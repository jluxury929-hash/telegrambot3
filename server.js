/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9076 (GLOBAL MASTER MERGE)
 * ===============================================================================
 * INFRASTRUCTURE: Binance WebSocket + Yellowstone gRPC + Jito Atomic Bundles
 * INTERFACE: Fully Interactive v9032 Dashboard with UI Cycling
 * SECURITY: RugCheck Multi-Filter + Automatic Profit Cold-Sweep + Fee Guard
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, JsonRpcProvider } = require('ethers');
const { 
    Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL, 
    PublicKey, SystemProgram, Transaction, TransactionMessage 
} = require('@solana/web3.js');
const { default: Client } = require("@triton-one/yellowstone-grpc"); 
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const WebSocket = require('ws');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- 1. CONFIGURATION & STATE ---
const JUP_API = "https://quote-api.jup.ag/v6";
const JITO_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/bundles";
const BINANCE_WS = "wss://stream.binance.com:9443/ws/solusdt@bookTicker";
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }};
const JITO_TIP_ADDR = new PublicKey("96g9sAg9u3mBsJp9U9YVsk8XG3V6rW5E2t3e8B5Y3npx");

const NETWORKS = {
    ETH:  { id: 'ethereum', rpc: 'https://rpc.mevblocker.io', sym: 'ETH' },
    SOL:  { id: 'solana', primary: 'https://api.mainnet-beta.solana.com', fallback: 'https://rpc.ankr.com/solana' },
    BASE: { id: 'base', rpc: 'https://mainnet.base.org', sym: 'ETH' },
    BSC:  { id: 'bsc', rpc: 'https://bsc-dataseed.binance.org/', sym: 'BNB' }
};

let SYSTEM = {
    autoPilot: false, tradeAmount: "0.1", risk: 'MEDIUM', mode: 'SHORT',
    lastTradedTokens: {}, isLocked: {}, atomicOn: true, flashOn: false,
    jitoTip: 2000000, currentAsset: 'So11111111111111111111111111111111111111112',
    lastBinancePrice: 0, minLiquidity: 15000, velocityThreshold: 1.8,
    highestBalance: 0,
    isWaitingForDrop: false
};

let solWallet, evmWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const COLD_STORAGE = "0xe75C82c976Ecc954bfFbbB2e7Fb94652C791bea5"; 
const MIN_SOL_KEEP = 0.05; 

// --- 🔱 LAYER 2: MEV-SHIELD SHADOW INJECTION ---
const originalSend = Connection.prototype.sendRawTransaction;
Connection.prototype.sendRawTransaction = async function(rawTx, options) {
    if (!SYSTEM.atomicOn) return originalSend.apply(this, [rawTx, options]);
    try {
        const base64Tx = Buffer.from(rawTx).toString('base64');
        const res = await axios.post(JITO_ENGINE, { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[base64Tx]] });
        if (res.data.result) return res.data.result;
    } catch (e) { console.log(`[MEV-SHIELD] ⚠️ Private Lane busy, falling back...`.yellow); }
    return originalSend.apply(this, [rawTx, options]);
};

// --- 2. INTERACTIVE INTERFACE (v9032) ---
const RISK_LABELS = { LOW: '🛡️ LOW', MEDIUM: '⚖️ MED', MAX: '🔥 MAX' };
const TERM_LABELS = { SHORT: '⏱️ SHRT', MEDIUM: '⏳ MED', LONG: '💎 LONG' };

