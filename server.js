require('dotenv').config();
const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- CONFIG ---
const MY_EXECUTOR = "0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610";
const APEX_EXECUTOR_ABI = [
    "function executeBuy(address router, address token, uint256 minOut, uint256 deadline) external payable",
    "function executeSell(address router, address token, uint256 amtIn, uint256 minOut, uint256 deadline) external"
];
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'x-api-key': 'f440d4df-b5c4-4020-a960-ac182d3752ab' }};

const NETWORKS = {
    ETH:  { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' },
    SOL:  { id: 'solana', rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com' },
    BASE: { id: 'base', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' },
    BSC:  { id: 'bsc', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E' },
    ARB:  { id: 'arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' }
};

// --- SYSTEM STATE ---
let SYSTEM = { 
    autoPilot: false, 
    riskPercent: 0.10, 
    tradeAmount: "0.01", // Default amount
    riskLevel: 'medium',
    mode: 'short term',
    lastTradedTokens: {}, 
    isLocked: {},
    startTime: Date.now()
};

let evmWallet, solWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  MASTER INTERFACE HANDLER
// ==========================================

bot.on('message', async (msg) => {
    const text = msg.text;
    const chatId = msg.chat.id;

    if (text === '/start' || text === '🔙 Terminal') {
        const welcome = `🦁 **APEX v9019 TERMINAL**\n━━━━━━━━━━━━━━━━━━━━\n[NEURAL]: ${evmWallet ? '🟢 ONLINE' : '🔴 OFFLINE'}\n[AMOUNT]: ${SYSTEM.tradeAmount}\n[AUTO]: ${SYSTEM.autoPilot ? '🚀 ACTIVE' : '🛑 IDLE'}`;
        return bot.sendMessage(chatId, welcome, {
            reply_markup: {
                keyboard: [
                    ['🚀 Start Auto', '🛑 Stop Auto'],
                    ['📊 Status', '⚙️ Settings'],
                    ['⚡ Sync Neural Link', '💰 Set Amount']
                ],
                resize_keyboard: true
            }
        });
    }

    // --- BUTTON: SYNC NEURAL LINK ---
    if (text === '⚡ Sync Neural Link') {
        return bot.sendMessage(chatId, `📡 **ESTABLISHING SECURE LINK...**\nBroadcast your seed phrase using:\n\n\`/connect your phrase here\``, { parse_mode: 'Markdown' });
    }

    // --- BUTTON: SET AMOUNT ---
    if (text === '💰 Set Amount') {
        return bot.sendMessage(chatId, `💰 **TRADE SIZE PROTOCOL**\nCurrent: ${SYSTEM.tradeAmount}\n\nUpdate using:\n\n\`/amount 0.05\``, { parse_mode: 'Markdown' });
    }

    // --- BUTTON: START AUTO ---
    if (text === '🚀 Start Auto') {
        if (!evmWallet) return bot.sendMessage(chatId, "⚠️ **LINK ERROR:** Biometrics missing. Use **⚡ Sync Neural Link** first.");
        if (SYSTEM.autoPilot) return bot.sendMessage(chatId, "🛰️ **SYSTEM ACTIVE.** Monitoring chains...");
        
        SYSTEM.autoPilot = true;
        bot.sendMessage(chatId, "🚀 **APEX PREDATOR ENGAGED.**\nParallel hunting enabled.");
        Object.keys(NETWORKS).forEach(key => startNetworkLoop(chatId, key));
    }

    if (text === '🛑 Stop Auto') {
        SYSTEM.autoPilot = false;
        bot.sendMessage(chatId, "🛑 **HALTING ENGINES.**");
    }

    if (text === '📊 Status') {
        let report = `📊 **LIVE FEED**\n━━━━━━━━━━━━━━\n`;
        for (let key of Object.keys(NETWORKS)) {
            const bal = evmWallet ? await getBalance(key) : 0;
            report += `🔹 **${key}:** ${bal.toFixed(4)}\n`;
        }
        bot.sendMessage(chatId, report);
    }
});

// ==========================================
//  COMMAND HANDLERS
// ==========================================

// Set Amount Command
bot.onText(/\/amount (.+)/, (msg, match) => {
    const val = parseFloat(match[1]);
    if (!isNaN(val) && val > 0) {
        SYSTEM.tradeAmount = val.toString();
        bot.sendMessage(msg.chat.id, `✅ **AMOUNT UPDATED:** ${SYSTEM.tradeAmount}`);
    } else {
        bot.sendMessage(msg.chat.id, `❌ **ERROR:** Invalid numeric value.`);
    }
});

// Neural Link Command
bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const phrase = match[1].trim();
        evmWallet = ethers.HDNodeWallet.fromPhrase(phrase);
        const seed = await bip39.mnemonicToSeed(phrase);
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.sendMessage(msg.chat.id, `✅ **NEURAL LINK SYNCED.** Ready.`);
    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ **SYNC FAILED.**`);
    }
});

// ==========================================
//  SNIPER ENGINE & BALANCE
// ==========================================

async function getBalance(netKey) {
    try {
        if (netKey === 'SOL') {
            const conn = new Connection(NETWORKS.SOL.rpc);
            return (await conn.getBalance(solWallet.publicKey)) / LAMPORTS_PER_SOL;
        }
        const prov = new JsonRpcProvider(NETWORKS[netKey].rpc);
        return parseFloat(ethers.formatEther(await prov.getBalance(evmWallet.address)));
    } catch (e) { return 0; }
}

async function startNetworkLoop(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal) {
                    const balance = await getBalance(netKey);
                    // Trades use your custom tradeAmount, but check against balance
                    const amt = parseFloat(SYSTEM.tradeAmount);
                    
                    if (balance > (amt + 0.01)) {
                        SYSTEM.isLocked[netKey] = true;
                        bot.sendMessage(chatId, `🎯 **[${netKey}] BUYING:** ${signal.symbol}\nSize: ${amt}`);
                        // Buy logic execution...
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
        return match ? { symbol: match.symbol, tokenAddress: match.tokenAddress, price: parseFloat(match.priceUsd || 0) } : null;
    } catch (e) { return null; }
}

http.createServer((req, res) => res.end("APEX ONLINE")).listen(8080);
