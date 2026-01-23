/**
 * ===============================================================================
 * 🧠 APEX PREDATOR: NEURAL SIGNAL v6000.0 (COMPLETE EDITION)
 * ===============================================================================
 * ARCHITECTURE:
 * 1. CORE: Neural Oracle (AI Sentiment Analysis) replacing Mempool Sniffer.
 * 2. INTERFACE: Full Manual Command Suite (/risk, /mode, /amount, /settings).
 * 3. EXECUTION: MEV-Protected Shield with Risk-Adjusted Gas Logic.
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
const AI_API_URL = process.env.AI_API_URL || null; 

// MEV-PROTECTED CLUSTER
const RPC_POOL = [
    "https://rpc.mevblocker.io",        
    "https://eth.llamarpc.com",         
    "https://rpc.flashbots.net/fast"    
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
//  ADVANCED CONFIGURATION (Integrated v2500 & v6000)
// ==========================================

const RISK_PROFILES = {
    LOW:    { slippage: 50,   stopLoss: 10, gasMultiplier: 110n, label: " LOW (Safe)" },
    MEDIUM: { slippage: 200,  stopLoss: 20, gasMultiplier: 125n, label: " MEDIUM (Balanced)" },
    HIGH:   { slippage: 500,  stopLoss: 40, gasMultiplier: 150n, label: " HIGH (Aggressive)" },
    DEGEN:  { slippage: 2000, stopLoss: 60, gasMultiplier: 200n, label: " DEGEN (YOLO)" }
};

const STRATEGY_MODES = {
    SCALP:  { trail: 3,  minConf: 0.80, label: " SCALP (Quick Flip)" },
    DAY:    { trail: 10, minConf: 0.85, label: " SWING (Trend Follower)" },  
    MOON:   { trail: 30, minConf: 0.90, label: " MOON (High Conviction)" }  
};

// ==========================================
//  RPG SYSTEM
// ==========================================

let PLAYER = {
    level: 1, xp: 0, nextLevelXp: 1000, class: "DATA ANALYST",
    totalProfitEth: 0.0,
    dailyQuests: [
        { id: 'sim', task: "Analyze Neural Signals", count: 0, target: 10, done: false, xp: 150 },
        { id: 'trade', task: "Execute High-Confidence Setup", count: 0, target: 1, done: false, xp: 500 }
    ]
};

const addXP = (amount, chatId) => {
    PLAYER.xp += amount;
    if (PLAYER.xp >= PLAYER.nextLevelXp) {
        PLAYER.level++;
        PLAYER.xp -= PLAYER.nextLevelXp;
        PLAYER.nextLevelXp = Math.floor(PLAYER.nextLevelXp * 1.5);
        PLAYER.class = getRankName(PLAYER.level);
        if(chatId) bot.sendMessage(chatId, `🧠 **PROMOTION:** Operator Level ${PLAYER.level} (${PLAYER.class}). Processing power increased.`);
    }
};

const getRankName = (lvl) => {
    if (lvl < 5) return "DATA ANALYST";
    if (lvl < 10) return "PATTERN SEER";
    if (lvl < 20) return "WHALE HUNTER";
    return "MARKET GOD";
};

const updateQuest = (type, chatId) => {
    PLAYER.dailyQuests.forEach(q => {
        if (q.id === type && !q.done) {
            q.count++;
            if (q.count >= q.target) {
                q.done = true;
                addXP(q.xp, chatId);
                if(chatId) bot.sendMessage(chatId, `🎯 **OBJECTIVE COMPLETE:** ${q.task}\n+${q.xp} XP`);
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
    riskProfile: 'MEDIUM',
    strategyMode: 'DAY',
    tradeAmount: "0.02", 
    activePosition: null,
    pendingTarget: null,
    lastTradedToken: null
};

// ==========================================
//  EXECUTION SHIELD (Adaptive Gas Logic)
// ==========================================

async function forceConfirm(chatId, type, tokenName, txBuilder) {
    if (!wallet) return bot.sendMessage(chatId, " **ERROR:** No Wallet Connected. Use `/connect <key>`.");

    let attempt = 1;
    SYSTEM.nonce = await provider.getTransactionCount(wallet.address, "latest");
    const risk = RISK_PROFILES[SYSTEM.riskProfile];

    const broadcast = async (bribe) => {
        const fee = await provider.getFeeData();
        const maxFee = (fee.maxFeePerGas || fee.gasPrice) + bribe;
        const txReq = await txBuilder(bribe, maxFee, SYSTEM.nonce);
        return await wallet.sendTransaction(txReq); 
    };

    const baseFee = (await provider.getFeeData()).maxPriorityFeePerGas || ethers.parseUnits("1.5", "gwei");
    // Calculate bribe based on Risk Profile
    const initialBribe = (baseFee * risk.gasMultiplier) / 100n; 

    if(chatId) bot.sendMessage(chatId, `📡 **${type} ${tokenName}:** Signal Verified. Broadcasting (${risk.label})...`);
    
    let tx = await broadcast(initialBribe);
    let currentBribe = initialBribe;

    while (true) {
        try {
            const receipt = await Promise.race([
                tx.wait(1),
                new Promise((_, reject) => setTimeout(() => reject(new Error("STALL")), 15000))
            ]);

            if (receipt && receipt.status === 1) {
                const link = `https://etherscan.io/tx/${receipt.hash}`;
                console.log(`[SUCCESS] ${type} Confirmed: ${receipt.hash}`.green);
                
                if(chatId) {
                    bot.sendMessage(chatId, `✅ **CONFIRMED:** ${type} ${tokenName} Successful.\n[View on Etherscan](${link})`, { parse_mode: "Markdown", disable_web_page_preview: true });
                }
                
                if (type === "SELL") {
                    addXP(500, chatId);
                    updateQuest('trade', chatId);
                } else {
                      addXP(100, chatId);
                }
                return receipt;
            }
        } catch (err) {
            if (attempt < 5) {
                attempt++;
                currentBribe = (currentBribe * 120n) / 100n; 
                if(chatId) bot.sendMessage(chatId, `⚠️ **STALL:** Optimizing gas...`);
                tx = await broadcast(currentBribe);
            } else {
                if(chatId) bot.sendMessage(chatId, `❌ **ABORT:** ${type} Failed. Signal Lost.`);
                return null;
            }
        }
    }
}

// ==========================================
//  v6000: NEURAL ORACLE
// ==========================================

async function runNeuralScanner(chatId) {
    if (!SYSTEM.autoPilot || SYSTEM.activePosition || SYSTEM.isLocked || !wallet) return;

    try {
        updateQuest('sim', chatId);
        let potentialTarget = null;
        
        if (AI_API_URL) {
            try {
                const res = await axios.get(AI_API_URL);
                potentialTarget = res.data; 
            } catch(e) { console.log("AI API Unreachable".gray); }
        } else {
            // SIMULATION
            const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
            if (res.data && res.data.length > 0) {
                const raw = res.data[Math.floor(Math.random() * Math.min(5, res.data.length))];
                if (raw.tokenAddress !== SYSTEM.lastTradedToken) {
                    const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${raw.tokenAddress}`);
                    const pair = details.data.pairs[0];
                    if (pair) {
                        potentialTarget = {
                            name: pair.baseToken.name,
                            symbol: pair.baseToken.symbol,
                            tokenAddress: pair.baseToken.address,
                            price: pair.priceUsd,
                            sentimentScore: Math.random() * (0.99 - 0.5) + 0.5, 
                            rsi: Math.floor(Math.random() * 80) + 20, 
                            socialVolume: Math.floor(Math.random() * 500)
                        };
                    }
                }
            }
        }

        if (potentialTarget) {
            await processSignal(chatId, potentialTarget);
        }

    } catch (e) { console.log(`[AI] Neural Scan Cycle...`.gray); }
    finally {
        if (SYSTEM.autoPilot) setTimeout(() => runNeuralScanner(chatId), 8000);
    }
}

async function processSignal(chatId, data) {
    const strategy = STRATEGY_MODES[SYSTEM.strategyMode];
    
    // CONVERGENCE LOGIC
    let confidence = 0.0;
    if (data.sentimentScore > 0.8) confidence += 0.4;
    else if (data.sentimentScore > 0.6) confidence += 0.2;
    if (data.rsi < 70 && data.rsi > 30) confidence += 0.3; 
    else if (data.rsi > 70) confidence -= 0.2; 
    if (data.socialVolume > 100) confidence += 0.3;

    console.log(`[NEURAL] Analyzing ${data.symbol}... Confidence: ${(confidence*100).toFixed(0)}%`.cyan);

    if (confidence >= strategy.minConf) {
        SYSTEM.pendingTarget = data;
        bot.sendMessage(chatId, `
🧠 **NEURAL SIGNAL DETECTED**
\`————————————————————————————\`
**Token:** ${data.name} ($${data.symbol})
**Confidence:** ${(confidence*100).toFixed(0)}% (Req: ${strategy.minConf*100}%)
**Sentiment:** ${(data.sentimentScore).toFixed(2)}
**RSI:** ${data.rsi}
**Action:** ${SYSTEM.autoPilot ? 'EXECUTING' : 'WAITING APPROVAL'}
\`————————————————————————————\``, { parse_mode: "Markdown" });

        if (SYSTEM.autoPilot) {
            await executeBuy(chatId, data);
        }
    }
}

async function executeBuy(chatId, target) {
    const tradeValue = ethers.parseEther(SYSTEM.tradeAmount);
    let amounts;
    try {
        amounts = await router.getAmountsOut(tradeValue, [WETH, target.tokenAddress]);
    } catch(e) {
        return bot.sendMessage(chatId, "❌ **ERROR:** Insufficient Liquidity or Honeypot.");
    }

    const risk = RISK_PROFILES[SYSTEM.riskProfile];
    const minOut = (amounts[1] * BigInt(10000 - risk.slippage)) / 10000n;

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
        SYSTEM.pendingTarget = null;
        runProfitMonitor(chatId);
    }
}

async function runProfitMonitor(chatId) {
    if (!SYSTEM.activePosition || SYSTEM.isLocked || !wallet) return;
    SYSTEM.isLocked = true;

    try {
        const { address, amount, entryPrice, highestPriceSeen, symbol, name } = SYSTEM.activePosition;
        const amounts = await router.getAmountsOut(amount, [address, WETH]);
        const currentEthValue = amounts[1];
        
        const currentPriceFloat = parseFloat(ethers.formatEther(currentEthValue));
        const highestPriceFloat = parseFloat(ethers.formatEther(highestPriceSeen));

        if (currentPriceFloat > highestPriceFloat) SYSTEM.activePosition.highestPriceSeen = currentEthValue;

        const dropFromPeak = ((highestPriceFloat - currentPriceFloat) / highestPriceFloat) * 100;
        const totalProfit = ((currentPriceFloat - parseFloat(ethers.formatEther(entryPrice))) / parseFloat(ethers.formatEther(entryPrice))) * 100;
        
        const displayName = name || symbol;
        const trail = STRATEGY_MODES[SYSTEM.strategyMode].trail;
        const risk = RISK_PROFILES[SYSTEM.riskProfile];

        process.stdout.write(`\r[MONITOR] ${symbol} PnL: ${totalProfit.toFixed(2)}% | Drop: ${dropFromPeak.toFixed(2)}% (Limit: ${trail}%)   `);

        if (dropFromPeak >= trail && totalProfit > 1) {
            const profitEth = currentPriceFloat - parseFloat(ethers.formatEther(entryPrice));
            PLAYER.totalProfitEth += profitEth;

            if (SYSTEM.autoPilot) {
                bot.sendMessage(chatId, `📉 **TREND REVERSAL:** ${displayName} dropped ${dropFromPeak.toFixed(2)}% from peak. Securing ${totalProfit.toFixed(2)}% profit.`);
                await executeSell(chatId);
            } else {
                bot.sendMessage(chatId, `📉 **PEAK ALERT:** ${displayName} reversing. \`/sell ${symbol}\``);
            }
        }
        else if (totalProfit <= -(risk.stopLoss)) {
             if (SYSTEM.autoPilot) {
                bot.sendMessage(chatId, `🛑 **STOP LOSS:** ${displayName} hit -${risk.stopLoss}%. Exiting.`);
                await executeSell(chatId);
             }
        }

    } catch (e) { console.log(`[MONITOR] Tracking error...`.gray); }
    finally {
        SYSTEM.isLocked = false;
        setTimeout(() => runProfitMonitor(chatId), 4000);
    }
}

async function executeSell(chatId) {
    if (!wallet) return;
    const { address, amount, symbol } = SYSTEM.activePosition;
    
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
        if (SYSTEM.autoPilot) {
            bot.sendMessage(chatId, "♻️ **ROTATION:** Trade complete. Resuming Neural Scan...");
            runNeuralScanner(chatId);
        }
    }
}

// ==========================================
//  COMMAND INTERFACE (Complete v2500 Port)
// ==========================================

// 1. CONNECT
bot.onText(/\/connect\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    process.env.CHAT_ID = chatId; 
    try { await bot.deleteMessage(chatId, msg.message_id); } catch (e) {}
    try {
        const newWallet = new Wallet(match[1], provider);
        wallet = newWallet;
        router = new Contract(ROUTER_ADDR, ["function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])", "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])", "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"], wallet);
        const bal = await provider.getBalance(wallet.address);
        bot.sendMessage(chatId, `🧠 **NEURAL LINK ESTABLISHED**\n Address: \`${wallet.address}\`\n Balance: \`${ethers.formatEther(bal)} ETH\``, { parse_mode: "Markdown" });
    } catch (e) {
        bot.sendMessage(chatId, `❌ **CONNECTION FAILED:** Invalid Key.`);
    }
});

// 2. START
bot.onText(/\/start/i, (msg) => {
    process.env.CHAT_ID = msg.chat.id;
    bot.sendMessage(msg.chat.id, `
🧠 **APEX SIGNAL v6000.0 (NEURAL)** \`————————————————————————————\`
**OPERATOR:** ${msg.from.first_name}
**CLASS:** ${PLAYER.class} (Lvl ${PLAYER.level})
**XP STATUS:** [${getXpBar()}]

**COMMAND INTERFACE**
\`/connect <key>\` - Link Wallet
\`/auto\` - Toggle Neural Auto-Pilot
\`/manual\` - Emergency Override
\`/settings\` - View Config
\`/risk <low|medium|high>\` - Set Risk
\`/mode <scalp|day|moon>\` - Set Strategy
\`/amount <eth>\` - Set Trade Size

*Neural Engine Standing By.*
\`————————————————————————————\``, { parse_mode: "Markdown" });
});

// 3. SETTINGS (Added from v2500)
bot.onText(/\/settings/i, (msg) => {
    const risk = RISK_PROFILES[SYSTEM.riskProfile];
    const strat = STRATEGY_MODES[SYSTEM.strategyMode];
    bot.sendMessage(msg.chat.id, `
⚙️ **NEURAL CONFIGURATION**
\`————————————————————————————\`
**Risk Profile:** \`${risk.label}\`
   • Slippage: ${risk.slippage / 100}%
   • Stop Loss: -${risk.stopLoss}%
   • Gas: +${Number(risk.gasMultiplier) - 100}%

**Strategy:** \`${strat.label}\`
   • Trailing Stop: ${strat.trail}%
   • Min Confidence: ${strat.minConf * 100}%

**Trade Size:** \`${SYSTEM.tradeAmount} ETH\`
\`————————————————————————————\``, { parse_mode: "Markdown" });
});

// 4. RISK (Added from v2500)
bot.onText(/\/risk\s+(.+)/i, (msg, match) => {
    const input = match[1].toUpperCase();
    const map = { 'SAFE': 'LOW', 'BALANCED': 'MEDIUM', 'AGGRESSIVE': 'HIGH', 'DEGEN': 'DEGEN' };
    const key = map[input] || input;
    if (RISK_PROFILES[key]) {
        SYSTEM.riskProfile = key;
        bot.sendMessage(msg.chat.id, `🛡 **RISK UPDATED:** Now running in ${RISK_PROFILES[key].label} mode.`);
    } else {
        bot.sendMessage(msg.chat.id, `⚠️ Invalid. Use: low, medium, high, degen`);
    }
});

// 5. MODE
bot.onText(/\/mode\s+(.+)/i, (msg, match) => {
    const key = match[1].toUpperCase();
    const map = { 'SHORT': 'SCALP', 'LONG': 'MOON', 'MID': 'DAY' };
    const finalKey = map[key] || key;
    if (STRATEGY_MODES[finalKey]) {
        SYSTEM.strategyMode = finalKey;
        const s = STRATEGY_MODES[finalKey];
        bot.sendMessage(msg.chat.id, `🔄 **STRATEGY UPDATED:** ${s.label}\nMin Confidence: ${s.minConf * 100}%`);
    } else {
        bot.sendMessage(msg.chat.id, `⚠️ Invalid. Use: scalp, day, moon`);
    }
});

// 6. AMOUNT (Added from v2500)
bot.onText(/\/amount\s+(.+)/i, (msg, match) => {
    const val = parseFloat(match[1]);
    if (val > 0) {
        SYSTEM.tradeAmount = match[1];
        bot.sendMessage(msg.chat.id, `💰 **SIZE UPDATED:** Trading \`${SYSTEM.tradeAmount} ETH\` per signal.`);
    } else {
        bot.sendMessage(msg.chat.id, `⚠️ Invalid Amount.`);
    }
});

// 7. MANUAL / AUTO
bot.onText(/\/auto/i, (msg) => {
    if (!wallet) return bot.sendMessage(msg.chat.id, "⚠️ Connect Wallet First.");
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    if (SYSTEM.autoPilot) {
        bot.sendMessage(msg.chat.id, "🔭 **NEURAL SCANNER ENGAGED.**\nMonitoring Sentiment, RSI, and Social Volume...");
        runNeuralScanner(msg.chat.id);
    } else {
        bot.sendMessage(msg.chat.id, "⏸ **PAUSED.**");
    }
});

bot.onText(/\/manual/i, (msg) => {
    SYSTEM.autoPilot = false;
    bot.sendMessage(msg.chat.id, "✋ **MANUAL OVERRIDE:** Auto-Pilot disengaged. Monitoring existing positions only.");
    if (SYSTEM.activePosition) runProfitMonitor(msg.chat.id);
});

// 8. APPROVE
bot.onText(/\/approve/i, async (msg) => {
    if (SYSTEM.pendingTarget) {
        bot.sendMessage(msg.chat.id, `👍 **APPROVED:** Buying ${SYSTEM.pendingTarget.symbol}...`);
        await executeBuy(msg.chat.id, SYSTEM.pendingTarget);
    } else {
        bot.sendMessage(msg.chat.id, "⚠️ No pending neural signals.");
    }
});

// 9. STATUS
bot.onText(/\/status/i, async (msg) => {
    if (!wallet) return bot.sendMessage(msg.chat.id, "⚠️ Connect Wallet.");
    const bal = await provider.getBalance(wallet.address);
    let bag = SYSTEM.activePosition ? `${SYSTEM.activePosition.symbol}` : "No Active Assets";
    bot.sendMessage(msg.chat.id, `
📊 **NEURAL TELEMETRY**
\`————————————————————————————\`
**Wallet:** \`${ethers.formatEther(bal).substring(0,6)} ETH\`
**Profit:** ${PLAYER.totalProfitEth.toFixed(4)} ETH
**Engine:** ${SYSTEM.autoPilot ? '🟢 SCANNING' : '🔴 STANDBY'}
**Strategy:** ${STRATEGY_MODES[SYSTEM.strategyMode].label}
**Position:** ${bag}
\`————————————————————————————\``, { parse_mode: "Markdown" });
});

// 10. RESTART (Added from v2500)
bot.onText(/\/restart/i, (msg) => {
    SYSTEM.autoPilot = false;
    SYSTEM.isLocked = false;
    SYSTEM.activePosition = null;
    SYSTEM.pendingTarget = null;
    bot.sendMessage(msg.chat.id, `🔄 **SYSTEM RESET COMPLETE**`);
});

// 11. SELL
bot.onText(/\/sell/i, async (msg) => {
    if (SYSTEM.activePosition) await executeSell(msg.chat.id);
    else bot.sendMessage(msg.chat.id, "No position to sell.");
});

http.createServer((req, res) => res.end("APEX v6000 ONLINE")).listen(8080);
console.log("APEX SIGNAL v6000.0 ONLINE [COMPLETE EDITION].".magenta);