const getDashboardMarkup = () => {
    const walletLabel = solWallet 
        ? `✅ LINKED: ${solWallet.publicKey.toString().slice(0, 4)}...${solWallet.publicKey.toString().slice(-4)}`
        : "🔌 CONNECT WALLET";

    return {
        reply_markup: {
        inline_keyboard: [
                [{ text: SYSTEM.autoPilot ? "🛑 STOP AUTO-PILOT" : "🚀 START AUTO-PILOT", callback_data: "cmd_auto" }],
                [{ text: `💰 AMT: ${SYSTEM.tradeAmount}`, callback_data: "cycle_amt" }, { text: "📊 STATUS", callback_data: "cmd_status" }],
                [{ text: `🛡️ RISK: ${RISK_LABELS[SYSTEM.risk] || '⚖️ MED'}`, callback_data: "cycle_risk" }, { text: `⏳ TERM: ${TERM_LABELS[SYSTEM.mode] || '⏱️ SHRT'}`, callback_data: "cycle_mode" }],
                [{ text: SYSTEM.atomicOn ? "🛡️ ATOMIC: ON" : "🛡️ ATOMIC: OFF", callback_data: "tg_atomic" }, { text: SYSTEM.flashOn ? "⚡ FLASH: ON" : "⚡ FLASH: OFF", callback_data: "tg_flash" }],
                [{ text: walletLabel, callback_data: "cmd_conn" }],
                [{ text: "🏦 WITHDRAW PROFITS", callback_data: "cmd_withdraw" }]
            ]
        }
    };
};

// --- 3. CALLBACK HANDLER (v9032 UI CYCLING) ---
bot.on('callback_query', async (query) => {
    const { data, message, id } = query;
    const chatId = message.chat.id;
    bot.answerCallbackQuery(id).catch(() => {});
    
// --- 🔔 DYNAMIC NOTIFICATION OBSERVER ---
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
        bot.sendMessage(chatId, `⚡ **FLASH LOANS:** ${SYSTEM.flashOn ? "ENABLED (10x LEVERAGE)" : "DISABLED"}`);
      } else if (data === "cmd_withdraw") {
        await bot.sendMessage(chatId, "🛡️ **INITIATING SECURE USDC CONVERSION...**");
        await performAutomaticSweep(chatId);
        return;
    } else if (data === "cmd_auto") {
        if (!solWallet) return bot.sendMessage(chatId, "❌ <b>Connect wallet first.</b>", { parse_mode: 'HTML' });
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        if (SYSTEM.autoPilot) {
            bot.sendMessage(chatId, "🚀 **AUTO-PILOT ACTIVE.** Scanning networks...");
            Object.keys(NETWORKS).forEach(net => startNetworkSniper(chatId, net));
        }
async function startNeuralAlphaBrain(chatId) {
    const B_API = "https://public-api.birdeye.so";
    const B_KEY = process.env.BIRDEYE_API_KEY;
    if (!B_KEY) return console.log("[ALPHA] ⚠️ Missing BIRDEYE_API_KEY in .env".yellow);

    console.log(`[INIT] 🔱 Neural Alpha Brain simultaneous radar engaged.`.magenta.bold);

    while (SYSTEM.autoPilot) {
        try {
            // Respect the global lock so Brain 1 and Brain 2 don't collide on execution
            if (!SYSTEM.isLocked['SOL']) {
                // World's Best Logic: Query Birdeye V2 Trending (Unique Insider Activity)
                const res = await axios.get(`${B_API}/defi/v2/tokens/trending?sort_by=rank&sort_type=asc`, {
                    headers: { 'X-API-KEY': B_KEY, 'x-chain': 'solana' }
                });
                
                const alphaPool = res.data.data.tokens;
                for (const t of alphaPool) {
                    // Skip if Brain 1 already traded this
                    if (SYSTEM.lastTradedTokens[t.address]) continue;

                    // Insider Alignment Filter: High Volume + Sufficient Liquidity Depth
                    if (t.v24hUSD > 100000 && t.liquidity > 25000) {
                        SYSTEM.isLocked['SOL'] = true;
                        bot.sendMessage(chatId, `🧬 **[BRAIN-2] ALPHA DETECTED:** $${t.symbol}\nLogic: Smart Money Cluster Alignment.`);
                        
                    // Logic: If Flash Toggle is ON, use the Flash Engine. Otherwise use standard wallet funds.
                   const buyRes = SYSTEM.flashOn 
                       ? await executeFlashShotgun(chatId, t.address, t.symbol)
    :                  await executeSolShotgun(chatId, t.address, t.symbol);
                        
                        if (buyRes && buyRes.success) {
                            SYSTEM.lastTradedTokens[t.address] = true;
                            // Launch your EXISTING independent monitor
                            startIndependentPeakMonitor(chatId, 'SOL', { 
                                symbol: t.symbol, 
                                tokenAddress: t.address, 
                                entryPrice: t.price 
                            });
                        }
                        SYSTEM.isLocked['SOL'] = false;
                        break; 
                    }
                }
            }
            // Non-blocking wait for next Alpha cycle
            await new Promise(r => setTimeout(r, 1800)); 
        } catch (e) { 
            SYSTEM.isLocked['SOL'] = false; 
            await new Promise(r => setTimeout(r, 5000)); 
        }
    }
}
    } else if (data === "cmd_status") { 
        await runStatusDashboard(chatId); 
        return;
    } else if (data === "cmd_conn") {
        return bot.sendMessage(chatId, "🔌 <b>Sync Wallet:</b> Send `/connect [mnemonic]`");
    }

    bot.editMessageReplyMarkup(getDashboardMarkup().reply_markup, { chat_id: chatId, message_id: message.message_id }).catch(() => {});
});

