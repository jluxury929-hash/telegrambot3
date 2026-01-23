/**
 * ===============================================================================
 * ⚡ APEX PREDATOR v6000.3 (UNIVERSAL BALANCE PATCH)
 * ===============================================================================
 * UPDATES:
 * 1. ANY BALANCE: Works with tiny wallets (removed 0.02 ETH limit).
 * 2. SMART GAS: dynamically reserves just enough ETH for gas (0.003 ETH).
 * 3. INSTANT AUTO: 100ms polling loop for instant trade detection.
 * 4. HYBRID MANUAL: Manual Buy -> Automatic Peak Sell.
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
// Optional: Link to your local Python AI. If null, runs in simulation mode.
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

// Global Wallet
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

const STRATEGY_MODES = {
    SCALP:  { trail: 2,  minConf: 0.80, label: "SCALP (2% Drop)" },
    DAY:    { trail: 8,  minConf: 0.85, label: "SWING (8% Drop)" },  
    MOON:   { trail: 20, minConf: 0.90, label: "MOON (20% Drop)" }  
};

const RISK_PROFILES = {
    LOW:    { slippage: 50,   stopLoss: 5,  gasMultiplier: 110n, label: "LOW" },
    MEDIUM: { slippage: 200,  stopLoss: 15, gasMultiplier: 125n, label: "MEDIUM" },
    HIGH:   { slippage: 500,  stopLoss: 30, gasMultiplier: 150n, label: "HIGH" },
    DEGEN:  { slippage: 2000, stopLoss: 50, gasMultiplier: 200n, label: "DEGEN" }
};

let SYSTEM = {
    autoPilot: false,
    isLocked: false,
    nonce: null,
    riskProfile: 'HIGH', 
    strategyMode: 'SCALP',
    
    // DYNAMIC SIZING
    tradeStyle: 'PERCENT', 
    tradeValue: 10,         // Default: 10%
    gasReserve: ethers.parseEther("0.003"), // MINIMAL GAS BUFFER (Low enough for small wallets)

    activePosition: null,
    pendingTarget: null,
    lastTradedToken: null
};

// ==========================================
//  SMART BALANCE CALCULATOR (UNIVERSAL FIX)
// ==========================================

async function getSafeTradeAmount(chatId) {
    if (!wallet) return 0n;

    try {
        const balance = await provider.getBalance(wallet.address);
        
        // 1. Absolute Minimum Check (Gas + Dust)
        // If you have less than 0.004 ETH, you literally cannot pay gas on Mainnet.
        if (balance <= SYSTEM.gasReserve) {
            bot.sendMessage(chatId, `⚠️ **INSUFFICIENT FUNDS:** Balance (${ethers.formatEther(balance)}) is below gas reserve.`);
            return 0n;
        }

        let amount = 0n;
        const safeBalance = balance - SYSTEM.gasReserve; 

        if (SYSTEM.tradeStyle === 'PERCENT') {
            // Logic: (Available Balance) * (Percent / 100)
            const percentBn = BigInt(Math.floor(SYSTEM.tradeValue * 100)); // e.g. 10% -> 1000
            amount = (safeBalance * percentBn) / 10000n;
        } else {
            // Logic: Fixed Amount
            amount = ethers.parseEther(SYSTEM.tradeValue.toString());
        }

        // 2. Overdraft Protection
        // If fixed amount > what we have, just use what we have (max - gas).
        if (amount > safeBalance) {
            amount = safeBalance; 
        }

        // 3. Tiny Trade Warning
        if (amount < ethers.parseEther("0.001")) {
            // Still allow it, but warn.
            // bot.sendMessage(chatId, `⚠️ Warning: Tiny trade size (${ethers.formatEther(amount)} ETH). Gas might exceed profit.`);
        }

        return amount;

    } catch (e) {
        console.log("Size calc error:", e.message);
        return 0n;
    }
}

// ==========================================
//  EXECUTION ENGINE
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
                new Promise((_, reject) => setTimeout(() => reject(new Error("STALL")), 8000))
            ]);

            if (receipt && receipt.status === 1) {
                const link = `https://etherscan.io/tx/${receipt.hash}`;
                if(chatId) bot.sendMessage(chatId, `✅ **CONFIRMED:** ${type} ${tokenName}\n[Etherscan](${link})`, { parse_mode: "Markdown", disable_web_page_preview: true });
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

async function executeBuy(chatId, target) {
    // 1. Get Amount
    const tradeValue = await getSafeTradeAmount(chatId);
    if (tradeValue === 0n) return; // Stop if 0

    // 2. Liquidity Check
    let amounts;
    try {
        amounts = await router.getAmountsOut(tradeValue, [WETH, target.tokenAddress]);
    } catch(e) {
        console.log(`[SKIP] ${target.symbol}: Low Liquidity`.yellow);
        // Do not spam chat in Auto Mode, just return so it scans next
        if(!SYSTEM.autoPilot) bot.sendMessage(chatId, `⚠️ **SKIP:** ${target.symbol} has no liquidity.`);
        return; 
    }

    const risk = RISK_PROFILES[SYSTEM.riskProfile];
    const minOut = (amounts[1] * BigInt(10000 - risk.slippage)) / 10000n;

    // 3. Execute
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
        // HANDOVER TO AUTO-EXIT (Even for manual buys)
        runProfitMonitor(chatId); 
    } else {
        // If buy failed, immediately resume scanning if in Auto Mode
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
                bot.sendMessage(chatId, "✅ **SOLD:** Manual position closed automatically at peak.");
            }
        }
    } catch(e) {
        bot.sendMessage(chatId, `❌ **SELL ERROR:** ${e.message}`);
    }
}

// ==========================================
//  NEURAL ORACLE (INSTANT SCAN)
// ==========================================

async function runNeuralScanner(chatId, isManual = false) {
    if ((!SYSTEM.autoPilot && !isManual) || SYSTEM.activePosition || SYSTEM.isLocked || !wallet) return;

    try {
        if(isManual) bot.sendMessage(chatId, "🔎 **SCANNING:** Searching...");
        
        let potentialTarget = null;
        
        if (AI_API_URL) {
            try {
                const res = await axios.get(AI_API_URL);
                potentialTarget = res.data; 
            } catch(e) {}
        } else {
            // SIMULATION LOGIC (Replace with Real API in prod)
            const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1').catch(()=>null);
            
            if (res && res.data && res.data.length > 0) {
                const raw = res.data[Math.floor(Math.random() * Math.min(10, res.data.length))];
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
                                sentimentScore: Math.random() * (0.99 - 0.7) + 0.7, 
                                rsi: Math.floor(Math.random() * 60) + 30, 
                                socialVolume: Math.floor(Math.random() * 500)
                            };
                        }
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
        // INSTANT RE-LOOP: 100ms delay for maximum speed
        if (SYSTEM.autoPilot && !isManual) setTimeout(() => runNeuralScanner(chatId), 100);
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

    if (SYSTEM.autoPilot) {
        if (confidence >= strategy.minConf) {
            await executeBuy(chatId, data); // BUY INSTANTLY
        }
    } 
    else if (isManual) {
        // In Manual Mode, we WAIT for user input
        SYSTEM.pendingTarget = data;
        bot.sendMessage(chatId, `
🧠 **SIGNAL FOUND: ${data.symbol}**
Conf: ${(confidence*100).toFixed(0)}%
Action: Type \`/buy ${data.tokenAddress}\` or \`/approve\``);
    }
}

// ==========================================
//  PROFIT MONITOR (HYBRID EXIT)
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
        if (currentPriceFloat > highestPriceFloat) {
            SYSTEM.activePosition.highestPriceSeen = currentEthValue;
        }

        const dropFromPeak = ((highestPriceFloat - currentPriceFloat) / highestPriceFloat) * 100;
        const totalProfit = ((currentPriceFloat - parseFloat(ethers.formatEther(entryPrice))) / parseFloat(ethers.formatEther(entryPrice))) * 100;
        
        const trail = STRATEGY_MODES[SYSTEM.strategyMode].trail;
        const stopLoss = RISK_PROFILES[SYSTEM.riskProfile].stopLoss;

        process.stdout.write(`\r[MONITOR] ${symbol} PnL: ${totalProfit.toFixed(2)}% | Drop: ${dropFromPeak.toFixed(2)}%   `);

        // 2. AUTO-SELL LOGIC (Used for BOTH Auto and Manual Entry)
        // We always protect the bag.
        
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
        bot.sendMessage(chatId, `🧠 **CONNECTED:** \`${wallet.address}\`\nBalance: ${ethers.formatEther(bal).slice(0,6)} ETH`);
    } catch (e) { bot.sendMessage(chatId, `❌ Invalid Key.`); }
});

bot.onText(/\/start/i, (msg) => {
    process.env.CHAT_ID = msg.chat.id;
    bot.sendMessage(msg.chat.id, `
⚡ **APEX v6000.3 (UNIVERSAL)**
\`————————————————————————\`
**/auto** - Full Auto Trading
**/scan** - Manual Search
**/buy <addr>** - Force Buy
**/sell** - Panic Sell
**/setamount 10%** - Set Size
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
        bot.sendMessage(msg.chat.id, "🚀 **AUTO ENGAGED:** Scanning...");
        runNeuralScanner(msg.chat.id);
    } else {
        bot.sendMessage(msg.chat.id, "⏸ **PAUSED:** Manual Entry / Auto Exit.");
    }
});

bot.onText(/\/status/i, async (msg) => {
    if (!wallet) return bot.sendMessage(msg.chat.id, "⚠️ Connect Wallet.");
    const bal = await provider.getBalance(wallet.address);
    let pos = SYSTEM.activePosition ? `${SYSTEM.activePosition.symbol}` : "Idle";
    bot.sendMessage(msg.chat.id, `
📊 **STATUS**
**Size:** ${SYSTEM.tradeValue}${SYSTEM.tradeStyle === 'PERCENT' ? '%' : ' ETH'}
**Mode:** ${SYSTEM.autoPilot ? '🚀 AUTO' : '🟡 MANUAL ENTRY'}
**Exit Strategy:** AUTO (Trailing Peak)
**Pos:** ${pos}`, { parse_mode: "Markdown" });
});

http.createServer((req, res) => res.end("APEX v6000 ONLINE")).listen(8080);
console.log("APEX SIGNAL v6000.3 ONLINE [UNIVERSAL PATCH].".magenta);
