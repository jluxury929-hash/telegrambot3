/**
 * ===============================================================================
 * 🦁 APEX PREDATOR: OMEGA TOTALITY v3000.0 [STABLE FINAL - FIXED]
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
// Use Flashbots RPC as default fallback if Ankr is unauthorized
const { 
    TELEGRAM_TOKEN, 
    PRIVATE_KEY, 
    RPC_URL = "https://rpc.flashbots.net", 
    CHAT_ID 
} = process.env;

const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; 
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// --- PROVIDERS ---
let provider, wallet, router, flashbotsProvider, bot;

// --- SYSTEM STATE ---
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
        
        const priorityFee = (feeData.maxPriorityFeePerGas || 1500000000n) * 3n;
        const maxFee = (feeData.maxFeePerGas || 30000000000n) + priorityFee;

        let bundleTxs = [];

        if (type === "BUY") {
            const amountIn = ethers.parseEther(amountInEth.toString());
            const amounts = await router.getAmountsOut(amountIn, [WETH, tokenAddress]);
            const minOut = (amounts[1] * 90n) / 100n; 
            
            const buyTx = await router.swapExactETHForTokens.populateTransaction(
                minOut, [WETH, tokenAddress], wallet.address, Math.floor(Date.now()/1000)+120,
                { value: amountIn, gasLimit: 350000n }
            );

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

            const approveTx = await tokenContract.approve.populateTransaction(ROUTER_ADDR, bal, { gasLimit: 60000n });
            const signedApprove = await wallet.signTransaction({
                ...approveTx, type: 2, chainId: 1, nonce: nonce,
                maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee
            });

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

        const sim = await flashbotsProvider.simulate(bundleTxs, blockNumber + 1);
        if ("error" in sim || sim.firstRevert) {
            if(targetChatId) bot.sendMessage(targetChatId, `🛡 **ATOMIC SHIELD:** Simulation Reverted. Trade Aborted.`);
            throw new Error("Sim Revert");
        }

        const res = await flashbotsProvider.sendBundle(bundleTxs, blockNumber + 1);
        const wait = await res.wait();

        if (wait === FlashbotsBundleResolution.BundleIncluded) {
            if(targetChatId) bot.sendMessage(targetChatId, `🏆 **OBLITERATED:** Block Won!`);
            if (type === "BUY") {
                SYSTEM.activePosition = { address: tokenAddress, entry: amountInEth, highWaterMark: amountInEth };
                SYSTEM.state = "MONITORING";
            } else {
                SYSTEM.activePosition = null;
                SYSTEM.state = "HUNTING";
            }
            return true;
        }
        SYSTEM.state = originalState;
        return false;

    } catch (e) {
        console.log(`[EXEC ERROR] ${e.message}`.red);
        SYSTEM.state = originalState;
        return false;
    }
}

// ==========================================
// 2. INIT & START
// ==========================================

async function startBot() {
    try {
        console.log(`[SYSTEM] Initializing Provider: ${RPC_URL}`.yellow);
        provider = new JsonRpcProvider(RPC_URL);
        
        // Error handling for "Unauthorized" RPC
        try {
            await provider.getNetwork();
        } catch (e) {
            console.log("❌ RPC CONNECTION FAILED: Your RPC URL is unauthorized or incorrect.".bgRed);
            console.log("👉 Tip: Use 'https://rpc.flashbots.net' in your .env if Ankr fails.".yellow);
            process.exit(1);
        }

        wallet = new Wallet(PRIVATE_KEY, provider);
        flashbotsProvider = await FlashbotsBundleProvider.create(provider, Wallet.createRandom());
        
        router = new Contract(ROUTER_ADDR, [
            "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
            "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])",
            "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"
        ], wallet);

        bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

        // Command Listeners...
        bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "🦁 APEX ONLINE. /scan to start."));
        
        bot.onText(/\/scan/, async (msg) => {
            try {
                const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
                SYSTEM.pendingTarget = res.data[0].tokenAddress;
                bot.sendMessage(msg.chat.id, `🎯 LOCKED: \`${SYSTEM.pendingTarget}\` \nType /buy to engage.`);
            } catch (e) { bot.sendMessage(msg.chat.id, "❌ API error."); }
        });

        bot.onText(/\/buy/, async (msg) => {
            if (!SYSTEM.pendingTarget) return bot.sendMessage(msg.chat.id, "❌ Run /scan.");
            await executeStrike("BUY", SYSTEM.pendingTarget, SYSTEM.tradeAmount, msg.chat.id);
        });

        bot.onText(/\/sell/, async (msg) => {
            if (!SYSTEM.activePosition) return bot.sendMessage(msg.chat.id, "❌ Empty.");
            await executeStrike("SELL", SYSTEM.activePosition.address, "0", msg.chat.id);
        });

        console.log("🦁 APEX v3000 STABLE ONLINE".magenta);

    } catch (e) {
        console.log(`[STARTUP ERROR] ${e.message}`.red);
    }
}

startBot();
http.createServer((req, res) => res.end("APEX_ALIVE")).listen(8080);
