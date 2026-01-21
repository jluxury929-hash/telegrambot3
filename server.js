/**
 * ===============================================================================
 * 🦍 APEX PREDATOR: OMEGA TOTALITY v100000.0 (DYNAMIC PEAK & MEV SHIELD)
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
require('colors');

// --- CONFIGURATION ---
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; 

// 🛡️ MEV-SHIELDED CLUSTER POOL
// Routes directly to block builders. Bots cannot sandwich what they cannot see.
const RPC_POOL = [
    "https://rpc.mevblocker.io",        // Primary: Anti-Sandwich + Rebates
    "https://rpc.flashbots.net/fast",   // Secondary: Aggressive Private Inclusion
    "https://eth.llamarpc.com"          // Fallback: Public High-Performance
];

const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Initialize Provider (Static Network for Speed)
const network = ethers.Network.from(1); 
let provider = new JsonRpcProvider(RPC_POOL[0], network, { staticNetwork: network });
let wallet = new Wallet(PRIVATE_KEY, provider);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Prevent Polling Errors from Crashing Bot
bot.on('polling_error', (error) => console.log(`[POLLING ERROR] ${error.code}`.red));

let router = new Contract(ROUTER_ADDR, [
    "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
    "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])",
    "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"
], wallet);

const SYSTEM = {
    autoPilot: false,
    isLocked: false,
    nonce: null,
    tradeAmount: "0.01",   // ETH Amount to trade
    slippage: 50,          // 0.5% (Tight for Max Profit)
    minGasBuffer: ethers.parseEther("0.008"),
    trailingStopPercent: 5, // Sells if price drops 5% from its ABSOLUTE PEAK
    activePosition: null   // { address, symbol, entryPrice, amount, highestPriceSeen }
};

// ==========================================
// 🚀 1. SATURATION ENGINE (GUARANTEED CONFIRMATION)
// ==========================================

async function forceConfirm(chatId, type, tokenSym, txBuilder) {
    let attempt = 1;
    // Fresh Nonce Sync
    SYSTEM.nonce = await provider.getTransactionCount(wallet.address, "latest");

    const broadcast = async (bribe) => {
        const fee = await provider.getFeeData();
        const maxFee = (fee.maxFeePerGas || fee.gasPrice) + bribe;

        // Build Tx
        const txReq = await txBuilder(bribe, maxFee, SYSTEM.nonce);
        const signedTx = await wallet.signTransaction(txReq);

        // 📡 CLUSTER SATURATION: Blast to all private nodes simultaneously
        // This ensures if one node lags, the others pick it up.
        RPC_POOL.forEach(url => {
            axios.post(url, { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [signedTx] }).catch(() => {});
        });

        // Also broadcast via standard provider
        return await provider.broadcastTransaction(signedTx);
    };

    const initialBribe = (await provider.getFeeData()).maxPriorityFeePerGas * 150n / 100n;
    bot.sendMessage(chatId, `🛡️ **${type} ${tokenSym}:** Broadcasting via MEV-Shield Cluster...`);
    
    let tx = await broadcast(initialBribe);
    let currentBribe = initialBribe;

    // Recursive Confirmation Loop
    while (true) {
        try {
            const receipt = await Promise.race([
                tx.wait(1),
                new Promise((_, reject) => setTimeout(() => reject(new Error("STALL")), 12000))
            ]);

            if (receipt && receipt.status === 1n) {
                bot.sendMessage(chatId, `✅ **CONFIRMED:** ${type} ${tokenSym} Successful. Block: ${receipt.blockNumber}`);
                return receipt;
            }
        } catch (err) {
            if (attempt < 5) {
                attempt++;
                currentBribe = (currentBribe * 160n) / 100n; // +60% Gas Escalation
                bot.sendMessage(chatId, `🔄 **STALL:** Bumping gas to ${ethers.formatUnits(currentBribe, 'gwei')} Gwei...`);
                tx = await broadcast(currentBribe);
            } else {
                bot.sendMessage(chatId, `❌ **ABORT:** ${type} Failed. Network too congested.`);
                return null;
            }
        }
    }
}

// ==========================================
// 📉 2. DYNAMIC PEAK MONITOR (PROFIT MAXIMIZER)
// ==========================================

async function runProfitMonitor(chatId) {
    if (!SYSTEM.activePosition || SYSTEM.isLocked) return;
    SYSTEM.isLocked = true;

    try {
        const { address, amount, entryPrice, highestPriceSeen, symbol } = SYSTEM.activePosition;
        
        // Check current value in ETH
        const amounts = await router.getAmountsOut(amount, [address, WETH]);
        const currentEthValue = amounts[1];
        
        const currentPriceFloat = parseFloat(ethers.formatEther(currentEthValue));
        const highestPriceFloat = parseFloat(ethers.formatEther(highestPriceSeen));

        // 1. UPDATE PEAK: If new high, record it
        if (currentPriceFloat > highestPriceFloat) {
            SYSTEM.activePosition.highestPriceSeen = currentEthValue;
        }

        // 2. CALCULATE DRAWDOWN: How far have we fallen from the PEAK?
        const dropFromPeak = ((highestPriceFloat - currentPriceFloat) / highestPriceFloat) * 100;
        const totalProfit = ((currentPriceFloat - parseFloat(ethers.formatEther(entryPrice))) / parseFloat(ethers.formatEther(entryPrice))) * 100;

        // 3. DECISION LOGIC: Sell on Reversal (Trailing Stop)
        // If we have profit (>1%) AND price drops 5% from peak -> SELL
        if (dropFromPeak >= SYSTEM.trailingStopPercent && totalProfit > 1) {
            
            if (SYSTEM.autoPilot) {
                bot.sendMessage(chatId, `📉 **PEAK REVERSAL:** ${symbol} dropped ${dropFromPeak.toFixed(2)}% from top. Securing ${totalProfit.toFixed(2)}% profit.`);
                await executeSell(chatId);
            } else {
                // Manual Mode Notification
                bot.sendMessage(chatId, `⚠️ **PEAK SIGNAL:** ${symbol} reversed from top!\n💰 **Profit:** ${totalProfit.toFixed(2)}%\nType \`/sell ${symbol}\` NOW.`);
            }
        } 
        else if (totalProfit <= -15) {
            // Hard Stop Loss at -15%
             if (SYSTEM.autoPilot) {
                bot.sendMessage(chatId, `🛡️ **STOP LOSS:** ${symbol} down 15%. Exiting.`);
                await executeSell(chatId);
             }
        }

    } catch (e) { console.log(`[MONITOR] Tracking...`.gray); }
    finally {
        SYSTEM.isLocked = false;
        setTimeout(() => runProfitMonitor(chatId), 4000); // Check every 4s
    }
}

async function executeSell(chatId) {
    const { address, amount, symbol } = SYSTEM.activePosition;
    
    // 1. Approve
    const tokenContract = new Contract(address, ["function approve(address, uint) returns (bool)"], wallet);
    await (await tokenContract.approve(ROUTER_ADDR, amount)).wait();

    // 2. Sell with Saturation
    const receipt = await forceConfirm(chatId, "SELL", symbol, async (bribe, maxFee, nonce) => {
        return await router.swapExactTokensForETH.populateTransaction(
            amount, 0n, [address, WETH], wallet.address, Math.floor(Date.now()/1000)+120,
            { gasLimit: 450000, maxPriorityFeePerGas: bribe, maxFeePerGas: maxFee, nonce: nonce }
        );
    });

    if (receipt) {
        SYSTEM.activePosition = null;
        // If in Auto Mode, immediately scan for next target
        if (SYSTEM.autoPilot) {
            bot.sendMessage(chatId, "♻️ **ROTATION:** Sell complete. Scanning for next alpha...");
            runScanner(chatId);
        }
    }
}

// ==========================================
// 🔭 3. SCANNER & ENTRY
// ==========================================

async function runScanner(chatId) {
    if (SYSTEM.activePosition) return; // Don't scan if we hold a bag

    try {
        const bal = await provider.getBalance(wallet.address);
        if (bal < SYSTEM.minGasBuffer) {
            bot.sendMessage(chatId, `🛑 **HALT:** Low Balance (${ethers.formatEther(bal)} ETH).`);
            SYSTEM.autoPilot = false;
            return;
        }

        // Fetch Trending Boosts
        const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
        const target = res.data ? res.data[0] : null;

        if (target) {
            const tradeValue = ethers.parseEther(SYSTEM.tradeAmount);
            const amounts = await router.getAmountsOut(tradeValue, [WETH, target.tokenAddress]);
            const minOut = (amounts[1] * BigInt(10000 - SYSTEM.slippage)) / 10000n;

            const receipt = await forceConfirm(chatId, "BUY", target.symbol, async (bribe, maxFee, nonce) => {
                return await router.swapExactETHForTokens.populateTransaction(
                    minOut, [WETH, target.tokenAddress], wallet.address, Math.floor(Date.now()/1000)+120,
                    { value: tradeValue, gasLimit: 400000, maxPriorityFeePerGas: bribe, maxFeePerGas: maxFee, nonce: nonce, type: 2 }
                );
            });

            if (receipt) {
                SYSTEM.activePosition = {
                    address: target.tokenAddress,
                    symbol: target.symbol,
                    entryPrice: tradeValue,
                    amount: minOut,
                    highestPriceSeen: tradeValue // Initialize peak at entry
                };
                runProfitMonitor(chatId); // Start tracking peak immediately
            }
        }
    } catch (e) { console.log(`[SCAN]`.gray); }
    finally {
        // Infinite Loop if in Auto Mode
        if (SYSTEM.autoPilot && !SYSTEM.activePosition) setTimeout(() => runScanner(chatId), 5000);
    }
}

// ==========================================
// 📊 COMMANDS & DASHBOARD
// ==========================================

bot.onText(/\/status/, async (msg) => {
    const bal = await provider.getBalance(wallet.address); // Live Balance Check
    let bag = SYSTEM.activePosition ? `${SYSTEM.activePosition.symbol}` : "None";
    bot.sendMessage(msg.chat.id, `
🛡️ **OMEGA TOTALITY v100000**
---
💰 **Exact Balance:** \`${ethers.formatUnits(bal, 18)}\` ETH
🤖 **Mode:** ${SYSTEM.autoPilot ? '🟢 AUTO-PILOT' : '🔴 MANUAL'}
💼 **Holding:** ${bag}
⚡ **MEV Shield:** ACTIVE
    `, { parse_mode: "Markdown" });
});

bot.onText(/\/auto/, (msg) => {
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    if (SYSTEM.autoPilot) {
        bot.sendMessage(msg.chat.id, "🚀 **AUTOPILOT ENGAGED.**\nLogic: Buy -> Track Peak -> Sell on Reversal -> Rotate.");
        runScanner(msg.chat.id);
    } else {
        bot.sendMessage(msg.chat.id, "🛑 **AUTOPILOT OFF.** Switching to Manual Signal Mode.");
        runProfitMonitor(msg.chat.id); // Continue monitoring existing bags
    }
});

bot.onText(/\/snipe/, (msg) => {
    bot.sendMessage(msg.chat.id, "⚡ **ONE-SHOT SNIPE:** Scanning for immediate entry...");
    let oldState = SYSTEM.autoPilot;
    SYSTEM.autoPilot = true; // Briefly enable to allow logic to run
    runScanner(msg.chat.id);
    SYSTEM.autoPilot = oldState; // Revert state
});

bot.onText(/\/sell (.+)/, async (msg, match) => {
    if (SYSTEM.activePosition) {
        await executeSell(msg.chat.id);
    } else {
        bot.sendMessage(msg.chat.id, "⚠️ No active position to sell.");
    }
});

bot.onText(/\/approve (.+)/, async (msg, match) => {
    // Manual buy command
    const targetAddr = match[1];
    const tradeValue = ethers.parseEther(SYSTEM.tradeAmount);
    
    // Quick buy logic for manual approve
    const receipt = await forceConfirm(msg.chat.id, "BUY", "MANUAL", async (bribe, maxFee, nonce) => {
         return await router.swapExactETHForTokens.populateTransaction(
             0n, [WETH, targetAddr], wallet.address, Math.floor(Date.now()/1000)+120,
             { value: tradeValue, gasLimit: 400000, maxPriorityFeePerGas: bribe, maxFeePerGas: maxFee, nonce: nonce, type: 2 }
         );
    });
    
    if (receipt) {
         bot.sendMessage(msg.chat.id, `✅ **MANUAL BUY COMPLETE**`);
    }
});

bot.onText(/\/manual/, (msg) => {
    SYSTEM.autoPilot = false;
    bot.sendMessage(msg.chat.id, "👀 **MANUAL MODE:** I will watch the charts. Wait for my 'PEAK REVERSAL' signal.");
    if (SYSTEM.activePosition) runProfitMonitor(msg.chat.id);
});

const http = require('http');
http.createServer((req, res) => res.end("V100000_APEX")).listen(8080);
console.log("🦍 OMEGA TOTALITY v100000 ONLINE.".magenta);
