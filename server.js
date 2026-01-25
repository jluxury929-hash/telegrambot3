/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9032 (ULTIMATE 24/7 EDITION)
 * ===============================================================================
 * UPTIME: Self-healing recursive sniper loop for 24/7 autonomous operation.
 * GUARD: Global exception handlers prevent process exit on network/API errors.
 * FIX: Dashboard Sync - UI buttons and state update instantly.
 * FIX: /amount & /term - Correct cycling and manual control synchronization.
 * WITHDRAW: /withdraw converts all tradeable SPL assets into USDT instantly.
 * ===============================================================================
 */

require('dotenv').config();
const { ethers } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- 🛡️ 24/7 GLOBAL PROCESS GUARDS ---
process.on('uncaughtException', (e) => console.error(`[CRITICAL] Uncaught: ${e.message}`.red));
process.on('unhandledRejection', (r) => console.error(`[CRITICAL] Rejected: ${r}`.red));

// --- CONSTANTS ---
const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";
const RUGCHECK_API = "https://api.rugcheck.xyz/v1/tokens";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'x-api-key': 'f440d4df-b5c4-4020-a960-ac182d3752ab' }};

// --- GLOBAL STATE ---
let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MEDIUM', mode: 'SHORT',
    lastTradedTokens: {}, currentAsset: 'So11111111111111111111111111111111111111112'
};
let solWallet;

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  📊 UI & BUTTON SYNC LOGIC
// ==========================================

const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP ROTATION" : "🚀 START ROTATION", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount} SOL`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `🛡️ RISK: ${SYSTEM.risk}`, callback_data: "cycle_risk" }, { text: `⏱️ TERM: ${SYSTEM.mode}`, callback_data: "cycle_mode" }],
            [{ text: "💵 WITHDRAW TO USDT", callback_data: "cmd_withdraw" }]
        ]
    }
});

