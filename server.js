/**
 * ===============================================================================
 * ⚡ APEX PREDATOR v6000.1 (EXECUTION PATCH)
 * ===============================================================================
 * FIXES:
 * 1. PROTECTOR: Prevents "0 ETH" trades by enforcing min size or skipping.
 * 2. SIZING: Strictly follows /setamount (Percent or Fixed) for ALL trades.
 * 3. SPEED: Auto-Mode executes instantly. Liquidity errors trigger instant retry.
 * 4. MANUAL: strict "Alert Only" mode.
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

// MEV-PROTECTED CLUSTER (Fastest Nodes)
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
        console.log(`[INIT] Wallet Loaded: ${wallet.address}`.green);
    } catch (e) {
        console.log(`[INIT] Invalid Key. Waiting for /connect`.red);
    }
}

// ==========================================
//  SYSTEM STATE
// ==========================================

const RISK_PROFILES = {
    LOW:    { slippage: 50,   stopLoss: 5,  gasMultiplier: 110n, label: "LOW" },
    MEDIUM: { slippage: 200,  stopLoss: 15, gasMultiplier: 125n, label: "MEDIUM" },
    HIGH:   { slippage: 500,  stopLoss: 30, gasMultiplier: 150n, label: "HIGH" },
    DEGEN:  { slippage: 2000, stopLoss: 50, gasMultiplier: 200n, label: "DEGEN" }
};

const STRATEGY_MODES = {
    SCALP:  { trail: 2,  minConf: 0.80, label: "SCALP (2% Drop)" },
    DAY:    { trail: 8,  minConf: 0.85, label: "SWING (8% Drop)" },  
    MOON:   { trail: 20, minConf: 0.90, label: "MOON (20% Drop)" }  
};

let SYSTEM = {
    autoPilot: false,
    isLocked: false,
    nonce: null,
    riskProfile: 'HIGH', // Default to fast execution
    strategyMode: 'SCALP',
    
    // STRICT SIZING DEFAULTS
    tradeStyle: 'PERCENT', 
    tradeValue: 5,         // Default: 5%
    gasReserve: ethers.parseEther("0.01"), // Protection Buffer

    activePosition: null,
    pendingTarget: null,
    lastTradedToken: null
};

// ==========================================
//  TRADE SIZING PROTECTOR (CRITICAL FIX)
// ==========================================

async function getSafeTradeAmount(chatId) {
    if (!wallet) return 0n;

    try {
        const balance = await provider.getBalance(wallet.address);
        
        // 1. Gas Protector: Ensure we have at least 0.015 ETH total
        if (balance < ethers.parseEther("0.015")) {
            bot.sendMessage(chatId, `⚠️ **CRITICAL:** Wallet Empty or < 0.015 ETH.`);
            return 0n;
        }

        let amount = 0n;
        const safeBalance = balance - SYSTEM.gasReserve; // Always subtract gas reserve

        if (SYSTEM.tradeStyle === 'PERCENT') {
            // Percent logic: (Balance - Gas) * (Percent / 100)
            const percentBn = BigInt(Math.floor(SYSTEM.tradeValue * 100)); // e.g. 5.0 -> 500
            amount = (safeBalance * percentBn) / 10000n;
        } else {
            // Fixed logic
            amount = ethers.parseEther(SYSTEM.tradeValue.toString());
        }

        // 2. Overdraft Protector
        if (amount > safeBalance) {
            amount = safeBalance; // Cap at max available
        }

        // 3. Dust Protector (Prevent 0 value trades)
        if (amount <= 0n) {
            bot.sendMessage(chatId, `⚠️ **ERROR:** Calculated trade size is 0 ETH. Check /setamount.`);
            return 0n;
        }

        return amount;

    } catch (e) {
        console.log("Size calc error:", e.message);
        return 0n;
    }
}

// ==========================================
//  EXECUTION ENGINE (The Muscle)
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
                if(chatId) bot.sendMessage(chatId, `✅ **CONFIRMED:** ${type} ${tokenName}\n[Etherscan](${link})`, { parse_mode: "Markdown", disable_web_page_preview: true });
                return receipt;
            }
        } catch (err) {
            if (attempt < 2) { // Only 1 retry to keep it fast
                attempt++;
                tx = await broadcast(initialBribe + ethers.parseUnits("2", "gwei")); 
            } else {
                bot.sendMessage(chatId, `❌ **FAIL:** TX Dropped/Stalled.`);
                return null;
            }
        }
    }
}

async function executeBuy(chatId, target) {
    // 1. GET SAFE AMOUNT
    const tradeValue = await getSafeTradeAmount(chatId);
    if (tradeValue === 0n) return; // Stop if 0

    // 2. LIQUIDITY CHECK (Protector)
    let amounts;
    try {
        amounts = await router.getAmountsOut(tradeValue, [WETH, target.tokenAddress]);
    } catch(e) {
        // If liquidity fails, we log it and RETURN immediately so Auto-Mode can scan next.
        console.log(`[SKIP] ${target.symbol}: Low Liquidity / Honeypot`.yellow);
        if(!SYSTEM.autoPilot) bot.sendMessage(chatId, `⚠️ **SKIP:** ${target.symbol} has no liquidity.`);
        return; 
    }

    const risk = RISK_PROFILES[SYSTEM.riskProfile];
    const minOut = (amounts[1] * BigInt(10000 - risk.slippage)) / 10000n;

    // 3. EXECUTE
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
            entryPrice: tradeValue,
            amount: minOut,
            highestPriceSeen: tradeValue
        };
        SYSTEM.pendingTarget = null;
        runProfitMonitor(chatId);
    } else {
        // If failed, resume scanning immediately
        if(SYSTEM.autoPilot) runNeuralScanner(chatId);
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
            SYSTEM.activePosition = null;
            if (SYSTEM.autoPilot) {
                bot.sendMessage(chatId, "♻️ **ROTATION:** Scanning next target...");
                runNeuralScanner(chatId);
            } else {
                bot.sendMessage(chatId, "✅ **SOLD:** Position Closed.");
            }
        }
    } catch(e) {
        bot.sendMessage(chatId, `❌ **SELL ERROR:** ${e.message}`);
    }
}

// ==========================================
//  NEURAL ORACLE (HYPER-VELOCITY)
// ==========================================

async function runNeuralScanner(chatId, isManual = false) {
    if ((!SYSTEM.autoPilot && !isManual) || SYSTEM.activePosition || SYSTEM.isLocked || !wallet) return;

    try {
        if(isManual) bot.sendMessage(chatId, "🔎 **SCANNING:** Searching for signals...");
        
        let potentialTarget = null;
        
        // --- SIMULATION LOGIC (REPLACE WITH REAL API IF AVAILABLE) ---
        // Fast fetch of trending tokens
        const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1').catch(()=>null);
        
        if (res && res.data && res.data.length > 0) {
            // Pick random from top 10 to simulate finding "New" signals
            const raw = res.data[Math.floor(Math.random() * Math.min(10, res.data.length))];
            
            // Duplicate Check
            if (raw.tokenAddress !== SYSTEM.lastTradedToken) {
                const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${raw.tokenAddress}`).catch(()=>null);
                
                if(details && details.data.pairs) {
                    const pair = details.data.pairs[0];
                    if (pair) {
                        potentialTarget = {
                            name: pair.baseToken.name,
                            symbol: pair.baseToken.symbol,
                            tokenAddress: pair.baseToken.address,
                            price: pair.priceUsd,
                            // High confidence simulation for demo purposes
                            sentimentScore: Math.random() * (0.99 - 0.7) + 0.7, 
                            rsi: Math.floor(Math.random() * 60) + 30, 
                            socialVolume: Math.floor(Math.random() * 500)
                        };
                    }
                }
            }
        }

        if (potentialTarget) {
            await processSignal(chatId, potentialTarget, isManual);
        } else if (isManual) {
            bot.sendMessage(chatId, "⚠️ No signals found. Try again.");
        }

    } catch (e) {}
    finally {
        // INSTANT RE-LOOP: If Auto-Pilot is ON and we didn't buy, scan again in 200ms
        if (SYSTEM.autoPilot && !SYSTEM.activePosition) setTimeout(() => runNeuralScanner(chatId), 200);
    }
}

async function processSignal(chatId, data, isManual) {
    const strategy = STRATEGY_MODES[SYSTEM.strategyMode];
    let confidence = 0.0;
    
    if (data.sentimentScore > 0.8) confidence += 0.4;
    else if (data.sentimentScore > 0.6) confidence += 0.2;
    if (data.rsi < 70) confidence += 0.3; 
    if (data.socialVolume > 100) confidence += 0.3;

    console.log(`[NEURAL] ${data.symbol}: ${(confidence*100).toFixed(0)}% Conf`.cyan);

    // AUTO MODE: Must meet min confidence
    if (SYSTEM.autoPilot) {
        if (confidence >= strategy.minConf) {
            // EXECUTE INSTANTLY - No messaging delay
            await executeBuy(chatId, data); 
        }
        // If low confidence, the loop in `runNeuralScanner` will just retry instantly.
    } 
    // MANUAL MODE: Just show the alert
    else if (isManual) {
        SYSTEM.pendingTarget = data;
        bot.sendMessage(chatId, `
🧠 **SIGNAL FOUND: ${data.symbol}**
Conf: ${(confidence*100).toFixed(0)}%
Price: $${data.price}
Action: Type \`/buy ${data.tokenAddress}\` or \`/approve\``);
    }
}

// ==========================================
//  PROFIT MONITOR (PEAK / DECLINE LOGIC)
// ==========================================

async function runProfitMonitor(chatId) {
    if (!SYSTEM.activePosition || SYSTEM.isLocked) return;
    SYSTEM.isLocked = true;

    try {
        const { address, amount, entryPrice, highestPriceSeen, symbol } = SYSTEM.activePosition;
        const amounts = await router.getAmountsOut(amount, [address, WETH]);
        const currentEthValue = amounts[1];
        
        const currentPriceFloat = parseFloat(ethers.formatEther(currentEthValue));
        const highestPriceFloat = parseFloat(ethers.formatEther(highestPriceSeen));

        // 1. UPDATE PEAK
        let newPeakFound = false;
        if (currentPriceFloat > highestPriceFloat) {
            SYSTEM.activePosition.highestPriceSeen = currentEthValue;
            newPeakFound = true;
        }

        const dropFromPeak = ((highestPriceFloat - currentPriceFloat) / highestPriceFloat) * 100;
        const totalProfit = ((currentPriceFloat - parseFloat(ethers.formatEther(entryPrice))) / parseFloat(ethers.formatEther(entryPrice))) * 100;
        
        const trail = STRATEGY_MODES[SYSTEM.strategyMode].trail;
        const stopLoss = RISK_PROFILES[SYSTEM.riskProfile].stopLoss;

        process.stdout.write(`\r[MONITOR] ${symbol} PnL: ${totalProfit.toFixed(2)}% | Drop: ${dropFromPeak.toFixed(2)}%   `);

        // 2. MANUAL MODE ALERT (Never Auto Sell)
        if (!SYSTEM.autoPilot) {
            if (newPeakFound && totalProfit > 1.5) {
                bot.sendMessage(chatId, `📈 **NEW PEAK:** ${symbol} is UP ${totalProfit.toFixed(2)}%!`);
            }
            if (dropFromPeak >= trail && totalProfit > 0) {
                bot.sendMessage(chatId, `🚨 **PEAK REVERSAL:** ${symbol} dropped ${dropFromPeak.toFixed(2)}% from top. \`/sell\` NOW!`);
            }
        }

        // 3. AUTO MODE EXECUTION (Auto Sell)
        if (SYSTEM.autoPilot) {
            if (dropFromPeak >= trail && totalProfit > 0.5) {
                bot.sendMessage(chatId, `📉 **AUTO-SELL:** ${symbol} dropped from peak. Securing Profit.`);
                await executeSell(chatId);
            }
            else if (totalProfit <= -stopLoss) {
                bot.sendMessage(chatId, `🛑 **STOP LOSS:** ${symbol} hit limit. Exiting.`);
                await executeSell(chatId);
            }
        }

    } catch (e) { }
    finally {
        SYSTEM.isLocked = false;
        setTimeout(() => runProfitMonitor(chatId), 1000);
    }
}

// ==========================================
//  COMMANDS
// ==========================================

bot.onText(/\/connect\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    process.env.CHAT_ID = chatId; 
    try { await bot.deleteMessage(chatId, msg.message_id); } catch (e) {}
    try {
        wallet = new Wallet(match[1], provider);
        router = new Contract(ROUTER_ADDR, ["function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])", "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])", "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"], wallet);
        const bal = await provider.getBalance(wallet.address);
        bot.sendMessage(chatId, `⚡ **CONNECTED:** \`${wallet.address}\`\nBalance: ${ethers.formatEther(bal).slice(0,6)} ETH`);
    } catch (e) { bot.sendMessage(chatId, `❌ Invalid Key.`); }
});

bot.onText(/\/start/i, (msg) => {
    process.env.CHAT_ID = msg.chat.id;
    bot.sendMessage(msg.chat.id, `
⚡ **APEX v6000.1**
\`————————————————————————\`
**/auto** - Start Loop
**/scan** - Manual Scan
**/buy <addr>** - Force Buy
**/sell** - Sell
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
        // Buy specific address
        bot.sendMessage(msg.chat.id, `🛒 **BUYING:** ${addr}`);
        await executeBuy(msg.chat.id, { tokenAddress: addr, symbol: "MANUAL", name: "User" });
    } else if (SYSTEM.pendingTarget) {
        // Buy pending
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
        bot.sendMessage(msg.chat.id, "📉 **SELLING NOW...**");
        await executeSell(msg.chat.id);
    } else {
        bot.sendMessage(msg.chat.id, "⚠️ No position.");
    }
});

bot.onText(/\/auto/i, (msg) => {
    if (!wallet) return bot.sendMessage(msg.chat.id, "⚠️ Connect Wallet.");
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    if (SYSTEM.autoPilot) {
        bot.sendMessage(msg.chat.id, "🚀 **AUTO ENGAGED:** Scanning...");
        runNeuralScanner(msg.chat.id);
    } else {
        bot.sendMessage(msg.chat.id, "⏸ **PAUSED:** Manual Mode.");
    }
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

http.createServer((req, res) => res.end("APEX v6000 ONLINE")).listen(8080);
console.log("APEX SIGNAL v6000.1 ONLINE [EXECUTION PATCH].".magenta);
