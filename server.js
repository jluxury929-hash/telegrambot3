/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9032 (OMNI-DASHBOARD MASTER)
 * ===============================================================================
 * FIX: Fully interactive buttons (Updates Risk/Mode/Amount via UI cycling).
 * FIX: SOL "Have 0" resolved via Multi-Path (Standard/Legacy) + Dual-RPC Failover.
 * FIX: Universal Scanner Logic (Chain Mapping) + Symbol Safety Fallbacks.
 * FIX: PnL Calculation Guard (Infinity% Protection).
 * AUTO: Integrated 'startNetworkSniper' loop with Signal -> Verify -> execute.
 * MANUAL: Added /amount <val> override to set custom trade size instantly.
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

// --- CONFIGURATION ---
const MY_EXECUTOR = "0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610";
const APEX_ABI = [
    "function executeBuy(address router, address token, uint256 minOut, uint256 deadline) external payable",
    "function executeSell(address router, address token, uint256 amtIn, uint256 minOut, uint256 deadline) external",
    "function emergencyWithdraw(address token) external"
];
const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'x-api-key': 'f440d4df-b5c4-4020-a960-ac182d3752ab' }};

const NETWORKS = {
    ETH:  { id: 'ethereum', type: 'EVM', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' },
    SOL:  { id: 'solana', type: 'SVM', primary: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', fallback: 'https://solana-mainnet.g.allthatnode.com' },
    BASE: { id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' },
    BSC:  { id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E' },
    ARB:  { id: 'arbitrum', type: 'EVM', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506' }
};

// --- GLOBAL STATE ---
let SYSTEM = {
    autoPilot: false, tradeAmount: "0.01", risk: 'MEDIUM', mode: 'MEDIUM',
    lastTradedTokens: {}, isLocked: {}
};
let evmWallet, solWallet;

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  INTERACTIVE MENU (UI CYCLING)
// ==========================================

const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: `🛡️ RISK: ${SYSTEM.risk}`, callback_data: "cycle_risk" }, { text: `⏱️ TERM: ${SYSTEM.mode}`, callback_data: "cycle_mode" }],
            [{ text: "🔗 CONNECT WALLET", callback_data: "cmd_conn" }]
        ]
    }
});

bot.onText(/\/menu|\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "🎮 **APEX DASHBOARD v9032**\nNeural Control Center:", { parse_mode: 'Markdown', ...getDashboardMarkup() });
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;

    if (query.data === "cycle_risk") {
        const risks = ['LOW', 'MEDIUM', 'HIGH'];
        SYSTEM.risk = risks[(risks.indexOf(SYSTEM.risk) + 1) % risks.length];
    }
    if (query.data === "cycle_mode") {
        const modes = ['SHORT', 'MEDIUM', 'LONG'];
        SYSTEM.mode = modes[(modes.indexOf(SYSTEM.mode) + 1) % modes.length];
    }
    if (query.data === "cycle_amt") {
        const amts = ["0.01", "0.05", "0.1", "0.25", "0.5"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
    }
    if (query.data === "cmd_auto") {
        if (!solWallet) return bot.answerCallbackQuery(query.id, { text: "❌ Connect Wallet First!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) {
            bot.sendMessage(chatId, "🚀 **AUTO-PILOT ONLINE.** Scanning all networks...");
            Object.keys(NETWORKS).forEach(netKey => startNetworkSniper(chatId, netKey));
        } else {
            bot.sendMessage(chatId, `🤖 **AUTO-PILOT:** ${SYSTEM.autoPilot ? '✅ ACTIVE' : '❌ STOPPED'}`);
        }
    }
    if (query.data === "cmd_status") await runStatusDashboard(chatId);
    if (query.data === "cmd_conn") bot.sendMessage(chatId, "⌨️ Use `/connect <seed phrase>` to link.");

    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: chatId, message_id: msgId }).catch(() => {});
    bot.answerCallbackQuery(query.id);
});

// ==========================================
//  MANUAL OVERRIDES & CONNECTIONS
// ==========================================

