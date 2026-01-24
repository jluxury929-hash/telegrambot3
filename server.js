/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9021 (STRATEGY & RISK MASTER)
 * ===============================================================================
 * NEW: /setamount <value> - Change global trade size.
 * NEW: /risk <low|medium|high> - Adjusts TP/SL targets.
 * NEW: /mode <short|medium|long> - Adjusts trailing stop sensitivity.
 * SPECS: 24/7 Multi-Chain Parallel Sniping | Smart Contract 0x5aF9...
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

// --- FIXED SMART CONTRACT CONFIG ---
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
    risk: 'medium', // low, medium, high
    mode: 'medium', // short, medium, long
    lastTradedTokens: {}, 
    isLocked: {} 
};

let evmWallet, solWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  STRATEGY LOGIC: RISK & MODE
// ==========================================

function getStrategyParams() {
    let params = { tp: 25, sl: -10, trail: 6 }; // Default Medium/Medium

    // Adjust by Risk Profile
    if (SYSTEM.risk === 'low')    { params.tp = 12; params.sl = -5; }
    if (SYSTEM.risk === 'high')   { params.tp = 100; params.sl = -20; }

    // Adjust by Term/Mode
    if (SYSTEM.mode === 'short')  { params.trail = 3; } // Tight trailing stop
    if (SYSTEM.mode === 'long')   { params.trail = 15; } // Wide breathing room

    return params;
}

// ==========================================
//  COMMANDS
// ==========================================

bot.onText(/\/setamount (.+)/, (msg, match) => {
    SYSTEM.tradeAmount = match[1];
    bot.sendMessage(msg.chat.id, `💰 **TRADE SIZE:** ${SYSTEM.tradeAmount} Native`);
});

bot.onText(/\/risk (.+)/, (msg, match) => {
    const r = match[1].toLowerCase();
    if (['low', 'medium', 'high'].includes(r)) {
        SYSTEM.risk = r;
        bot.sendMessage(msg.chat.id, `🛡️ **RISK PROFILE:** ${r.toUpperCase()}`);
    }
});

bot.onText(/\/mode (.+)/, (msg, match) => {
    const m = match[1].toLowerCase();
    if (['short', 'medium', 'long'].includes(m)) {
        SYSTEM.mode = m;
        bot.sendMessage(msg.chat.id, `⏱️ **MODE:** ${m.toUpperCase()}`);
    }
});

// ==========================================
//  PEAK MONITOR (UPDATED WITH STRATEGY)
// ==========================================

