/**
 * ===============================================================================
 * 🦁 APEX PREDATOR: OMEGA TOTALITY v3000.0 [STABLE RELEASE]
 * ===============================================================================
 * FIXES:
 * 1. AUTO-PILOT: Full loop logic (Scan -> Buy -> Monitor -> Sell -> Repeat).
 * 2. COMMANDS: /buy and /sell now context-aware (no address entry needed).
 * 3. BUNDLE FIX: Priority fees optimized for "Block Winning."
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const { FlashbotsBundleProvider, FlashbotsBundleResolution } = require('@flashbots/ethers-provider-bundle');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- CONFIG ---
const { TELEGRAM_TOKEN, PRIVATE_KEY, RPC_URL, CHAT_ID } = process.env;
const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; 
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// --- PROVIDERS ---
const provider = new JsonRpcProvider(RPC_URL || "https://rpc.ankr.com/eth");
let wallet, router, flashbotsProvider, bot;

// --- SYSTEM STATE ---
let SYSTEM = {
    autoPilot: false,
    state: "HUNTING",      // HUNTING, MONITORING, EXECUTING
    pendingTarget: null,   // Target address from /scan
    activePosition: null,  // Data of the token currently held
    tradeAmount: "0.02",   // Default ETH size
    scannedTokens: new Set(),
    config: { trailingStop: 10, stopLoss: 15, minLiquidity: 30000 }
};

// ==========================================
// 1. ATOMIC EXECUTION CORE (WIN THE BLOCK)
// ==========================================

async function executeStrike(type, tokenAddress, amountInEth) {
    if (!wallet || !flashbotsProvider) return false;
    SYSTEM.state = "EXECUTING";

    const blockNumber = await provider.getBlockNumber();
    let txRequest;

    try {
        if (type === "BUY") {
            const amountIn = ethers.parseUnits(amountInEth.toString(), 18);
            const amounts = await router.getAmountsOut(amountIn, [WETH, tokenAddress]);
            const minOut = (amounts[1] * 90n) / 100n; // 10% Slippage
            
            txRequest = await router.swapExactETHForTokens.populateTransaction(
                minOut, [WETH, tokenAddress], wallet.address, Math.floor(Date.now()/1000)+120,
                { value: amountIn }
            );
        } else {
            const tokenContract = new Contract(tokenAddress, ["function approve(address, uint) returns (bool)", "function balanceOf(address) view returns (uint)"], wallet);
            const bal = await tokenContract.balanceOf(wallet.address);
            if (bal === 0n) return false;

            // Bundle Approval + Sell for absolute speed
            const approveTx = await tokenContract.approve.populateTransaction(ROUTER_ADDR, bal);
            const sellTx = await router.swapExactTokensForETH.populateTransaction(
                bal, 0n, [tokenAddress, WETH], wallet.address, Math.floor(Date.now()/1000)+120
            );
            
            // For Sell, we send a bundle of 2 transactions
            return await sendFlashbotsBundle([approveTx, sellTx], blockNumber);
        }

        return await sendFlashbotsBundle([txRequest], blockNumber, type, tokenAddress, amountInEth);

    } catch (e) {
        console.log(`[STRIKE ERROR] ${e.message}`.red);
        SYSTEM.state = (type === "BUY") ? "HUNTING" : "MONITORING";
        return false;
    }
}

async function sendFlashbotsBundle(txs, blockNumber, type, addr, amt) {
    const nonce = await provider.getTransactionCount(wallet.address);
    const feeData = await provider.getFeeData();
    
    // Predatory Bribing: 2.5x the current priority fee
    const priorityFee = (feeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei")) * 25n / 10n;
    const maxFee = (feeData.maxFeePerGas || ethers.parseUnits("20", "gwei")) + priorityFee;

    const bundle = [];
    for (let i = 0; i < txs.length; i++) {
        const signed = await wallet.signTransaction({
            ...txs[i],
            type: 2, chainId: 1, nonce: nonce + i,
            maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee, gasLimit: 400000
        });
        bundle.push({ signedTransaction: signed });
    }

    const sim = await flashbotsProvider.simulate(bundle, blockNumber + 1);
    if ("error" in sim || sim.firstRevert) return false;

    const res = await flashbotsProvider.sendBundle(bundle, blockNumber + 1);
    const wait = await res.wait();

    if (wait === FlashbotsBundleResolution.BundleIncluded) {
        if (type === "BUY") {
            SYSTEM.activePosition = { address: addr, entry: amt, highWaterMark: amt };
            SYSTEM.state = "MONITORING";
        } else {
            SYSTEM.activePosition = null;
            SYSTEM.state = "HUNTING";
        }
        return true;
    }
    return false;
}

// ==========================================
// 2. AUTO-PILOT STATE MACHINE
// ==========================================

async function autoPilotLoop() {
    if (!SYSTEM.autoPilot) return setTimeout(autoPilotLoop, 2000);

    // PHASE 1: SCANNING/HUNTING
    if (SYSTEM.state === "HUNTING" && !SYSTEM.activePosition) {
        try {
            const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
            const target = res.data.find(t => !SYSTEM.scannedTokens.has(t.tokenAddress));
            
            if (target) {
                const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${target.tokenAddress}`);
                const pair = details.data.pairs?.[0];
                
                if (pair && pair.liquidity.usd > SYSTEM.config.minLiquidity) {
                    SYSTEM.scannedTokens.add(target.tokenAddress);
                    bot.sendMessage(CHAT_ID, `🎯 **AUTO-BUY:** ${pair.baseToken.symbol} - Liquidity: $${pair.liquidity.usd}`);
                    await executeStrike("BUY", target.tokenAddress, SYSTEM.tradeAmount);
                }
            }
        } catch (e) {}
    }

    // PHASE 2: MONITORING/PROFIT TAKING
    if (SYSTEM.state === "MONITORING" && SYSTEM.activePosition) {
        try {
            const pos = SYSTEM.activePosition;
            const amounts = await router.getAmountsOut(ethers.parseEther("1"), [pos.address, WETH]);
            const currentEth = parseFloat(ethers.formatEther(amounts[1]));
            
            if (currentEth > pos.highWaterMark) pos.highWaterMark = currentEth;
            const drop = ((pos.highWaterMark - currentEth) / pos.highWaterMark) * 100;

            if (drop >= SYSTEM.config.trailingStop) {
                bot.sendMessage(CHAT_ID, `📉 **AUTO-SELL:** Trailing stop hit at ${drop.toFixed(2)}% drop.`);
                await executeStrike("SELL", pos.address, "0");
            }
        } catch (e) {}
    }

    setTimeout(autoPilotLoop, 4000);
}

// ==========================================
// 3. INTEGRATED COMMAND HANDLERS
// ==========================================

async function startBot() {
    wallet = new Wallet(PRIVATE_KEY, provider);
    flashbotsProvider = await FlashbotsBundleProvider.create(provider, Wallet.createRandom());
    router = new Contract(ROUTER_ADDR, [
        "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
        "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])",
        "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"
    ], wallet);

    bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

    bot.onText(/\/scan/, async (msg) => {
        bot.sendMessage(msg.chat.id, "🦅 **SCANNING...**");
        const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
        SYSTEM.pendingTarget = res.data[0].tokenAddress;
        bot.sendMessage(msg.chat.id, `🎯 **LOCKED:** \`${SYSTEM.pendingTarget}\` \nType **/buy** to execute.`);
    });

    bot.onText(/\/buy/, async (msg) => {
        if (!SYSTEM.pendingTarget) return bot.sendMessage(msg.chat.id, "❌ Run /scan first.");
        const success = await executeStrike("BUY", SYSTEM.pendingTarget, SYSTEM.tradeAmount);
        if (success) bot.sendMessage(msg.chat.id, "✅ Buy Mined via Flashbots.");
    });

    bot.onText(/\/sell/, async (msg) => {
        if (!SYSTEM.activePosition) return bot.sendMessage(msg.chat.id, "❌ No position to sell.");
        const success = await executeStrike("SELL", SYSTEM.activePosition.address, "0");
        if (success) bot.sendMessage(msg.chat.id, "✅ Sold Position.");
    });

    bot.onText(/\/auto/, (msg) => {
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        bot.sendMessage(msg.chat.id, `🤖 **AUTO-PILOT:** ${SYSTEM.autoPilot ? 'ENABLED' : 'DISABLED'}`);
    });

    autoPilotLoop();
}

startBot();
http.createServer((req, res) => res.end("APEX")).listen(8080);