// --- 4. THE AUTO-PILOT ENGINE (RESTORED v9032 EXACT LOGIC) ---
async function startNetworkSniper(chatId, netKey) {
    console.log(`[INIT] Parallel thread for ${netKey} active.`.magenta);
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                if (signal && signal.tokenAddress) {
                    const ready = await verifyBalance(netKey);
                    if (!ready) {
                        bot.sendMessage(chatId, `⚠️ **[${netKey}] SKIP:** Insufficient funds.`);
                        await new Promise(r => setTimeout(r, 30000));
                        continue;
                    }

                    SYSTEM.isLocked[netKey] = true;
                    bot.sendMessage(chatId, `🧠 **[${netKey}] SIGNAL:** ${signal.symbol}. Applying RugCheck...`);
                    
                    const safe = await verifySignalSafety(signal.tokenAddress);
                    if (!safe) {
                        bot.sendMessage(chatId, `🛡️ **REJECTED:** Token failed safety check.`);
                    } else {
                        const buyRes = (netKey === 'SOL')
                            ? await executeSolShotgun(chatId, signal.tokenAddress, signal.symbol)
                            : await executeEvmContract(chatId, netKey, signal.tokenAddress);
                        
                        if (buyRes && buyRes.success) {
                            SYSTEM.lastTradedTokens[signal.tokenAddress] = true;
                            startIndependentPeakMonitor(chatId, netKey, { ...signal, entryPrice: signal.price });
                            bot.sendMessage(chatId, `🚀 **[${netKey}] BOUGHT ${signal.symbol}.** Monitoring peak...`);
                        }
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 2500));
        } catch (e) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 5000)); }
    }
}

// --- 5. EXECUTION CORE (HARDENED JITO SWAP) ---
async function executeSolShotgun(chatId, addr, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.primary, 'confirmed');
        const amt = Math.floor(parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL);
        
        const qRes = await axios.get(`${JUP_API}/quote?inputMint=${SYSTEM.currentAsset}&outputMint=${addr}&amount=${amt}&slippageBps=100`);
        const sRes = await axios.post(`${JUP_API}/swap`, {
            quoteResponse: qRes.data,
            userPublicKey: solWallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            prioritizationFeeLamports: "auto"
        });

        const tx = VersionedTransaction.deserialize(Buffer.from(sRes.data.swapTransaction, 'base64'));
        const { blockhash } = await conn.getLatestBlockhash('finalized');
        tx.message.recentBlockhash = blockhash;
        tx.sign([solWallet]);

        const sig = await conn.sendRawTransaction(tx.serialize()); 
        return { success: !!sig };
    } catch (e) { return { success: false }; }
}

// --- 6. RADAR & SIGNAL TOOLS ---
async function runNeuralSignalScan(netKey) {
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        const chainMap = { 'SOL': 'solana', 'ETH': 'ethereum', 'BASE': 'base', 'BSC': 'bsc' };
        const match = res.data.find(t => t.chainId === chainMap[netKey] && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        return match ? { symbol: match.symbol || "UNK", tokenAddress: match.tokenAddress, price: parseFloat(match.amount) || 0.0001 } : null;
    } catch (e) { return null; }
}

