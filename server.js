/**
 * ===============================================================================
 * 🦁 APEX PREDATOR v400.0 (OMNI-FUSION SINGULARITY)
 * ===============================================================================
 * THE ULTIMATE MERGE:
 * 1. AI SENTRY: Scans Web Sentiment (Script 1) + Mempool Hype (Script 3).
 * 2. NUCLEAR EXECUTION: Flashbots + Saturation Broadcast (Script 2).
 * 3. MULTI-CHAIN: Supports ETH, BASE, ARB, POLY (Script 1).
 * 4. SMART ROTATION: Auto-skips duplicates (Script 2).
 * ===============================================================================
 */

require('dotenv').config();
const { ethers } = require('ethers');
const { FlashbotsBundleProvider } = require("@flashbots/ethers-provider-bundle");
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
const axios = require('axios');
const Sentiment = require('sentiment');
const fs = require('fs');
const http = require('http');
require('colors');

// ==========================================
// 0. CONFIGURATION
// ==========================================

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const WSS_NODE_URL = process.env.WSS_NODE_URL; // Required for Mempool Sniffing

// Uniswap V2 Router (ETH/Base/Arb often use same address, verify per chain)
const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; 
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Network Definitions (from Script 1)
const NETWORKS = {
    ETHEREUM: { 
        chainId: 1, 
        rpc: process.env.ETH_RPC || "https://rpc.mevblocker.io", 
        flashbots: true,
        priority: "50.0"
    },
    BASE: { 
        chainId: 8453, 
        rpc: process.env.BASE_RPC || "https://mainnet.base.org", 
        flashbots: false,
        priority: "1.5"
    },
    ARBITRUM: { 
        chainId: 42161, 
        rpc: process.env.ARB_RPC || "https://arb1.arbitrum.io/rpc", 
        flashbots: false,
        priority: "1.0" 
    },
    POLYGON: { 
        chainId: 137, 
        rpc: process.env.POLY_RPC || "https://polygon-rpc.com", 
        flashbots: false,
        priority: "200.0" 
    }
};

// Web AI Targets (from Script 1)
const AI_SITES = [
    "https://api.dexscreener.com/token-boosts/top/v1",
    "https://api.crypto-ai-signals.com/v1/latest"
];

// Saturation Pool for ETH Broadcasting (from Script 2)
const ETH_RPC_POOL = [
    "https://rpc.mevblocker.io",
    "https://rpc.flashbots.net/fast",
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth"
];

// Mempool Thresholds (from Script 3)
const HYPE_THRESHOLD = 5;
const HYPE_WINDOW_MS = 2000;

// ==========================================
// 1. CLOUD BOOT GUARD
// ==========================================
const runHealthServer = () => {
    http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: "APEX_ALIVE", 
            mode: "OMNI_FUSION",
            mempool_active: !!WSS_NODE_URL
        }));
    }).listen(process.env.PORT || 8080);
    console.log(`[SYSTEM] Health Server Active`.green);
};

// ==========================================
// 2. AI & MEMPOOL ENGINE (The Brain)
// ==========================================
class AIEngine {
    constructor(governor) {
        this.governor = governor;
        this.trustFile = "trust_scores.json";
        this.sentiment = new Sentiment();
        this.trustScores = this.loadTrust();
        
        // Mempool State
        this.mempoolCounts = {}; 
        this.processedTxHashes = new Set();
    }

    loadTrust() {
        try { return JSON.parse(fs.readFileSync(this.trustFile, 'utf8')); } 
        catch (e) { return { WEB_AI: 0.85, MEMPOOL: 0.95 }; }
    }

    updateTrust(source, success) {
        let current = this.trustScores[source] || 0.5;
        current = success ? Math.min(0.99, current * 1.05) : Math.max(0.1, current * 0.90);
        this.trustScores[source] = current;
        try { fs.writeFileSync(this.trustFile, JSON.stringify(this.trustScores)); } catch(e){}
    }

    // --- SOURCE 1: WEB SCANNER (Script 1) ---
    async scanWeb() {
        const signals = [];
        // console.log(`[AI] Scanning Web Intelligence...`.cyan);
        
        for (const url of AI_SITES) {
            try {
                const res = await axios.get(url, { timeout: 3000 });
                // DexScreener Logic
                if (Array.isArray(res.data)) {
                    res.data.slice(0, 3).forEach(t => {
                        if (t.tokenAddress) signals.push({ 
                            address: t.tokenAddress, 
                            symbol: t.symbol || "UNKNOWN",
                            network: "ETHEREUM", // Default, could parse chainId from response
                            source: "WEB_AI"
                        });
                    });
                }
            } catch (e) {}
        }
        return signals;
    }

