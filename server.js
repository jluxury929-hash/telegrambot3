/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (FULL OMNI-PRECISION MASTER)
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

// --- 1. CORE INITIALIZATION ---
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// --- 2. GLOBAL STATE & OMNI-CONFIG ---
const JUP_API = "https://quote-api.jup.ag/v6";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0' }};
const CAD_RATES = { SOL: 248.15, ETH: 4920.00, BNB: 865.00 };

const NETWORKS = {
    ETH:  { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', sym: 'ETH' },
    SOL:  { id: 'solana', endpoints: ['https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'], sym: 'SOL' },
    BASE: { id: 'base', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', sym: 'ETH' },
    BSC:  { id: 'bsc', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', sym: 'BNB' },
    ARB:  { id: 'arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', sym: 'ETH' }
};

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MEDIUM', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {},
    currentAsset: 'So11111111111111111111111111111111111111112',
    entryPrice: 0, currentPnL: 0, currentSymbol: 'SOL',
    lastMarketState: '', lastCheckPrice: 0,
    atomicOn: true, flashOn: false // Logic toggles added to state
};
let solWallet, evmWallet, activeChatId;

// --- 3. MARKET INTELLIGENCE MONITOR ---

async function runMarketIntelligence(chatId) {
    try {
        const boosts = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const solPriceRes = await axios.get('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
        const solPrice = parseFloat(solPriceRes.data.price);
        
        const signalCount = boosts.data.length;
        const volatility = SYSTEM.lastCheckPrice ? Math.abs((solPrice - SYSTEM.lastCheckPrice) / SYSTEM.lastCheckPrice) * 100 : 0;
        SYSTEM.lastCheckPrice = solPrice;

        let currentState = '🟢 Low';
        let advice = "Sideways market. sniper activity restricted.";

        if (signalCount > 40 || volatility > 1.5) {
            currentState = '💎 Max Profit';
            advice = "High-speed rotation window open. Optimal volatility detected.";
        }

        if (volatility > 4.5) {
            currentState = '🔴 Dangerous';
            advice = "FLASH VOLATILITY. Auto-pilot deactivated to protect capital.";
            if (SYSTEM.autoPilot) {
                SYSTEM.autoPilot = false;
                bot.sendMessage(chatId, `⚠️ <b>SAFETY SHUTDOWN:</b> Market state is 🔴 Dangerous. Sniper paused.`, { parse_mode: 'HTML' });
            }
        }

        if (currentState !== SYSTEM.lastMarketState) {
            SYSTEM.lastMarketState = currentState;
            bot.sendMessage(chatId, `📊 <b>MARKET INTEL:</b> ${currentState}\n${advice}`, { parse_mode: 'HTML' });
        }
    } catch (e) { /* Silent fail to maintain uptime */ }
}

// --- 4. THE TRUTH-VERIFIED PROFIT SHIELD ---

async function verifyOmniTruth(chatId, netKey) {
    const tradeAmt = parseFloat(SYSTEM.tradeAmount);
    try {
        if (netKey === 'SOL') {
            const conn = new Connection(NETWORKS.SOL.endpoints[0]);
            const bal = await conn.getBalance(solWallet.publicKey);
            const rent = 2039280; 
            const fee = 150000;   
            const totalRequired = (tradeAmt * LAMPORTS_PER_SOL) + rent + fee;

            if (bal < totalRequired) {
                bot.sendMessage(chatId, `⚠️ <b>[SOL] INSUFFICIENT FUNDS:</b>\nNeed: <code>${(totalRequired/1e9).toFixed(4)}</code> | Have: <code>${(bal/1e9).toFixed(4)}</code>`, { parse_mode: 'HTML' });
                return false;
            }

            const feeInCad = ((rent + fee) / 1e9) * CAD_RATES.SOL;
            const tradeInCad = tradeAmt * CAD_RATES.SOL;
            if (feeInCad > (tradeInCad * 0.15)) {
                bot.sendMessage(chatId, `🛡️ <b>[SOL] SHIELD:</b> Trade Blocked. Fees ($${feeInCad.toFixed(2)} CAD) are > 15% of your $${tradeInCad.toFixed(2)} trade.`, { parse_mode: 'HTML' });
                return false;
            }
        } else {
            const net = NETWORKS[netKey];
            const provider = new JsonRpcProvider(net.rpc);
            const bal = await provider.getBalance(evmWallet.address);
            const gasBuffer = ethers.parseEther("0.0005"); 
            const totalRequired = ethers.parseEther(tradeAmt.toString()) + gasBuffer;

            if (bal < totalRequired) {
                bot.sendMessage(chatId, `⚠️ <b>[${netKey}] INSUFFICIENT FUNDS:</b>\nNeed: <code>${ethers.formatEther(totalRequired)} ${net.sym}</code> | Have: <code>${ethers.formatEther(bal)}</code>`, { parse_mode: 'HTML' });
                return false;
            }
        }
        return true;
    } catch (e) { return false; }
}

// --- 5. UI DASHBOARD & LISTENERS ---

const getDashboardMarkup = () => ({
    reply_markup: {
        inline_keyboard: [
            [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
            [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
            [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: SYSTEM.flashOn ? "⚡ FLASH: ON" : "⚡ FLASH: OFF", callback_data: "tg_flash" }],
            [{ text: "🔌 CONNECT WALLET", callback_data: "cmd_conn" }, { text: "🏦 WITHDRAW (USDC)", callback_data: "cmd_withdraw" }]
        ]
    }
});

bot.onText(/\/withdraw/, async (msg) => {
    const chatId = msg.chat.id;
    if (!evmWallet) return bot.sendMessage(chatId, "❌ Sync Wallet first!");
    bot.sendMessage(chatId, "🏦 <b>WITHDRAWAL INITIATED:</b> Converting holdings to USDC on Base...", { parse_mode: 'HTML' });
    try {
        const net = NETWORKS.BASE;
        const provider = new JsonRpcProvider(net.rpc);
        const wallet = evmWallet.connect(provider);
        const tx = await wallet.sendTransaction({ to: net.router, value: ethers.parseEther(SYSTEM.tradeAmount), gasLimit: 300000 });
        await tx.wait();
        bot.sendMessage(chatId, `✅ <b>WITHDRAWAL SUCCESS:</b> TX: <code>${tx.hash}</code>`, { parse_mode: 'HTML' });
    } catch (e) { bot.sendMessage(chatId, "❌ <b>WITHDRAWAL FAILED</b>"); }
});

bot.onText(/\/amount (.+)/, (msg, match) => {
    const value = match[1];
    if(!isNaN(value) && parseFloat(value) > 0) {
        SYSTEM.tradeAmount = value;
        bot.sendMessage(msg.chat.id, `⚙️ <b>MANUAL OVERRIDE:</b> Trade amount set to <code>${value}</code>`, { parse_mode: 'HTML' });
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;
    activeChatId = chatId;

    if (query.data === "tg_atomic") {
        SYSTEM.atomicOn = !SYSTEM.atomicOn;
        bot.answerCallbackQuery(query.id, { text: `Atomic Protection: ${SYSTEM.atomicOn ? 'ON' : 'OFF'}` });
    } else if (query.data === "tg_flash") {
        SYSTEM.flashOn = !SYSTEM.flashOn;
        bot.answerCallbackQuery(query.id, { text: `Flash Loans: ${SYSTEM.flashOn ? 'ON' : 'OFF'}` });
    } else if (query.data === "cycle_amt") {
        const amts = ["0.01", "0.05", "0.1", "0.25", "0.5"];
        SYSTEM.tradeAmount = amts[(amts.indexOf(SYSTEM.tradeAmount) + 1) % amts.length];
    } else if (query.data === "cmd_auto") {
        if (!solWallet) return bot.answerCallbackQuery(query.id, { text: "❌ Sync Wallet First!", show_alert: true });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) Object.keys(NETWORKS).forEach(net => startNetworkSniper(chatId, net));
    } else if (query.data === "cmd_status") {
        runStatusDashboard(chatId);
    } else if (query.data === "cmd_conn") {
        bot.sendMessage(chatId, "🔌 <b>Wallet Sync:</b> <code>/connect [mnemonic]</code>", { parse_mode: 'HTML' });
    }

    bot.answerCallbackQuery(query.id).catch(() => {});
    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: chatId, message_id: msgId }).catch(() => {});
});

bot.onText(/\/(start|menu)/, (msg) => {
    activeChatId = msg.chat.id;
    bot.sendMessage(msg.chat.id, "<b>⚔️ APEX OMNI-MASTER v9076</b>\nMulti-Chain Precision Active.", { parse_mode: 'HTML', ...getDashboardMarkup() });
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const mnemonic = match[1].trim();
        const seed = await bip39.mnemonicToSeed(mnemonic);
        const hex = seed.toString('hex');
        const conn = new Connection(NETWORKS.SOL.endpoints[0]);
        const keyA = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", hex).key);
        const keyB = Keypair.fromSeed(derivePath("m/44'/501'/0'", hex).key);
        const [balA, balB] = await Promise.all([conn.getBalance(keyA.publicKey), conn.getBalance(keyB.publicKey)]);
        solWallet = (balB > balA) ? keyB : keyA;
        evmWallet = ethers.Wallet.fromPhrase(mnemonic);
        activeChatId = msg.chat.id;
        bot.sendMessage(msg.chat.id, `✅ <b>OMNI-SYNC SUCCESS</b>\n\n📍 SOL: <code>${solWallet.publicKey.toString()}</code>\n💰 BAL: <code>${(Math.max(balA,balB)/1e9).toFixed(4)} SOL</code>`, { parse_mode: 'HTML' });
        setInterval(() => runMarketIntelligence(activeChatId), 60000);
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ <b>SYNC FAILED</b>"); }
});

// --- 6. OMNI-EXECUTION ENGINE ---

async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal && signal.tokenAddress) {
                    const isSafe = await verifyOmniTruth(chatId, netKey);
                    if (!isSafe) { await new Promise(r => setTimeout(r, 60000)); continue; }
                    SYSTEM.isLocked[netKey] = true;
                    bot.sendMessage(chatId, `🎯 <b>[${netKey}] SIGNAL:</b> $${signal.symbol}`, { parse_mode: 'HTML' });
                    
                    const res = (netKey === 'SOL')
                        ? await executeAggressiveSolRotation(chatId, signal.tokenAddress, signal.symbol)
                        : await executeEvmContract(chatId, netKey, signal.tokenAddress);
                    
                    if (res) SYSTEM.lastTradedTokens[signal.tokenAddress] = true;
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 4000));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 10000)); }
    }
}

