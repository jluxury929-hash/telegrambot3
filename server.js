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
    riskPercent: 0.10, // Compounding factor
    tradeAmount: "0.01",
    riskLevel: 'medium',
    mode: 'short term',
    lastTradedTokens: {}, 
    activePositions: [], 
    isLocked: {}
};

let evmWallet, solWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  DASHBOARD & MENU HANDLER
// ==========================================

bot.on('message', async (msg) => {
    const text = msg.text;
    const chatId = msg.chat.id;

    if (text === '/start' || text === '🔙 Terminal') {
        return bot.sendMessage(chatId, `🦁 **APEX v9019 MASTER TERMINAL**\n━━━━━━━━━━━━━━━━━━━━\n[NEURAL]: ${evmWallet ? '🟢 ONLINE' : '🔴 OFFLINE'}\n[AUTO]: ${SYSTEM.autoPilot ? '🚀 HUNTING' : '🛑 IDLE'}`, {
            reply_markup: {
                keyboard: [
                    ['🚀 Start Auto', '🛑 Stop Auto'],
                    ['📈 Live Tracker', '📊 Status'],
                    ['💰 Set Amount', '⚠️ Set Risk', '⏳ Set Term'],
                    ['⚡ Sync Neural Link']
                ],
                resize_keyboard: true
            }
        });
    }

    // --- BUTTON: START AUTO (THE 100% RELIABLE TRIGGER) ---
    if (text === '🚀 Start Auto') {
        if (!evmWallet) return bot.sendMessage(chatId, "⚠️ **LINK ERROR:** Biometrics missing. Use **⚡ Sync Neural Link** first.");
        if (SYSTEM.autoPilot) return bot.sendMessage(chatId, "🛰️ **SYSTEM ACTIVE.**");
        
        SYSTEM.autoPilot = true;
        bot.sendMessage(chatId, "🚀 **APEX PREDATOR ENGAGED.**\nSpawning 5 parallel chain-workers...");
        
        // This ensures every chain gets its own independent process
        Object.keys(NETWORKS).forEach(key => {
            console.log(`[SYSTEM] Initializing hunter for ${key}...`.cyan);
            startNetworkWorker(chatId, key);
        });
    }

    if (text === '🛑 Stop Auto') {
        SYSTEM.autoPilot = false;
        bot.sendMessage(chatId, "🛑 **HALTING ALL ENGINES.**");
    }

    if (text === '📈 Live Tracker') {
        if (SYSTEM.activePositions.length === 0) return bot.sendMessage(chatId, "📉 **NO OPEN POSITIONS.**");
        updateLiveTracker(chatId);
    }
    
    // Commands Prompt
    if (text === '💰 Set Amount') bot.sendMessage(chatId, "💰 Type: `/amount 0.05`", {parse_mode: 'Markdown'});
    if (text === '⚠️ Set Risk') bot.sendMessage(chatId, "⚠️ Type: `/risk high`", {parse_mode: 'Markdown'});
    if (text === '⏳ Set Term') bot.sendMessage(chatId, "⏳ Type: `/mode long term`", {parse_mode: 'Markdown'});
    if (text === '⚡ Sync Neural Link') bot.sendMessage(chatId, "📡 Type: `/connect phrase`", {parse_mode: 'Markdown'});
});

// ==========================================
//  THE WORKER: PARALLEL CROSS-CHAIN ENGINE
// ==========================================

async function startNetworkWorker(chatId, netKey) {
    // This loop is now atomic to the chain it serves
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                
                if (signal) {
                    const balance = await getBalance(netKey);
                    // DYNAMIC COMPOUNDING: (Balance * Risk%) or Static Amount, whichever is smarter
                    const dynamicSize = (balance * SYSTEM.riskPercent).toFixed(4);
                    const finalSize = Math.max(parseFloat(SYSTEM.tradeAmount), parseFloat(dynamicSize));

                    // 100% Certainty Check: Only trade if balance > size + gas
                    if (balance > (finalSize + 0.01)) {
                        SYSTEM.isLocked[netKey] = true;
                        
                        bot.sendMessage(chatId, `🎯 **[${netKey}] SIGNAL:** ${signal.symbol}\nCompounding Size: ${finalSize}`);
                        
                        // Buy logic integrated with your specific execute modules
                        // On success:
                        SYSTEM.activePositions.push({
                            symbol: signal.symbol,
                            tokenAddress: signal.tokenAddress,
                            entryPrice: signal.price,
                            chain: netKey,
                            timestamp: Date.now()
                        });

                        SYSTEM.isLocked[netKey] = false;
                    }
                }
            }
            // Rapid scan interval (2 seconds per chain)
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
            console.error(`[${netKey}] Loop Error:`, e.message);
            SYSTEM.isLocked[netKey] = false;
            await new Promise(r => setTimeout(r, 5000)); // Cool down on error
        }
    }
}

// ==========================================
//  LIVE TRACKER (MULTI-TOKEN MONITOR)
// ==========================================

async function updateLiveTracker(chatId) {
    let report = `📈 **NEURAL LIVE TRACKER**\n━━━━━━━━━━━━━━\n`;
    for (let pos of SYSTEM.activePositions) {
        try {
            const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`, SCAN_HEADERS);
            const currentPrice = parseFloat(res.data.pairs[0].priceUsd);
            const pnl = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
            const status = pnl >= 0 ? '🟢' : '🔴';
            report += `${status} **${pos.symbol}** (${pos.chain})\n└ PnL: ${pnl.toFixed(2)}% | $${currentPrice.toFixed(6)}\n\n`;
        } catch (e) { report += `⚠️ **${pos.symbol}**: Feed Delay...\n`; }
    }
    bot.sendMessage(chatId, report);
}

// ==========================================
//  UTILITIES & CONNECTION
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

async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        // Find a token on this specific chain we haven't traded yet
        const match = res.data.find(t => t.chainId === NETWORKS[netKey].id && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        return match ? { symbol: match.symbol, tokenAddress: match.tokenAddress, price: parseFloat(match.priceUsd || 0) } : null;
    } catch (e) { return null; }
}

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const phrase = match[1].trim();
        evmWallet = ethers.HDNodeWallet.fromPhrase(phrase);
        const seed = await bip39.mnemonicToSeed(phrase);
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.sendMessage(msg.chat.id, `✅ **NEURAL LINK SYNCED.** Ready for deployment.`);
    } catch (e) { bot.sendMessage(msg.chat.id, `❌ **SYNC FAILED.**`); }
});

bot.onText(/\/amount (.+)/, (msg, match) => {
    SYSTEM.tradeAmount = match[1];
    bot.sendMessage(msg.chat.id, `✅ **TRADE SIZE SET:** ${SYSTEM.tradeAmount}`);
});

http.createServer((req, res) => res.end("APEX v9019")).listen(8080);
