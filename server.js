/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9019 (SPEED-OPTIMIZED MASTER)
 * ===============================================================================
 * UPDATE: Message editing for 0ms menu latency.
 * NEW: Secure "Connect Wallet" menu flow.
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

const MY_EXECUTOR = "0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610";
const APEX_EXECUTOR_ABI = ["function executeBuy(address router, address token, uint256 minOut, uint256 deadline) external payable", "function executeSell(address router, address token, uint256 amtIn, uint256 minOut, uint256 deadline) external", "function emergencyWithdraw(address token) external"];
const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'x-api-key': 'f440d4df-b5c4-4020-a960-ac182d3752ab' }};

const NETWORKS = {
    ETH:  { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' },
    SOL:  { id: 'solana', rpc: 'https://api.mainnet-beta.solana.com' },
    BASE: { id: 'base', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' },
    BSC:  { id: 'bsc', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E' },
    ARB:  { id: 'arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' }
};

let SYSTEM = { autoPilot: false, tradeAmount: "0.01", lastTradedTokens: {}, isLocked: {} };
let evmWallet, solWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  UI - FAST NAVIGATION SYSTEM
// ==========================================

const getMenuMarkup = () => {
    const status = SYSTEM.autoPilot ? "🟢 ACTIVE" : "🔴 STOPPED";
    const walletStatus = evmWallet ? "✅ SYNCED" : "❌ DISCONNECTED";
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: `Engine: ${status}`, callback_data: 'toggle' }],
                [{ text: `💰 Set Amount (${SYSTEM.tradeAmount})`, callback_data: 'setamount' }],
                [{ text: `🔑 Connect Wallet (${walletStatus})`, callback_data: 'connect_wallet' }],
                [{ text: "📊 Status & Balances", callback_data: 'status' }]
            ]
        },
        parse_mode: 'Markdown'
    };
};

// Start or Update Menu
const refreshMenu = (chatId, messageId = null) => {
    const text = `*APEX v9019 DASHBOARD*\n_Speed optimized neural link active._`;
    if (messageId) {
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...getMenuMarkup() }).catch(() => {});
    } else {
        bot.sendMessage(chatId, text, getMenuMarkup());
    }
};

bot.onText(/\/start/, (msg) => refreshMenu(msg.chat.id));

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;

    bot.answerCallbackQuery(query.id); // Remove loading spinner immediately

    if (query.data === 'toggle') {
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) Object.keys(NETWORKS).forEach(nk => startNetworkSniper(chatId, nk));
        refreshMenu(chatId, msgId);
    } 
    else if (query.data === 'setamount') {
        bot.sendMessage(chatId, "⌨️ *Trade Amount:* Enter new value (e.g. 0.05):", { reply_markup: { force_reply: true }, parse_mode: 'Markdown' });
    }
    else if (query.data === 'connect_wallet') {
        bot.sendMessage(chatId, "🔑 *Security:* Send your 12/24 word seed phrase.\n_(This message will be deleted after syncing)_", { reply_markup: { force_reply: true }, parse_mode: 'Markdown' });
    }
    else if (query.data === 'status') {
        let msg = `*SYSTEM STATUS*\nEngine: ${SYSTEM.autoPilot ? 'RUNNING' : 'IDLE'}\nAmount: ${SYSTEM.tradeAmount}\nWallet: ${evmWallet ? 'CONNECTED' : 'NOT SET'}`;
        bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    }
});

// Capture Replied Inputs (Amount & Seed)
bot.on('message', async (msg) => {
    if (!msg.reply_to_message) return;

    // Handle Amount Update
    if (msg.reply_to_message.text.includes("Trade Amount")) {
        if (!isNaN(parseFloat(msg.text))) {
            SYSTEM.tradeAmount = msg.text.trim();
            bot.sendMessage(msg.chat.id, `✅ Amount updated: ${SYSTEM.tradeAmount}`);
        }
    }

    // Handle Seed Connection
    if (msg.reply_to_message.text.includes("seed phrase")) {
        try {
            const seed = msg.text.trim();
            evmWallet = ethers.Wallet.fromPhrase(seed);
            const seedBuffer = await bip39.mnemonicToSeed(seed);
            solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seedBuffer.toString('hex')).key);
            
            bot.deleteMessage(msg.chat.id, msg.message_id); // Security: Delete phrase
            bot.sendMessage(msg.chat.id, `🔐 **NEURAL LINK ESTABLISHED**\nEVM: \`${evmWallet.address.slice(0,6)}...${evmWallet.address.slice(-4)}\`\nSOL: \`${solWallet.publicKey.toString().slice(0,6)}...\``, { parse_mode: 'Markdown' });
        } catch (e) {
            bot.sendMessage(msg.chat.id, "❌ **SYNC ERROR:** Invalid mnemonic phrase.");
        }
    }
});

// ==========================================
//  CORE ENGINE (Logic remained same for stability)
// ==========================================

async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal) {
                    SYSTEM.isLocked[netKey] = true;
                    const buyRes = (netKey === 'SOL')
                        ? await executeSolanaShotgun(chatId, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY')
                        : await executeEvmContract(chatId, netKey, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY');
                    if (buyRes) startIndependentPeakMonitor(chatId, netKey, { ...signal, amountOut: buyRes.amountOut, entryPrice: signal.price, highestPrice: signal.price });
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 5000)); }
    }
}

// ... [Rest of Signal Scanner, Execution Logic, and Peak Monitor as per previous versions] ...

async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const match = res.data.find(t => t.chainId === NETWORKS[netKey].id && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        return match ? { symbol: match.symbol, tokenAddress: match.tokenAddress, price: parseFloat(match.priceUsd || 0) } : null;
    } catch (e) { return null; }
}

http.createServer((req, res) => res.end("APEX v9019")).listen(8080);
console.log("APEX v9019 OMNI-MASTER ONLINE".magenta);
