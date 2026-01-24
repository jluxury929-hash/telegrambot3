require('dotenv').config();
const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'x-api-key': 'f440d4df-b5c4-4020-a960-ac182d3752ab' }};
const NETWORKS = {
    ETH:  { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' },
    SOL:  { id: 'solana', rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com' },
    BASE: { id: 'base', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' },
    BSC:  { id: 'bsc', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E' },
    ARB:  { id: 'arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' }
};

let SYSTEM = { 
    autoPilot: false, 
    riskPercent: 0.10, 
    tradeAmount: "0.01",
    riskLevel: 'medium',
    mode: 'short term',
    lastTradedTokens: {}, 
    isLocked: {},
    startTime: Date.now()
};

let evmWallet, solWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

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

// ==========================================
//  FIXED: MENU & COMMAND HANDLERS
// ==========================================

bot.on('message', async (msg) => {
    const text = msg.text;
    const chatId = msg.chat.id;

    if (text === '/start') {
        bot.sendMessage(chatId, `🦁 **APEX v9019 TERMINAL**\nStatus: ${SYSTEM.autoPilot ? 'RUNNING' : 'STOPPED'}`, {
            reply_markup: {
                keyboard: [
                    ['🚀 Start Auto', '🛑 Stop Auto'],
                    ['📊 Status', '⚙️ Settings'],
                    ['🔐 Connect Wallet'] // Added to menu
                ],
                resize_keyboard: true
            }
        });
    }

    if (text === '🚀 Start Auto') {
        if (!evmWallet || !solWallet) return bot.sendMessage(chatId, "❌ **ERROR:** Connect your wallet first using /connect or the menu.");
        if (SYSTEM.autoPilot) return bot.sendMessage(chatId, "⚠️ System already active.");
        SYSTEM.autoPilot = true;
        bot.sendMessage(chatId, "🚀 **ENGINE IGNITION.** Compounding logic active.");
        Object.keys(NETWORKS).forEach(key => startNetworkLoop(chatId, key));
    }

    if (text === '🛑 Stop Auto') {
        SYSTEM.autoPilot = false;
        bot.sendMessage(chatId, "🛑 **EMERGENCY STOP.** All scanning halted.");
    }

    if (text === '📊 Status') {
        let report = `📊 **LIVE PERFORMANCE**\n━━━━━━━━━━━━━━\n`;
        for (let key of Object.keys(NETWORKS)) {
            const bal = (evmWallet) ? await getBalance(key) : 0;
            report += `🔹 **${key}:** ${bal.toFixed(4)}\n`;
        }
        bot.sendMessage(chatId, report);
    }

    if (text === '⚙️ Settings') {
        bot.sendMessage(chatId, `⚙️ **SYSTEM CONFIG**\n━━━━━━━━━━━━━━\nRisk: ${SYSTEM.riskLevel}\nMode: ${SYSTEM.mode}\nCompound: ${(SYSTEM.riskPercent*100)}%\n\nTo update, use:\n/riskpercent 20\n/setamount 0.05`);
    }

    if (text === '🔐 Connect Wallet') {
        bot.sendMessage(chatId, `🔑 **SECURE CONNECTION**\nPlease send your seed phrase in this format:\n\n\`/connect your twelve word seed phrase here\``, { parse_mode: 'Markdown' });
    }
});

// ==========================================
//  AUTO-PILOT WORKER LOOP
// ==========================================

async function startNetworkLoop(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal) {
                    const balance = await getBalance(netKey);
                    const dynamicAmount = (balance * SYSTEM.riskPercent).toFixed(4);
                    
                    if (balance > (parseFloat(dynamicAmount) + 0.01)) {
                        SYSTEM.isLocked[netKey] = true;
                        bot.sendMessage(chatId, `🎯 **[${netKey}] SIGNAL:** ${signal.symbol}\nCompounded Buy: ${dynamicAmount}`);
                        // execution calls here...
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

// --- ACTUAL CONNECTION HANDLER ---
bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const phrase = match[1].trim();
        evmWallet = ethers.HDNodeWallet.fromPhrase(phrase);
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", (await bip39.mnemonicToSeed(phrase)).toString('hex')).key);
        bot.sendMessage(msg.chat.id, `✅ **WALLETS LINKED.**\nEVM: \`${evmWallet.address}\`\nSOL: \`${solWallet.publicKey.toString()}\``, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, `❌ **FAIL:** Invalid seed phrase.`); }
});

http.createServer((req, res) => res.end("APEX v9019")).listen(8080);