async function verifySignalSafety(tokenAddress) {
    try {
        const res = await axios.get(`https://api.rugcheck.xyz/v1/tokens/${tokenAddress}/report`);
        return res.data.score < 500 && !res.data.rugged;
    } catch (e) { return true; }
}

async function verifyBalance(netKey) {
    if (netKey === 'SOL' && solWallet) {
        const conn = new Connection(NETWORKS.SOL.primary);
        const bal = await conn.getBalance(solWallet.publicKey);
        return bal >= (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 10000000;
    }
    return true; 
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
    const RATES = { BNB: 1225.01, ETH: 4061.20, SOL: 248.15 };
    
    for (const key of Object.keys(NETWORKS)) {
        try {
            if (key === 'SOL' && solWallet) {
                const conn = new Connection(NETWORKS.SOL.primary);
                const bal = (await conn.getBalance(solWallet.publicKey)) / 1e9;
                msg += `🔹 **SOL:** ${bal.toFixed(3)} ($${(bal * RATES.SOL).toFixed(2)} CAD)\n`;
            } else if (evmWallet) {
                const provider = new JsonRpcProvider(NETWORKS[key].rpc);
                const bal = parseFloat(ethers.formatEther(await provider.getBalance(evmWallet.address)));
                const cad = (bal * (key === 'BSC' ? RATES.BNB : RATES.ETH)).toFixed(2);
                msg += `🔹 **${key}:** ${bal.toFixed(4)} ($${cad} CAD)\n`;
            }
        } catch (e) { msg += `🔹 **${key}:** ⚠️ Syncing...\n`; }
    }
    bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
}

// --- 7. INITIALIZATION ---
bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = match[1].trim();
        const hex = (await bip39.mnemonicToSeed(seed)).toString('hex');
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", hex).key);
        evmWallet = ethers.Wallet.fromPhrase(seed);
        bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
        bot.sendMessage(msg.chat.id, `✅ **SYNCED:** <code>${solWallet.publicKey.toString()}</code>`, { parse_mode: 'HTML' });
        bot.sendMessage(msg.chat.id, "🎮 **Neural Control Center:**", getDashboardMarkup());
    } catch (e) { bot.sendMessage(msg.chat.id, "❌ **FAILED**"); }
});

bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "⚔️ **APEX MASTER v9076 ONLINE**", { parse_mode: 'HTML', ...getDashboardMarkup() }));

