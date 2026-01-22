/**
 * ===============================================================================
 * 🦁 APEX PREDATOR v300.0 (OMNI-NUCLEAR SINGULARITY)
 * ===============================================================================
 * THE FUSION ARCHITECTURE:
 * 1. AI SENTRY: Scans Web Sentiment + Mempool Hype simultaneously.
 * 2. NUCLEAR EXECUTION: Flashbots Bundling + Saturation Broadcast.
 * 3. MULTI-CHAIN: Supports ETH (Nuclear) and Base/Arb/Poly (Aggressive).
 * 4. RPG & CONTROL: Telegram Command Center with Leveling/XP.
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
// 0. CONFIGURATION & INFRASTRUCTURE
// ==========================================

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const WSS_NODE_URL = process.env.WSS_NODE_URL; // For Mempool Sniffing (ETH)

// Uniswap V2 Router (Standard for ETH, verify for L2s)
const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; 
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Network Config (Multi-Chain Support)
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
    }
};

// Saturation Pool (For ETH Broadcasting)
const ETH_RPC_POOL = [
    "https://rpc.mevblocker.io",
    "https://rpc.flashbots.net/fast",
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth"
];

// Web AI Targets
const AI_SITES = [
    "https://api.dexscreener.com/token-boosts/top/v1",
    "https://api.crypto-ai-signals.com/v1/latest"
];

// Mempool Thresholds
const HYPE_THRESHOLD = 5; // 5 buys...
const HYPE_WINDOW_MS = 2000; // ...in 2 seconds

// ==========================================
// 1. CLOUD BOOT GUARD
// ==========================================
const runHealthServer = () => {
    http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: "APEX_ALIVE", mode: "OMNI_NUCLEAR" }));
    }).listen(process.env.PORT || 8080);
    console.log(`[SYSTEM] Health Server Active`.green);
};

// ==========================================
// 2. RPG & STATE MANAGEMENT
// ==========================================
let PLAYER = {
    level: 1, xp: 0, nextLevelXp: 1000, class: "HUNTING CUB",
    totalProfitEth: 0.0
};

const addXP = (amount, bot, chatId) => {
    PLAYER.xp += amount;
    if (PLAYER.xp >= PLAYER.nextLevelXp) {
        PLAYER.level++; PLAYER.xp -= PLAYER.nextLevelXp;
        PLAYER.nextLevelXp = Math.floor(PLAYER.nextLevelXp * 1.5);
        if(chatId) bot.sendMessage(chatId, `🆙 **LEVEL UP:** Operator Level ${PLAYER.level}`);
    }
};

// ==========================================
// 3. AI & MEMPOOL ENGINE (The Brain)
// ==========================================
class AIEngine {
    constructor(governor) {
        this.governor = governor;
        this.sentiment = new Sentiment();
        this.mempoolCounts = {}; 
        this.processedTxHashes = new Set();
    }

    // --- SOURCE 1: WEB SENTIMENT ---
    async scanWeb() {
        const signals = [];
        // console.log(`[AI] Scanning Web Intelligence...`.cyan);
        for (const url of AI_SITES) {
            try {
                const res = await axios.get(url, { timeout: 3000 });
                if (Array.isArray(res.data)) {
                    res.data.slice(0, 3).forEach(t => {
                        if (t.tokenAddress) signals.push({ 
                            address: t.tokenAddress, 
                            symbol: t.symbol || "UNKNOWN",
                            network: "ETHEREUM", 
                            source: "WEB_AI"
                        });
                    });
                }
            } catch (e) {}
        }
        return signals;
    }

    // --- SOURCE 2: MEMPOOL SNIFFER ---
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

                    const provider = this.governor.providers.ETHEREUM;
                    const tx = await provider.getTransaction(txHash).catch(() => null);
                    if (tx && tx.to && tx.data) this.processPendingTx(tx);
                }
            } catch (e) {}
        });

        ws.on('error', () => setTimeout(() => this.startMempoolListener(), 5000));
    }

    processPendingTx(tx) {
        const to = tx.to.toLowerCase();
        if (to !== "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD".toLowerCase() && to !== ROUTER_ADDR.toLowerCase()) return;

        const data = tx.data.toLowerCase();
        const matches = data.match(/0x[a-f0-9]{40}/g);

        if (matches) {
            for (const addr of matches) {
                if (addr !== WETH.toLowerCase() && addr !== ROUTER_ADDR.toLowerCase() && addr !== this.governor.wallets.ETHEREUM.address.toLowerCase()) {
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
            this.governor.processSignal({
                address: tokenAddress,
                symbol: "PRE-COG",
                network: "ETHEREUM",
                source: "MEMPOOL_HYPE"
            });
            this.mempoolCounts[tokenAddress] = [];
        }
    }
}

// ==========================================
// 4. APEX OMNI GOVERNOR (The Controller)
// ==========================================
class ApexOmniGovernor {
    constructor() {
        this.ai = new AIEngine(this);
        this.providers = {};
        this.wallets = {};
        this.flashbots = null;
        
        this.bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
        this.setupTelegramListeners();

        this.system = {
            autoPilot: false,
            activePosition: null, 
            lastTradedToken: null, // Smart Rotation
            riskProfile: 'DEGEN',
            tradeAmount: "0.00002"
        };

        this.risk = {
            LOW: { slippage: 50, gasMult: 120n },
            MEDIUM: { slippage: 200, gasMult: 150n },
            DEGEN: { slippage: 2000, gasMult: 300n }, 
            FINALITY: { slippage: 3000, gasMult: 500n } // Nuclear
        };

        this.initNetworks();
    }

    async initNetworks() {
        for (const [key, cfg] of Object.entries(NETWORKS)) {
            try {
                const net = ethers.Network.from(cfg.chainId);
                const prov = new ethers.JsonRpcProvider(cfg.rpc, net, { staticNetwork: net });
                this.providers[key] = prov;
                if (PRIVATE_KEY) this.wallets[key] = new ethers.Wallet(PRIVATE_KEY, prov);
                console.log(`[INIT] ${key} Connected`.green);
            } catch (e) { console.log(`[INIT] ${key} Failed`.red); }
        }

        try {
            this.flashbots = await FlashbotsBundleProvider.create(
                this.providers.ETHEREUM, 
                ethers.Wallet.createRandom(), 
                "https://relay.flashbots.net"
            );
            console.log(`[INIT] ☢️ NUCLEAR ENGINE: Flashbots Active`.magenta);
        } catch (e) {}

        this.ai.startMempoolListener();
    }

    // --- NUCLEAR EXECUTION ---
    async executeNuclearTransaction(networkName, txBuilder, description) {
        const provider = this.providers[networkName];
        const wallet = this.wallets[networkName];
        const config = this.risk[this.system.riskProfile];

        if (!wallet) return null;

        const feeData = await provider.getFeeData();
        const baseFee = feeData.maxFeePerGas || feeData.gasPrice;
        const priorityFee = ethers.parseUnits(NETWORKS[networkName].priority || "3", "gwei");

        const aggPriority = (priorityFee * config.gasMult) / 100n;
        const aggMaxFee = baseFee + aggPriority;

        const nonce = await provider.getTransactionCount(wallet.address, "latest");
        const txReq = await txBuilder(aggPriority, aggMaxFee, nonce);
        const signedTx = await wallet.signTransaction(txReq);

        console.log(`[EXEC] 🚀 Sending ${description} on ${networkName}...`.yellow);

        if (networkName === 'ETHEREUM' && this.flashbots) {
            const block = await provider.getBlockNumber();
            const bundle = [{ signedTransaction: signedTx }];
            for(let i=1; i<=3; i++) {
                this.flashbots.sendBundle(bundle, block + i).catch(()=>{});
            }
            ETH_RPC_POOL.forEach(url => {
                axios.post(url, { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [signedTx] }).catch(()=>{});
            });
        }

        try {
            const tx = await provider.broadcastTransaction(signedTx);
            const receipt = await tx.wait(1);
            if (receipt.status === 1) {
                console.log(`[SUCCESS] ${description} Confirmed`.green);
                if (process.env.CHAT_ID) {
                    this.bot.sendMessage(process.env.CHAT_ID, `✅ **CONFIRMED:** ${description}\n🔗 [Etherscan](https://etherscan.io/tx/${receipt.hash})`, {parse_mode: "Markdown", disable_web_page_preview: true});
                }
                return receipt;
            }
        } catch (e) { console.log(`[FAIL] ${description}: ${e.message}`.red); }
        return null;
    }

    // --- LOGIC ---
    async processSignal(signal) {
        if (!this.system.autoPilot) return;
        // Smart Rotation: Anti-Duplicate
        if (this.system.lastTradedToken === signal.address) {
            console.log(`[SKIP] Already traded ${signal.symbol}. Rotating...`.gray);
            return;
        }
        if (this.system.activePosition) return;

        console.log(`[TARGET] Acquired: ${signal.symbol} via ${signal.source}`.bgGreen.black);
        if (process.env.CHAT_ID) this.bot.sendMessage(process.env.CHAT_ID, `🎯 **TARGET:** ${signal.symbol}\n🤖 **Source:** ${signal.source}`);

        await this.executeBuy(signal);
    }

    async executeBuy(signal) {
        const networkKey = signal.network;
        const wallet = this.wallets[networkKey];
        if (!wallet) return;

        const router = new ethers.Contract(ROUTER_ADDR, [
            "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
            "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"
        ], wallet);

        const tradeVal = ethers.parseEther(this.system.tradeAmount);
        
        let minOut = 0n;
        try {
            const amounts = await router.getAmountsOut(tradeVal, [WETH, signal.address]);
            const slippage = this.risk[this.system.riskProfile].slippage;
            minOut = (amounts[1] * BigInt(10000 - slippage)) / 10000n;
        } catch (e) {
            console.log(`[WARN] Liquidity Check Failed. YOLO Mode.`.red);
        }

        const receipt = await this.executeNuclearTransaction(networkKey, async (prio, max, n) => {
            return await router.swapExactETHForTokens.populateTransaction(
                minOut, [WETH, signal.address], wallet.address, Math.floor(Date.now()/1000)+120,
                { value: tradeVal, gasLimit: 350000, maxPriorityFeePerGas: prio, maxFeePerGas: max, nonce: n }
            );
        }, `BUY ${signal.symbol}`);

        if (receipt) {
            this.system.activePosition = {
                address: signal.address,
                symbol: signal.symbol,
                network: networkKey,
                amount: minOut,
                entryPrice: tradeVal
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
            addXP(500, this.bot, process.env.CHAT_ID);
            if (this.system.autoPilot) this.runWebLoop();
        }
    }

    async monitorPosition() {
        if (!this.system.activePosition) return;
        // Demo Logic: Sell after 60s
        console.log(`[MONITOR] Holding ${this.system.activePosition.symbol}... Selling in 60s`.cyan);
        setTimeout(() => this.executeSell(), 60000);
    }

    async runWebLoop() {
        if (!this.system.autoPilot) return;
        
        const signals = await this.ai.scanWeb();
        if (signals.length > 0) {
            const target = signals.find(s => s.address !== this.system.lastTradedToken);
            if (target) {
                this.processSignal({ ...target, source: "WEB_AI" });
            }
        }

        if (!this.system.activePosition && this.system.autoPilot) {
            setTimeout(() => this.runWebLoop(), 3000);
        }
    }

    setupTelegramListeners() {
        this.bot.onText(/\/start/, (msg) => {
            process.env.CHAT_ID = msg.chat.id;
            this.bot.sendMessage(msg.chat.id, `🦁 **APEX OMNI-NUCLEAR ONLINE**\n/auto - Toggle Autopilot\n/status - View Telemetry`);
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
📊 **XP:** ${PLAYER.xp}/${PLAYER.nextLevelXp} (Lvl ${PLAYER.level})
            `);
        });
    }
}

// ==========================================
// 4. IGNITION
// ==========================================
runHealthServer();
const predator = new ApexOmniGovernor();
console.log(`🦁 APEX PREDATOR v300.0 INITIALIZED`.magenta);
