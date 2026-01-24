/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9019 (OMNI-PARALLEL MASTER)
 * ===============================================================================
 * INTEGRATED: Interactive Menu + Dynamic Trade Amount Config
 * SPECS: 24/7 Simultaneous Sniping + Smart Contract 0x5aF9...
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

let SYSTEM = { autoPilot: false, tradeAmount: "0.01", lastTradedTokens: {}, isLocked: {} };
let evmWallet, solWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  UI & MENU SYSTEM
// ==========================================

const showDashboard = (chatId) => {
    const status = SYSTEM.autoPilot ? "🟢 ACTIVE" : "🔴 STOPPED";
    const opts = {
        reply_markup: {
            inline_keyboard: [
                [{ text: `Toggle Engine: ${status}`, callback_data: 'toggle_engine' }],
                [{ text: `💰 Set Trade Amount (Current: ${SYSTEM.tradeAmount})`, callback_data: 'set_amt' }],
                [{ text: "📊 Check Balances", callback_data: 'check_bal' }]
            ]
        },
        parse_mode: 'Markdown'
    };
    bot.sendMessage(chatId, `*APEX v9019 OMNI-MASTER DASHBOARD*\n_Status:_ ${status}\n_Trade Size:_ \`${SYSTEM.tradeAmount}\``, opts);
};

bot.onText(/\/start/, (msg) => showDashboard(msg.chat.id));

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data === 'toggle_engine') {
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) {
            bot.answerCallbackQuery(query.id, { text: "Neural Engines Initializing..." });
            Object.keys(NETWORKS).forEach(netKey => startNetworkSniper(chatId, netKey));
        }
        showDashboard(chatId);
    } 
    else if (data === 'set_amt') {
        bot.sendMessage(chatId, "⌨️ *Reply to this message* with the new trade amount (e.g. 0.05):", { 
            reply_markup: { force_reply: true },
            parse_mode: 'Markdown' 
        });
    }
    else if (data === 'check_bal') {
        bot.answerCallbackQuery(query.id, { text: "Scanning wallets..." });
        let report = "*NETWORK STATUS*\n";
        for (const netKey of Object.keys(NETWORKS)) {
            const ok = await verifyBalance(chatId, netKey);
            report += `${ok ? '✅' : '❌'} ${netKey}\n`;
        }
        bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
    }
});

// Listener for Amount Input
bot.on('message', (msg) => {
    if (msg.reply_to_message && msg.reply_to_message.text.includes("new trade amount")) {
        const amount = msg.text.trim();
        if (!isNaN(parseFloat(amount))) {
            SYSTEM.tradeAmount = amount;
            bot.sendMessage(msg.chat.id, `✅ *Trade Amount Updated:* ${SYSTEM.tradeAmount}`, { parse_mode: 'Markdown' });
            showDashboard(msg.chat.id);
        } else {
            bot.sendMessage(msg.chat.id, "⚠️ Invalid number format. Use 0.01 etc.");
        }
    }
});

// ==========================================
//  DIAGNOSTIC BALANCE CHECKER
// ==========================================