async function startIndependentPeakMonitor(chatId, netKey, pos) {
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`, SCAN_HEADERS);
        const currentPrice = parseFloat(res.data.pairs[0].priceUsd);
        const pnl = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
        
        if (currentPrice > pos.highestPrice) pos.highestPrice = currentPrice;
        const dropFromPeak = ((pos.highestPrice - currentPrice) / pos.highestPrice) * 100;

        const config = getStrategyParams();

        // Check Exit Conditions
        if (pnl >= config.tp || dropFromPeak >= config.trail || pnl <= config.sl) {
            const reason = pnl <= config.sl ? "STOP LOSS" : (pnl >= config.tp ? "TAKE PROFIT" : "TRAILING STOP");
            bot.sendMessage(chatId, `📉 **[${netKey}] EXIT TRIGGER:** ${reason} at ${pnl.toFixed(2)}%`);
            
            const sold = (netKey === 'SOL')
                ? await executeSolanaShotgun(chatId, pos.tokenAddress, pos.amountOut, 'SELL')
                : await executeEvmContract(chatId, netKey, pos.tokenAddress, pos.amountOut, 'SELL');

            if (sold) SYSTEM.lastTradedTokens[pos.tokenAddress] = true;
        } else {
            setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 5000);
        }
    } catch(e) {
        setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 8000);
    }
}

// ==========================================
//  SNIPER ENGINE & CORE LOGIC
// ==========================================

async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal) {
                    bot.sendMessage(chatId, `🧠 **[${netKey}] SIGNAL:** ${signal.symbol}. Engaging Sniper...`);
                    const ready = await verifyBalance(chatId, netKey);
                    if (!ready) { await new Promise(r => setTimeout(r, 10000)); continue; }

                    SYSTEM.isLocked[netKey] = true;
                    const buyRes = (netKey === 'SOL')
                        ? await executeSolanaShotgun(chatId, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY')
                        : await executeEvmContract(chatId, netKey, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY');

                    if (buyRes) {
                        const newPos = { ...signal, entryPrice: signal.price, highestPrice: signal.price, amountOut: buyRes.amountOut };
                        startIndependentPeakMonitor(chatId, netKey, newPos);
                        bot.sendMessage(chatId, `🚀 **[${netKey}] BOUGHT ${signal.symbol}.** Monitoring...`);
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 1500));
        } catch (e) {
            SYSTEM.isLocked[netKey] = false;
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

// ... [Keep verifyBalance, runNeuralSignalScan, executeEvmContract, executeSolanaShotgun, connect, withdraw as previously defined] ...

async function verifyBalance(chatId, netKey) {
    try {
        if (netKey === 'SOL') {
            const conn = new Connection(NETWORKS.SOL.rpc);
            const bal = await conn.getBalance(solWallet.publicKey);
            const needed = (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 10000000;
            if (bal < needed) {
                bot.sendMessage(chatId, `⚠️ **[SOL] WARNING:** Insufficient Balance.`);
                return false;
            }
        } else {
            const prov = new JsonRpcProvider(NETWORKS[netKey].rpc);
            const bal = await prov.getBalance(evmWallet.address);
            const needed = ethers.parseEther(SYSTEM.tradeAmount) + ethers.parseEther("0.005");
            if (bal < needed) {
                bot.sendMessage(chatId, `⚠️ **[${netKey}] WARNING:** Insufficient Balance.`);
                return false;
            }
        }
        return true;
    } catch (e) { return false; }
}

async function runNeuralSignalScan(netKey) {
    const net = NETWORKS[netKey];
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const match = res.data.find(t => t.chainId === net.id && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        return match ? { symbol: match.symbol || 'GEMS', tokenAddress: match.tokenAddress, price: parseFloat(match.priceUsd || 0) } : null;
    } catch (e) { return null; }
}

async function executeEvmContract(chatId, netKey, tokenAddress, amount, direction) {
    try {
        const net = NETWORKS[netKey];
        const signer = evmWallet.connect(new JsonRpcProvider(net.rpc));
        const contract = new ethers.Contract(MY_EXECUTOR, APEX_ABI, signer);
        const deadline = Math.floor(Date.now() / 1000) + 120;
        const tx = direction === 'BUY' 
            ? await contract.executeBuy(net.router, tokenAddress, 0, deadline, { value: ethers.parseEther(amount.toString()), gasLimit: 350000 })
            : await contract.executeSell(net.router, tokenAddress, amount, 0, deadline, { gasLimit: 400000 });
        await tx.wait();
        return { amountOut: 1 };
    } catch (e) { bot.sendMessage(chatId, `❌ **[${netKey}] CONTRACT FAIL:** ${e.message}`); return null; }
}

async function executeSolanaShotgun(chatId, tokenAddress, amount, direction) {
    try {
        const amtStr = direction === 'BUY' ? Math.floor(amount * LAMPORTS_PER_SOL).toString() : amount.toString();
        const res = await axios.get(`${JUP_ULTRA_API}/order?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenAddress}&amount=${amtStr}&taker=${solWallet.publicKey.toString()}&slippageBps=200`, SCAN_HEADERS);
        const tx = VersionedTransaction.deserialize(Buffer.from(res.data.transaction, 'base64'));
        tx.sign([solWallet]);
        const sig = await new Connection(NETWORKS.SOL.rpc).sendRawTransaction(tx.serialize(), { skipPreflight: true });
        return { amountOut: res.data.outAmount, hash: sig };
    } catch (e) { bot.sendMessage(chatId, `❌ **[SOL] SHOTGUN FAIL:** ${e.message}`); return null; }
}

bot.onText(/\/auto/, (msg) => {
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    if (SYSTEM.autoPilot) {
        bot.sendMessage(msg.chat.id, `🚀 **OMNI-SNIPER ONLINE.**`);
        Object.keys(NETWORKS).forEach(netKey => startNetworkSniper(msg.chat.id, netKey));
    } else { bot.sendMessage(msg.chat.id, `🤖 **OFF.**`); }
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        evmWallet = ethers.HDNodeWallet.fromPhrase(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", (await bip39.mnemonicToSeed(match[1].trim())).toString('hex')).key);
        bot.sendMessage(msg.chat.id, `🔗 **CONNECTED.**`);
    } catch (e) { bot.sendMessage(msg.chat.id, `❌ **ERROR.**`); }
});

http.createServer((req, res) => res.end("APEX ONLINE")).listen(8080);
