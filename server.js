/**
 * ===============================================================================
 * 🦁 APEX PREDATOR v7000.1 (OMNI-HYBRID EDITION)
 * ===============================================================================
 * 1. OMNI-FILTER: Strictly filters for Ethereum chain tokens (Fixes Liquidity Errors).
 * 2. HYBRID EXIT: Manual buys (/buy) are automatically sold at peak decline.
 * 3. HONEYPOT GUARD: Skips tokens with 0 sells.
 * 4. FULL SUITE: Includes /manual, /scan, /buy, /sell, /setamount.
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
    polling: { interval: 100, autoStart: true, params: { timeout: 10 } }
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
//  SYSTEM STATE
// ==========================================

const RISK_PROFILES = {
    LOW:    { slippage: 50,   stopLoss: 5,  gasMultiplier: 110n, label: " LOW (Safe)" },
    MEDIUM: { slippage: 200,  stopLoss: 15, gasMultiplier: 125n, label: " MEDIUM (Balanced)" },
    HIGH:   { slippage: 500,  stopLoss: 30, gasMultiplier: 150n, label: " HIGH (Aggressive)" },
    DEGEN:  { slippage: 2000, stopLoss: 60, gasMultiplier: 200n, label: " DEGEN (YOLO)" }
};

const STRATEGY_MODES = {
    SCALP:  { trail: 3,  minConf: 0.80, label: " SCALP (Sell on 3% Drop)" },
    DAY:    { trail: 8,  minConf: 0.85, label: " SWING (Sell on 8% Drop)" },  
    MOON:   { trail: 20, minConf: 0.90, label: " MOON (Sell on 20% Drop)" }  
};

// RPG System
let PLAYER = {
    level: 1, xp: 0, nextLevelXp: 1000, class: "DATA ANALYST",
    totalProfitEth: 0.0
};

const addXP = (amount, chatId) => {
    PLAYER.xp += amount;
    if (PLAYER.xp >= PLAYER.nextLevelXp) {
        PLAYER.level++;
        PLAYER.xp -= PLAYER.nextLevelXp;
        PLAYER.nextLevelXp = Math.floor(PLAYER.nextLevelXp * 1.5);
        if(chatId) bot.sendMessage(chatId, `🧠 **PROMOTION:** Level ${PLAYER.level}`);
    }
};

const getXpBar = () => {
    const p = Math.min(Math.round((PLAYER.xp / PLAYER.nextLevelXp) * 10), 10);
    return "🟦".repeat(p) + "⬜".repeat(10 - p);
};

let SYSTEM = {
    autoPilot: false,
    isLocked: false,
    nonce: null,
    riskProfile: 'MEDIUM',
    strategyMode: 'SCALP',
    
    // Trade Sizing
    tradeStyle: 'PERCENT', 
    tradeValue: 5,         
    gasReserve: ethers.parseEther("0.003"), // Low reserve

    activePosition: null,
    pendingTarget: null,
    lastTradedToken: null
};

// ==========================================
//  TRADE SIZING PROTECTOR
// ==========================================

async function getSafeTradeAmount(chatId) {
    if (!wallet) return 0n;

    try {
        const balance = await provider.getBalance(wallet.address);
        
        if (balance <= SYSTEM.gasReserve) {
            bot.sendMessage(chatId, `⚠️ **LOW FUNDS:** Balance (${ethers.formatEther(balance)}) is below gas reserve.`);
            return 0n;
        }

        let amount = 0n;
        const safeBalance = balance - SYSTEM.gasReserve; 

        if (SYSTEM.tradeStyle === 'PERCENT') {
            const percentBn = BigInt(Math.floor(SYSTEM.tradeValue * 100)); 
            amount = (safeBalance * percentBn) / 10000n;
        } else {
            amount = ethers.parseEther(SYSTEM.tradeValue.toString());
        }

        if (amount > safeBalance) amount = safeBalance; 

        if (amount <= 0n) {
            return 0n;
        }

        return amount;

    } catch (e) { return 0n; }
}

// ==========================================
//  EXECUTION SHIELD
// ==========================================

async function forceConfirm(chatId, type, tokenName, txBuilder) {
    let attempt = 1;
    SYSTEM.nonce = await provider.getTransactionCount(wallet.address, "latest");
    const risk = RISK_PROFILES[SYSTEM.riskProfile];

    const broadcast = async (bribe) => {
        const fee = await provider.getFeeData();
        const maxFee = (fee.maxFeePerGas || fee.gasPrice) + bribe;
        const txReq = await txBuilder(bribe, maxFee, SYSTEM.nonce);
        return await wallet.sendTransaction(txReq); 
    };

    const baseFee = (await provider.getFeeData()).maxPriorityFeePerGas || ethers.parseUnits("2", "gwei");
    const initialBribe = (baseFee * risk.gasMultiplier) / 100n; 

    if(chatId) bot.sendMessage(chatId, `🚀 **${type} ${tokenName}:** Broadcasting...`);
    
    let tx = await broadcast(initialBribe);

    while (true) {
        try {
            const receipt = await Promise.race([
                tx.wait(1),
                new Promise((_, reject) => setTimeout(() => reject(new Error("STALL")), 10000))
            ]);

            if (receipt && receipt.status === 1) {
                const link = `https://etherscan.io/tx/${receipt.hash}`;
                if(chatId) bot.sendMessage(chatId, `✅ **CONFIRMED:** ${type} ${tokenName}\n[View on Etherscan](${link})`, { parse_mode: "Markdown", disable_web_page_preview: true });
                
                if (type === "SELL") addXP(500, chatId);
                else addXP(100, chatId);
                return receipt;
            }
        } catch (err) {
            if (attempt < 2) { 
                attempt++;
                tx = await broadcast(initialBribe + ethers.parseUnits("3", "gwei")); 
            } else {
                bot.sendMessage(chatId, `❌ **FAIL:** TX Dropped.`);
                return null;
            }
        }
    }
}

// ==========================================
//  NEURAL ORACLE (OMNI-CHAIN FILTER)
// ==========================================

async function runNeuralScanner(chatId, isManual = false) {
    if ((!SYSTEM.autoPilot && !isManual) || SYSTEM.activePosition || SYSTEM.isLocked || !wallet) return;

    try {
        if(isManual) bot.sendMessage(chatId, "🔭 **MANUAL SCAN:** Filtering Ethereum chain...");
        
        let potentialTarget = null;
        
        // --- DEXSCREENER FETCH ---
        const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1').catch(()=>null);
        
        if (res && res.data && res.data.length > 0) {
            // Loop through up to 20 results to find a valid one
            for (let i = 0; i < Math.min(20, res.data.length); i++) {
                const raw = res.data[i];
                
                // 1. FILTER: Must be on Ethereum
                if (raw.chainId !== 'ethereum') continue;

                // 2. FILTER: Don't rebuy same token
                if (raw.tokenAddress === SYSTEM.lastTradedToken) continue;

                // 3. ENRICH DATA
                const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${raw.tokenAddress}`).catch(()=>null);
                if(details && details.data.pairs) {
                    const pair = details.data.pairs[0];
                    if (pair) {
                        // 4. FILTER: Minimum Liquidity $1,000
                        if (pair.liquidity && pair.liquidity.usd < 1000) continue;

                        // 5. FILTER: Honeypot Check (Must have Sells)
                        if (pair.txns && pair.txns.h24.buys > 10 && pair.txns.h24.sells === 0) {
                            console.log(`[HONEYPOT] Skipped ${pair.baseToken.symbol}`);
                            continue;
                        }

                        // VALID TARGET FOUND
                        potentialTarget = {
                            name: pair.baseToken.name,
                            symbol: pair.baseToken.symbol,
                            tokenAddress: pair.baseToken.address,
                            price: pair.priceUsd,
                            sentimentScore: 0.85, 
                            rsi: 50,
                            socialVolume: 500
                        };
                        break; // Exit loop, we found a target
                    }
                }
            }
        }

        if (potentialTarget) {
            await processSignal(chatId, potentialTarget, isManual);
        } else if (isManual) {
            bot.sendMessage(chatId, "⚠️ No valid ETH tokens found. Retrying...");
        }

    } catch (e) {}
    finally {
        // INSTANT RE-LOOP: 100ms delay
        if (SYSTEM.autoPilot && !SYSTEM.activePosition) setTimeout(() => runNeuralScanner(chatId), 100);
    }
}

async function processSignal(chatId, data, isManual) {
    const strategy = STRATEGY_MODES[SYSTEM.strategyMode];
    let confidence = 0.9; 

    console.log(`[NEURAL] ${data.symbol}: Found`.cyan);

    if (SYSTEM.autoPilot) {
        if (confidence >= strategy.minConf) {
            await executeBuy(chatId, data); 
        }
    } 
    else if (isManual) {
        SYSTEM.pendingTarget = data;
        bot.sendMessage(chatId, `
🧠 **SIGNAL FOUND: ${data.symbol}**
Price: $${data.price}
Action: Type \`/buy ${data.tokenAddress}\` or \`/approve\``);
    }
}

async function executeBuy(chatId, target) {
    const tradeValue = await getSafeTradeAmount(chatId);
    if (tradeValue === 0n) return; 

    let amounts;
    try {
        amounts = await router.getAmountsOut(tradeValue, [WETH, target.tokenAddress]);
    } catch(e) {
        console.log(`[SKIP] ${target.symbol}: Router Revert`.yellow);
        return; 
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
        // HYBRID EXIT: Manual buys trigger Auto-Monitor
        runProfitMonitor(chatId); 
    }
}

// ==========================================
//  PROFIT MONITOR (HYBRID EXIT LOGIC)
// ==========================================

async function runProfitMonitor(chatId) {
    if (!SYSTEM.activePosition || SYSTEM.isLocked || !wallet) return;
    SYSTEM.isLocked = true;

    try {
        const { address, amount, entryPrice, highestPriceSeen, symbol } = SYSTEM.activePosition;
        const amounts = await router.getAmountsOut(amount, [address, WETH]);
        const currentEthValue = amounts[1];
        
        const currentPriceFloat = parseFloat(ethers.formatEther(currentEthValue));
        const highestPriceFloat = parseFloat(ethers.formatEther(highestPriceSeen));

        if (currentPriceFloat > highestPriceFloat) {
            SYSTEM.activePosition.highestPriceSeen = currentEthValue;
        }

        const dropFromPeak = ((highestPriceFloat - currentPriceFloat) / highestPriceFloat) * 100;
        const totalProfit = ((currentPriceFloat - parseFloat(ethers.formatEther(entryPrice))) / parseFloat(ethers.formatEther(entryPrice))) * 100;
        
        const trail = STRATEGY_MODES[SYSTEM.strategyMode].trail; 
        const stopLoss = RISK_PROFILES[SYSTEM.riskProfile].stopLoss;

        process.stdout.write(`\r[MONITOR] ${symbol} PnL: ${totalProfit.toFixed(2)}% | Drop: ${dropFromPeak.toFixed(2)}%   `);

        // HYBRID LOGIC: Auto-Sell applies to BOTH Manual and Auto modes
        if (dropFromPeak >= trail && totalProfit > 0.5) {
            bot.sendMessage(chatId, `📉 **PEAK REVERSAL:** ${symbol} dropped ${dropFromPeak.toFixed(2)}% from top. Auto-Selling.`);
            await executeSell(chatId);
        }
        else if (totalProfit <= -stopLoss) {
             bot.sendMessage(chatId, `🛑 **STOP LOSS:** ${symbol} hit -${stopLoss}%. Auto-Selling.`);
             await executeSell(chatId);
        }

    } catch (e) { }
    finally {
        SYSTEM.isLocked = false;
        setTimeout(() => runProfitMonitor(chatId), 1000);
    }
}

async function executeSell(chatId) {
    if (!wallet || !SYSTEM.activePosition) return;
    const { address, amount, symbol } = SYSTEM.activePosition;
    
    try {
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
                bot.sendMessage(chatId, "♻️ **ROTATION:** Scanning next target...");
                runNeuralScanner(chatId);
            } else {
                 bot.sendMessage(chatId, "✅ **SOLD:** Manual position closed automatically.");
            }
        }
    } catch(e) {
        bot.sendMessage(chatId, `❌ **SELL ERROR:** ${e.message}`);
    }
}

// ==========================================
//  COMMAND INTERFACE
// ==========================================

bot.onText(/\/connect\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    process.env.CHAT_ID = chatId; 
    try { await bot.deleteMessage(chatId, msg.message_id); } catch (e) {}
    try {
        wallet = new Wallet(match[1], provider);
        router = new Contract(ROUTER_ADDR, ["function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])", "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])", "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"], wallet);
        const bal = await provider.getBalance(wallet.address);
        bot.sendMessage(chatId, `🧠 **CONNECTED:** \`${wallet.address}\`\nBalance: ${ethers.formatEther(bal).slice(0,6)} ETH`);
    } catch (e) { bot.sendMessage(chatId, `❌ Invalid Key.`); }
});

bot.onText(/\/start/i, (msg) => {
    process.env.CHAT_ID = msg.chat.id;
    bot.sendMessage(msg.chat.id, `
⚡ **APEX v7000.1 (OMNI-HYBRID)**
\`————————————————————————\`
**/auto** - Start Auto-Trading
**/manual** - Stop Auto, Enable Hybrid
**/scan** - Manual Search
**/buy <addr>** - Force Buy
**/sell** - Panic Sell
**/setamount 5%** - Set Size
**/status** - View
\`————————————————————————\``, { parse_mode: "Markdown" });
});