async function verifyBalance(chatId, netKey) {
    try {
        if (netKey === 'SOL') {
            const conn = new Connection(NETWORKS.SOL.rpc);
            const bal = await conn.getBalance(solWallet.publicKey);
            const needed = (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 10000000;
            return bal >= needed;
        } else {
            const prov = new JsonRpcProvider(NETWORKS[netKey].rpc);
            const bal = await prov.getBalance(evmWallet.address);
            const needed = ethers.parseEther(SYSTEM.tradeAmount) + ethers.parseEther("0.005");
            return bal >= needed;
        }
    } catch (e) { return false; }
}

// ==========================================
//  OMNI-SNIPER ENGINE (PARALLEL)
// ==========================================

async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal) {
                    const ready = await verifyBalance(chatId, netKey);
                    if (!ready) { 
                        bot.sendMessage(chatId, `⚠️ **[${netKey}]** Insufficient funds for signal ${signal.symbol}.`);
                        await new Promise(r => setTimeout(r, 15000)); 
                        continue; 
                    }

                    SYSTEM.isLocked[netKey] = true;
                    bot.sendMessage(chatId, `🚀 **[${netKey}] SIGNAL:** ${signal.symbol}. Sniper Engaged.`);

                    const buyRes = (netKey === 'SOL')
                        ? await executeSolanaShotgun(chatId, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY')
                        : await executeEvmContract(chatId, netKey, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY');

                    if (buyRes) {
                        const newPos = { ...signal, entryPrice: signal.price, highestPrice: signal.price, amountOut: buyRes.amountOut };
                        startIndependentPeakMonitor(chatId, netKey, newPos);
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
            SYSTEM.isLocked[netKey] = false;
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

// ==========================================
//  SIGNAL SCANNER
// ==========================================

async function runNeuralSignalScan(netKey) {
    const net = NETWORKS[netKey];
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        if (!res.data || res.data.length === 0) return null;

        const match = res.data.find(t => t.chainId === net.id && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        if (match) {
            return { symbol: match.symbol || 'GEMS', tokenAddress: match.tokenAddress, price: parseFloat(match.priceUsd || 0) };
        }
    } catch (e) { return null; }
}

// ==========================================
//  EXECUTION LOGIC
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
            bot.sendMessage(chatId, `⏳ **[${netKey}] PENDING:** ${tx.hash}`);
            await tx.wait();
            return { amountOut: 1 };
        } else {
            const tx = await contract.executeSell(net.router, tokenAddress, amount, 0, deadline, { gasLimit: 400000 });
            await tx.wait();
            return { hash: tx.hash };
        }
    } catch (e) {
        bot.sendMessage(chatId, `❌ **[${netKey}] EXECUTION FAIL:** ${e.message}`);
        return null;
    }
}

async function executeSolanaShotgun(chatId, tokenAddress, amount, direction) {
    try {
        const amtStr = direction === 'BUY' ? Math.floor(amount * LAMPORTS_PER_SOL).toString() : amount.toString();
        const res = await axios.get(`${JUP_ULTRA_API}/order?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenAddress}&amount=${amtStr}&taker=${solWallet.publicKey.toString()}&slippageBps=200`, SCAN_HEADERS);
        
        const tx = VersionedTransaction.deserialize(Buffer.from(res.data.transaction, 'base64'));
        tx.sign([solWallet]);

        const signature = await new Connection(NETWORKS.SOL.rpc).sendRawTransaction(tx.serialize(), { skipPreflight: true });
        bot.sendMessage(chatId, `⏳ **[SOL] PENDING:** https://solscan.io/tx/${signature}`);
        return { amountOut: res.data.outAmount, hash: signature };
    } catch (e) {
        bot.sendMessage(chatId, `❌ **[SOL] FAIL:** ${e.message}`);
        return null;
    }
}

// ==========================================
//  PEAK MONITOR
// ==========================================

async function startIndependentPeakMonitor(chatId, netKey, pos) {
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`, SCAN_HEADERS);
        const currentPrice = parseFloat(res.data.pairs[0].priceUsd);
        const pnl = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
        
        if (currentPrice > pos.highestPrice) pos.highestPrice = currentPrice;
        const drop = ((pos.highestPrice - currentPrice) / pos.highestPrice) * 100;

        if (pnl >= 25 || drop >= 6 || pnl <= -10) {
            bot.sendMessage(chatId, `💰 **[${netKey}] PEAK:** Selling ${pos.symbol} at ${pnl.toFixed(2)}% PnL`);
            const sold = (netKey === 'SOL')
                ? await executeSolanaShotgun(chatId, pos.tokenAddress, pos.amountOut, 'SELL')
                : await executeEvmContract(chatId, netKey, pos.tokenAddress, pos.amountOut, 'SELL');

            if (sold) SYSTEM.lastTradedTokens[pos.tokenAddress] = true;
        } else { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 5000); }
    } catch(e) { setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 8000); }
}

// ==========================================
//  LEGACY COMMANDS
// ==========================================

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        evmWallet = ethers.HDNodeWallet.fromPhrase(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", (await bip39.mnemonicToSeed(match[1].trim())).toString('hex')).key);
        bot.sendMessage(msg.chat.id, `✅ **NEURAL LINK SECURE.** Wallet synced.`);
    } catch (e) { bot.sendMessage(msg.chat.id, `❌ **SEED ERROR:** Invalid phrase.`); }
});

bot.onText(/\/setamount (.+)/, (msg, match) => {
    const amt = match[1].trim();
    if (!isNaN(parseFloat(amt))) {
        SYSTEM.tradeAmount = amt;
        bot.sendMessage(msg.chat.id, `✅ Trade amount updated to: ${amt}`);
    }
});

http.createServer((req, res) => res.end("APEX v9019 ONLINE")).listen(8080);
console.log("APEX v9019 OMNI-MASTER READY".magenta);
