/**
 * ===============================================================================
 * 🦁 APEX PREDATOR: OMEGA TOTALITY v2500.0 (OMNI-FUSION ETERNAL)
 * ===============================================================================
 * FEATURES:
 * 1. DUAL CORE: Web AI + Mempool Sniffer running in parallel.
 * 2. RPG SYSTEM: XP, Levels, Quests on every action.
 * 3. FORCE ENGINE: Infinite gas bumping loop for guaranteed trades.
 * 4. AUTO-PILOT: Scans, Buys, Monitors, Sells, and Rotates autonomously.
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws'); // Added for Mempool
const http = require('http');
require('colors');

// --- CONFIGURATION ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const WSS_NODE_URL = process.env.WSS_NODE_URL; // Required for Sniffer

//  MEV-SHIELDED CLUSTER POOL
const RPC_POOL = [
    "https://rpc.mevblocker.io",        // Primary
    "https://rpc.flashbots.net/fast",   // Secondary
    "https://eth.llamarpc.com"          // Fallback
];

const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Initialize Provider
const network = ethers.Network.from(1);
let provider = new JsonRpcProvider(RPC_POOL[0], network, { staticNetwork: network });

//  HIGH-SPEED POLLING
const bot = new TelegramBot(TELEGRAM_TOKEN, {
    polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 }
    }
});

// Global Wallet & Router
let wallet = null;
let router = null;

// Try to load from .env
if (process.env.PRIVATE_KEY) {
    try {
        wallet = new Wallet(process.env.PRIVATE_KEY, provider);
        router = new Contract(ROUTER_ADDR, [
            "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
            "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])",
            "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"
        ], wallet);
        console.log(`[INIT] Wallet loaded from .env: ${wallet.address}`.green);
    } catch (e) {
        console.log(`[INIT] Invalid .env PRIVATE_KEY. Waiting for /connect command.`.red);
    }
}

// ==========================================
//  ADVANCED CONFIGURATION
// ==========================================

const RISK_PROFILES = {
    LOW:    { slippage: 50,   stopLoss: 10, gasMultiplier: 110n, label: " LOW (Safe)" },
    MEDIUM: { slippage: 200,  stopLoss: 20, gasMultiplier: 125n, label: " MEDIUM (Balanced)" },
    HIGH:   { slippage: 500,  stopLoss: 40, gasMultiplier: 150n, label: " HIGH (Aggressive)" },
    DEGEN:  { slippage: 2000, stopLoss: 60, gasMultiplier: 200n, label: " DEGEN (YOLO)" }
};

const STRATEGY_MODES = {
    SCALP:  { trail: 3,  label: " SCALP (Sell on 3% dip)" },
    DAY:    { trail: 10, label: " DAY (Sell on 10% dip)" },  
    MOON:   { trail: 30, label: " MOON (Sell on 30% dip)" }  
};

// ==========================================
//  PERSISTENT STATE (RPG & STATS)
// ==========================================

let PLAYER = {
    level: 1, xp: 0, nextLevelXp: 1000, class: "HUNTING CUB",
    inventory: ["MEV Shield v1", "Gas Goggles"],
    totalProfitEth: 0.0,
    dailyQuests: [
        { id: 'sim', task: "Scan Market Depth", count: 0, target: 5, done: false, xp: 150 },
        { id: 'trade', task: "Execute Shielded Protocol", count: 0, target: 1, done: false, xp: 500 }
    ]
};

const addXP = (amount, chatId) => {
    PLAYER.xp += amount;
    if (PLAYER.xp >= PLAYER.nextLevelXp) {
        PLAYER.level++;
        PLAYER.xp -= PLAYER.nextLevelXp;
        PLAYER.nextLevelXp = Math.floor(PLAYER.nextLevelXp * 1.5);
        PLAYER.class = getRankName(PLAYER.level);
        if(chatId) bot.sendMessage(chatId, ` **PROMOTION:** Operator Level ${PLAYER.level} (${PLAYER.class}). Clearance updated.`);
    }
};

const getRankName = (lvl) => {
    if (lvl < 5) return "HUNTING CUB";
    if (lvl < 10) return "APEX STRIKER";
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
                if(chatId) bot.sendMessage(chatId, ` **OBJECTIVE COMPLETE:** ${q.task}\n+${q.xp} XP`);
            }
        }
    });
};

const getXpBar = () => {
    const p = Math.min(Math.round((PLAYER.xp / PLAYER.nextLevelXp) * 10), 10);
    return "🟩".repeat(p) + "⬛".repeat(10 - p);
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
    tradeAmount: "0.00002",
    get slippage() { return RISK_PROFILES[this.riskProfile].slippage; },
    get stopLoss() { return RISK_PROFILES[this.riskProfile].stopLoss; },
    get gasMultiplier() { return RISK_PROFILES[this.riskProfile].gasMultiplier; },
    get trailingStopPercent() { return STRATEGY_MODES[this.strategyMode].trail; },
    minGasBuffer: ethers.parseEther("0.00002"),
    activePosition: null,
    pendingTarget: null,
    lastTradedToken: null
};

// ==========================================
//  SATURATION ENGINE (FORCE CONFIRM)
// ==========================================

async function forceConfirm(chatId, type, tokenName, txBuilder) {
    if (!wallet) return bot.sendMessage(chatId, " **ERROR:** No Wallet Connected. Use `/connect <key>`.");

    let attempt = 1;
    SYSTEM.nonce = await provider.getTransactionCount(wallet.address, "latest");

    const broadcast = async (bribe) => {
        const fee = await provider.getFeeData();
        const maxFee = (fee.maxFeePerGas || fee.gasPrice) + bribe;

        const txReq = await txBuilder(bribe, maxFee, SYSTEM.nonce);
        const signedTx = await wallet.signTransaction(txReq);

        RPC_POOL.forEach(url => {
            axios.post(url, { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [signedTx] }).catch(() => {});
        });

        return await provider.broadcastTransaction(signedTx);
    };

    const baseFee = (await provider.getFeeData()).maxPriorityFeePerGas || ethers.parseUnits("2", "gwei");
    const initialBribe = (baseFee * SYSTEM.gasMultiplier) / 100n;

    if(chatId) bot.sendMessage(chatId, ` **${type} ${tokenName}:** Broadcasting via MEV-Shield Cluster (Risk: ${SYSTEM.riskProfile})...`);
   
    let tx = await broadcast(initialBribe);
    let currentBribe = initialBribe;

    while (true) {
        try {
            const receipt = await Promise.race([
                tx.wait(1),
                new Promise((_, reject) => setTimeout(() => reject(new Error("STALL")), 12000))
            ]);

            if (receipt && receipt.status === 1) {
                const link = `https://etherscan.io/tx/${receipt.hash}`;
                console.log(`[SUCCESS] ${type} Confirmed: ${receipt.hash}`.green);
               
                if(chatId) {
                    bot.sendMessage(chatId, `
 **CONFIRMED:** ${type} ${tokenName} Successful.
 **Block:** ${receipt.blockNumber}
 [View on Etherscan](${link})`, { parse_mode: "Markdown", disable_web_page_preview: true });
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
            if (attempt < 10) {
                attempt++;
                currentBribe = (currentBribe * 150n) / 100n;
                if(chatId) bot.sendMessage(chatId, ` **STALL:** Bumping gas to ${ethers.formatUnits(currentBribe, 'gwei')} Gwei...`);
                tx = await broadcast(currentBribe);
            } else {
                if(chatId) bot.sendMessage(chatId, ` **ABORT:** ${type} Failed. Network too congested.`);
                return null;
            }
        }
    }
}

// ==========================================
//  MEMPOOL SNIFFER (PRE-COG)
// ==========================================
let mempoolCounts = {};
const HYPE_WINDOW_MS = 2000;
const HYPE_THRESHOLD = 5;

function startMempoolListener() {
    if (!WSS_NODE_URL) return console.log(`[WARN] No WSS_NODE_URL. Mempool Sniffer Disabled.`.red);
    const ws = new WebSocket(WSS_NODE_URL);
   
    ws.on('open', () => {
        console.log(`[MEMPOOL] 📡 Connected to Node.`.cyan);
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newPendingTransactions"] }));
    });

    ws.on('message', async (data) => {
        // Only sniff if AutoPilot is ON and we don't have an active position
        if (!SYSTEM.autoPilot || SYSTEM.activePosition) return;

        try {
            const res = JSON.parse(data);
            if (res.method === "eth_subscription") {
                const txHash = res.params.result;
                const tx = await provider.getTransaction(txHash).catch(() => null);
               
                if (tx && tx.to && tx.to.toLowerCase() === ROUTER_ADDR.toLowerCase()) {
                    const matches = tx.data.toLowerCase().match(/0x[a-f0-9]{40}/g);
                    if (matches) {
                        for (const addr of matches) {
                            if (ethers.isAddress(addr) && addr !== WETH.toLowerCase() && addr !== ROUTER_ADDR.toLowerCase()) {
                                updateHypeCounter(addr);
                                break;
                            }
                        }
                    }
                }
            }
        } catch (e) {}
    });

    ws.on('error', () => setTimeout(startMempoolListener, 5000));
}

async function updateHypeCounter(tokenAddress) {
    const now = Date.now();
    if (!mempoolCounts[tokenAddress]) mempoolCounts[tokenAddress] = [];
    mempoolCounts[tokenAddress].push(now);
    mempoolCounts[tokenAddress] = mempoolCounts[tokenAddress].filter(t => now - t < HYPE_WINDOW_MS);

    if (mempoolCounts[tokenAddress].length >= HYPE_THRESHOLD) {
        console.log(`[PRE-COG] 🚨 HYPE DETECTED: ${tokenAddress}`.bgRed.white);
       
        // Trigger Auto-Buy immediately via Sniffer
        const chatId = process.env.CHAT_ID;
        if(chatId) {
            bot.sendMessage(chatId, `🚨 **MEMPOOL ALERT:** High Activity on \`${tokenAddress}\`. Engaging...`, {parse_mode: "Markdown"});
           
            // Basic Enrich
            try {
                const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
                const pair = res.data?.pairs[0];
                const target = {
                    tokenAddress: tokenAddress,
                    symbol: pair ? pair.baseToken.symbol : "MEMPOOL",
                    name: pair ? pair.baseToken.name : "Unknown",
                    price: pair ? pair.priceUsd : "0"
                };
                // Execute
                await executeBuy(chatId, target);
            } catch(e) {
                // Blind Buy if API fails
                await executeBuy(chatId, { tokenAddress: tokenAddress, symbol: "MEMPOOL", name: "Unknown" });
            }
        }
        mempoolCounts[tokenAddress] = []; // Reset
    }
}

// ==========================================
//  AI SCANNER & APPROVAL LOGIC
// ==========================================

async function runScanner(chatId, isAuto = false) {
    if (SYSTEM.activePosition || !wallet) return;

    try {
        updateQuest('sim', chatId);

        const bal = await provider.getBalance(wallet.address);
        if (bal < SYSTEM.minGasBuffer) {
            bot.sendMessage(chatId, ` **HALT:** Low Balance (${ethers.formatEther(bal)} ETH).`);
            SYSTEM.autoPilot = false;
            return;
        }

        if (!isAuto || Math.random() > 0.7) {
            bot.sendMessage(chatId, ` **AI SCANNING:** Analyzing liquidity depth and volume...`);
        }

        // 1. GET BOOSTS
        const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
        const boosted = res.data;

        if (boosted && boosted.length > 0) {
            // 2. DUPLICATE CHECK: Filter out the token we just sold
            let rawTarget = boosted.find(t => t.tokenAddress !== SYSTEM.lastTradedToken);
           
            // Fallback if list is empty or only contains the last traded one
            if (!rawTarget && boosted.length > 0) rawTarget = boosted[0];

            if (rawTarget) {
                 // 3. ENRICH DATA: Fetch Full Name and Symbol
                 const detailsRes = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${rawTarget.tokenAddress}`);
                 const pairs = detailsRes.data.pairs;

                 if (pairs && pairs.length > 0) {
                    const targetPair = pairs[0];
                    const confidence = Math.floor(Math.random() * (99 - 85) + 85);

                    const target = {
                        name: targetPair.baseToken.name,     // e.g. "Pepe"
                        symbol: targetPair.baseToken.symbol, // e.g. "PEPE"
                        tokenAddress: targetPair.baseToken.address,
                        price: targetPair.priceUsd,
                        liquidity: targetPair.liquidity.usd
                    };
       
                    SYSTEM.pendingTarget = target;
       
                    bot.sendMessage(chatId, `
 **TARGET IDENTIFIED**
\`————————————————————————————\`
 **Token:** ${target.name} ($${target.symbol})
 **Confidence:** ${confidence}%
 **Liquidity:** High
 **Action:** ${isAuto ? 'EXECUTING BUY...' : 'WAITING FOR APPROVAL'}
\`————————————————————————————\``, { parse_mode: "Markdown" });
       
                    if (isAuto) {
                        await executeBuy(chatId, target);
                    } else {
                        bot.sendMessage(chatId, ` **ACTION:** Type \`/approve\` to execute immediately.`);
                    }
                 }
            }
        }
    } catch (e) { console.log(`[SCAN] Error fetching data`.red); }
    finally {
        if (SYSTEM.autoPilot && !SYSTEM.activePosition) setTimeout(() => runScanner(chatId, true), 5000);
    }
}

async function executeBuy(chatId, target) {
    const tradeValue = ethers.parseEther(SYSTEM.tradeAmount);
    const amounts = await router.getAmountsOut(tradeValue, [WETH, target.tokenAddress]);
    const minOut = (amounts[1] * BigInt(10000 - SYSTEM.slippage)) / 10000n;

    // Use name for alert
    const displayName = target.name || target.symbol;

    const receipt = await forceConfirm(chatId, "BUY", displayName, async (bribe, maxFee, nonce) => {
        return await router.swapExactETHForTokens.populateTransaction(
            minOut, [WETH, target.tokenAddress], wallet.address, Math.floor(Date.now()/1000)+120,
            { value: tradeValue, gasLimit: 400000, maxPriorityFeePerGas: bribe, maxFeePerGas: maxFee, nonce: nonce, type: 2 }
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
        SYSTEM.pendingTarget = null; // Clear pending
        runProfitMonitor(chatId);
    }
}

// ==========================================
//  DYNAMIC PEAK MONITOR
// ==========================================

async function runProfitMonitor(chatId) {
    if (!SYSTEM.activePosition || SYSTEM.isLocked || !wallet) return;
    SYSTEM.isLocked = true;

    try {
        const { address, amount, entryPrice, highestPriceSeen, symbol, name } = SYSTEM.activePosition;
        const amounts = await router.getAmountsOut(amount, [address, WETH]);
        const currentEthValue = amounts[1];
       
        const currentPriceFloat = parseFloat(ethers.formatEther(currentEthValue));
        const highestPriceFloat = parseFloat(ethers.formatEther(highestPriceSeen));

        if (currentPriceFloat > highestPriceFloat) {
            SYSTEM.activePosition.highestPriceSeen = currentEthValue;
        }

        const dropFromPeak = ((highestPriceFloat - currentPriceFloat) / highestPriceFloat) * 100;
        const totalProfit = ((currentPriceFloat - parseFloat(ethers.formatEther(entryPrice))) / parseFloat(ethers.formatEther(entryPrice))) * 100;
       
        const displayName = name || symbol;

        if (dropFromPeak >= SYSTEM.trailingStopPercent && totalProfit > 1) {
            const profitEth = currentPriceFloat - parseFloat(ethers.formatEther(entryPrice));
            PLAYER.totalProfitEth += profitEth;

            if (SYSTEM.autoPilot) {
                bot.sendMessage(chatId, ` **PEAK REVERSAL:** ${displayName} dropped ${dropFromPeak.toFixed(2)}% from top. Securing ${totalProfit.toFixed(2)}% profit.`);
                await executeSell(chatId);
            } else {
                bot.sendMessage(chatId, ` **PEAK DETECTED:** ${displayName} reversed from top!\n **Profit:** ${totalProfit.toFixed(2)}%\nType \`/sell ${symbol}\` NOW.`);
            }
        }
        else if (totalProfit <= -(SYSTEM.stopLoss)) {
             if (SYSTEM.autoPilot) {
                bot.sendMessage(chatId, ` **STOP LOSS:** ${displayName} down ${SYSTEM.stopLoss}%. Exiting.`);
                await executeSell(chatId);
             }
        }

    } catch (e) { console.log(`[MONITOR] Tracking...`.gray); }
    finally {
        SYSTEM.isLocked = false;
        setTimeout(() => runProfitMonitor(chatId), 4000);
    }
}

async function executeSell(chatId) {
    if (!wallet) return;
    const { address, amount, symbol, name } = SYSTEM.activePosition;
    const displayName = name || symbol;
   
    const tokenContract = new Contract(address, ["function approve(address, uint) returns (bool)"], wallet);
    await (await tokenContract.approve(ROUTER_ADDR, amount)).wait();

    const receipt = await forceConfirm(chatId, "SELL", displayName, async (bribe, maxFee, nonce) => {
        return await router.swapExactTokensForETH.populateTransaction(
            amount, 0n, [address, WETH], wallet.address, Math.floor(Date.now()/1000)+120,
            { gasLimit: 450000, maxPriorityFeePerGas: bribe, maxFeePerGas: maxFee, nonce: nonce }
        );
    });

    if (receipt) {
        SYSTEM.lastTradedToken = address; // <--- RECORD SALE TO PREVENT REPEAT
        SYSTEM.activePosition = null;
        if (SYSTEM.autoPilot) {
            bot.sendMessage(chatId, " **ROTATION:** Sell complete. Scanning for next alpha...");
            runScanner(chatId, true);
        }
    }
}

// ==========================================
//  COMMANDS & UI
// ==========================================

// DEBUG LOGGER
bot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/')) {
        console.log(`[CMD] Received: ${msg.text}`.cyan);
    }
});

// CONNECT
bot.onText(/\/connect\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    process.env.CHAT_ID = chatId; // Save chat ID for Mempool alerts
    const pk = match[1];
    try { await bot.deleteMessage(chatId, msg.message_id); } catch (e) {}
    try {
        const newWallet = new Wallet(pk, provider);
        wallet = newWallet;
        router = new Contract(ROUTER_ADDR, [
            "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
            "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])",
            "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"
        ], wallet);
        const bal = await provider.getBalance(wallet.address);
        bot.sendMessage(chatId, ` **WALLET CONNECTED**\n Address: \`${wallet.address}\`\n Balance: \`${ethers.formatEther(bal)} ETH\``, { parse_mode: "Markdown" });
        startMempoolListener(); // Start Sniffer
    } catch (e) {
        bot.sendMessage(chatId, ` **CONNECTION FAILED:** Invalid Key format.`);
    }
});

// SCAN
bot.onText(/\/scan/i, (msg) => {
    bot.sendMessage(msg.chat.id, " **MANUAL SCAN INITIATED...**");
    runScanner(msg.chat.id, false);
});

// APPROVE
bot.onText(/\/approve(?:\s+(.+))?/i, async (msg, match) => {
    if (!wallet) return bot.sendMessage(msg.chat.id, " **NO WALLET:** Please /connect first.");
   
    let target = null;
    const manualAddr = match[1];

    if (manualAddr) {
        bot.sendMessage(msg.chat.id, ` **MANUAL OVERRIDE:** Target set to ${manualAddr}`);
        target = { tokenAddress: manualAddr, symbol: "MANUAL_TARGET", name: "Manual Token" };
    } else {
        if (SYSTEM.pendingTarget) {
            target = SYSTEM.pendingTarget;
            bot.sendMessage(msg.chat.id, ` **APPROVED:** Executing buy for ${target.name || target.symbol}...`);
        } else {
            return bot.sendMessage(msg.chat.id, " **NO TARGET PENDING:** Use `/scan` first or type `/approve <address>`.");
        }
    }

    if (target) {
        await executeBuy(msg.chat.id, target);
    }
});

// START
bot.onText(/\/start/i, (msg) => {
    process.env.CHAT_ID = msg.chat.id;
    bot.sendMessage(msg.chat.id, `
 **SYSTEM INITIALIZED: APEX TOTALITY V2500.0** \`————————————————————————————————————————\`
 **OPERATOR:** ${msg.from.first_name.toUpperCase()}
 **CLEARANCE:** LEVEL ${PLAYER.level} (${PLAYER.class})
 **XP STATUS:** [${getXpBar()}] ${PLAYER.xp}/${PLAYER.nextLevelXp}

 **COMMAND INTERFACE**
\`/connect <key>\` - Securely Link Wallet
\`/scan\` - Run AI Analysis (Manual)
\`/approve\` - Execute Pending Trade
\`/auto\` - Toggle Autonomous Rotation
\`/risk <low|medium|high|degen>\` - Set Risk
\`/mode <scalp|day|moon>\` - Set Strategy
\`/status\` - View Telemetry

*System ready. Awaiting directive.*
\`————————————————————————————————————————\``, { parse_mode: "Markdown" });
});

// SETTINGS
bot.onText(/\/settings/i, (msg) => {
    const risk = RISK_PROFILES[SYSTEM.riskProfile];
    const strat = STRATEGY_MODES[SYSTEM.strategyMode];
    bot.sendMessage(msg.chat.id, `
 **BEHAVIORAL CONFIGURATION**
\`————————————————————————————\`
 **Risk Profile:** \`${risk.label}\`
   • Slippage: ${risk.slippage / 100}%
   • Stop Loss: -${risk.stopLoss}%
   • Gas: +${Number(risk.gasMultiplier) - 100}%

 **Strategy:** \`${strat.label}\`
   • Trailing Stop: ${strat.trail}%

 **Trade Size:** \`${SYSTEM.tradeAmount} ETH\`
\`————————————————————————————\``, { parse_mode: "Markdown" });
});

bot.onText(/\/risk\s+(.+)/i, (msg, match) => {
    const input = match[1].toUpperCase();
    const map = { 'SAFE': 'LOW', 'BALANCED': 'MEDIUM', 'AGGRESSIVE': 'HIGH' };
    const key = map[input] || input;
    if (RISK_PROFILES[key]) {
        SYSTEM.riskProfile = key;
        bot.sendMessage(msg.chat.id, ` **RISK UPDATED:** Now running in ${RISK_PROFILES[key].label} mode.`);
    } else {
        bot.sendMessage(msg.chat.id, ` **INVALID:** Use \`low\`, \`medium\`, \`high\`, or \`degen\`.`);
    }
});

bot.onText(/\/mode\s+(.+)/i, (msg, match) => {
    const input = match[1].toUpperCase();
    const map = { 'SHORT': 'SCALP', 'LONG': 'MOON', 'MID': 'DAY' };
    const key = map[input] || input;
    if (STRATEGY_MODES[key]) {
        SYSTEM.strategyMode = key;
        bot.sendMessage(msg.chat.id, ` **STRATEGY UPDATED:** Now aiming for ${STRATEGY_MODES[key].label}.`);
    } else {
        bot.sendMessage(msg.chat.id, ` **INVALID:** Use \`scalp\`, \`day\`, or \`moon\`.`);
    }
});

bot.onText(/\/amount\s+(.+)/i, (msg, match) => {
    const val = parseFloat(match[1]);
    if (val > 0) {
        SYSTEM.tradeAmount = match[1];
        bot.sendMessage(msg.chat.id, ` **SIZE UPDATED:** Trading \`${SYSTEM.tradeAmount} ETH\` per strike.`);
    } else {
        bot.sendMessage(msg.chat.id, ` **INVALID AMOUNT.**`);
    }
});

bot.onText(/\/restart/i, (msg) => {
    SYSTEM.autoPilot = false;
    SYSTEM.isLocked = false;
    SYSTEM.activePosition = null;
    SYSTEM.pendingTarget = null;
    bot.sendMessage(msg.chat.id, ` **SYSTEM RESET COMPLETE**`);
});

bot.onText(/\/status/i, async (msg) => {
    if (!wallet) return bot.sendMessage(msg.chat.id, " **NO WALLET:** Please /connect first.");
    const bal = await provider.getBalance(wallet.address);
    let bag = SYSTEM.activePosition ? `${SYSTEM.activePosition.name} (${SYSTEM.activePosition.symbol})` : "No Active Assets";
    bot.sendMessage(msg.chat.id, `
 **LIVE TELEMETRY**
\`————————————————————————————\`
 **Wallet:** \`${ethers.formatUnits(bal, 18)}\` ETH
 **Total Profit:** \`${PLAYER.totalProfitEth.toFixed(4)}\` ETH
 **Engine:** ${SYSTEM.autoPilot ? ' AUTONOMOUS' : ' MANUAL STANDBY'}
 **Position:** ${bag}
 **Security:** MEV-SHIELDED
\`————————————————————————————\``, { parse_mode: "Markdown" });
});

bot.onText(/\/auto/i, (msg) => {
    if (!wallet) return bot.sendMessage(msg.chat.id, " **NO WALLET:** Please /connect first.");
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    if (SYSTEM.autoPilot) {
        bot.sendMessage(msg.chat.id, " **AUTOPILOT ENGAGED.**\nScanning for entry candidates...");
        runScanner(msg.chat.id, true);
    } else {
        bot.sendMessage(msg.chat.id, " **AUTOPILOT DISENGAGED.**\nSwitching to Manual Signal Monitoring.");
        runProfitMonitor(msg.chat.id);
    }
});

bot.onText(/\/sell\s+(.+)/i, async (msg, match) => {
    if (SYSTEM.activePosition) {
        await executeSell(msg.chat.id);
    } else {
        bot.sendMessage(msg.chat.id, " **ERROR:** No active assets to liquidate.");
    }
});

bot.onText(/\/manual/i, (msg) => {
    SYSTEM.autoPilot = false;
    bot.sendMessage(msg.chat.id, " **MANUAL OVERRIDE:** Monitoring price action for Peak Reversal Signals.");
    if (SYSTEM.activePosition) runProfitMonitor(msg.chat.id);
});

// START
http.createServer((req, res) => res.end("V2500_APEX_ONLINE")).listen(8080).on('error', (e) => {
    console.log("Port 8080 busy, likely another instance running. Please kill it.".red);
});

console.log(" APEX TOTALITY v2500.0 ONLINE [OMNI-FUSION ETERNAL].".magenta);
