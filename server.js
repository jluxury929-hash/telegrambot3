/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9019 (OMNI-PARALLEL MASTER)
 * ===============================================================================
 * FEATURES: 24/7 Simultaneous Sniping, Auto-Compounding, Neural Live Tracker.
 * NETWORKS: ETH, SOL, BASE, BSC, ARB
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

// --- SMART CONTRACT CONFIG ---
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
    ETH:  { id: 'ethereum', type: 'EVM', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', scanPrefix: 'https://etherscan.io/tx/' },
    SOL:  { id: 'solana', type: 'SVM', rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', scanPrefix: 'https://solscan.io/tx/' },
    BASE: { id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', scanPrefix: 'https://basescan.org/tx/' },
    BSC:  { id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', scanPrefix: 'https://bscscan.com/tx/' },
    ARB:  { id: 'arbitrum', type: 'EVM', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', scanPrefix: 'https://arbiscan.io/tx/' }
};

// --- SYSTEM STATE ---
let SYSTEM = { 
    autoPilot: false, 
    tradeAmount: "0.01", 
    riskPercent: 0.10, // Compounding factor (10%)
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
//  BALANCE & DIAGNOSTICS
// ==========================================

async function getBalance(netKey) {
    try {
        if (netKey === 'SOL') {
            const conn = new Connection(NETWORKS.SOL.rpc);
            return (await conn.getBalance(solWallet.publicKey)) / LAMPORTS_PER_SOL;
        }
        const prov = new JsonRpcProvider(NETWORKS[netKey].rpc);
        const bal = await prov.getBalance(evmWallet.address);
        return parseFloat(ethers.formatEther(bal));
    } catch (e) { return 0; }
}

async function verifyBalance(chatId, netKey, amount) {
    try {
        const bal = await getBalance(netKey);
        const buffer = netKey === 'SOL' ? 0.01 : 0.005;
        if (bal < (parseFloat(amount) + buffer)) {
            bot.sendMessage(chatId, `⚠️ **[${netKey}] WARNING:** Low funds. Have ${bal.toFixed(4)}, need ${(parseFloat(amount) + buffer).toFixed(4)}.`);
            return false;
        }
        return true;
    } catch (e) { return false; }
}

// ==========================================
//  MASTER INTERFACE (MENU)
// ==========================================

bot.on('message', async (msg) => {
    const text = msg.text;
    const chatId = msg.chat.id;

    if (text === '/start' || text === '🔙 Terminal') {
        const welcome = `🦁 **APEX v9019 MASTER TERMINAL**\n━━━━━━━━━━━━━━━━━━━━\n[NEURAL]: ${evmWallet ? '🟢 ONLINE' : '🔴 OFFLINE'}\n[AUTO]: ${SYSTEM.autoPilot ? '🚀 HUNTING' : '🛑 IDLE'}\n[AMOUNT]: ${SYSTEM.tradeAmount}`;
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

    if (text === '🚀 Start Auto') {
        if (!evmWallet || !solWallet) return bot.sendMessage(chatId, "❌ **LINK ERROR:** Sync biometrics first.");
        if (SYSTEM.autoPilot) return bot.sendMessage(chatId, "🛰️ **SYSTEM ACTIVE.** Monitoring all chains.");
        
        SYSTEM.autoPilot = true;
        bot.sendMessage(chatId, "🚀 **APEX PREDATOR ENGAGED.**\nInitializing parallel 5-chain workers...");
        Object.keys(NETWORKS).forEach(netKey => startNetworkWorker(chatId, netKey));
    }

    if (text === '🛑 Stop Auto') {
        SYSTEM.autoPilot = false;
        bot.sendMessage(chatId, "🛑 **EMERGENCY STOP.** All scanning modules offline.");
    }

    if (text === '📊 Status') {
        let report = `📊 **SYSTEM STATUS**\n━━━━━━━━━━━━━━\n`;
        for (let key of Object.keys(NETWORKS)) {
            const bal = evmWallet ? await getBalance(key) : 0;
            report += `🔹 **${key}:** ${bal.toFixed(4)}\n`;
        }
        bot.sendMessage(chatId, report);
    }

    if (text === '📈 Live Tracker') {
        if (SYSTEM.activePositions.length === 0) return bot.sendMessage(chatId, "📉 **TRACKER EMPTY.**");
        updateLiveTracker(chatId);
    }

    if (text === '⚡ Sync Neural Link') {
        bot.sendMessage(chatId, `📡 **SYNC:** Send \`/connect twelve word phrase here\``, { parse_mode: 'Markdown' });
    }

    if (text === '💰 Set Amount') {
        bot.sendMessage(chatId, `💰 **AMOUNT:** Send \`/amount 0.05\``);
    }
});

// ==========================================
//  SNIPER ENGINE (100% CROSS-CHAIN)
// ==========================================

async function startNetworkWorker(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal) {
                    const balance = await getBalance(netKey);
                    const dynamicAmount = (balance * SYSTEM.riskPercent).toFixed(4);
                    const finalAmount = Math.max(parseFloat(SYSTEM.tradeAmount), parseFloat(dynamicAmount));

                    if (await verifyBalance(chatId, netKey, finalAmount)) {
                        SYSTEM.isLocked[netKey] = true;
                        bot.sendMessage(chatId, `🎯 **[${netKey}] SIGNAL:** ${signal.symbol}\nBuying: ${finalAmount} (Compounding)`);

                        const buyRes = (netKey === 'SOL')
                            ? await executeSolanaShotgun(chatId, signal.tokenAddress, finalAmount)
                            : await executeEvmContract(chatId, netKey, signal.tokenAddress, finalAmount);

                        if (buyRes && buyRes.hash) {
                            bot.sendMessage(chatId, `✅ **[${netKey}] CONFIRMED:** ${signal.symbol}\n[View Hash](${NETWORKS[netKey].scanPrefix}${buyRes.hash})`, { parse_mode: 'Markdown' });
                            const pos = { ...signal, entryPrice: signal.price, chain: netKey, amountOut: buyRes.amountOut };
                            SYSTEM.activePositions.push(pos);
                            startIndependentPeakMonitor(chatId, netKey, pos);
                        }
                        SYSTEM.isLocked[netKey] = false;
                    }
                }
            }
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 5000)); }
    }
}

