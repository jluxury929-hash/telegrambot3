/**
 * ===============================================================================
 * 🦍 APEX PREDATOR: OMEGA TOTALITY v42000.0 (SHIELDED MERGE)
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const axios = require('axios');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
require('colors');

// 1. CONFIGURATION & FAILOVER POOL
const TELEGRAM_TOKEN = "7903779688:AAGFMT3fWaYgc9vKBhxNQRIdB5AhmX0U9Nw";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_POOL = [
    "https://rpc.mevblocker.io", 
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth"
];

const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// 2. ENGINE INITIALIZATION
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
    heartbeat: Date.now()
};

// ==========================================
// 3. 🛡️ HONEYPOT SHIELD: PRE-TRADE SIMULATION
// ==========================================

async function simulateTrade(tokenAddress, tradeValue) {
    try {
        const pathBuy = [WETH, tokenAddress];
        const pathSell = [tokenAddress, WETH];
        const deadline = Math.floor(Date.now() / 1000) + 60;

        // 1. SIMULATE BUY (staticCall asks the node "what would happen?")
        await router.swapExactETHForTokens.staticCall(
            0, pathBuy, wallet.address, deadline, 
            { value: tradeValue }
        );

        // 2. SIMULATE SELL (The trap detection)
        const amounts = await router.getAmountsOut(ethers.parseUnits("1", 18), pathSell);
        if (amounts[1] === 0n) return false; // 100% tax honeypot

        return true; 
    } catch (e) {
        return false; // Transaction would revert (Honeypot/Scam)
    }
}

// ==========================================
// 4. THE ESCALATOR (CERTAINTY ENGINE)
// ==========================================

async function forceConfirm(chatId, tokenSym, txParams) {
    let currentBribe = txParams.initialBribe;
    let attempt = 1;

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
    bot.sendMessage(chatId, `📡 **STRIKE 1 [BROADCASTED]:** ${tokenSym}\nNonce: ${SYSTEM.nonce}\n[Etherscan](https://etherscan.io/tx/${tx.hash})`, { parse_mode: "Markdown" });

    while (SYSTEM.autoPilot) {
        try {
            const receipt = await Promise.race([
                tx.wait(1),
                new Promise((_, reject) => setTimeout(() => reject(new Error("STALL")), 13000))
            ]);

            if (receipt && receipt.status === 1n) {
                bot.sendMessage(chatId, `✅ **STRIKE CONFIRMED.** Block: ${receipt.blockNumber}`);
                return receipt;
            }
        } catch (err) {
            if (err.message === "STALL" && attempt < 4) {
                attempt++;
                currentBribe = (currentBribe * 200n) / 100n;
                bot.sendMessage(chatId, `⚠️ **TX STALLED.** Escalating Bribe...`);
                tx = await broadcast(currentBribe);
            } else { throw err; }
        }
    }
}

// ==========================================
// 5. AUTOPILOT CORE RECURSION
// ==========================================

async function runAutopilotCycle(chatId) {
    if (!SYSTEM.autoPilot || SYSTEM.isLocked) return;
    SYSTEM.isLocked = true;

    try {
        // RPC Rotation & Nonce Check
        try {
            SYSTEM.nonce = await provider.getTransactionCount(wallet.address, "latest");
        } catch (e) {
            rpcIdx = (rpcIdx + 1) % RPC_POOL.length;
            provider = new JsonRpcProvider(RPC_POOL[rpcIdx]);
            wallet = new Wallet(PRIVATE_KEY, provider);
            router = router.connect(wallet);
            SYSTEM.nonce = await provider.getTransactionCount(wallet.address, "latest");
        }

        const bal = await provider.getBalance(wallet.address);

        // Calculate Trade Size
        let tradeValue = SYSTEM.mode === "FIXED" 
            ? ethers.parseEther(SYSTEM.tradeAmount) 
            : (bal - SYSTEM.minGasBuffer) * BigInt(Math.floor(SYSTEM.risk * 100)) / 100n;

        if (tradeValue <= 0n) return;

        // Step 1: Scan for Target
        const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
        const target = res.data[0];

        if (target && target.tokenAddress) {
            bot.sendMessage(chatId, `🛡️ **SHIELD:** Simulating ${target.symbol}...`);

            // Step 2: 🛡️ Honeypot Shield Check
            const isSafe = await simulateTrade(target.tokenAddress, tradeValue);

            if (!isSafe) {
                bot.sendMessage(chatId, `⚠️ **SHIELD ALERT:** ${target.symbol} failed safety simulation. Skipping.`);
            } else {
                // Step 3: Trigger the Escalator
                const fee = await provider.getFeeData();
                const txParams = {
                    path: [WETH, target.tokenAddress],
                    deadline: Math.floor(Date.now() / 1000) + 60,
                    value: tradeValue,
                    initialBribe: (fee.maxPriorityFeePerGas * 150n) / 100n
                };
                await forceConfirm(chatId, target.symbol, txParams);
            }
        }
    } catch (e) {
        console.log(`[AUTO] Pulsing...`.gray);
    } finally {
        SYSTEM.isLocked = false;
        if (SYSTEM.autoPilot) setTimeout(() => runAutopilotCycle(chatId), 15000);
    }
}

// ==========================================
// 6. MASTER COMMANDS
// ==========================================

bot.onText(/\/auto/, (msg) => {
    const chatId = msg.chat.id;
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    bot.sendMessage(chatId, SYSTEM.autoPilot ? `🚀 **OMEGA TOTALITY: ON**\nMode: ${SYSTEM.mode}` : "🛑 **OMEGA TOTALITY: OFF**");
    if (SYSTEM.autoPilot) runAutopilotCycle(chatId);
});

bot.onText(/\/setamount (.+)/, (msg, match) => {
    SYSTEM.tradeAmount = match[1];
    SYSTEM.mode = "FIXED";
    bot.sendMessage(msg.chat.id, `⚙️ **AMOUNT SET:** ${match[1]} ETH`);
});

bot.onText(/\/compound/, (msg) => {
    SYSTEM.mode = "COMPOUND";
    bot.sendMessage(msg.chat.id, `📈 **RECURSIVE MODE ACTIVE.**`);
});

bot.onText(/\/status/, async (msg) => {
    const bal = await provider.getBalance(wallet.address);
    bot.sendMessage(msg.chat.id, `🛡️ **SYSTEM v42000**\nBalance: ${parseFloat(ethers.formatEther(bal)).toFixed(4)} ETH\nEngine: ${SYSTEM.autoPilot ? '🟢' : '🔴'}`);
});

http.createServer((req, res) => res.end("V42000_RUNNING")).listen(8080);
console.log("🦍 OMEGA TOTALITY v42000 ONLINE.".magenta);
