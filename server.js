/**
 * ===============================================================================
 * 🦁 APEX PREDATOR: OMEGA TOTALITY v3000.0 [STABLE FINAL]
 * ===============================================================================
 * 1. FIXED: Ethers v6 read-only transaction object overrides.
 * 2. FIXED: Concurrent Nonce management for Sell Bundles.
 * 3. FIXED: Autonomous State Machine logic for zero-latency rotation.
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

let SYSTEM = {
    autoPilot: false,
    state: "HUNTING",      
    pendingTarget: null,   
    activePosition: null,  
    tradeAmount: "0.02",   
    scannedTokens: new Set(),
    config: { trailingStop: 10, stopLoss: 15, minLiquidity: 30000 }
};

// ==========================================
// 1. ATOMIC EXECUTION CORE
// ==========================================

async function executeStrike(type, tokenAddress, amountInEth, targetChatId) {
    if (!wallet || !flashbotsProvider) return false;
    const originalState = SYSTEM.state;
    SYSTEM.state = "EXECUTING";

    try {
        const blockNumber = await provider.getBlockNumber();
        const nonce = await provider.getTransactionCount(wallet.address, "latest");
        const feeData = await provider.getFeeData();
        
        // Predatory Bribing: High priority for Flashbots builders
        const priorityFee = (feeData.maxPriorityFeePerGas || 1500000000n) * 3n;
        const maxFee = (feeData.maxFeePerGas || 30000000000n) + priorityFee;

        let bundleTxs = [];

        if (type === "BUY") {
            const amountIn = ethers.parseEther(amountInEth.toString());
            const amounts = await router.getAmountsOut(amountIn, [WETH, tokenAddress]);
            const minOut = (amounts[1] * 90n) / 100n; // 10% Slippage
            
            const buyTx = await router.swapExactETHForTokens.populateTransaction(
                minOut, [WETH, tokenAddress], wallet.address, Math.floor(Date.now()/1000)+120,
                { value: amountIn, gasLimit: 350000n }
            );

            // Correctly format for signing in v6
            const signedBuy = await wallet.signTransaction({
                ...buyTx,
                type: 2, chainId: 1, nonce: nonce,
                maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee
            });
            bundleTxs.push({ signedTransaction: signedBuy });

        } else {
            const tokenContract = new Contract(tokenAddress, [
                "function approve(address, uint) returns (bool)", 
                "function balanceOf(address) view returns (uint)"
            ], wallet);
            const bal = await tokenContract.balanceOf(wallet.address);
            if (bal === 0n) throw new Error("Zero Balance");

            // Bundle 1: Approve
            const approveTx = await tokenContract.approve.populateTransaction(ROUTER_ADDR, bal, { gasLimit: 60000n });
            const signedApprove = await wallet.signTransaction({
                ...approveTx, type: 2, chainId: 1, nonce: nonce,
                maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee
            });

            // Bundle 2: Sell
            const sellTx = await router.swapExactTokensForETH.populateTransaction(
                bal, 0n, [tokenAddress, WETH], wallet.address, Math.floor(Date.now()/1000)+120, 
                { gasLimit: 350000n }
            );
            const signedSell = await wallet.signTransaction({
                ...sellTx, type: 2, chainId: 1, nonce: nonce + 1n,
                maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee
            });

            bundleTxs.push({ signedTransaction: signedApprove }, { signedTransaction: signedSell });
        }

        // SIMULATE
        const sim = await flashbotsProvider.simulate(bundleTxs, blockNumber + 1);
        if ("error" in sim || sim.firstRevert) {
            if(targetChatId) bot.sendMessage(targetChatId, `🛡 **ATOMIC SHIELD:** Trade unsafe. Aborted. $0 spent.`);
            throw new Error("Sim Revert");
        }

        // EXECUTE
        const res = await flashbotsProvider.sendBundle(bundleTxs, blockNumber + 1);
        const wait = await res.wait();

        if (wait === FlashbotsBundleResolution.BundleIncluded) {
            if(targetChatId) bot.sendMessage(targetChatId, `🏆 **OBLITERATED:** ${type} mined! Block ${blockNumber + 1}.`);
            if (type === "BUY") {
                SYSTEM.activePosition = { address: tokenAddress, entry: amountInEth, highWaterMark: amountInEth };
                SYSTEM.state = "MONITORING";
            } else {
                SYSTEM.activePosition = null;
                SYSTEM.state = "HUNTING";
            }
            return true;
        } else {
            SYSTEM.state = originalState;
            return false;
        }

    } catch (e) {
        console.log(`[EXEC ERROR] ${e.message}`.red);
        SYSTEM.state = originalState;
        return false;
    }
}

// ==========================================
// 2. LOOPS
// ==========================================

async function coreLoop() {
    if (SYSTEM.autoPilot) {
        if (SYSTEM.state === "HUNTING" && !SYSTEM.activePosition) {
            try {
                const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
                const target = res.data.find(t => !SYSTEM.scannedTokens.has(t.tokenAddress));
                if (target) {
                    const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${target.tokenAddress}`);
                    const pair = details.data.pairs?.[0];
                    if (pair && pair.liquidity.usd > SYSTEM.config.minLiquidity) {
                        SYSTEM.scannedTokens.add(target.tokenAddress);
                        await executeStrike("BUY", target.tokenAddress, SYSTEM.tradeAmount, CHAT_ID);
                    }
                }
            } catch (e) {}
        }
        if (SYSTEM.state === "MONITORING" && SYSTEM.activePosition) {
            try {
                const pos = SYSTEM.activePosition;
                // GetPrice: Use a small amount to check output
                const checkAmt = ethers.parseEther("1");
                const amounts = await router.getAmountsOut(checkAmt, [pos.address, WETH]);
                const currentEth = parseFloat(ethers.formatEther(amounts[1]));
                
                if (currentEth > pos.highWaterMark) pos.highWaterMark = currentEth;
                const drop = ((pos.highWaterMark - currentEth) / pos.highWaterMark) * 100;

                if (drop >= SYSTEM.config.trailingStop) {
                    await executeStrike("SELL", pos.address, "0", CHAT_ID);
                }
            } catch (e) {}
        }
    }
    setTimeout(coreLoop, 3000);
}

// ==========================================
// 3. INIT & COMMANDS
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
        try {
            const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
            SYSTEM.pendingTarget = res.data[0].tokenAddress;
            bot.sendMessage(msg.chat.id, `🎯 **LOCKED:** \`${SYSTEM.pendingTarget}\` \nType **/buy** to engage.`);
        } catch (e) { bot.sendMessage(msg.chat.id, "❌ API error."); }
    });

    bot.onText(/\/buy/, async (msg) => {
        if (!SYSTEM.pendingTarget) return bot.sendMessage(msg.chat.id, "❌ Run /scan.");
        await executeStrike("BUY", SYSTEM.pendingTarget, SYSTEM.tradeAmount, msg.chat.id);
    });

    bot.onText(/\/sell/, async (msg) => {
        if (!SYSTEM.activePosition) return bot.sendMessage(msg.chat.id, "❌ Empty position.");
        await executeStrike("SELL", SYSTEM.activePosition.address, "0", msg.chat.id);
    });

    bot.onText(/\/auto/, (msg) => {
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        bot.sendMessage(msg.chat.id, `🤖 **AUTO-PILOT:** ${SYSTEM.autoPilot ? 'ENABLED' : 'DISABLED'}`);
    });

    console.log("🦁 APEX v3000 STABLE ONLINE".magenta);
    coreLoop();
}

startBot();
http.createServer((req, res) => res.end("APEX_RUNNING")).listen(8080);
