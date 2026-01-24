/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL OMNI-MASTER v9019
 * ===============================================================================
 * ENGINE: Data-Driven AI + Web Signal Confirmation
 * SCANNER: Volatility-First (1m/5m Price Velocity)
 * UI: High-Speed Interactive Menu (Edit-Mode)
 * ===============================================================================
 */

require('dotenv').config();
const { ethers } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- CONFIGURATION ---
const AI_MODEL = "gpt-4o"; // Quantitative reasoning model
const SCAN_INTERVAL = 1500; // 1.5s ultra-fast scan
const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";

let SYSTEM = { 
    autoPilot: false, 
    tradeAmount: "0.01", 
    lastTradedTokens: {}, 
    isLocked: {},
    minAiScore: 85 // AI must confirm 85% data integrity
};

let evmWallet, solWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  UI - HIGH-SPEED DASHBOARD
// ==========================================

const getMenu = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: `Engine: ${SYSTEM.autoPilot ? "🟢 RUNNING" : "🔴 STOPPED"}`, callback_data: 'toggle' }],
            [{ text: `💰 Trade Size: ${SYSTEM.tradeAmount}`, callback_data: 'setamount' }],
            [{ text: `🔑 ${evmWallet ? "Wallet: SYNCED" : "Connect Seed"}`, callback_data: 'connect' }],
            [{ text: "📊 AI Data Status", callback_data: 'status' }]
        ]
    },
    parse_mode: 'Markdown'
});

const updateUI = (chatId, msgId) => {
    const txt = `*APEX v9019: NEURAL DATA HUB*\n_Strategy: High-Velocity Web-AI Scalping_`;
    msgId ? bot.editMessageText(txt, { chat_id: chatId, message_id: msgId, ...getMenu() }).catch(() => {})
          : bot.sendMessage(chatId, txt, getMenu());
};

bot.onText(/\/start/, (msg) => updateUI(msg.chat.id));

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    bot.answerCallbackQuery(query.id);
    if (query.data === 'toggle') {
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) startNeuralEngine(chatId);
        updateUI(chatId, query.message.message_id);
    } else if (query.data === 'setamount') {
        bot.sendMessage(chatId, "⌨️ *Enter Trade Amount:*", { reply_markup: { force_reply: true } });
    } else if (query.data === 'connect') {
        bot.sendMessage(chatId, "🔑 *Enter 12/24 Word Seed:*", { reply_markup: { force_reply: true } });
    }
});

// ==========================================
//  THE NEURAL ENGINE (VOLATILITY + DATA)
// ==========================================

async function startNeuralEngine(chatId) {
    while (SYSTEM.autoPilot) {
        try {
            // 1. DATA SCAN: Look for most volatile tokens (Data over Patterns)
            const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1');
            const candidate = res.data[0];

            if (candidate && !SYSTEM.lastTradedTokens[candidate.tokenAddress]) {
                // 2. WEB SIGNAL SCRAPE: Deep-check the numbers
                const stats = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${candidate.tokenAddress}`);
                const data = stats.data.pairs[0];

                const metrics = {
                    change5m: Math.abs(data.priceChange.m5),
                    vol5m: data.volume.m5,
                    liq: data.liquidity.usd,
                    buySellRatio: data.txns.m5.buys / (data.txns.m5.sells || 1)
                };

                // 3. AI CONFIRMATION: Verify the "Data DNA"
                if (metrics.change5m > 5 && metrics.liq > 5000) {
                    const aiResult = await runAiInference(metrics, candidate.symbol);
                    
                    if (aiResult.score >= SYSTEM.minAiScore) {
                        bot.sendMessage(chatId, `🎯 **AI CONFIRMED TRADE**\nToken: ${candidate.symbol}\nScore: ${aiResult.score}\nReason: ${aiResult.reason}`);
                        
                        // 4. EXECUTION (Auto-Detect Chain)
                        const netKey = data.chainId.toUpperCase();
                        if (netKey === 'SOLANA') await executeSol(chatId, candidate.tokenAddress);
                        else await executeEvm(chatId, netKey, candidate.tokenAddress);

                        SYSTEM.lastTradedTokens[candidate.tokenAddress] = true;
                    }
                }
            }
            await new Promise(r => setTimeout(r, SCAN_INTERVAL));
        } catch (e) { await new Promise(r => setTimeout(r, 5000)); }
    }
}

async function runAiInference(data, sym) {
    try {
        const response = await axios.post("https://api.openai.com/v1/chat/completions", {
            model: AI_MODEL,
            messages: [{ role: "system", content: "You are a quant trader. Analyze raw metrics. No fluff." }, 
                       { role: "user", content: `Token: ${sym}, 5m Change: ${data.change5m}%, Liq: $${data.liq}, Buy/Sell Ratio: ${data.buySellRatio}. Rate 0-100.` }],
            response_format: { type: "json_object" }
        }, { headers: { 'Authorization': `Bearer ${process.env.AI_API_KEY}` } });
        return JSON.parse(response.data.choices[0].message.content);
    } catch (e) { return { score: 0 }; }
}

// ==========================================
//  WALLET HANDLING
// ==========================================

bot.on('message', async (msg) => {
    if (!msg.reply_to_message) return;
    const input = msg.text.trim();

    if (msg.reply_to_message.text.includes("Trade Amount")) {
        SYSTEM.tradeAmount = input;
        bot.sendMessage(msg.chat.id, `✅ Trade size set to ${input}`);
    }

    if (msg.reply_to_message.text.includes("Seed")) {
        try {
            evmWallet = ethers.Wallet.fromPhrase(input);
            const seedBuf = await bip39.mnemonicToSeed(input);
            solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seedBuf.toString('hex')).key);
            bot.deleteMessage(msg.chat.id, msg.message_id);
            bot.sendMessage(msg.chat.id, "🔐 **NEURAL LINK SECURED.**");
        } catch (e) { bot.sendMessage(msg.chat.id, "❌ Invalid seed phrase."); }
    }
});

http.createServer((req, res) => res.end("APEX v9019 ONLINE")).listen(8080);