bot.onText(/\/setamount\s+(.+)/i, (msg, match) => {
    const input = match[1].trim();
    if (input.endsWith('%')) {
        SYSTEM.tradeStyle = 'PERCENT';
        SYSTEM.tradeValue = parseFloat(input.replace('%', ''));
        bot.sendMessage(msg.chat.id, `⚖️ **SIZING:** ${SYSTEM.tradeValue}% of Wallet`);
    } else {
        SYSTEM.tradeStyle = 'FIXED';
        SYSTEM.tradeValue = parseFloat(input);
        bot.sendMessage(msg.chat.id, `⚖️ **SIZING:** ${SYSTEM.tradeValue} ETH Fixed`);
    }
});

bot.onText(/\/scan/i, (msg) => {
    if (!wallet) return bot.sendMessage(msg.chat.id, "⚠️ Connect Wallet.");
    runNeuralScanner(msg.chat.id, true);
});

bot.onText(/\/buy(?:\s+(.+))?/i, async (msg, match) => {
    if (!wallet) return bot.sendMessage(msg.chat.id, "⚠️ Connect Wallet.");
    const addr = match[1];
    
    if(addr) {
        bot.sendMessage(msg.chat.id, `🛒 **MANUAL ENTRY:** Buying ${addr}. Auto-Exit engaged.`);
        await executeBuy(msg.chat.id, { tokenAddress: addr, symbol: "MANUAL", name: "User" });
    } else if (SYSTEM.pendingTarget) {
        bot.sendMessage(msg.chat.id, `👍 **APPROVED:** Buying ${SYSTEM.pendingTarget.symbol}`);
        await executeBuy(msg.chat.id, SYSTEM.pendingTarget);
    } else {
        bot.sendMessage(msg.chat.id, "⚠️ No target. Use `/buy <address>`");
    }
});