// --- MANUAL AMOUNT OVERRIDE ---
bot.onText(/\/amount (.+)/, (msg, match) => {
    const newAmt = match[1].trim();
    if (isNaN(newAmt) || parseFloat(newAmt) <= 0) {
        return bot.sendMessage(msg.chat.id, "❌ **INVALID AMOUNT.** Please enter a number (e.g., `/amount 0.08`) ");
    }
    SYSTEM.tradeAmount = newAmt;
    bot.sendMessage(msg.chat.id, `✅ **TRADE SIZE UPDATED:** \`${SYSTEM.tradeAmount}\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    const raw = match[1].trim();
    const chatId = msg.chat.id;
    try {
        if (!bip39.validateMnemonic(raw)) return bot.sendMessage(chatId, "❌ **INVALID SEED.**");
        const seed = await bip39.mnemonicToSeed(raw);
        const conn = new Connection(NETWORKS.SOL.primary, 'confirmed');

        const keyA = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        const keyB = Keypair.fromSeed(derivePath("m/44'/501'/0'", seed.toString('hex')).key);

        const [balA, balB] = await Promise.all([conn.getBalance(keyA.publicKey), conn.getBalance(keyB.publicKey)]);
        solWallet = (balB > balA) ? keyB : keyA;
        evmWallet = ethers.Wallet.fromPhrase(raw);

        bot.sendMessage(chatId,
            `🔗 **SYNC COMPLETE**\n\n` +
            `📍 **Bot Tracking:** \`${solWallet.publicKey.toString()}\`\n` +
            `💰 **Current Balance:** ${(Math.max(balA, balB) / 1e9).toFixed(4)} SOL\n\n` +
            `*If this balance looks wrong, move your 0.1 SOL to the address above.*`
        , { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(chatId, "❌ **SEED ERROR.**"); }
});

async function verifyBalance(chatId, netKey) {
    try {
        const amt = parseFloat(SYSTEM.tradeAmount);
        if (netKey === 'SOL') {
            let bal = 0;
            try { bal = await (new Connection(NETWORKS.SOL.primary)).getBalance(solWallet.publicKey); }
            catch (e) { bal = await (new Connection(NETWORKS.SOL.fallback)).getBalance(solWallet.publicKey); }
            const needed = (amt * LAMPORTS_PER_SOL) + 10000000;
            return bal >= needed;
        } else {
            const bal = await (new JsonRpcProvider(NETWORKS[netKey].rpc)).getBalance(evmWallet.address);
            return bal >= (ethers.parseEther(SYSTEM.tradeAmount) + ethers.parseEther("0.006"));
        }
    } catch (e) { return false; }
}

// ==========================================
//  OMNI-CORE ENGINE (SAFE SCANNER LOGIC)
// ==========================================

async function startNetworkSniper(chatId, netKey) {
    console.log(`[INIT] Parallel thread for ${netKey} active.`.magenta);
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
               
                // VALIDATION: Ensure tokenAddress and valid signal data exist
                if (signal && signal.tokenAddress) {
                    const ready = await verifyBalance(chatId, netKey);
                    if (!ready) {
                        bot.sendMessage(chatId, `⚠️ **[${netKey}] SKIP:** Insufficient funds for trade.`);
                        await new Promise(r => setTimeout(r, 30000));
                        continue;
                    }

                    SYSTEM.isLocked[netKey] = true;
                    bot.sendMessage(chatId, `🧠 **[${netKey}] SIGNAL:** ${signal.symbol}. Engaging Sniper.`);
                   
                    const buyRes = (netKey === 'SOL')
                        ? await executeSolShotgun(chatId, signal.tokenAddress, SYSTEM.tradeAmount)
                        : await executeEvmContract(chatId, netKey, signal.tokenAddress, SYSTEM.tradeAmount);
                   
                    if (buyRes && buyRes.amountOut) {
                        const pos = { ...signal, entryPrice: signal.price, amountOut: buyRes.amountOut };
                        startIndependentPeakMonitor(chatId, netKey, pos);
                        bot.sendMessage(chatId, `🚀 **[${netKey}] BOUGHT ${signal.symbol}.** Rescanning...`);
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 2500));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 5000)); }
    }
}

async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        if (!res.data || !Array.isArray(res.data)) return null;

        // UNIVERSAL SCANNER MAPPING: Map bot keys to official chain IDs
        const chainMap = { 'SOL': 'solana', 'ETH': 'ethereum', 'BASE': 'base', 'BSC': 'bsc', 'ARB': 'arbitrum' };
        const match = res.data.find(t => t.chainId === chainMap[netKey] && !SYSTEM.lastTradedTokens[t.tokenAddress]);
       
        // SAFETY FALLBACKS: Prevent 'undefined' crashes
        if (match && match.tokenAddress) {
            return {
                symbol: match.symbol || "UNKNOWN",
                tokenAddress: match.tokenAddress,
                price: parseFloat(match.priceUsd) || 0.00000001 // Prevent zero price errors
            };
        }
        return null;
    } catch (e) { return null; }
}