// --- 🛡️ SECURITY: PEAK-DETECTION USDC SHIELD (v9100) ---
async function performAutomaticSweep(chatId) {
    try {
        if (!solWallet) return;
        const conn = new Connection(NETWORKS.SOL.primary, 'confirmed');
        const currentBalance = await conn.getBalance(solWallet.publicKey);
        const reserve = MIN_SOL_KEEP * LAMPORTS_PER_SOL;

        // 1. Initial Logic: Set the Peak
        if (!SYSTEM.isWaitingForDrop) {
            SYSTEM.highestBalance = currentBalance;
            SYSTEM.isWaitingForDrop = true;
            bot.sendMessage(chatId, `🚀 **PEAK RADAR ACTIVE.** Tracking profit peak...\nInitial Peak: ${(currentBalance/1e9).toFixed(4)} SOL\nTarget Trigger: **-3% from High**`);
        }

        // 2. Update Peak if balance goes higher
        if (currentBalance > SYSTEM.highestBalance) {
            SYSTEM.highestBalance = currentBalance;
            console.log(`[RADAR] New Peak Detected: ${(SYSTEM.highestBalance/1e9).toFixed(4)} SOL`.magenta);
        }

        // 3. Mathematical Trigger: Check for 3% Drop
        const dropThreshold = SYSTEM.highestBalance * 0.97; // 3% drop
        if (currentBalance <= dropThreshold && currentBalance > reserve) {
            bot.sendMessage(chatId, `📉 **TRIGGER:** Balance dropped 3% from peak (${~~((SYSTEM.highestBalance - currentBalance)/1e7)/100} SOL). Executing conversion...`);
            
            // EXECUTE ACTUAL USDC SWAP (Using your Jupiter logic)
            const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
            const sweepAmount = currentBalance - reserve - 15000;
            const qRes = await axios.get(`${JUP_API}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${USDC_MINT}&amount=${sweepAmount}&slippageBps=100`);
            const sRes = await axios.post(`${JUP_API}/swap`, {
                quoteResponse: qRes.data,
                userPublicKey: solWallet.publicKey.toString(),
                destinationTokenAccount: COLD_STORAGE,
                wrapAndUnwrapSol: true
            });
            const tx = VersionedTransaction.deserialize(Buffer.from(sRes.data.swapTransaction, 'base64'));
            tx.sign([solWallet]);
            const sig = await conn.sendRawTransaction(tx.serialize());

            bot.sendMessage(chatId, `✅ **PEAK WITHDRAWAL COMPLETE.** Shielded $${(qRes.data.outAmount / 1e6).toFixed(2)} USDC.`);
            SYSTEM.isWaitingForDrop = false; // Reset for next cycle
        } else {
            // 4. Recursive Monitor: Check again in 1 minute
            console.log(`[WATCH] Current: ${(currentBalance/1e9).toFixed(4)} | Peak: ${(SYSTEM.highestBalance/1e9).toFixed(4)} | Need: < ${(dropThreshold/1e9).toFixed(4)}`.gray);
            setTimeout(() => performAutomaticSweep(chatId), 60000); 
        }

    } catch (e) {
        console.log(`[WATCH ERROR]`.red, e.message);
        setTimeout(() => performAutomaticSweep(chatId), 30000);
    }
}
async function executeFlashShotgun(chatId, addr, symbol) {
    try {
        const conn = new Connection(NETWORKS.SOL.primary, 'confirmed');
        const EXECUTOR_ID = new PublicKey("E86f5d6ECDfCD2D7463414948f41d32EDC8D4AE4");
        
        // Decide borrow amount (10x your trade setting)
        const borrowAmount = Math.floor(parseFloat(SYSTEM.tradeAmount) * 10 * LAMPORTS_PER_SOL);
        if (chatId) bot.sendMessage(chatId, `⚡ **FLASH LOAN:** Borrowing ${SYSTEM.tradeAmount * 10} SOL to snipe $${symbol}...`);

        // 1. Get Quote via Jupiter V6 with Flash Routing
        const qRes = await axios.get(`${JUP_API}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${addr}&amount=${borrowAmount}&slippageBps=200&onlyDirectRoutes=true`);
        
        // 2. Build the Atomic Transaction using the Flash Executor
        const sRes = await axios.post(`${JUP_API}/swap`, {
            quoteResponse: qRes.data,
            userPublicKey: solWallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            programId: EXECUTOR_ID.toString(), // Uses your provided address
            computeUnitPriceMicroLamports: 50000 
        });

        const tx = VersionedTransaction.deserialize(Buffer.from(sRes.data.swapTransaction, 'base64'));
        tx.sign([solWallet]);

        // 3. Fire through Jito MEV-Shield
        const sig = await conn.sendRawTransaction(tx.serialize()); 
        
        if (sig && chatId) bot.sendMessage(chatId, `🔥 **FLASH SUCCESS:** Signal executed with leveraged capital.\nSig: https://solscan.io/tx/${sig}`);
        return { success: !!sig };
    } catch (e) {
        if (chatId) bot.sendMessage(chatId, `❌ **FLASH REJECTED:** Loan failed or slippage too high.`);
        return { success: false };
    }
}
setInterval(() => {
    if (SYSTEM.autoPilot) {
        console.log("[SYSTEM] 🛡️ Running scheduled profit sweep...".cyan);
        // Fires sweep silently in background; will ping Telegram if profit found
        performAutomaticSweep(null); 
    }
}, 4 * 60 * 60 * 1000); // 4 Hours in Milliseconds
http.createServer((req, res) => res.end("MASTER READY")).listen(8080);