    // --- SOURCE 2: MEMPOOL LISTENER (Script 3) ---
    startMempoolListener() {
        if (!WSS_NODE_URL) {
            console.log(`[WARN] No WSS_NODE_URL! Mempool Sniffer Disabled.`.red);
            return;
        }

        console.log(`[MEMPOOL] 📡 Connecting to Hype Stream...`.cyan);
        const ws = new WebSocket(WSS_NODE_URL); 

        ws.on('open', () => {
            console.log(`[MEMPOOL] ✅ Connected. Scanning...`.green);
            ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newPendingTransactions"] }));
        });

        ws.on('message', async (data) => {
            if (!this.governor.system.autoPilot || this.governor.system.activePosition) return;

            try {
                const response = JSON.parse(data);
                if (response.method === "eth_subscription") {
                    const txHash = response.params.result;
                    if (this.processedTxHashes.has(txHash)) return;
                    this.processedTxHashes.add(txHash);
                    if (this.processedTxHashes.size > 5000) this.processedTxHashes.clear();

                    // Fetch TX (Note: Rate limits apply on public nodes)
                    const provider = this.governor.providers.ETHEREUM;
                    const tx = await provider.getTransaction(txHash).catch(() => null);
                    if (tx && tx.to && tx.data) this.processPendingTx(tx);
                }
            } catch (e) {}
        });

        ws.on('error', (e) => {
            console.log(`[MEMPOOL] Reconnecting...`.red);
            setTimeout(() => this.startMempoolListener(), 5000);
        });
    }

    processPendingTx(tx) {
        // Basic Router Detection (Uniswap Universal / V2)
        const routers = ["0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD", ROUTER_ADDR];
        if (!routers.includes(tx.to)) return;

        // Naive Calldata Decode
        const data = tx.data.toLowerCase();
        const addressRegex = /0x[a-f0-9]{40}/g;
        const matches = data.match(addressRegex);

        if (matches) {
            for (const addr of matches) {
                // Ignore WETH and Routers
                if (addr !== WETH.toLowerCase() && !routers.map(r=>r.toLowerCase()).includes(addr)) {
                    this.updateHypeCounter(addr);
                    break;
                }
            }
        }
    }

    updateHypeCounter(tokenAddress) {
        const now = Date.now();
        if (!this.mempoolCounts[tokenAddress]) this.mempoolCounts[tokenAddress] = [];
        this.mempoolCounts[tokenAddress].push(now);
        this.mempoolCounts[tokenAddress] = this.mempoolCounts[tokenAddress].filter(t => now - t < HYPE_WINDOW_MS);

        if (this.mempoolCounts[tokenAddress].length >= HYPE_THRESHOLD) {
            // TRIGGER ATTACK
            this.governor.processSignal({
                address: tokenAddress,
                symbol: "PRE-COG",
                network: "ETHEREUM",
                source: "MEMPOOL"
            });
            this.mempoolCounts[tokenAddress] = []; // Reset
        }
    }
}

// ==========================================
// 3. APEX OMNI GOVERNOR (The Controller)
// ==========================================
class ApexOmniGovernor {
    constructor() {
        this.ai = new AIEngine(this);
        this.providers = {};
        this.wallets = {};
        this.flashbots = null;
        
        // Telegram Setup
        this.bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
        this.setupTelegramListeners();

        // System State
        this.system = {
            autoPilot: false,
            activePosition: null, 
            lastTradedToken: null, // Smart Rotation Memory
            riskProfile: 'DEGEN',
            tradeAmount: "0.00002"
        };

        // Risk Configs (Merged)
        this.risk = {
            LOW: { slippage: 50, gasMult: 120n },
            MEDIUM: { slippage: 200, gasMult: 150n },
            DEGEN: { slippage: 2000, gasMult: 300n }, // Nuclear
            FINALITY: { slippage: 3000, gasMult: 500n } // Pre-Cog Max
        };

        this.initNetworks();
    }

