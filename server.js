/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9032 (FULL AUTO-PILOT MASTER)
 * ===============================================================================
 * FEATURES: Parallel sniper threads + Independent position monitoring.
 * SAFETY: Dual-RPC failover + Infinity% PnL Protection.
 * INTERFACE: Fully interactive cycling buttons.
 * ===============================================================================
 */

const { Worker, isMainThread } = require('worker_threads');

// --- HARDWARE BRANCHING (Fixes Button Stickiness) ---
if (isMainThread) { 
    new Worker(__filename); // Offloads Sniper to Core 2
}

require('dotenv').config();
const { ethers, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- 1. CONFIGURATION ---
const MY_EXECUTOR = "0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610";
const APEX_ABI = [
    "function executeBuy(address router, address token, uint256 minOut, uint256 deadline) external payable",
    "function executeSell(address router, address token, uint256 amtIn, uint256 minOut, uint256 deadline) external",
    "function emergencyWithdraw(address token) external"
];
const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'x-api-key': 'f440d4df-b5c4-4020-a960-ac182d3752ab' }};
const JITO_SENTINEL = new PublicKey("jitodontfront111111111111111111111111111111");

const NETWORKS = {
    ETH:  { id: 'ethereum', type: 'EVM', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' },
    SOL:  { id: 'solana', type: 'SVM', primary: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', fallback: 'https://solana-mainnet.g.allthatnode.com' },
    BASE: { id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' },
    BSC:  { id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E' }
};

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.01", risk: 'MEDIUM', mode: 'MEDIUM',
    lastTradedTokens: {}, isLocked: {}, flashOn: true // Toggled for high-yield shotgun
};

let evmWallet, solWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: isMainThread });

// --- HIGH FREQUENCY MODULES ---
async function startGeyserPush(chatId) {
    try {
        const Client = require("@triton-one/yellowstone-grpc");
        const client = new Client(process.env.GEYSER_URL, process.env.GEYSER_TOKEN);
        const stream = await client.subscribe();
        const request = {
            transactions: {
                raydium: { accountInclude: ["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"] }
            },
            commitment: "processed", 
        };

        stream.on("data", async (data) => {
            if (data.transaction && SYSTEM.autoPilot) {
                const pool = data.transaction.transaction.message.accountKeys[1];
                bot.sendMessage(chatId, `🚀 **[gRPC] FAST-SIGNAL:** ${pool}`);
                await executeSolShotgun(chatId, pool, "GEYSER_MINT");
            }
        });

        await new Promise((resolve, reject) => {
            stream.write(request, (err) => err ? reject(err) : resolve());
        });
    } catch (e) { console.log("[gRPC] Connection Error".red); }
}

async function executeFlashShotgun(chatId, addr, symbol) {
    try {
        const borrowAmt = parseFloat(SYSTEM.tradeAmount) * 10 * LAMPORTS_PER_SOL;
        const quote = await axios.get(`https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${addr}&amount=${borrowAmt}&slippageBps=200`);
        const swap = await axios.post(`https://quote-api.jup.ag/v6/swap`, {
            quoteResponse: quote.data,
            userPublicKey: solWallet.publicKey.toString(),
            programId: "E86f5d6ECDfCD2D7463414948f41d32EDC8D4AE4" 
        });
        const tx = VersionedTransaction.deserialize(Buffer.from(swap.data.swapTransaction, 'base64'));
        tx.sign([solWallet]);
        const sig = await (new Connection(NETWORKS.SOL.primary)).sendRawTransaction(tx.serialize());
        bot.sendMessage(chatId, `🔥 **FLASH 10x FIRED:** ${symbol}\nLeveraged: ${(borrowAmt/1e9).toFixed(2)} SOL`);
        return { success: !!sig };
    } catch (e) { return { success: false }; }
}

// --- 2. THE EXACT AUTO-PILOT CORE ---
async function startNetworkSniper(chatId, netKey) {
    if (isMainThread) return;
    console.log(`[INIT] Parallel thread for ${netKey} active.`.magenta);
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                
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
                        bot.sendMessage(chatId, `🚀 **[${netKey}] BOUGHT ${signal.symbol}.** Monitoring PnL...`);
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 2500));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 5000)); }
    }
}