bot.onText(/\/approve/i, async (msg) => {
    if (SYSTEM.pendingTarget) {
        bot.sendMessage(msg.chat.id, `👍 **APPROVED:** Buying ${SYSTEM.pendingTarget.symbol}`);
        await executeBuy(msg.chat.id, SYSTEM.pendingTarget);
    } else {
        bot.sendMessage(msg.chat.id, "⚠️ No pending signal.");
    }
});

bot.onText(/\/sell/i, async (msg) => {
    if (SYSTEM.activePosition) {
        bot.sendMessage(msg.chat.id, "📉 **PANIC SELL!**");
        await executeSell(msg.chat.id);
    } else {
        bot.sendMessage(msg.chat.id, "⚠️ No position.");
    }
});

bot.onText(/\/auto/i, (msg) => {
    if (!wallet) return bot.sendMessage(msg.chat.id, "⚠️ Connect Wallet.");
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    if (SYSTEM.autoPilot) {
        bot.sendMessage(msg.chat.id, "🚀 **AUTO ENGAGED:** Scanning ETH Tokens...");
        runNeuralScanner(msg.chat.id);
    } else {
        bot.sendMessage(msg.chat.id, "⏸ **PAUSED:** Manual Mode.");
    }
});

bot.onText(/\/manual/i, (msg) => {
    if (!wallet) return bot.sendMessage(msg.chat.id, "⚠️ Connect Wallet.");
    SYSTEM.autoPilot = false;
    bot.sendMessage(msg.chat.id, "✋ **MANUAL MODE:** Auto-buying disabled. Auto-Selling ENABLED.");
});