    async initNetworks() {
        // Initialize Providers & Wallets
        for (const [key, cfg] of Object.entries(NETWORKS)) {
            try {
                const net = ethers.Network.from(cfg.chainId);
                const prov = new ethers.JsonRpcProvider(cfg.rpc, net, { staticNetwork: net });
                this.providers[key] = prov;
                if (PRIVATE_KEY) {
                    this.wallets[key] = new ethers.Wallet(PRIVATE_KEY, prov);
                    console.log(`[INIT] ${key} Connected: ${this.wallets[key].address}`.green);
                }
            } catch (e) { console.log(`[INIT] ${key} Failed`.red); }
        }

        // Initialize Flashbots (ETH Only)
        try {
            this.flashbots = await FlashbotsBundleProvider.create(
                this.providers.ETHEREUM, 
                ethers.Wallet.createRandom(), 
                "https://relay.flashbots.net"
            );
            console.log(`[INIT] ☢️ NUCLEAR ENGINE: Flashbots Active`.magenta);
        } catch (e) { console.log(`[INIT] Flashbots Failed`.red); }

        // Start Mempool Listener
        this.ai.startMempoolListener();
    }

    // --- NUCLEAR EXECUTION LOGIC (Script 2) ---
    async executeNuclearTransaction(networkName, txBuilder, description) {
        const provider = this.providers[networkName];
        const wallet = this.wallets[networkName];
        const config = this.risk[this.system.riskProfile];

        if (!wallet) return null;

        // Dynamic Gas Calculation
        const feeData = await provider.getFeeData();
        const baseFee = feeData.maxFeePerGas || feeData.gasPrice;
        
        // Use Network-Specific Priority or Default
        let prioVal = NETWORKS[networkName].priority || "3";
        const priorityFee = ethers.parseUnits(prioVal, "gwei");

        // Aggressive Gas Multiplier
        const aggPriority = (priorityFee * config.gasMult) / 100n;
        const aggMaxFee = baseFee + aggPriority;

        const nonce = await provider.getTransactionCount(wallet.address, "latest");
        const txReq = await txBuilder(aggPriority, aggMaxFee, nonce);
        const signedTx = await wallet.signTransaction(txReq);

        console.log(`[EXEC] 🚀 Sending ${description} on ${networkName}...`.yellow);

        // Flashbots Route (ETH Only)
        if (networkName === 'ETHEREUM' && this.flashbots) {
            const block = await provider.getBlockNumber();
            const bundle = [{ signedTransaction: signedTx }];
            // Target Next 3 Blocks (Script 2 Logic)
            for(let i=1; i<=3; i++) {
                this.flashbots.sendBundle(bundle, block + i).catch(()=>{});
            }
            
            // Saturation Broadcast (Script 2)
            ETH_RPC_POOL.forEach(url => {
                axios.post(url, { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [signedTx] }).catch(()=>{});
            });
        }

        // Standard Broadcast (All Networks)
        try {
            const tx = await provider.broadcastTransaction(signedTx);
            const receipt = await tx.wait(1);
            if (receipt.status === 1) {
                console.log(`[SUCCESS] ${description} Confirmed: ${receipt.hash}`.green);
                if (process.env.CHAT_ID) {
                    this.bot.sendMessage(process.env.CHAT_ID, `✅ **CONFIRMED:** ${description}\n🔗 [View](${receipt.hash})`, {parse_mode: "Markdown"});
                }
                return receipt;
            }
        } catch (e) {
            console.log(`[FAIL] ${description}: ${e.message}`.red);
        }
        return null;
    }

    // --- MAIN LOGIC HUB ---
    async processSignal(signal) {
        // 1. Check Autopilot
        if (!this.system.autoPilot && signal.source !== "MANUAL") return;

        // 2. Smart Rotation (Script 2)
        if (this.system.lastTradedToken === signal.address) {
            console.log(`[SKIP] Already traded ${signal.symbol}. Rotating...`.gray);
            return;
        }

        // 3. Busy Check
        if (this.system.activePosition) return;

        console.log(`[TARGET] Acquired: ${signal.symbol} via ${signal.source}`.bgGreen.black);
        if (process.env.CHAT_ID) this.bot.sendMessage(process.env.CHAT_ID, `🎯 **TARGET ACQUIRED:** ${signal.symbol}\n🤖 **Source:** ${signal.source}`);

        await this.executeBuy(signal);
    }

