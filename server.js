/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9019 (OMNI-PARALLEL MASTER)
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

const MY_EXECUTOR = "0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610";
const APEX_EXECUTOR_ABI = [
    "function executeBuy(address router, address token, uint256 minOut, uint256 deadline) external payable",
    "function executeSell(address router, address token, uint256 amtIn, uint256 minOut, uint256 deadline) external",
    "function emergencyWithdraw(address token) external"
];

const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";
const JUP_API_KEY = "f440d4df-b5c4-4020-a960-ac182d3752ab";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'x-api-key': JUP_API_KEY }};

const NETWORKS = {
    ETH:  { id: 'ethereum', type: 'EVM', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', executor: MY_EXECUTOR },
    SOL:  { id: 'solana', type: 'SVM', rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com' },
    BASE: { id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', executor: MY_EXECUTOR },
    BSC:  { id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', executor: MY_EXECUTOR },
    ARB:  { id: 'arbitrum', type: 'EVM', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', executor: MY_EXECUTOR }
};

// --- UPDATED SYSTEM OBJECT ---
let SYSTEM = { 
    autoPilot: false, 
    tradeAmount: "0.01", 
    lastTradedTokens: {}, 
    isLocked: {},
    risk: "medium", 
    mode: "short term",
    tp: 25, trail: 6, sl: -10 
};

let evmWallet, solWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// --- STRATEGY HANDLER ---
function syncStrategy() {
    const riskMap = { low: { trail: 3, sl: -5 }, medium: { trail: 6, sl: -10 }, high: { trail: 15, sl: -25 } };
    const modeMap = { "short term": 20, "medium term": 60, "long term": 200 };
    SYSTEM.tp = modeMap[SYSTEM.mode];
    SYSTEM.trail = riskMap[SYSTEM.risk].trail;
    SYSTEM.sl = riskMap[SYSTEM.risk].sl;
}

// ==========================================
//  COMMANDS (NEW)
// ==========================================

bot.onText(/\/setamount (.+)/, (msg, match) => {
    SYSTEM.tradeAmount = match[1];
    bot.sendMessage(msg.chat.id, `💰 **Trade Amount:** ${SYSTEM.tradeAmount}`);
});

bot.onText(/\/risk (low|medium|high)/, (msg, match) => {
    SYSTEM.risk = match[1].toLowerCase();
    syncStrategy();
    bot.sendMessage(msg.chat.id, `⚠️ **Risk:** ${SYSTEM.risk.toUpperCase()} (SL: ${SYSTEM.sl}%, Trail: ${SYSTEM.trail}%)`);
});

bot.onText(/\/mode (short term|medium term|long term)/, (msg, match) => {
    SYSTEM.mode = match[1].toLowerCase();
    syncStrategy();
    bot.sendMessage(msg.chat.id, `⏳ **Mode:** ${SYSTEM.mode.toUpperCase()} (TP: ${SYSTEM.tp}%)`);
});

// ==========================================
//  EXISTING LOGIC (CORE)
// ==========================================

async function verifyBalance(chatId, netKey) {
    try {
        if (netKey === 'SOL') {
            const conn = new Connection(NETWORKS.SOL.rpc);
            const bal = await conn.getBalance(solWallet.publicKey);
            const needed = (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 10000000;
            if (bal < needed) return false;
        } else {
            const prov = new JsonRpcProvider(NETWORKS[netKey].rpc);
            const bal = await prov.getBalance(evmWallet.address);
            const needed = ethers.parseEther(SYSTEM.tradeAmount) + ethers.parseEther("0.005");
            if (bal < needed) return false;
        }
        return true;
    } catch (e) { return false; }
}

bot.onText(/\/auto/, (msg) => {
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    if (SYSTEM.autoPilot) {
        bot.sendMessage(msg.chat.id, `🚀 **OMNI-ENGINE ONLINE.**`);
        Object.keys(NETWORKS).forEach(netKey => startNetworkSniper(msg.chat.id, netKey));
    } else { bot.sendMessage(msg.chat.id, `🛑 **AUTO-PILOT OFF.**`); }
});

async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal) {
                    if (!(await verifyBalance(chatId, netKey))) continue;
                    SYSTEM.isLocked[netKey] = true;
                    const buyRes = (netKey === 'SOL')
                        ? await executeSolanaShotgun(chatId, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY')
                        : await executeEvmContract(chatId, netKey, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY');
                    if (buyRes) {
                        startIndependentPeakMonitor(chatId, netKey, { ...signal, entryPrice: signal.price, highestPrice: signal.price, amountOut: buyRes.amountOut });
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 1500));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 5000)); }
    }
}

async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const match = res.data.find(t => t.chainId === NETWORKS[netKey].id && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        return match ? { symbol: match.symbol, tokenAddress: match.tokenAddress, price: parseFloat(match.priceUsd || 0) } : null;
    } catch (e) { return null; }
}

async function executeEvmContract(chatId, netKey, tokenAddress, amount, direction) {
    try {
        const net = NETWORKS[netKey];
        const signer = evmWallet.connect(new JsonRpcProvider(net.rpc));
        const contract = new ethers.Contract(MY_EXECUTOR, APEX_EXECUTOR_ABI, signer);
        const deadline = Math.floor(Date.now() / 1000) + 120;
        if (direction === 'BUY') {
            const tx = await contract.executeBuy(net.router, tokenAddress, 0, deadline, { value: ethers.parseEther(amount.toString()), gasLimit: 350000 });
            await tx.wait(); return { amountOut: 1 };
        } else {
            const tx = await contract.executeSell(net.router, tokenAddress, amount, 0, deadline, { gasLimit: 400000 });
            await tx.wait(); return { hash: tx.hash };
        }
    } catch (e) { return null; }
}

async function executeSolanaShotgun(chatId, tokenAddress, amount, direction) {
    try {
        const amtStr = direction === 'BUY' ? Math.floor(amount * LAMPORTS_PER_SOL).toString() : amount.toString();
        const res = await axios.get(`${JUP_ULTRA_API}/order?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenAddress}&amount=${amtStr}&taker=${solWallet.publicKey.toString()}&slippageBps=200`, SCAN_HEADERS);
        const tx = VersionedTransaction.deserialize(Buffer.from(res.data.transaction, 'base64'));
        tx.sign([solWallet]);
        const sig = await new Connection(NETWORKS.SOL.rpc).sendRawTransaction(tx.serialize(), { skipPreflight: true });
        return { amountOut: res.data.outAmount, hash: sig };
    } catch (e) { return null; }
}

// --- UPDATED MONITOR (DYNAMIC) ---
async function startIndependentPeakMonitor(chatId, netKey, pos) {
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`, SCAN_HEADERS);
        const curPrice = parseFloat(res.data.pairs[0].priceUsd);
        const pnl = ((curPrice - pos.entryPrice) / pos.entryPrice) * 100;
        if (curPrice > pos.highestPrice) pos.highestPrice = curPrice;
        const drop = ((pos.highestPrice - curPrice) / pos.highestPrice) * 100;

        if (pnl >= SYSTEM.tp || drop >= SYSTEM.trail || pnl <= SYSTEM.sl) {
            bot.sendMessage(chatId, `🎯 **[${netKey}] EXIT:** ${pos.symbol} at ${pnl.toFixed(2)}%`);
            const sold = (netKey === 'SOL')
                ? await executeSolanaShotgun(chatId, pos.tokenAddress, pos.amountOut, 'SELL')
                : await executeEvmContract(chatId, netKey, pos.tokenAddress, pos.amountOut, 'SELL');
            if (sold) SYSTEM.lastTradedTokens[pos.tokenAddress] = true;
        } else { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 5000); }
    } catch(e) { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 8000); }
}

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        evmWallet = ethers.HDNodeWallet.fromPhrase(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", (await bip39.mnemonicToSeed(match[1].trim())).toString('hex')).key);
        bot.sendMessage(msg.chat.id, `🔗 **LINKED.**`);
    } catch (e) { bot.sendMessage(msg.chat.id, `❌ **SEED ERROR**`); }
});

http.createServer((req, res) => res.end("APEX v9019")).listen(8080);