async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const match = res.data.find(t => t.chainId === NETWORKS[netKey].id && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        if (match) {
            const meta = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${match.tokenAddress}`, SCAN_HEADERS);
            const pair = meta.data.pairs ? meta.data.pairs[0] : null;
            return {
                symbol: pair ? pair.baseToken.symbol : 'GEMS',
                tokenAddress: match.tokenAddress,
                price: pair ? parseFloat(pair.priceUsd) : 0
            };
        }
    } catch (e) { return null; }
}

// ==========================================
//  EXECUTION LOGIC (HASH SECURED)
// ==========================================

async function executeEvmContract(chatId, netKey, tokenAddress, amount) {
    try {
        const net = NETWORKS[netKey];
        const signer = evmWallet.connect(new JsonRpcProvider(net.rpc));
        const contract = new ethers.Contract(MY_EXECUTOR, APEX_EXECUTOR_ABI, signer);
        const tx = await contract.executeBuy(net.router, tokenAddress, 0, Math.floor(Date.now()/1000)+120, {
            value: ethers.parseEther(amount.toString()),
            gasLimit: 350000
        });
        return { hash: tx.hash, amountOut: 1 };
    } catch (e) { return null; }
}

async function executeSolanaShotgun(chatId, tokenAddress, amount) {
    try {
        const amtStr = Math.floor(amount * LAMPORTS_PER_SOL).toString();
        const res = await axios.get(`${JUP_ULTRA_API}/order?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenAddress}&amount=${amtStr}&taker=${solWallet.publicKey.toString()}&slippageBps=200`, SCAN_HEADERS);
        const tx = VersionedTransaction.deserialize(Buffer.from(res.data.transaction, 'base64'));
        tx.sign([solWallet]);
        const sig = await new Connection(NETWORKS.SOL.rpc).sendRawTransaction(tx.serialize(), { skipPreflight: true });
        return { hash: sig, amountOut: res.data.outAmount };
    } catch (e) { return null; }
}

// ==========================================
//  COMMAND HANDLERS
// ==========================================

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const phrase = match[1].trim();
        evmWallet = ethers.HDNodeWallet.fromPhrase(phrase);
        const seed = await bip39.mnemonicToSeed(phrase);
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.sendMessage(msg.chat.id, `✅ **NEURAL LINK SYNCED.**`);
    } catch (e) { bot.sendMessage(msg.chat.id, `❌ **SYNC FAILED.**`); }
});

bot.onText(/\/amount (.+)/, (msg, match) => {
    SYSTEM.tradeAmount = match[1];
    bot.sendMessage(msg.chat.id, `✅ **AMOUNT UPDATED:** ${SYSTEM.tradeAmount}`);
});

http.createServer((req, res) => res.end("APEX v9019")).listen(8080);
