/**
 * ===============================================================================
 * 🧠 APEX SIGNAL: NEURAL PRECOGNITION v6000.0
 * ===============================================================================
 * ARCHITECTURE EVOLUTION:
 * 1. REMOVED: Mempool Sniffer (Too risky/fast).
 * 2. ADDED: Web AI Oracle (Sentiment/Signal processing).
 * 3. RETAINED: Force Engine (Now used for reliability, not gas wars).
 * 4. RETAINED: RPG System (Now rewards Accuracy over Speed).
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- CONFIGURATION ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
// If you have a real Python AI running, put URL here. If not, it uses Simulation Mode.
const AI_API_URL = process.env.AI_API_URL || null; 

//  MEV-PROTECTED CLUSTER (Primary change for v6000: Safety over Speed)
const RPC_POOL = [
    "https://rpc.mevblocker.io",        // Primary: Prevents Sandwich attacks
    "https://eth.llamarpc.com",         // Secondary
    "https://rpc.flashbots.net/fast"    // Fallback
];

const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Initialize Provider
const network = ethers.Network.from(1);
let provider = new JsonRpcProvider(RPC_POOL[0], network, { staticNetwork: network });

const bot = new TelegramBot(TELEGRAM_TOKEN, {
    polling: { interval: 300, autoStart: true, params: { timeout: 10 } }
});

// Global Wallet & Router
let wallet = null;
let router = null;

if (process.env.PRIVATE_KEY) {
    try {
        wallet = new Wallet(process.env.PRIVATE_KEY, provider);
        router = new Contract(ROUTER_ADDR, [
            "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
            "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])",
            "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"
        ], wallet);
        console.log(`[INIT] Neural Link Loaded: ${wallet.address}`.green);
    } catch (e) {
        console.log(`[INIT] Invalid Key. Waiting for /connect`.red);
    }
}

// ==========================================
//  SIGNAL CONFIGURATION (v6000 Specific)
// ==========================================

// We pivoted from "Gas Profiles" to "Confidence Profiles"
const STRATEGY_MODES = {
    SCALP:  { trail: 3,  minConf: 0.80, label: " SCALP (Quick Flip)" },
    SWING:  { trail: 10, minConf: 0.85, label: " SWING (Trend Follower)" },  
    HODL:   { trail: 30, minConf: 0.90, label: " HODL (High Conviction)" }  
};

// ==========================================
//  PERSISTENT STATE (RPG & STATS) - KEPT
// ==========================================

let PLAYER = {
    level: 1, xp: 0, nextLevelXp: 1000, class: "DATA ANALYST",
    inventory: ["Neural Filter v1", "Limit Order Module"],
    totalProfitEth: 0.0,
    dailyQuests: [
        { id: 'sim', task: "Process Market Signals", count: 0, target: 20, done: false, xp: 150 },
        { id: 'trade', task: "Execute High-Conviction Trade", count: 0, target: 1, done: false, xp: 500 }
    ]
};

const addXP = (amount, chatId) => {
    PLAYER.xp += amount;
    if (PLAYER.xp >= PLAYER.nextLevelXp) {
        PLAYER.level++;
        PLAYER.xp -= PLAYER.nextLevelXp;
        PLAYER.nextLevelXp = Math.floor(PLAYER.nextLevelXp * 1.5);
        PLAYER.class = getRankName(PLAYER.level);
        if(chatId) bot.sendMessage(chatId, `🧠 **LEVEL UP:** Operator is now Level ${PLAYER.level} (${PLAYER.class}).`);
    }
};

const getRankName = (lvl) => {
    if (lvl < 5) return "DATA ANALYST";
    if (lvl < 10) return "PATTERN SEER";
    if (lvl < 20) return "WHALE WATCHER";
    return "MARKET ORACLE";
};

const updateQuest = (type, chatId) => {
    PLAYER.dailyQuests.forEach(q => {
        if (q.id === type && !q.done) {
            q.count++;
            if (q.count >= q.target) {
                q.done = true;
                addXP(q.xp, chatId);
                if(chatId) bot.sendMessage(chatId, `🎯 **QUEST COMPLETE:** ${q.task}`);
            }
        }
    });
};

const getXpBar = () => {
    const p = Math.min(Math.round((PLAYER.xp / PLAYER.nextLevelXp) * 10), 10);
    return "🟦".repeat(p) + "⬜".repeat(10 - p);
};

// ==========================================
//  SYSTEM STATE
// ==========================================

let SYSTEM = {
    autoPilot: false,
    isLocked: false,
    nonce: null,
    strategyMode: 'SWING',
    tradeAmount: "0.02", // Default trade size
    activePosition: null,
    pendingTarget: null,
    lastTradedToken: null
};

// ==========================================
//  EXECUTION SHIELD (Formerly Force Engine)
// ==========================================
// RETAINED: This code is solid. We just use it for reliability now, not speed.

async function forceConfirm(chatId, type, tokenName, txBuilder) {
    if (!wallet) return bot.sendMessage(chatId, "⚠️ **ERROR:** No Wallet Connected.");

    let attempt = 1;
    SYSTEM.nonce = await provider.getTransactionCount(wallet.address, "latest");

    const broadcast = async (bribe) => {
        const fee = await provider.getFeeData();
        // v6000 CHANGE: No massive bribes. Just standard market rate + small tip.
        const maxFee = (fee.maxFeePerGas || fee.gasPrice) + bribe;
        const txReq = await txBuilder(bribe, maxFee, SYSTEM.nonce);
        return await wallet.sendTransaction(txReq);
    };

    // Low priority tip (we aren't racing)
    const initialBribe = ethers.parseUnits("1.5", "gwei");

    if(chatId) bot.sendMessage(chatId, `📡 **${type} ${tokenName}:** Broadcasting via Signal Layer...`);
    
    let tx = await broadcast(initialBribe);

    while (true) {
        try {
            const receipt = await Promise.race([
                tx.wait(1),
                new Promise((_, reject) => setTimeout(() => reject(new Error("STALL")), 15000))
            ]);

            if (receipt && receipt.status === 1) {
                const link = `https://etherscan.io/tx/${receipt.hash}`;
                console.log(`[SUCCESS] ${type} Confirmed`.green);
                
                if(chatId) {
                    bot.sendMessage(chatId, `✅ **CONFIRMED:** ${type} ${tokenName}\n[View on Etherscan](${link})`, { parse_mode: "Markdown", disable_web_page_preview: true });
                }
                
                if (type === "SELL") updateQuest('trade', chatId);
                addXP(50, chatId);
                return receipt;
            }
        } catch (err) {
            if (attempt < 3) { // Reduced attempts (don't spam)
                attempt++;
                // Bump slightly
                tx = await broadcast(initialBribe + ethers.parseUnits("1", "gwei"));
            } else {
                if(chatId) bot.sendMessage(chatId, `❌ **FAIL:** Transaction timed out.`);
                return null;
            }
        }
    }
}

// ==========================================
//  LAYER A: WEB AI ORACLE (The New Brain)
// ==========================================
// REPLACES: Mempool Sniffer. This looks for Logic/Signals, not raw TXs.

async function runAiOracle(chatId) {
    // Only run if autopilot is ON and we have no position
    if (!SYSTEM.autoPilot || SYSTEM.activePosition || SYSTEM.isLocked) return;

    try {
        updateQuest('sim', chatId);

        // 1. DATA ACQUISITION
        let signalData;
        if (AI_API_URL) {
            // Real AI Mode: Fetch from your Python script
            const res = await axios.get(AI_API_URL);
            signalData = res.data; 
        } else {
            // Simulation Mode: Generate a "found" signal occasionally
            if (Math.random() > 0.8) { // 20% chance to find a signal per tick
                signalData = generateMockSignal();
            }
        }

        // 2. SIGNAL PROCESSING (The Neural Filter)
        if (signalData) {
            await processSignal(chatId, signalData);
        }

    } catch (e) { console.log(`[AI] Scanning...`.gray); }
    finally {
        // Poll every 5 seconds (Slower than mempool, because signals take time)
        setTimeout(() => runAiOracle(chatId), 5000);
    }
}

function generateMockSignal() {
    // Generates a mock "Twitter Sentiment" signal
    const tokens = [
        { s: "AIX", n: "AI Exchange", a: "0x..." }, 
        { s: "GPT", n: "GPT Protocol", a: "0x..." },
        { s: "PEPE", n: "Pepe Coin", a: "0x..." }
    ];
    const t = tokens[Math.floor(Math.random() * tokens.length)];
    return {
        symbol: t.s,
        name: t.n,
        tokenAddress: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH as placeholder
        sentiment: Math.random() * (0.99 - 0.7) + 0.7, // 0.70 to 0.99
        rsi: Math.floor(Math.random() * 80),
        mentions: Math.floor(Math.random() * 50)
    };
}

async function processSignal(chatId, signal) {
    const minConf = STRATEGY_MODES[SYSTEM.strategyMode].minConf;
    
    // THE FILTER: Check convergence
    let isBuy = false;
    let confidence = 0.0;

    // Logic: Sentiment must be high + RSI must not be overbought (>70)
    if (signal.sentiment > 0.8) confidence += 0.5;
    if (signal.rsi < 70) confidence += 0.3;
    if (signal.mentions > 10) confidence += 0.15;

    console.log(`[AI] Signal Found: ${signal.symbol} | Conf: ${confidence.toFixed(2)}`.cyan);

    if (confidence >= minConf) {
        bot.sendMessage(chatId, `
🧠 **NEURAL SIGNAL DETECTED**
\`————————————————————————————\`
**Token:** ${signal.name} ($${signal.symbol})
**Confidence:** ${(confidence*100).toFixed(0)}% (Req: ${minConf*100}%)
**Sentiment:** ${signal.sentiment.toFixed(2)}
**RSI:** ${signal.rsi}
\`————————————————————————————\``, { parse_mode: "Markdown" });

        // Trigger Execution
        await executeBuy(chatId, signal);
    }
}

// ==========================================
//  LAYER C: EXECUTION (The Muscle)
// ==========================================
// RETAINED: logic from v2500, but removed the "Slippage" override from Risk Profiles

async function executeBuy(chatId, target) {
    const tradeValue = ethers.parseEther(SYSTEM.tradeAmount);
    // Check WETH vs Token Address
    const amounts = await router.getAmountsOut(tradeValue, [WETH, target.tokenAddress]).catch(()=>null);
    
    if(!amounts) {
        // If simulation, we fake the buy
        if (!AI_API_URL) {
            SYSTEM.activePosition = {
                address: target.tokenAddress,
                symbol: target.symbol,
                name: target.name,
                entryPrice: tradeValue,
                amount: ethers.parseEther("100"), // Fake amount
                highestPriceSeen: tradeValue
            };
            bot.sendMessage(chatId, `🛠 **SIMULATION BUY:** Position opened on ${target.symbol}`);
            runProfitMonitor(chatId);
            return;
        }
        return bot.sendMessage(chatId, "❌ Error estimating swap.");
    }

    const minOut = (amounts[1] * 95n) / 100n; // Fixed 5% slippage (Safer)

    const receipt = await forceConfirm(chatId, "BUY", target.symbol, async (bribe, maxFee, nonce) => {
        return await router.swapExactETHForTokens.populateTransaction(
            minOut, [WETH, target.tokenAddress], wallet.address, Math.floor(Date.now()/1000)+120,
            { value: tradeValue, gasLimit: 300000, maxPriorityFeePerGas: bribe, maxFeePerGas: maxFee, nonce: nonce }
        );
    });

    if (receipt) {
        SYSTEM.activePosition = {
            address: target.tokenAddress,
            symbol: target.symbol,
            name: target.name,
            entryPrice: tradeValue,
            amount: minOut,
            highestPriceSeen: tradeValue
        };
        runProfitMonitor(chatId);
    }
}

// ==========================================
//  DYNAMIC PEAK MONITOR (Retained)
// ==========================================
// This logic is universal. It works for both Sniping and Signals.

async function runProfitMonitor(chatId) {
    if (!SYSTEM.activePosition || SYSTEM.isLocked) return;
    SYSTEM.isLocked = true;

    try {
        const { address, amount, entryPrice, highestPriceSeen, symbol } = SYSTEM.activePosition;
        
        let currentEthValue;
        
        // Simulating price if using mock
        if (!AI_API_URL && address === "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2") {
            const oldVal = parseFloat(ethers.formatEther(highestPriceSeen));
            const randomMove = oldVal * (Math.random() * 0.05 - 0.02); // Random +/- movement
            currentEthValue = ethers.parseEther((oldVal + randomMove).toFixed(18));
        } else {
            // Real Price Check
            const amounts = await router.getAmountsOut(amount, [address, WETH]);
            currentEthValue = amounts[1];
        }
        
        const currentPriceFloat = parseFloat(ethers.formatEther(currentEthValue));
        const highestPriceFloat = parseFloat(ethers.formatEther(highestPriceSeen));

        if (currentPriceFloat > highestPriceFloat) {
            SYSTEM.activePosition.highestPriceSeen = currentEthValue;
        }

        const dropFromPeak = ((highestPriceFloat - currentPriceFloat) / highestPriceFloat) * 100;
        const totalProfit = ((currentPriceFloat - parseFloat(ethers.formatEther(entryPrice))) / parseFloat(ethers.formatEther(entryPrice))) * 100;
        const trailConfig = STRATEGY_MODES[SYSTEM.strategyMode].trail;

        // VISUAL LOG
        process.stdout.write(`\r[MONITOR] ${symbol} PnL: ${totalProfit.toFixed(2)}% | Drop: ${dropFromPeak.toFixed(2)}% (Limit: ${trailConfig}%)   `);

        if (dropFromPeak >= trailConfig && totalProfit > 1) {
            const profitEth = currentPriceFloat - parseFloat(ethers.formatEther(entryPrice));
            PLAYER.totalProfitEth += profitEth;

            if (SYSTEM.autoPilot) {
                bot.sendMessage(chatId, `📉 **TREND REVERSAL:** ${symbol} dropped ${dropFromPeak.toFixed(2)}%. Selling...`);
                await executeSell(chatId);
            }
        }
    } catch (e) { console.log(`[MONITOR] Error checking price`.red); }
    finally {
        SYSTEM.isLocked = false;
        setTimeout(() => runProfitMonitor(chatId), 4000);
    }
}

async function executeSell(chatId) {
    if (!wallet || !SYSTEM.activePosition) return;
    const { address, amount, symbol } = SYSTEM.activePosition;
    
    // Simulation Sell
    if (!AI_API_URL && address === "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2") {
        SYSTEM.activePosition = null;
        bot.sendMessage(chatId, `💵 **SIMULATION SELL:** ${symbol} closed.`);
        addXP(300, chatId);
        return;
    }

    // Real Sell
    const tokenContract = new Contract(address, ["function approve(address, uint) returns (bool)"], wallet);
    await (await tokenContract.approve(ROUTER_ADDR, amount)).wait();

    const receipt = await forceConfirm(chatId, "SELL", symbol, async (bribe, maxFee, nonce) => {
        return await router.swapExactTokensForETH.populateTransaction(
            amount, 0n, [address, WETH], wallet.address, Math.floor(Date.now()/1000)+120,
            { gasLimit: 350000, maxPriorityFeePerGas: bribe, maxFeePerGas: maxFee, nonce: nonce }
        );
    });

    if (receipt) {
        SYSTEM.lastTradedToken = address;
        SYSTEM.activePosition = null;
        bot.sendMessage(chatId, "♻️ **ROTATION:** Trade complete. Resuming Neural Scan...");
    }
}

// ==========================================
//  COMMANDS (Retained & Updated)
// ==========================================

bot.onText(/\/connect\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    process.env.CHAT_ID = chatId;
    try { await bot.deleteMessage(chatId, msg.message_id); } catch (e) {}
    try {
        wallet = new Wallet(match[1], provider);
        router = new Contract(ROUTER_ADDR, [ "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])", "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])", "function getAmountsOut(uint amt, address[] path) external view returns (uint[])" ], wallet);
        bot.sendMessage(chatId, `🧠 **NEURAL LINK ONLINE:** ${wallet.address}`);
    } catch (e) { bot.sendMessage(chatId, `❌ Invalid Key.`); }
});

bot.onText(/\/start/i, (msg) => {
    process.env.CHAT_ID = msg.chat.id;
    bot.sendMessage(msg.chat.id, `
🧠 **APEX SIGNAL V6000.0** \`——————————————————\`
**OPERATOR:** ${msg.from.first_name}
**CLASS:** ${PLAYER.class} (Lvl ${PLAYER.level})
**XP:** [${getXpBar()}]

**COMMANDS**
\`/auto\` - Start Neural AI Scanner
\`/mode <scalp|swing|hodl>\` - Set Strategy
\`/status\` - View Telemetry
\`/sell\` - Force Exit
\`——————————————————\``, { parse_mode: "Markdown" });
});

bot.onText(/\/mode\s+(.+)/i, (msg, match) => {
    const key = match[1].toUpperCase();
    if (STRATEGY_MODES[key]) {
        SYSTEM.strategyMode = key;
        bot.sendMessage(msg.chat.id, `🔄 **STRATEGY UPDATED:** ${STRATEGY_MODES[key].label}`);
    }
});

bot.onText(/\/auto/i, (msg) => {
    if (!wallet) return bot.sendMessage(msg.chat.id, "⚠️ Connect Wallet First.");
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    if (SYSTEM.autoPilot) {
        bot.sendMessage(msg.chat.id, `🔭 **NEURAL SCANNER ENGAGED**\nMonitoring Social Sentiment & RSI...`);
        runAiOracle(msg.chat.id);
    } else {
        bot.sendMessage(msg.chat.id, `⏸ **PAUSED.**`);
    }
});

bot.onText(/\/status/i, async (msg) => {
    let bag = SYSTEM.activePosition ? `${SYSTEM.activePosition.symbol}` : "No Active Assets";
    bot.sendMessage(msg.chat.id, `
📊 **SYSTEM TELEMETRY**
\`————————————————————————————\`
**Profit:** ${PLAYER.totalProfitEth.toFixed(4)} ETH
**Mode:** ${SYSTEM.autoPilot ? '🟢 SCANNING' : '🔴 STANDBY'}
**Strategy:** ${STRATEGY_MODES[SYSTEM.strategyMode].label}
**Position:** ${bag}
\`————————————————————————————\``, { parse_mode: "Markdown" });
});

bot.onText(/\/sell/i, async (msg) => {
    if(SYSTEM.activePosition) await executeSell(msg.chat.id);
    else bot.sendMessage(msg.chat.id, "No position to sell.");
});

// START
http.createServer((req, res) => res.end("V6000_SIGNAL_ONLINE")).listen(8080);
console.log("APEX SIGNAL v6000.0 ONLINE [NEURAL EDITION].".magenta);