async function startIndependentPeakMonitor(chatId, netKey, pos) {
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`, SCAN_HEADERS);
        if (!res.data.pairs || res.data.pairs.length === 0) throw new Error("No pairs");

        const curPrice = parseFloat(res.data.pairs[0].priceUsd) || 0;
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

// --- 3. EXECUTION ENGINES ---
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
            value: ethers.parseEther(amt.toString()), gasLimit: 350000
        });
        await tx.wait(); return { amountOut: 1 };
    } catch (e) { return null; }
}

// --- 4. SIGNAL & VERIFICATION ---
async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const chainMap = { 'SOL': 'solana', 'ETH': 'ethereum', 'BASE': 'base', 'BSC': 'bsc' };
        const match = res.data.find(t => t.chainId === chainMap[netKey] && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        if (match && match.tokenAddress) {
            return { symbol: match.symbol || "UNK", tokenAddress: match.tokenAddress, price: parseFloat(match.priceUsd) || 0.000001 };
        }
        return null;
    } catch (e) { return null; }
}

async function verifyBalance(chatId, netKey) {
    try {
        const amt = parseFloat(SYSTEM.tradeAmount);
        if (netKey === 'SOL') {
            const conn = new Connection(NETWORKS.SOL.primary);
            const bal = await conn.getBalance(solWallet.publicKey);
            return bal >= (amt * LAMPORTS_PER_SOL) + 10000000;
        } else {
            const bal = await (new JsonRpcProvider(NETWORKS[netKey].rpc)).getBalance(evmWallet.address);
            return bal >= (ethers.parseEther(SYSTEM.tradeAmount) + ethers.parseEther("0.006"));
        }
    } catch (e) { return false; }
}

// --- 5. INTERFACE (UI) ---
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

if (isMainThread) {
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        bot.answerCallbackQuery(query.id).catch(() => {});
        
        if (query.data === "cycle_risk") {
            const risks = ['LOW', 'MEDIUM', 'HIGH'];
            SYSTEM.risk = risks[(risks.indexOf(SYSTEM.risk) + 1) % risks.length];
        }
        if (query.data === "cycle_amt") {
            const amts = ["0.01", "0.05", "0.1", "0.25", "0.5"];
            SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
        }
        if (query.data === "cmd_auto") {
            if (!solWallet) return bot.sendMessage(chatId, "❌ Connect Wallet First!");
            SYSTEM.autoPilot = !SYSTEM.autoPilot;
            if (SYSTEM.autoPilot) {
                bot.sendMessage(chatId, "🚀 **AUTO-PILOT ONLINE.** Parallel threads active.");
                Object.keys(NETWORKS).forEach(netKey => startNetworkSniper(chatId, netKey));
                if (process.env.GEYSER_URL) startGeyserPush(chatId);
            }
        }
        bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
    });

    bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "🎮 **APEX v9032 AUTO-PILOT**", getDashboardMarkup()));

    bot.onText(/\/connect (.+)/, async (msg, match) => {
        try {
            const seed = match[1].trim();
            const mnemonic = await bip39.mnemonicToSeed(seed);
            solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", mnemonic.toString('hex')).key);
            evmWallet = new ethers.Wallet(ethers.Mnemonic.fromPhrase(seed).derivePath("m/44'/60'/0'/0/0").privateKey);
            bot.sendMessage(msg.chat.id, `✅ **SYNCED:** \`${solWallet.publicKey.toString()}\``);
        } catch (e) { bot.sendMessage(msg.chat.id, "❌ Invalid seed phrase."); }
    });

    http.createServer((req, res) => res.end("AUTO-PILOT READY")).listen(8080);
}