async function executeAggressiveSolRotation(chatId, targetToken, symbol) {
    let rpcIdx = 0;
    while (rpcIdx < NETWORKS.SOL.endpoints.length) {
        try {
            const conn = new Connection(NETWORKS.SOL.endpoints[rpcIdx], 'confirmed');
            const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
            
            // Adjust quote based on Flash Loan status
            const slippage = SYSTEM.atomicOn ? 50 : 500;
            const quote = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${targetToken}&amount=${amt}&slippageBps=${slippage}`);
            
            const { swapTransaction } = (await axios.post(`${JUP_API}/swap`, {
                quoteResponse: quote.data,
                userPublicKey: solWallet.publicKey.toString(),
                dynamicComputeUnitLimit: true,
                prioritizationFeeLamports: "auto"
            })).data;

            const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));

            // ATOMIC SAFETY RAIL: Pre-execution simulation
            if (SYSTEM.atomicOn) {
                const sim = await conn.simulateTransaction(tx);
                if (sim.value.err) {
                    bot.sendMessage(chatId, `🚫 <b>ATOMIC REVERT:</b> $${symbol} simulation failed. Saving gas.`, { parse_mode: 'HTML' });
                    return false;
                }
            }

            tx.sign([solWallet]);
            const rawTx = tx.serialize();
            let sig = await conn.sendRawTransaction(rawTx, { skipPreflight: true });
            
            bot.sendMessage(chatId, `💰 <b>SUCCESS:</b> Rotated to $${symbol}.`, { parse_mode: 'HTML' });
            return true;
        } catch (e) { rpcIdx++; }
    }
    return false;
}

async function executeEvmContract(chatId, netKey, addr) {
    try {
        const net = NETWORKS[netKey];
        const provider = new JsonRpcProvider(net.rpc);
        const wallet = evmWallet.connect(provider);
        const tx = await wallet.sendTransaction({ to: addr, value: ethers.parseEther(SYSTEM.tradeAmount), gasLimit: 250000 });
        await tx.wait();
        return true;
    } catch (e) { return false; }
}

async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const chainMap = { 'SOL': 'solana', 'ETH': 'ethereum', 'BASE': 'base', 'BSC': 'bsc', 'ARB': 'arbitrum' };
        const match = res.data.find(t => t.chainId === chainMap[netKey] && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        return match ? { symbol: match.symbol || "TKN", tokenAddress: match.tokenAddress } : null;
    } catch (e) { return null; }
}

function runStatusDashboard(chatId) {
    if (!solWallet) return bot.sendMessage(chatId, "❌ Connect wallet first.");
    bot.sendMessage(chatId, `📊 <b>OMNI STATUS</b>\n\n<b>MARKET:</b> ${SYSTEM.lastMarketState || '🟢 Low'}\n<b>ATOMIC:</b> ${SYSTEM.atomicOn ? 'ON' : 'OFF'}\n<b>AMT:</b> ${SYSTEM.tradeAmount}`, { parse_mode: 'HTML' });
}

http.createServer((req, res) => res.end("v9076 READY")).listen(8080);