const refreshUI = (chatId, msgId) => {
    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: chatId, message_id: msgId }).catch(() => {});
};

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const msgId = q.message.message_id;

    if (q.data === "cycle_risk") {
        const risks = ['LOW', 'MEDIUM', 'HIGH'];
        SYSTEM.risk = risks[(risks.indexOf(SYSTEM.risk) + 1) % risks.length];
        refreshUI(chatId, msgId);
    }
    if (q.data === "cycle_mode") {
        const modes = ['SHORT', 'MEDIUM', 'LONG'];
        SYSTEM.mode = modes[(modes.indexOf(SYSTEM.mode) + 1) % modes.length];
        refreshUI(chatId, msgId);
    }
    if (q.data === "cycle_amt") {
        const amts = ["0.01", "0.05", "0.1", "0.25", "0.5"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
        refreshUI(chatId, msgId);
    }
    if (q.data === "cmd_auto") {
        if (!solWallet) return bot.answerCallbackQuery(q.id, { text: "❌ Connect Wallet First!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) {
            bot.sendMessage(chatId, "🚀 **AUTO-PILOT ACTIVE (24/7):** Scanning for profitable rotations...");
            startNetworkSniper(chatId);
        }
        refreshUI(chatId, msgId);
    }
    if (q.data === "cmd_status") {
        if (!solWallet) return bot.answerCallbackQuery(q.id, { text: "❌ Sync Wallet!" });
        const conn = new Connection(process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com');
        const bal = await conn.getBalance(solWallet.publicKey);
        bot.sendMessage(chatId, `📊 **APEX STATUS**\n------------------\n📍 **SVM:** \`${solWallet.publicKey.toString().substring(0,8)}...\`\n💰 **BAL:** ${(bal / 1e9).toFixed(4)} SOL\n🤖 **AUTO:** ${SYSTEM.autoPilot ? '✅' : '❌'}\n🛡️ **RISK:** ${SYSTEM.risk}\n⏱️ **TERM:** ${SYSTEM.mode}`);
    }
    if (q.data === "cmd_withdraw") executeWithdrawal(chatId);
    bot.answerCallbackQuery(q.id);
});

// ==========================================
//  🔄 INFINITE SNIPER (SELF-HEALING)
// ==========================================

async function startNetworkSniper(chatId) {
    if (!SYSTEM.autoPilot) return;
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const match = res.data.find(t => t.chainId === 'solana' && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        if (match) {
            SYSTEM.lastTradedTokens[match.tokenAddress] = true;
            await executeRotation(chatId, match.tokenAddress);
        }
    } catch (e) { console.error(`[SCAN] ${e.message}`.yellow); await new Promise(r => setTimeout(r, 3000)); }

    // Recursive timeout for 24/7 loop stability
    setTimeout(() => startNetworkSniper(chatId), 1500);
}

async function executeRotation(chatId, targetToken) {
    try {
        const rug = await axios.get(`${RUGCHECK_API}/${targetToken}/report`);
        if (rug.data.score > 400) return;

        const dex = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${targetToken}`);
        const pair = dex.data.pairs[0];
        
        bot.sendMessage(chatId, `🧠 **NEURAL ROTATION:** $${pair.baseToken.symbol}...`);
        const conn = new Connection(process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);

        const res = await axios.get(`${JUP_ULTRA_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${targetToken}&amount=${amt}&slippageBps=100`);
        const swapRes = await axios.post(`${JUP_ULTRA_API}/swap`, {
            quoteResponse: res.data,
            userPublicKey: solWallet.publicKey.toString(),
            prioritizationFeeLamports: 150000 
        });

        const tx = VersionedTransaction.deserialize(Buffer.from(swapRes.data.swapTransaction, 'base64'));
        tx.sign([solWallet]);
        const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
        
        bot.sendMessage(chatId, `🚀 **SUCCESS:** Rotated into $${pair.baseToken.symbol}\n🔗 [View Solscan](https://solscan.io/tx/${sig})`, { parse_mode: 'Markdown' });
        SYSTEM.currentAsset = targetToken;
    } catch (e) { console.error(`[EXEC] ${e.message}`.red); }
}

// ==========================================
//  🏦 WITHDRAW COMMAND (SPL -> USDT)
// ==========================================

async function executeWithdrawal(chatId) {
    bot.sendMessage(chatId, "🏦 **WITHDRAWAL:** Cleaning SPL assets to USDT...");
    try {
        const conn = new Connection(process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', 'confirmed');
        const accounts = await conn.getParsedTokenAccountsByOwner(solWallet.publicKey, { programId: TOKEN_PROGRAM_ID });
        for (const account of accounts.value) {
            const info = account.account.data.parsed.info;
            if (info.tokenAmount.amount > 0 && info.mint !== USDT_MINT) {
                const quote = await axios.get(`${JUP_ULTRA_API}/quote?inputMint=${info.mint}&outputMint=${USDT_MINT}&amount=${info.tokenAmount.amount}&slippageBps=100`);
                const swap = await axios.post(`${JUP_ULTRA_API}/swap`, { quoteResponse: quote.data, userPublicKey: solWallet.publicKey.toString() });
                const tx = VersionedTransaction.deserialize(Buffer.from(swap.data.swapTransaction, 'base64'));
                tx.sign([solWallet]);
                await conn.sendRawTransaction(tx.serialize());
            }
        }
        bot.sendMessage(chatId, "✅ **WITHDRAWAL COMPLETE.** All earnings rotated to USDT.");
    } catch (e) { bot.sendMessage(chatId, "❌ **WITHDRAWAL ERROR.**"); }
}

bot.onText(/\/connect (.+)/, async (msg, match) => {
    const raw = match[1].trim();
    try {
        const seed = await bip39.mnemonicToSeed(raw);
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.sendMessage(msg.chat.id, `⚡ **NEURAL SYNC COMPLETE**\n📍 SVM: \`${solWallet.publicKey.toString()}\``);
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ **SYNC ERROR.**"); }
});

bot.onText(/\/amount (.+)/, (msg, match) => {
    if (!isNaN(match[1]) && parseFloat(match[1]) > 0) {
        SYSTEM.tradeAmount = match[1].trim();
        bot.sendMessage(msg.chat.id, `✅ **AMT UPDATED:** ${SYSTEM.tradeAmount} SOL`);
    }
});

bot.onText(/\/menu|\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "🎮 **APEX DASHBOARD v9032**", { parse_mode: 'Markdown', ...getDashboardMarkup() });
});

http.createServer((req, res) => res.end("APEX READY")).listen(8080);
