/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9019 (OMNI-PARALLEL MASTER)
 * ===============================================================================
 * INTEGRATED: Parallel Engine + Fixed Status + Compounding Menu
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
const APEX_EXECUTOR_ABI = [
    "function executeBuy(address router, address token, uint256 minOut, uint256 deadline) external payable",
    "function executeSell(address router, address token, uint256 amtIn, uint256 minOut, uint256 deadline) external",
    "function emergencyWithdraw(address token) external"
];

const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";
const JUP_API_KEY = "f440d4df-b5c4-4020-a960-ac182d3752ab";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'x-api-key': JUP_API_KEY }};

// --- 5-CHAIN NETWORK DEFINITIONS ---
const NETWORKS = {
    ETH:  { id: 'ethereum', type: 'EVM', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', executor: MY_EXECUTOR },
    SOL:  { id: 'solana', type: 'SVM', rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com' },
    BASE: { id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', executor: MY_EXECUTOR },
    BSC:  { id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', executor: MY_EXECUTOR },
    ARB:  { id: 'arbitrum', type: 'EVM', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', executor: MY_EXECUTOR }
};

let SYSTEM = { 
    autoPilot: false, 
    tradeAmount: "0.01", 
    riskLevel: 'medium',
    mode: 'short term',
    lastTradedTokens: {}, 
    activePositions: [], 
    isLocked: {},
    startTime: Date.now()
};

let evmWallet, solWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  DIAGNOSTIC BALANCE CHECKER (FIXED)
// ==========================================

async function verifyBalance(chatId, netKey) {
    try {
        if (netKey === 'SOL') {
            const conn = new Connection(NETWORKS.SOL.rpc);
            const bal = await conn.getBalance(solWallet.publicKey);
            const needed = (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 10000000;
            if (bal < needed) {
                bot.sendMessage(chatId, `⚠️ **[SOL] INSUFFICIENT:** Have ${bal/LAMPORTS_PER_SOL}, need ${needed/LAMPORTS_PER_SOL} SOL.`);
                return false;
            }
        } else {
            const prov = new JsonRpcProvider(NETWORKS[netKey].rpc);
            const bal = await prov.getBalance(evmWallet.address);
            const needed = ethers.parseEther(SYSTEM.tradeAmount) + ethers.parseEther("0.005");
            if (bal < needed) {
                bot.sendMessage(chatId, `⚠️ **[${netKey}] INSUFFICIENT:** Funds too low for trade + gas.`);
                return false;
            }
        }
        return true;
    } catch (e) { return false; }
}

// ==========================================
//  OMNI-SNIPER ENGINE (EXACT AUTO LOGIC)
// ==========================================

bot.on('message', async (msg) => {
    const text = msg.text;
    const chatId = msg.chat.id;

    if (text === '/start' || text === '🔙 Terminal') {
        const welcome = `🦁 **APEX v9019 MASTER TERMINAL**\n━━━━━━━━━━━━━━━━━━━━\n[NEURAL]: ${evmWallet ? '🟢 ONLINE' : '🔴 OFFLINE'}\n[AUTO]: ${SYSTEM.autoPilot ? '🚀 HUNTING' : '🛑 IDLE'}`;
        return bot.sendMessage(chatId, welcome, {
            reply_markup: {
                keyboard: [
                    ['🚀 Start Auto', '🛑 Stop Auto'],
                    ['📈 Live Tracker', '📊 Status'],
                    ['💰 Set Amount', '⚙️ Settings'],
                    ['⚡ Sync Neural Link']
                ],
                resize_keyboard: true
            }
        });
    }

    if (text === '🚀 Start Auto' || text === '/auto') {
        if (!evmWallet || !solWallet) return bot.sendMessage(chatId, "⚠️ **LINK ERROR:** Biometrics missing. Use **⚡ Sync Neural Link**.");
        
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) {
            bot.sendMessage(chatId, `🚀 **OMNI-ENGINE ONLINE.** Scanning 5 chains simultaneously...`);
            Object.keys(NETWORKS).forEach(netKey => startNetworkSniper(chatId, netKey));
        } else { bot.sendMessage(chatId, `🛑 **AUTO-PILOT OFF.**`); }
    }

    if (text === '🛑 Stop Auto') {
        SYSTEM.autoPilot = false;
        bot.sendMessage(chatId, "🛑 **EMERGENCY STOP.** All scanning modules offline.");
    }

    if (text === '📊 Status' || text === '/status') {
        await handleStatus(chatId);
    }
    
    if (text === '⚡ Sync Neural Link') {
        bot.sendMessage(chatId, `📡 **NEURAL LINK PROTOCOL:**\nSend: \`/connect twelve word seed phrase here\``, { parse_mode: 'Markdown' });
    }
});

async function handleStatus(chatId) {
    bot.sendMessage(chatId, "🔍 **COLLECTING NEURAL DATA...**");
    let statusMsg = `📊 **APEX SYSTEM STATUS**\n━━━━━━━━━━━━━━━━━━━━\n`;
    statusMsg += `🤖 **Auto-Pilot:** ${SYSTEM.autoPilot ? '✅ ACTIVE' : '🛑 STANDBY'}\n`;
    statusMsg += `🎯 **Trade Size:** ${SYSTEM.tradeAmount}\n`;
    statusMsg += `⏳ **Uptime:** ${Math.floor((Date.now() - SYSTEM.startTime)/60000)} mins\n\n`;

    for (let key of Object.keys(NETWORKS)) {
        try {
            let bal = 0;
            if (key === 'SOL') {
                const conn = new Connection(NETWORKS.SOL.rpc);
                bal = (await conn.getBalance(solWallet.publicKey)) / LAMPORTS_PER_SOL;
            } else {
                const prov = new JsonRpcProvider(NETWORKS[key].rpc);
                bal = ethers.formatEther(await prov.getBalance(evmWallet.address));
            }
            statusMsg += `🔹 **${key}:** ${parseFloat(bal).toFixed(4)}\n`;
        } catch (e) { statusMsg += `🔹 **${key}:** ⚠️ RPC Lag\n`; }
    }
    bot.sendMessage(chatId, statusMsg);
}

// ==========================================
//  SNIPER WORKERS (PARALLEL)
// ==========================================

async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal) {
                    bot.sendMessage(chatId, `🎯 **[${netKey}] SIGNAL:** ${signal.symbol}. Sniper Engaged.`);
                    const ready = await verifyBalance(chatId, netKey);
                    if (!ready) { await new Promise(r => setTimeout(r, 10000)); continue; }

                    SYSTEM.isLocked[netKey] = true;
                    const buyRes = (netKey === 'SOL')
                        ? await executeSolanaShotgun(chatId, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY')
                        : await executeEvmContract(chatId, netKey, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY');

                    if (buyRes) {
                        const newPos = { ...signal, entryPrice: signal.price, highestPrice: signal.price, amountOut: buyRes.amountOut };
                        SYSTEM.activePositions.push(newPos);
                        startIndependentPeakMonitor(chatId, netKey, newPos);
                        bot.sendMessage(chatId, `🚀 **[${netKey}] BOUGHT ${signal.symbol}.** Rescanning...`);
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

async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const match = res.data.find(t => t.chainId === NETWORKS[netKey].id && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        return match ? { symbol: match.symbol, tokenAddress: match.tokenAddress, price: parseFloat(match.priceUsd || 0) } : null;
    } catch (e) { return null; }
}

// ==========================================
//  EXECUTION (CONTRACT + JUPITER)
// ==========================================

async function executeEvmContract(chatId, netKey, tokenAddress, amount, direction) {
    try {
        const net = NETWORKS[netKey];
        const signer = evmWallet.connect(new JsonRpcProvider(net.rpc));
        const contract = new ethers.Contract(MY_EXECUTOR, APEX_EXECUTOR_ABI, signer);
        const deadline = Math.floor(Date.now() / 1000) + 120;
        if (direction === 'BUY') {
            const tx = await contract.executeBuy(net.router, tokenAddress, 0, deadline, {
                value: ethers.parseEther(amount.toString()),
                gasLimit: 350000
            });
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

async function startIndependentPeakMonitor(chatId, netKey, pos) {
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`, SCAN_HEADERS);
        const currentPrice = parseFloat(res.data.pairs[0].priceUsd);
        const pnl = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
        if (currentPrice > pos.highestPrice) pos.highestPrice = currentPrice;
        const drop = ((pos.highestPrice - currentPrice) / pos.highestPrice) * 100;

        if (pnl >= 25 || drop >= 6 || pnl <= -10) {
            bot.sendMessage(chatId, `💰 **[${netKey}] EXIT:** Selling ${pos.symbol} at ${pnl.toFixed(2)}% PnL.`);
            const sold = (netKey === 'SOL') ? await executeSolanaShotgun(chatId, pos.tokenAddress, pos.amountOut, 'SELL') : await executeEvmContract(chatId, netKey, pos.tokenAddress, pos.amountOut, 'SELL');
            if (sold) SYSTEM.lastTradedTokens[pos.tokenAddress] = true;
        } else { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 5000); }
    } catch(e) { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 8000); }
}

// ==========================================
//  CONNECTION HANDLER
// ==========================================

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const phrase = match[1].trim();
        evmWallet = ethers.HDNodeWallet.fromPhrase(phrase);
        const seed = await bip39.mnemonicToSeed(phrase);
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.sendMessage(msg.chat.id, `✅ **NEURAL LINK SYNCED.** System ready.`);
    } catch (e) { bot.sendMessage(msg.chat.id, `❌ **SYNC FAILED.**`); }
});

bot.onText(/\/amount (.+)/, (msg, match) => {
    SYSTEM.tradeAmount = match[1];
    bot.sendMessage(msg.chat.id, `✅ **AMOUNT SET:** ${SYSTEM.tradeAmount}`);
});

http.createServer((req, res) => res.end("APEX v9019 ONLINE")).listen(8080);
console.log("APEX v9019 OMNI-MASTER READY".magenta);
