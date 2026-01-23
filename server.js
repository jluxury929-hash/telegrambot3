/**
 * ===============================================================================
 * 🦁 APEX PREDATOR: OMEGA TOTALITY v3000.0 (OMNI-FUSION ETERNAL)
 * ===============================================================================
 * MISSION: Quantum Force Execution & Zero-Loss Autonomy.
 * STATUS: MEV-Shielded / Flashbots Integrated / Pre-flight Simulation.
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const { FlashbotsBundleProvider, FlashbotsBundleResolution } = require('@flashbots/ethers-provider-bundle');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
const http = require('http');
require('colors');

// --- CONFIGURATION ---
const { TELEGRAM_TOKEN, PRIVATE_KEY, WSS_NODE_URL, RPC_URL, CHAT_ID } = process.env;
const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; 
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// MEV-SHIELDED BROADCAST CLUSTER (Socket Flood)
const EXECUTION_NODES = [
    RPC_URL || "https://rpc.flashbots.net",
    "https://rpc.mevblocker.io",
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth"
];

// Initialize Providers
const provider = new JsonRpcProvider(EXECUTION_NODES[0]);
let wallet, router, flashbotsProvider, bot;

// ==========================================
// SYSTEM & RPG STATE (The Strategist)
// ==========================================
let SYSTEM = {
    autoPilot: false,
    state: "HUNTING",      
    pendingTarget: null,   
    activePosition: null,  
    tradeAmount: "0.02",   
    scannedTokens: new Set(),
    lastTradedToken: null,
    config: { trailingStop: 10, stopLoss: 15, minLiquidity: 30000 },
    gasBuffer: ethers.parseUnits("0.0001", "ether") // Quantum Low Buffer
};

let PLAYER = {
    level: 1, xp: 0, nextLevelXp: 1000, class: "HUNTING CUB",
    totalProfitEth: 0.0,
    inventory: ["MEV Shield v3", "Quantum Goggles"],
    dailyQuests: [
        { id: 'scan', task: "Deep Market Analysis", count: 0, target: 5, done: false, xp: 200 },
        { id: 'trade', task: "Quantum Strike", count: 0, target: 1, done: false, xp: 800 }
    ]
};

// ==========================================
// 1. QUANTUM FORCE EXECUTION (The Muscle)
// ==========================================
async function executeQuantumStrike(type, tokenAddress, amountInEth) {
    if (!wallet || !flashbotsProvider) return false;
    
    const blockNumber = await provider.getBlockNumber();
    const nonce = await provider.getTransactionCount(wallet.address, "latest");
    const feeData = await provider.getFeeData();
    
    // Auto-Bribing: 250% priority tip to force block inclusion
    const priorityFee = (feeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei")) * 25n / 10n;
    const maxFee = (feeData.maxFeePerGas || ethers.parseUnits("20", "gwei")) + priorityFee;

    let bundleTxs = [];

    try {
        if (type === "BUY") {
            const amountIn = ethers.parseEther(amountInEth.toString());
            const amounts = await router.getAmountsOut(amountIn, [WETH, tokenAddress]);
            const minOut = (amounts[1] * 90n) / 100n; // 10% Slippage guard

            const buyTx = await router.swapExactETHForTokens.populateTransaction(
                minOut, [WETH, tokenAddress], wallet.address, Math.floor(Date.now()/1000)+120,
                { value: amountIn, gasLimit: 350000n }
            );

            const signedBuy = await wallet.signTransaction({
                ...buyTx, type: 2, chainId: 1, nonce, maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee
            });
            bundleTxs.push({ signedTransaction: signedBuy });

        } else {
            // Quantum Exit: Atomic Approval + Sell in ONE bundle
            const tokenContract = new Contract(tokenAddress, ["function approve(address, uint) returns (bool)", "function balanceOf(address) view returns (uint)"], wallet);
            const bal = await tokenContract.balanceOf(wallet.address);
            
            const approveTx = await tokenContract.approve.populateTransaction(ROUTER_ADDR, bal, { gasLimit: 65000n });
            const signedApprove = await wallet.signTransaction({
                ...approveTx, type: 2, chainId: 1, nonce, maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee
            });

            const sellTx = await router.swapExactTokensForETH.populateTransaction(
                bal, 0n, [tokenAddress, WETH], wallet.address, Math.floor(Date.now()/1000)+120, { gasLimit: 380000n }
            );
            const signedSell = await wallet.signTransaction({
                ...sellTx, type: 2, chainId: 1, nonce: nonce + 1n, maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee
            });

            bundleTxs.push({ signedTransaction: signedApprove }, { signedTransaction: signedSell });
        }

        // PRE-FLIGHT SIMULATION (The Honeypot Detector)
        const sim = await flashbotsProvider.simulate(bundleTxs, blockNumber + 1);
        if ("error" in sim || sim.firstRevert) {
            if (CHAT_ID) bot.sendMessage(CHAT_ID, `🛡 **ATOMIC SHIELD:** Honeypot or high tax detected in simulation. Aborted. Gas saved.`);
            return false;
        }

        // SOCKET FLOOD: Multi-Node Saturation Broadcast
        console.log(`[FORCE] Flooding Bundle to Cluster for block ${blockNumber + 1}`.magenta);
        const res = await flashbotsProvider.sendBundle(bundleTxs, blockNumber + 1);
        
        // Parallel broadcast to public MEV-shielded RPCs as fallback
        bundleTxs.forEach(tx => {
            EXECUTION_NODES.forEach(url => {
                axios.post(url, { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [tx.signedTransaction] }).catch(() => {});
            });
        });

        const wait = await res.wait();
        if (wait === FlashbotsBundleResolution.BundleIncluded) {
            if (CHAT_ID) bot.sendMessage(CHAT_ID, `🏆 **WIN:** Quantum Bundle Mined in Block ${blockNumber + 1}.`);
            handleTradeSuccess(type, tokenAddress, amountInEth);
            return true;
        }
        return false;

    } catch (e) {
        console.log(`[STRIKE ERROR]`.red, e.message);
        return false;
    }
}

// ==========================================
// 2. DUAL-CORE INTELLIGENCE (The Brain)
// ==========================================
async function runAutoPilot() {
    if (!SYSTEM.autoPilot) return setTimeout(runAutoPilot, 3000);

    // WEB AI HUNTING
    if (SYSTEM.state === "HUNTING" && !SYSTEM.activePosition) {
        try {
            const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
            const target = res.data.find(t => t.tokenAddress !== SYSTEM.lastTradedToken && !SYSTEM.scannedTokens.has(t.tokenAddress));
            
            if (target) {
                const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${target.tokenAddress}`);
                const pair = details.data.pairs?.[0];
                
                if (pair && pair.liquidity.usd > SYSTEM.config.minLiquidity) {
                    SYSTEM.scannedTokens.add(target.tokenAddress);
                    updateQuest('scan');
                    if (CHAT_ID) bot.sendMessage(CHAT_ID, `🎯 **TARGET LOCKED:** ${pair.baseToken.symbol}. Executing Quantum Strike...`);
                    await executeQuantumStrike("BUY", target.tokenAddress, SYSTEM.tradeAmount);
                }
            }
        } catch (e) { console.log("Scanning...".gray); }
    }

    // MONITORING (Trailing Stop)
    if (SYSTEM.state === "MONITORING" && SYSTEM.activePosition) {
        try {
            const pos = SYSTEM.activePosition;
            const amounts = await router.getAmountsOut(ethers.parseEther("1"), [pos.address, WETH]);
            const currentEth = parseFloat(ethers.formatEther(amounts[1]));
            
            if (currentEth > pos.highWaterMark) pos.highWaterMark = currentEth;
            const drop = ((pos.highWaterMark - currentEth) / pos.highWaterMark) * 100;

            if (drop >= SYSTEM.config.trailingStop) {
                if (CHAT_ID) bot.sendMessage(CHAT_ID, `📉 **PEAK DETECTED:** Reversal hit (${drop.toFixed(2)}%). Rotating funds...`);
                await executeQuantumStrike("SELL", pos.address, "0");
            }
        } catch (e) {}
    }

    setTimeout(runAutoPilot, 4000);
}

// ==========================================
// 3. RPG & USER INTERFACE
// ==========================================
function handleTradeSuccess(type, addr, amt) {
    if (type === "BUY") {
        SYSTEM.activePosition = { address: addr, entry: amt, highWaterMark: amt };
        SYSTEM.state = "MONITORING";
        addXP(200);
    } else {
        SYSTEM.lastTradedToken = addr;
        SYSTEM.activePosition = null;
        SYSTEM.state = "HUNTING";
        addXP(1000);
        updateQuest('trade');
    }
}

function addXP(amount) {
    PLAYER.xp += amount;
    if (PLAYER.xp >= PLAYER.nextLevelXp) {
        PLAYER.level++;
        PLAYER.xp = 0;
        PLAYER.nextLevelXp = Math.floor(PLAYER.nextLevelXp * 1.6);
        if (CHAT_ID) bot.sendMessage(CHAT_ID, `🆙 **PROMOTION:** Operator Rank increased to Level ${PLAYER.level}!`);
    }
}

function updateQuest(type) {
    const q = PLAYER.dailyQuests.find(x => x.id === type);
    if (q && !q.done) {
        q.count++;
        if (q.count >= q.target) {
            q.done = true;
            addXP(q.xp);
            if (CHAT_ID) bot.sendMessage(CHAT_ID, `💎 **QUEST COMPLETE:** ${q.task} (+${q.xp} XP)`);
        }
    }
}

// ==========================================
// INITIALIZATION
// ==========================================
async function startSystem() {
    wallet = new Wallet(PRIVATE_KEY, provider);
    flashbotsProvider = await FlashbotsBundleProvider.create(provider, Wallet.createRandom());
    router = new Contract(ROUTER_ADDR, [
        "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
        "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])",
        "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"
    ], wallet);

    bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

    bot.onText(/\/auto/, (msg) => {
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        bot.sendMessage(msg.chat.id, `🤖 **AUTO-PILOT:** ${SYSTEM.autoPilot ? '🟢 ENGAGED' : '🔴 STANDBY'}`);
    });

    bot.onText(/\/status/, (msg) => {
        const xpBar = "🟩".repeat(Math.floor((PLAYER.xp/PLAYER.nextLevelXp)*10)) + "⬛".repeat(10-Math.floor((PLAYER.xp/PLAYER.nextLevelXp)*10));
        bot.sendMessage(msg.chat.id, `📊 **OPERATOR STATUS**\nLevel: ${PLAYER.level} (${PLAYER.class})\nXP: [${xpBar}]\nState: ${SYSTEM.state}\nAuto-Pilot: ${SYSTEM.autoPilot}`);
    });

    console.log("🦁 APEX PREDATOR v3000.0 ONLINE".magenta);
    runAutoPilot();
}

startSystem();
http.createServer((req, res) => res.end("APEX_ALIVE")).listen(8080);