    async executeBuy(signal) {
        const networkKey = signal.network;
        const wallet = this.wallets[networkKey];
        if (!wallet) return;

        // Router Contract
        const router = new ethers.Contract(ROUTER_ADDR, [
            "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
            "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"
        ], wallet);

        const tradeVal = ethers.parseEther(this.system.tradeAmount);
        
        // Slippage Calc
        let minOut = 0n;
        try {
            const amounts = await router.getAmountsOut(tradeVal, [WETH, signal.address]);
            const slippage = this.risk[this.system.riskProfile].slippage;
            minOut = (amounts[1] * BigInt(10000 - slippage)) / 10000n;
        } catch (e) {
            console.log(`[WARN] Liquidity check failed. Using 0 minOut (YOLO).`.red);
        }

        // Execute Nuclear Tx
        const receipt = await this.executeNuclearTransaction(networkKey, async (prio, max, n) => {
            return await router.swapExactETHForTokens.populateTransaction(
                minOut, [WETH, signal.address], wallet.address, Math.floor(Date.now()/1000)+120,
                { value: tradeVal, gasLimit: 300000, maxPriorityFeePerGas: prio, maxFeePerGas: max, nonce: n }
            );
        }, `BUY ${signal.symbol}`);

        if (receipt) {
            this.system.activePosition = {
                address: signal.address,
                symbol: signal.symbol,
                network: networkKey,
                amount: minOut,
                entryPrice: tradeVal,
                startPrice: 0 // Will fetch
            };
            this.system.lastTradedToken = signal.address;
            this.monitorPosition();
        }
    }

    async executeSell() {
        if (!this.system.activePosition) return;
        const pos = this.system.activePosition;
        const wallet = this.wallets[pos.network];

        const token = new ethers.Contract(pos.address, ["function approve(address, uint) returns (bool)"], wallet);
        const router = new ethers.Contract(ROUTER_ADDR, ["function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])"], wallet);

        console.log(`[SELL] Approving...`.yellow);
        await (await token.approve(ROUTER_ADDR, pos.amount)).wait();

        const receipt = await this.executeNuclearTransaction(pos.network, async (prio, max, n) => {
            return await router.swapExactTokensForETH.populateTransaction(
                pos.amount, 0n, [pos.address, WETH], wallet.address, Math.floor(Date.now()/1000)+120,
                { gasLimit: 350000, maxPriorityFeePerGas: prio, maxFeePerGas: max, nonce: n }
            );
        }, `SELL ${pos.symbol}`);

        if (receipt) {
            this.system.activePosition = null;
            if (this.system.autoPilot) this.runWebLoop(); // Resume hunting
        }
    }

    async monitorPosition() {
        if (!this.system.activePosition) return;
        // Simplified Logic: Sell after 1 minute or rely on manual override for now to save API calls
        // Real-time price monitoring requires constant RPC calls which is heavy for a consolidated script
        console.log(`[MONITOR] Holding ${this.system.activePosition.symbol}... Waiting 60s or Manual Sell`.cyan);
        setTimeout(() => this.executeSell(), 60000);
    }

    // --- WEB SCAN LOOP (Script 1 Logic) ---
    async runWebLoop() {
        if (!this.system.autoPilot) return;
        
        const signals = await this.ai.scanWeb();
        if (signals.length > 0) {
            // Find best signal not currently ignored
            const target = signals.find(s => s.address !== this.system.lastTradedToken);
            if (target) {
                this.processSignal({ ...target, source: "WEB_AI" });
            }
        }

        if (!this.system.activePosition && this.system.autoPilot) {
            setTimeout(() => this.runWebLoop(), 3000);
        }
    }

    // --- TELEGRAM LISTENERS ---
    setupTelegramListeners() {
        this.bot.onText(/\/start/, (msg) => {
            process.env.CHAT_ID = msg.chat.id;
            this.bot.sendMessage(msg.chat.id, `🦁 **APEX OMNI-FUSION ONLINE**\n/auto - Toggle Autopilot\n/status - View Telemetry`);
        });

        this.bot.onText(/\/auto/, (msg) => {
            this.system.autoPilot = !this.system.autoPilot;
            this.bot.sendMessage(msg.chat.id, `🤖 **AUTOPILOT:** ${this.system.autoPilot ? "ON" : "OFF"}`);
            if (this.system.autoPilot) this.runWebLoop();
        });

        this.bot.onText(/\/sell/, (msg) => this.executeSell());

        this.bot.onText(/\/status/, async (msg) => {
            const ethBal = await this.providers.ETHEREUM.getBalance(this.wallets.ETHEREUM.address);
            this.bot.sendMessage(msg.chat.id, `
📡 **TELEMETRY**
💰 **ETH:** ${ethers.formatEther(ethBal)}
🚀 **Mode:** ${this.system.autoPilot ? "HUNTING" : "IDLE"}
🎒 **Pos:** ${this.system.activePosition ? this.system.activePosition.symbol : "None"}
            `);
        });
    }
}

// ==========================================
// 4. IGNITION
// ==========================================
runHealthServer();
const predator = new ApexOmniGovernor();
console.log(`🦁 APEX PREDATOR v400.0 INITIALIZED`.magenta);