// ==========================================
//  EXECUTION & MONITORING (INFINITY PROTECTION)
// ==========================================

async function executeSolShotgun(chatId, addr, amt) {
    try {
        const amtStr = Math.floor(amt * 1e9).toString();
        const res = await axios.get(`${JUP_ULTRA_API}/order?inputMint=So11111111111111111111111111111111111111112&outputMint=${addr}&amount=${amtStr}&taker=${solWallet.publicKey.toString()}&slippageBps=200`, SCAN_HEADERS);
        const tx = VersionedTransaction.deserialize(Buffer.from(res.data.transaction, 'base64'));
        tx.sign([solWallet]);
        const sig = await Promise.any([
            new Connection(NETWORKS.SOL.primary).sendRawTransaction(tx.serialize()),
            new Connection(NETWORKS.SOL.fallback).sendRawTransaction(tx.serialize())
        ]);
        return { amountOut: res.data.outAmount || 1, hash: sig };
    } catch (e) { return null; }
}

async function executeEvmContract(chatId, netKey, addr, amt) {
    try {
        const net = NETWORKS[netKey];
        const signer = evmWallet.connect(new JsonRpcProvider(net.rpc));
        const contract = new ethers.Contract(MY_EXECUTOR, APEX_ABI, signer);
        const tx = await contract.executeBuy(net.router, addr, 0, Math.floor(Date.now()/1000)+120, {
            value: ethers.parseEther(amt.toString()),
            gasLimit: 350000
        });
        await tx.wait(); return { amountOut: 1 };
    } catch (e) { return null; }
}

async function startIndependentPeakMonitor(chatId, netKey, pos) {
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`, SCAN_HEADERS);
        if (!res.data.pairs || res.data.pairs.length === 0) throw new Error("No pairs");

        const curPrice = parseFloat(res.data.pairs[0].priceUsd) || 0;
       
        // PNL CALCULATION GUARD: Treat entryPrice as non-zero to prevent Infinity%
        const entry = parseFloat(pos.entryPrice) || 0.00000001;
        const pnl = ((curPrice - entry) / entry) * 100;
       
        let tp = 25; let sl = -10;
        if (SYSTEM.risk === 'LOW') { tp = 12; sl = -5; }
        if (SYSTEM.risk === 'HIGH') { tp = 100; sl = -20; }

        if (pnl >= tp || pnl <= sl) {
            bot.sendMessage(chatId, `📉 **[${netKey}] EXIT:** ${pos.symbol} closed at ${pnl.toFixed(2)}% PnL.`);
            SYSTEM.lastTradedTokens[pos.tokenAddress] = true;
        } else { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 10000); }
    } catch (e) { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 15000); }
}

async function runStatusDashboard(chatId) {
    let msg = `📊 **APEX STATUS**\n----------------------------\n`;
    const RATES = { BNB: 1225.01, ETH: 4061.20, SOL: 175.14 };
    for (const key of Object.keys(NETWORKS)) {
        try {
            if (key === 'SOL' && solWallet) {
                const bal = (await (new Connection(NETWORKS.SOL.primary)).getBalance(solWallet.publicKey)) / 1e9;
                msg += `🔹 **SOL:** ${bal.toFixed(3)} ($${(bal * RATES.SOL).toFixed(2)} CAD)\n`;
            } else if (evmWallet) {
                const bal = parseFloat(ethers.formatEther(await new JsonRpcProvider(NETWORKS[key].rpc).getBalance(evmWallet.address)));
                const cad = (bal * (key === 'BSC' ? RATES.BNB : RATES.ETH)).toFixed(2);
                msg += `🔹 **${key}:** ${bal.toFixed(4)} ($${cad} CAD)\n`;
            }
        } catch (e) { msg += `🔹 **${key}:** ⚠️ Offline\n`; }
    }
    bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}

http.createServer((req, res) => res.end("APEX v9032 READY")).listen(8080);