bot.onText(/\/status/i, async (msg) => {
    if (!wallet) return bot.sendMessage(msg.chat.id, "⚠️ Connect Wallet.");
    const bal = await provider.getBalance(wallet.address);
    let pos = SYSTEM.activePosition ? `${SYSTEM.activePosition.symbol}` : "Idle";
    bot.sendMessage(msg.chat.id, `
📊 **STATUS**
**Profit:** ${PLAYER.totalProfitEth.toFixed(4)} ETH
**Size:** ${SYSTEM.tradeValue}${SYSTEM.tradeStyle === 'PERCENT' ? '%' : ' ETH'}
**Mode:** ${SYSTEM.autoPilot ? '🚀 AUTO' : '🔴 MANUAL'}
**Pos:** ${pos}`, { parse_mode: "Markdown" });
});

bot.onText(/\/settings/i, (msg) => {
    const risk = RISK_PROFILES[SYSTEM.riskProfile];
    const strat = STRATEGY_MODES[SYSTEM.strategyMode];
    bot.sendMessage(msg.chat.id, `⚙️ **CONFIG:** ${risk.label} | ${strat.label}`, { parse_mode: "Markdown" });
});

bot.onText(/\/risk\s+(.+)/i, (msg, match) => {
    const input = match[1].toUpperCase();
    const map = { 'SAFE': 'LOW', 'BALANCED': 'MEDIUM', 'AGGRESSIVE': 'HIGH', 'DEGEN': 'DEGEN' };
    const key = map[input] || input;
    if (RISK_PROFILES[key]) { SYSTEM.riskProfile = key; bot.sendMessage(msg.chat.id, `🛡 **RISK:** ${RISK_PROFILES[key].label}`); }
});

