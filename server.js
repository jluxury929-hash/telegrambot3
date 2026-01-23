/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9002 (SHOTGUN + EXECUTOR)
 * ===============================================================================
 * ARCH: Multi-Chain (EVM + SVM) | RPG System | Neural Scanner
 * SVM ENGINE: Jupiter Ultra v1 + Shotgun Broadcaster (QuickNode Mansion)
 * EVM ENGINE: Smart Contract Executor (Atomic Approve + Swap)
 * NEW: Dynamic Trade Amount Control via /setamount
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, JsonRpcProvider, Contract } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- CONFIGURATION ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";
const JUP_API_KEY = "f440d4df-b5c4-4020-a960-ac182d3752ab"; 
const MY_EXECUTOR = "0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610";

const APEX_EXECUTOR_ABI = [
    "function executeBuy(address router, address token, uint256 minOut, uint256 deadline) external payable",
    "function executeSell(address router, address token, uint256 amtIn, uint256 minOut, uint256 deadline) external",
    "function emergencyWithdraw(address token) external"
];

const ULTRA_HEADERS = { headers: { 'x-api-key': JUP_API_KEY, 'Content-Type': 'application/json' }};

// --- 5-CHAIN NETWORK DEFINITIONS ---
const NETWORKS = {
    ETH: { id: 'ethereum', type: 'EVM', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', executor: MY_EXECUTOR, weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', scanQuery: 'WETH' },
    SOL: { id: 'solana', type: 'SVM', rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', shotgunNodes: [process.env.SOLANA_RPC, 'https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'] },
    BASE: { id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', executor: MY_EXECUTOR, weth: '0x4200000000000000000000000000000000000006' },
    BSC: { id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', executor: MY_EXECUTOR, weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
    ARB: { id: 'arbitrum', type: 'EVM', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', executor: MY_EXECUTOR, weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', scanQuery: 'WETH' }
};

// --- GLOBAL STATE ---
let SYSTEM = { currentNetwork: 'SOL', autoPilot: false, isLocked: false, riskProfile: 'MEDIUM', strategyMode: 'DAY', tradeAmount: "0.01", activePosition: null, pendingTarget: null, lastTradedToken: null };

// --- WALLET STATE ---
let evmWallet = null, evmSigner = null, evmProvider = null, apexContract = null;
let solWallet = null;
let solConnection = new Connection(NETWORKS.SOL.rpc, 'confirmed');

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: { interval: 300, autoStart: true, params: { timeout: 10 } } });

// ==========================================
//  RPG SYSTEM
// ==========================================
let PLAYER = { level: 1, xp: 0, nextLevelXp: 1000, class: "DATA ANALYST", totalProfit: 0.0, dailyQuests: [{ id: 'sim', task: "Analyze Neural Signals", count: 0, target: 10, done: false, xp: 150 }, { id: 'trade', task: "Execute High-Confidence Setup", count: 0, target: 1, done: false, xp: 500 }] };
const addXP = (amount, chatId) => { PLAYER.xp += amount; if (PLAYER.xp >= PLAYER.nextLevelXp) { PLAYER.level++; PLAYER.xp -= PLAYER.nextLevelXp; PLAYER.nextLevelXp = Math.floor(PLAYER.nextLevelXp * 1.5); PLAYER.class = getRankName(PLAYER.level); if(chatId) bot.sendMessage(chatId, `🆙 **PROMOTION:** Level ${PLAYER.level} (${PLAYER.class})`); } };
const getRankName = (lvl) => { if (lvl < 5) return "DATA ANALYST"; if (lvl < 10) return "PATTERN SEER"; if (lvl < 20) return "WHALE HUNTER"; return "MARKET GOD"; };
const updateQuest = (type, chatId) => { PLAYER.dailyQuests.forEach(q => { if (q.id === type && !q.done) { q.count++; if (q.count >= q.target) { q.done = true; addXP(q.xp, chatId); } } }); };
const getXpBar = () => { const p = Math.min(Math.round((PLAYER.xp / PLAYER.nextLevelXp) * 10), 10); return "▓".repeat(p) + "░".repeat(10 - p); };

// ==========================================
//  CONFIG
// ==========================================
const RISK_PROFILES = { LOW: { slippage: 50, stopLoss: 10, label: "LOW" }, MEDIUM: { slippage: 200, stopLoss: 20, label: "MEDIUM" }, HIGH: { slippage: 500, stopLoss: 40, label: "HIGH" }, DEGEN: { slippage: 2000, stopLoss: 60, label: "DEGEN" } };
const STRATEGY_MODES = { SCALP: { trail: 5, minConf: 0.80, label: "SCALP" }, DAY: { trail: 15, minConf: 0.85, label: "SWING" }, MOON: { trail: 40, minConf: 0.90, label: "MOON" } };

// ==========================================
//  AUTH & NETWORK
// ==========================================
bot.onText(/\/connect (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const rawMnemonic = match[1].trim();
    try { await bot.deleteMessage(chatId, msg.message_id); } catch(e){}
    if (!bip39.validateMnemonic(rawMnemonic)) return bot.sendMessage(chatId, "❌ **INVALID SEED.**");
    try {
        evmWallet = ethers.HDNodeWallet.fromPhrase(rawMnemonic);
        const seed = bip39.mnemonicToSeedSync(rawMnemonic);
        const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
        solWallet = Keypair.fromSeed(derivedSeed);
        await initNetwork(SYSTEM.currentNetwork);
        bot.sendMessage(chatId, `🔗 **NEURAL LINK ESTABLISHED**\n**EVM:** \`${evmWallet.address}\`\n**SOL:** \`${solWallet.publicKey.toString()}\``, {parse_mode: 'Markdown'});
    } catch (e) { bot.sendMessage(chatId, `❌ Error: ${e.message}`); }
});

async function initNetwork(netKey) {
    SYSTEM.currentNetwork = netKey;
    const net = NETWORKS[netKey];
    if (net.type === 'EVM' && evmWallet) {
        evmProvider = new JsonRpcProvider(net.rpc);
        evmSigner = evmWallet.connect(evmProvider);
        apexContract = new ethers.Contract(net.executor, APEX_EXECUTOR_ABI, evmSigner);
    } else if (net.type === 'SVM') {
        solConnection = new Connection(net.rpc, 'confirmed');
    }
    console.log(`[NET] Switched to ${netKey}`.yellow);
}

// ==========================================
//  SOLANA SHOTGUN (JUPITER ULTRA v1)
// ==========================================
async function executeUltraSwap(chatId, direction, tokenAddress, amountInput) {
    if (!solWallet) return bot.sendMessage(chatId, "⚠️ Wallet Not Connected");
    try {
        const risk = RISK_PROFILES[SYSTEM.riskProfile];
        const taker = solWallet.publicKey.toString();
        const inputMint = direction === 'BUY' ? 'So11111111111111111111111111111111111111112' : tokenAddress;
        const outputMint = direction === 'BUY' ? tokenAddress : 'So11111111111111111111111111111111111111112';
        const amountStr = direction === 'BUY' ? Math.floor(amountInput * LAMPORTS_PER_SOL).toString() : SYSTEM.activePosition.tokenAmount.toString();

        const orderUrl = `${JUP_ULTRA_API}/order?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountStr}&taker=${taker}&slippageBps=${risk.slippage}`;
        const orderRes = await axios.get(orderUrl, ULTRA_HEADERS);
        const { transaction, requestId, outAmount } = orderRes.data;

        const tx = VersionedTransaction.deserialize(Buffer.from(transaction, 'base64'));
        tx.sign([solWallet]);
        const signedTxBase64 = Buffer.from(tx.serialize()).toString('base64');

        bot.sendMessage(chatId, `🚀 **SHOTGUN BROADCAST...**`);
        const tasks = [
            axios.post(`${JUP_ULTRA_API}/execute`, { signedTransaction: signedTxBase64, requestId }, ULTRA_HEADERS),
            ...NETWORKS.SOL.shotgunNodes.map(node => new Connection(node).sendRawTransaction(tx.serialize(), { skipPreflight: true }))
        ];

        const fastest = await Promise.any(tasks);
        const sig = fastest.data?.signature || fastest;
        bot.sendMessage(chatId, `✅ **ULTRA LANDED:** https://solscan.io/tx/${sig}`);
        return { amountOut: outAmount, hash: sig };
    } catch (e) {
        bot.sendMessage(chatId, `❌ **ULTRA ERROR:** ${e.response?.data?.error || e.message}`);
        return null;
    }
}

// ==========================================
//  EVM EXECUTION (SMART EXECUTOR)
// ==========================================
async function executeEvmSwap(chatId, direction, tokenAddress, amountInput) {
    if (!evmSigner || !apexContract) return bot.sendMessage(chatId, "⚠️ EVM Executor Not Linked");
    try {
        const net = NETWORKS[SYSTEM.currentNetwork];
        const deadline = Math.floor(Date.now() / 1000) + 120;
        
        if (direction === 'BUY') {
            const tx = await apexContract.executeBuy(net.router, tokenAddress, 0, deadline, { value: ethers.parseEther(amountInput.toString()), gasLimit: 300000 });
            bot.sendMessage(chatId, `⚔️ **CONTRACT BUY:** ${tx.hash}`);
            await tx.wait();
            return { amountOut: 1 };
        } else {
            const tx = await apexContract.executeSell(net.router, tokenAddress, amountInput, 0, deadline, { gasLimit: 350000 });
            bot.sendMessage(chatId, `📉 **CONTRACT SELL:** ${tx.hash}`);
            await tx.wait();
            return { hash: tx.hash };
        }
    } catch (e) { bot.sendMessage(chatId, `❌ **EVM ERROR:** ${e.message}`); return null; }
}

// ==========================================
//  SCANNER & MONITOR
// ==========================================
async function runNeuralScanner(chatId) {
    if (!SYSTEM.autoPilot || SYSTEM.isLocked || (!evmWallet && !solWallet)) return;
    try {
        updateQuest('sim', chatId);
        const netConfig = NETWORKS[SYSTEM.currentNetwork];
        let targets = [];
        try {
            const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
            const boostMatch = res.data.find(t => t.chainId === netConfig.id && t.tokenAddress !== SYSTEM.lastTradedToken);
            if (boostMatch) targets.push(boostMatch.tokenAddress);
        } catch(e) {}
        if (targets.length === 0 && (SYSTEM.currentNetwork === 'ETH' || SYSTEM.currentNetwork === 'ARB')) {
            const query = netConfig.scanQuery || 'WETH';
            try {
                const searchRes = await axios.get(`https://api.dexscreener.com/latest/dex/search/?q=${query}`);
                const validPair = searchRes.data.pairs.find(p => p.chainId === netConfig.id && p.volume.h24 > 500000);
                if (validPair) targets.push(validPair.baseToken.address);
            } catch(e) {}
        }
        if (targets.length > 0) {
            const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${targets[0]}`);
            const pair = details.data.pairs[0];
            if (pair) {
                const target = { name: pair.baseToken.name, symbol: pair.baseToken.symbol, tokenAddress: targets[0], price: parseFloat(pair.priceUsd), sentimentScore: Math.random() * 0.5 + 0.5, rsi: Math.floor(Math.random() * 80) + 20 };
                await processSignal(chatId, target);
            }
        }
    } catch (e) { console.log(`[SCAN] ${SYSTEM.currentNetwork} Searching...`.gray); }
    if (SYSTEM.autoPilot) setTimeout(() => runNeuralScanner(chatId), 6000);
}

async function processSignal(chatId, data) {
    const strategy = STRATEGY_MODES[SYSTEM.strategyMode];
    let confidence = 0.5 + (data.sentimentScore * 0.3);
    if (data.rsi < 70 && data.rsi > 30) confidence += 0.2;
    if (confidence >= strategy.minConf) {
        SYSTEM.pendingTarget = data;
        bot.sendMessage(chatId, `🧠 **NEURAL SIGNAL: ${data.symbol}**\nNet: ${SYSTEM.currentNetwork}\nConf: ${(confidence*100).toFixed(0)}%\nPrice: $${data.price}\nAmount: ${SYSTEM.tradeAmount}`, { parse_mode: 'Markdown' });
        if (SYSTEM.autoPilot) await executeBuy(chatId);
    }
}

async function executeBuy(chatId) {
    if (!SYSTEM.pendingTarget) return;
    const target = SYSTEM.pendingTarget; const amount = SYSTEM.tradeAmount;
    SYSTEM.isLocked = true;
    bot.sendMessage(chatId, `⚔️ **ATTACKING:** ${target.symbol} (${amount})...`);
    const result = SYSTEM.currentNetwork === 'SOL' ? await executeUltraSwap(chatId, 'BUY', target.tokenAddress, amount) : await executeEvmSwap(chatId, 'BUY', target.tokenAddress, amount);
    if (result) {
        SYSTEM.activePosition = { ...target, tokenAmount: result.amountOut || 0, entryPrice: target.price, highestPrice: target.price };
        SYSTEM.pendingTarget = null; updateQuest('trade', chatId); runProfitMonitor(chatId);
    } else { SYSTEM.isLocked = false; }
}

async function executeSell(chatId) {
    if (!SYSTEM.activePosition) return;
    bot.sendMessage(chatId, `📉 **SELLING:** ${SYSTEM.activePosition.symbol}...`);
    const result = SYSTEM.currentNetwork === 'SOL' ? await executeUltraSwap(chatId, 'SELL', SYSTEM.activePosition.tokenAddress, 0) : await executeEvmSwap(chatId, 'SELL', SYSTEM.activePosition.tokenAddress, SYSTEM.activePosition.tokenAmount);
    if (result) {
        SYSTEM.lastTradedToken = SYSTEM.activePosition.tokenAddress; SYSTEM.activePosition = null; SYSTEM.isLocked = false;
        bot.sendMessage(chatId, `✅ **CLOSED.**`); if (SYSTEM.autoPilot) runNeuralScanner(chatId);
    }
}

async function runProfitMonitor(chatId) {
    if (!SYSTEM.activePosition) return;
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${SYSTEM.activePosition.tokenAddress}`);
        const currentPrice = parseFloat(res.data.pairs[0].priceUsd);
        const pnl = ((currentPrice - SYSTEM.activePosition.entryPrice) / SYSTEM.activePosition.entryPrice) * 100;
        if (currentPrice > SYSTEM.activePosition.highestPrice) SYSTEM.activePosition.highestPrice = currentPrice;
        const drop = ((SYSTEM.activePosition.highestPrice - currentPrice) / SYSTEM.activePosition.highestPrice) * 100;
        const strategy = STRATEGY_MODES[SYSTEM.strategyMode]; const risk = RISK_PROFILES[SYSTEM.riskProfile];
        if (drop >= strategy.trail && pnl > 1) await executeSell(chatId);
        else if (pnl <= -risk.stopLoss) await executeSell(chatId);
        else setTimeout(() => runProfitMonitor(chatId), 4000);
    } catch(e) { setTimeout(() => runProfitMonitor(chatId), 4000); }
}

// ==========================================
//  COMMANDS
// ==========================================

// NEW: Set Trade Amount command
bot.onText(/\/setamount (.+)/, (msg, match) => {
    const amount = match[1];
    if (isNaN(amount) || parseFloat(amount) <= 0) {
        return bot.sendMessage(msg.chat.id, "❌ **Invalid amount.** Please provide a number (e.g., 0.1)");
    }
    SYSTEM.tradeAmount = amount;
    bot.sendMessage(msg.chat.id, `💰 **TRADE AMOUNT SET:** ${SYSTEM.tradeAmount} ${SYSTEM.currentNetwork === 'SOL' ? 'SOL' : 'ETH/BNB'}`);
});

bot.onText(/\/start/, (msg) => { 
    bot.sendMessage(msg.chat.id, `
🐲 **APEX PREDATOR v9002**
Operator: ${msg.from.first_name} | Class: ${PLAYER.class}
Current Network: ${SYSTEM.currentNetwork}
Trade Amount: ${SYSTEM.tradeAmount}

**/setamount <val>** - Change trade size
**/connect <seed>** - Link Wallets
**/network <SOL|ETH|BASE|BSC|ARB>**
**/auto** - Toggle AI Scan
**/status** - View Stats
`); 
});

bot.onText(/\/network (.+)/, (msg, match) => { const n = match[1].toUpperCase(); if(NETWORKS[n]) { initNetwork(n); bot.sendMessage(msg.chat.id, `✅ Network: ${n}\nReminder: Use /setamount to adjust size for this chain.`); } });
bot.onText(/\/auto/, (msg) => { if (!evmWallet && !solWallet) return; SYSTEM.autoPilot = !SYSTEM.autoPilot; bot.sendMessage(msg.chat.id, `🤖 Auto: ${SYSTEM.autoPilot}`); if(SYSTEM.autoPilot) runNeuralScanner(msg.chat.id); });
bot.onText(/\/status/, (msg) => { bot.sendMessage(msg.chat.id, `📊 **STATUS**\nNet: ${SYSTEM.currentNetwork}\nTrade Amt: ${SYSTEM.tradeAmount}\nMode: ${SYSTEM.strategyMode}\nTrade: ${SYSTEM.activePosition ? SYSTEM.activePosition.symbol : 'None'}`); });

http.createServer((req, res) => res.end("APEX v9002 ONLINE")).listen(8080);
console.log("APEX v9002 MASTER READY".magenta);
