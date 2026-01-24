/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9022 (OMNI-PARALLEL MASTER)
 * ===============================================================================
 * ARCH: 5-Chain Parallel Workers + Dynamic Strategy Monitor
 * EVM MASTER CONTRACT: 0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610
 * NEW: /setamount, /risk <LOW|MED|HIGH>, /mode <SHORT|MED|LONG>
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

// --- FIXED CONFIG ---
const MY_EXECUTOR = "0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610";
const APEX_ABI = [
    "function executeBuy(address router, address token, uint256 minOut, uint256 deadline) external payable",
    "function executeSell(address router, address token, uint256 amtIn, uint256 minOut, uint256 deadline) external",
    "function emergencyWithdraw(address token) external"
];
const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";
const JUP_API_KEY = "f440d4df-b5c4-4020-a960-ac182d3752ab"; 
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'x-api-key': JUP_API_KEY }};

// --- NETWORKS ---
const NETWORKS = {
    ETH:  { id: 'ethereum', type: 'EVM', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', executor: MY_EXECUTOR },
    SOL:  { id: 'solana', type: 'SVM', rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com' },
    BASE: { id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', executor: MY_EXECUTOR },
    BSC:  { id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', executor: MY_EXECUTOR },
    ARB:  { id: 'arbitrum', type: 'EVM', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', executor: MY_EXECUTOR }
};

// --- GLOBAL STATE ---
let SYSTEM = { 
    autoPilot: false, 
    tradeAmount: "0.01", 
    riskProfile: 'MEDIUM', // LOW, MEDIUM, HIGH
    strategyMode: 'MEDIUM', // SHORT, MEDIUM, LONG
    lastTradedTokens: {}, 
    isLocked: {} 
};

let evmWallet, solWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  COMMANDS: STRATEGY & RISK
// ==========================================

bot.onText(/\/setamount (.+)/, (msg, match) => {
    if (isNaN(match[1])) return bot.sendMessage(msg.chat.id, "❌ Enter a valid number.");
    SYSTEM.tradeAmount = match[1];
    const cadVal = (parseFloat(match[1]) * 1223.12).toFixed(2);
    bot.sendMessage(msg.chat.id, `💰 **TRADE SIZE:** ${SYSTEM.tradeAmount} Native (~$${cadVal} CAD)`);
});

bot.onText(/\/risk (.+)/, (msg, match) => {
    const choice = match[1].toUpperCase();
    if (['LOW', 'MEDIUM', 'HIGH'].includes(choice)) {
        SYSTEM.riskProfile = choice;
        bot.sendMessage(msg.chat.id, `🛡️ **RISK PROFILE:** ${choice}`);
    }
});

bot.onText(/\/mode (.+)/, (msg, match) => {
    const choice = match[1].toUpperCase();
    if (['SHORT', 'MEDIUM', 'LONG'].includes(choice)) {
        SYSTEM.strategyMode = choice;
        bot.sendMessage(msg.chat.id, `⏱️ **STRATEGY MODE:** ${choice}`);
    }
});

function getStrategyParams() {
    let p = { tp: 25, sl: -10, trail: 6 }; // Defaults
    if (SYSTEM.riskProfile === 'LOW')  { p.tp = 12; p.sl = -5; }
    if (SYSTEM.riskProfile === 'HIGH') { p.tp = 100; p.sl = -20; }
    if (SYSTEM.strategyMode === 'SHORT') p.trail = 3;
    if (SYSTEM.strategyMode === 'LONG')  p.trail = 15;
    return p;
}

// ==========================================
//  OMNI-ENGINE WORKERS
// ==========================================

bot.onText(/\/auto/, (msg) => {
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    if (SYSTEM.autoPilot) {
        bot.sendMessage(msg.chat.id, `🚀 **OMNI-ENGINE ONLINE.** Risk: ${SYSTEM.riskProfile} | Mode: ${SYSTEM.strategyMode}`);
        Object.keys(NETWORKS).forEach(netKey => startNetworkSniper(msg.chat.id, netKey));
    } else { bot.sendMessage(msg.chat.id, `🤖 **AUTO-PILOT OFF.**`); }
});

async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal) {
                    const ready = await verifyBalance(chatId, netKey);
                    if (!ready) { await new Promise(r => setTimeout(r, 15000)); continue; }

                    SYSTEM.isLocked[netKey] = true;
                    const buyRes = (netKey === 'SOL') 
                        ? await executeSolanaShotgun(chatId, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY')
                        : await executeEvmContract(chatId, netKey, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY');

                    if (buyRes) {
                        const newPos = { ...signal, entryPrice: signal.price, highestPrice: signal.price, amountOut: buyRes.amountOut };
                        startIndependentPeakMonitor(chatId, netKey, newPos);
                        bot.sendMessage(chatId, `🚀 **[${netKey}] Sniped ${signal.symbol}.**`);
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
            SYSTEM.isLocked[netKey] = false;
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

// ==========================================
//  PEAK MONITOR (STRATEGY AWARE)
// ==========================================

async function startIndependentPeakMonitor(chatId, netKey, pos) {
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`, SCAN_HEADERS);
        const curPrice = parseFloat(res.data.pairs[0].priceUsd);
        const pnl = ((curPrice - pos.entryPrice) / pos.entryPrice) * 100;
        if (curPrice > pos.highestPrice) pos.highestPrice = curPrice;
        const drop = ((pos.highestPrice - curPrice) / pos.highestPrice) * 100;

        const strat = getStrategyParams();

        if (pnl >= strat.tp || drop >= strat.trail || pnl <= strat.sl) {
            const reason = pnl <= strat.sl ? "STOP LOSS" : (pnl >= strat.tp ? "TAKE PROFIT" : "TRAILING STOP");
            bot.sendMessage(chatId, `📉 **[${netKey}] EXIT:** ${reason} at ${pnl.toFixed(2)}%`);
            const sold = (netKey === 'SOL') 
                ? await executeSolanaShotgun(chatId, pos.tokenAddress, pos.amountOut, 'SELL')
                : await executeEvmContract(chatId, netKey, pos.tokenAddress, pos.amountOut, 'SELL');
            if (sold) SYSTEM.lastTradedTokens[pos.tokenAddress] = true;
        } else { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 5000); }
    } catch(e) { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 8000); }
}

// ==========================================
//  DIAGNOSTICS & EXECUTION
// ==========================================

async function verifyBalance(chatId, netKey) {
    try {
        const amount = parseFloat(SYSTEM.tradeAmount);
        if (netKey === 'SOL') {
            const bal = await (new Connection(NETWORKS.SOL.rpc)).getBalance(solWallet.publicKey);
            const needed = (amount * LAMPORTS_PER_SOL) + 10000000; 
            if (bal < needed) { bot.sendMessage(chatId, `⚠️ **[SOL] Low Funds.** Need ${needed/1e9} SOL.`); return false; }
        } else {
            const bal = await (new JsonRpcProvider(NETWORKS[netKey].rpc)).getBalance(evmWallet.address);
            const needed = ethers.parseEther(SYSTEM.tradeAmount) + ethers.parseEther("0.005");
            if (bal < needed) { bot.sendMessage(chatId, `⚠️ **[${netKey}] Low Funds.** Need ${ethers.formatEther(needed)} gas token.`); return false; }
        }
        return true;
    } catch (e) {
        if (e.message.includes('402')) bot.sendMessage(chatId, `🚨 **[${netKey}] Error 402:** RPC Payment Required.`);
        return false;
    }
}

async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const match = res.data.find(t => t.chainId === NETWORKS[netKey].id && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        return match ? { symbol: match.symbol, tokenAddress: match.tokenAddress, price: parseFloat(match.priceUsd || 0) } : null;
    } catch (e) { return null; }
}

async function executeEvmContract(chatId, netKey, addr, amt, dir) {
    try {
        const net = NETWORKS[netKey];
        const signer = evmWallet.connect(new JsonRpcProvider(net.rpc));
        const contract = new ethers.Contract(MY_EXECUTOR, APEX_ABI, signer);
        const deadline = Math.floor(Date.now() / 1000) + 120;
        const tx = dir === 'BUY' 
            ? await contract.executeBuy(net.router, addr, 0, deadline, { value: ethers.parseEther(amt.toString()), gasLimit: 350000 })
            : await contract.executeSell(net.router, addr, amt, 0, deadline, { gasLimit: 400000 });
        bot.sendMessage(chatId, `⏳ **[${netKey}] PENDING:** ${tx.hash}`);
        await tx.wait(); return { amountOut: 1 };
    } catch (e) { bot.sendMessage(chatId, `❌ **[${netKey}] FAIL:** ${e.reason || e.message}`); return null; }
}

async function executeSolanaShotgun(chatId, addr, amt, dir) {
    try {
        const amtStr = dir === 'BUY' ? Math.floor(amt * LAMPORTS_PER_SOL).toString() : amt.toString();
        const res = await axios.get(`${JUP_ULTRA_API}/order?inputMint=So11111111111111111111111111111111111111112&outputMint=${addr}&amount=${amtStr}&taker=${solWallet.publicKey.toString()}&slippageBps=200`, SCAN_HEADERS);
        const tx = VersionedTransaction.deserialize(Buffer.from(res.data.transaction, 'base64'));
        tx.sign([solWallet]);
        const sig = await (new Connection(NETWORKS.SOL.rpc)).sendRawTransaction(tx.serialize(), { skipPreflight: true });
        bot.sendMessage(chatId, `⏳ **[SOL] PENDING:** ${sig}`);
        return { amountOut: res.data.outAmount, hash: sig };
    } catch (e) { bot.sendMessage(chatId, `❌ **[SOL] FAIL:** ${e.message}`); return null; }
}

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const raw = match[1].trim();
        evmWallet = ethers.HDNodeWallet.fromPhrase(raw);
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", (await bip39.mnemonicToSeed(raw)).toString('hex')).key);
        bot.sendMessage(msg.chat.id, `🔗 **NEURAL LINK SECURE.**`);
    } catch (e) { bot.sendMessage(msg.chat.id, `❌ **SEED ERROR.**`); }
});

http.createServer((req, res) => res.end("APEX v9022 ONLINE")).listen(8080);
console.log("APEX v9022 READY".magenta);