bot.onText(/\/mode\s+(.+)/i, (msg, match) => {
    const key = match[1].toUpperCase();
    const map = { 'SHORT': 'SCALP', 'LONG': 'MOON', 'MID': 'DAY' };
    const finalKey = map[key] || key;
    if (STRATEGY_MODES[finalKey]) { SYSTEM.strategyMode = finalKey; bot.sendMessage(msg.chat.id, `🔄 **STRATEGY:** ${STRATEGY_MODES[finalKey].label}`); }
});

bot.onText(/\/amount\s+(.+)/i, (msg, match) => {
    const val = parseFloat(match[1]);
    if (val > 0) { SYSTEM.tradeStyle='FIXED'; SYSTEM.tradeValue=val; bot.sendMessage(msg.chat.id, `💰 **SIZE:** ${val} ETH`); }
});

bot.onText(/\/restart/i, (msg) => {
    SYSTEM.autoPilot = false; SYSTEM.isLocked = false; SYSTEM.activePosition = null; SYSTEM.pendingTarget = null;
    bot.sendMessage(msg.chat.id, `🔄 **RESET**`);
});

http.createServer((req, res) => res.end("APEX v7000 ONLINE")).listen(8080);
console.log("APEX SIGNAL v7000.1 ONLINE [OMNI-HYBRID].".magenta);
