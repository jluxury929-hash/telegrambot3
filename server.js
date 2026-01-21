/**
 * ===============================================================================
 * 🦍 APEX PREDATOR: OMEGA TOTALITY v42500.0 (CLEAN ALERTS & FIXES)
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const axios = require('axios');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
require('colors');

const TELEGRAM_TOKEN = "7903779688:AAGFMT3fWaYgc9vKBhxNQRIdB5AhmX0U9Nw";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_POOL = ["https://rpc.mevblocker.io", "https://eth.llamarpc.com"];

const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

let rpcIdx = 0;
let provider = new JsonRpcProvider(RPC_POOL[rpcIdx]);
let wallet = new Wallet(PRIVATE_KEY, provider);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

let router = new Contract(ROUTER_ADDR, [
    "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
    "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"
], wallet);

const SYSTEM = {
    autoPilot: false,
    isLocked: false,
    nonce: null,
    tradeAmount: "0.01",
    mode: "FIXED", 
    risk: 0.90,
    minGasBuffer: ethers.parseEther("0.006"),
    lastScannedAddress: null // Prevents spamming the same coin
};

// ==========================================
// 🛡️ SHIELD: FIXING UNDEFINED & HONEYPOTS
// ==========================================

async function simulateTrade(tokenAddress, tradeValue) {
    if (!tokenAddress || !ethers.isAddress(tokenAddress)) return false;
    try {
        const pathBuy = [WETH, tokenAddress];
        const pathSell = [tokenAddress, WETH];
        const deadline = Math.floor(Date.now() / 1000) + 60;

        await router.swapExactETHForTokens.staticCall(
            0, pathBuy, wallet.address, deadline, 
            { value: tradeValue }
        );

        const amounts = await router.getAmountsOut(ethers.parseUnits("1", 18), pathSell);
        return amounts[1] > 0n; 
    } catch (e) {
        return false; 
    }
}

// ==========================================
// 🚀 THE ESCALATOR (REMAINING THE SAME)
// ==========================================

async function forceConfirm(chatId, tokenSym, txParams) {
    let currentBribe = txParams.initialBribe;
    const broadcast = async (bribe) => {
        const fee = await provider.getFeeData();
        return await router.swapExactETHForTokens(0, txParams.path, wallet.address, txParams.deadline, {
            value: txParams.value,
            gasLimit: 350000,
            maxPriorityFeePerGas: bribe,
            maxFeePerGas: (fee.maxFeePerGas || fee.gasPrice) + bribe,
            nonce: SYSTEM.nonce
        });
    };

    bot.sendMessage(chatId, `🚀 **APPROVED.** Executing Strike for ${tokenSym}...`);
    let tx = await broadcast(currentBribe);
    bot.sendMessage(chatId, `📡 **STRIKE 1 [BROADCASTED]:** ${tokenSym}\n[Etherscan](https://etherscan.io/tx/${tx.hash})`, { parse_mode: "Markdown" });

    const receipt = await tx.wait(1);
    if (receipt && receipt.status === 1n) {
        bot.sendMessage(chatId, `✅ **STRIKE CONFIRMED.**`);
    }
}

// ==========================================
// 5. AUTOPILOT: FIXING SPAM & UNDEFINED
// ==========================================

async function runAutopilotCycle(chatId) {
    if (!SYSTEM.autoPilot || SYSTEM.isLocked) return;
    SYSTEM.isLocked = true;

    try {
        const bal = await provider.getBalance(wallet.address);
        let tradeValue = SYSTEM.mode === "FIXED" 
            ? ethers.parseEther(SYSTEM.tradeAmount) 
            : (bal - SYSTEM.minGasBuffer) * BigInt(Math.floor(SYSTEM.risk * 100)) / 100n;

        // 1. Fetch Trending
        const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
        const target = res.data ? res.data[0] : null;

        // 2. DATA VALIDATION (Fixes "Simulating Undefined")
        if (!target || !target.tokenAddress || !target.symbol) {
            console.log("[SCAN] No valid targets found. Standing by...".gray);
            return; 
        }

        // 3. SPAM PREVENTION (Don't alert for the same coin twice)
        if (target.tokenAddress === SYSTEM.lastScannedAddress) return;
        SYSTEM.lastScannedAddress = target.tokenAddress;

        // 4. SHIELD TEST
        const isSafe = await simulateTrade(target.tokenAddress, tradeValue);

        if (!isSafe) {
            // Log to console instead of spamming Telegram if a coin is unsafe
            console.log(`[SHIELD] Skipped Honeypot: ${target.symbol}`.red);
        } else {
            // 5. EXECUTE ONLY IF SAFE
            SYSTEM.nonce = await provider.getTransactionCount(wallet.address, "latest");
            const fee = await provider.getFeeData();
            const txParams = {
                path: [WETH, target.tokenAddress],
                deadline: Math.floor(Date.now() / 1000) + 60,
                value: tradeValue,
                initialBribe: (fee.maxPriorityFeePerGas * 150n) / 100n
            };
            await forceConfirm(chatId, target.symbol, txParams);
        }
    } catch (e) {
        console.log(`[ERROR] Cycle stalled.`.gray);
    } finally {
        SYSTEM.isLocked = false;
        if (SYSTEM.autoPilot) setTimeout(() => runAutopilotCycle(chatId), 15000);
    }
}

// ==========================================
// 6. MASTER TOGGLE
// ==========================================

bot.onText(/\/auto/, (msg) => {
    const chatId = msg.chat.id;
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    
    if (SYSTEM.autoPilot) {
        bot.sendMessage(chatId, `🚀 **OMEGA TOTALITY: ON**\n\n*Scanning for safe, high-volume breakouts...*`);
        runAutopilotCycle(chatId);
    } else {
        bot.sendMessage(chatId, "🛑 **OMEGA TOTALITY: OFF**");
    }
});

bot.onText(/\/status/, async (msg) => {
    const bal = await provider.getBalance(wallet.address);
    bot.sendMessage(msg.chat.id, `🛡️ **SYSTEM v42500**\nBalance: ${parseFloat(ethers.formatEther(bal)).toFixed(4)} ETH\nAutopilot: ${SYSTEM.autoPilot ? '🟢' : '🔴'}`);
});

http.createServer((req, res) => res.end("V42500_RUNNING")).listen(8080);
console.log("🦍 OMEGA TOTALITY v42500 ONLINE.".magenta);
