/**
 * ===============================================================================
 * 🦍 APEX PREDATOR: OMEGA TOTALITY v28000.0 (Ethers v6)
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

// Failover RPC Pool for 100% Uptime
const RPC_POOL = [
    "https://rpc.mevblocker.io", 
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth"
];

const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const TOKEN_MAP = {
    "PEPE": "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
    "LINK": "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    "SHIB": "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE"
};

// ==========================================
// 1. ENGINE INITIALIZATION
// ==========================================
let rpcIdx = 0;
let provider = new JsonRpcProvider(RPC_POOL[rpcIdx]);
let wallet = new Wallet(PRIVATE_KEY, provider);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

let router = new Contract(ROUTER_ADDR, [
    "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
    "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"
], wallet);

const SYSTEM = {
    isLocked: false,
    nonce: null,
    risk: 0.15,
    heartbeat: Date.now()
};

// ==========================================
// 2. THE ESCALATOR (CERTAINTY ENGINE)
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

    let tx = await broadcast(currentBribe);
    bot.sendMessage(chatId, `📡 **STRIKE 1 [BROADCASTED]:** ${tokenSym}\nNonce: ${SYSTEM.nonce}\n[Etherscan](https://etherscan.io/tx/${tx.hash})`, { parse_mode: "Markdown" });

    while (true) {
        try {
            // Wait for 1 block (12s)
            const receipt = await Promise.race([
                tx.wait(1),
                new Promise((_, reject) => setTimeout(() => reject(new Error("STALL")), 13000))
            ]);

            if (receipt && receipt.status === 1n) {
                bot.sendMessage(chatId, `✅ **CONFIRMED.** Block: ${receipt.blockNumber}`);
                return receipt;
            }
        } catch (err) {
            if (err.message === "STALL" && attempt < 4) {
                attempt++;
                currentBribe = (currentBribe * 200n) / 100n; // DOUBLE the bribe to jump the queue
                bot.sendMessage(chatId, `⚠️ **TX STALLED.** Escalating Bribe to ${ethers.formatUnits(currentBribe, 'gwei')} Gwei...`);
                tx = await broadcast(currentBribe);
            } else { throw err; }
        }
    }
}

// ==========================================
// 3. AUTOPILOT RECOVERY LOOP
// ==========================================

async function runAutopilot(chatId) {
    if (SYSTEM.isLocked) return;
    SYSTEM.isLocked = true;
    SYSTEM.heartbeat = Date.now();

    try {
        // Handle potential RPC rate limits
        try {
            SYSTEM.nonce = await provider.getTransactionCount(wallet.address, "latest");
        } catch (e) {
            if (e.message.includes("429")) {
                rpcIdx = (rpcIdx + 1) % RPC_POOL.length;
                provider = new JsonRpcProvider(RPC_POOL[rpcIdx]);
                wallet = new Wallet(PRIVATE_KEY, provider);
                router = router.connect(wallet);
                console.log(`[RPC] Rotated to ${RPC_POOL[rpcIdx]}`.yellow);
            }
            throw e;
        }

        const bal = await provider.getBalance(wallet.address);
        const ethVal = parseFloat(ethers.formatEther(bal));
        if (ethVal < 0.015) { SYSTEM.isLocked = false; return; }

        const res = await axios.get('https://api.coingecko.com/api/v3/search/trending');
        const coin = res.data.coins[0].item.symbol.toUpperCase();

        if (TOKEN_MAP[coin]) {
            const fee = await provider.getFeeData();
            const txParams = {
                path: [WETH, TOKEN_MAP[coin]],
                deadline: Math.floor(Date.now() / 1000) + 300,
                value: ethers.parseEther(((ethVal - 0.01) * SYSTEM.risk).toFixed(18)),
                initialBribe: (fee.maxPriorityFeePerGas * 150n) / 100n
            };

            await forceConfirm(chatId, coin, txParams);
        }
    } catch (e) { console.log(`[AUTO] Restarting...`.gray); }
    finally { SYSTEM.isLocked = false; }
}

// Auto-trigger every 30s
setInterval(() => runAutopilot("7903779688"), 30000);

bot.onText(/\/status/, async (msg) => {
    const bal = await provider.getBalance(wallet.address);
    bot.sendMessage(msg.chat.id, `🛡️ **OMEGA TOTALITY v28000 ONLINE**\nWallet: ${parseFloat(ethers.formatEther(bal)).toFixed(4)} ETH\nRPC: ${RPC_POOL[rpcIdx]}\nAutopilot: ACTIVE`);
});

http.createServer((req, res) => res.end("V28000_RUNNING")).listen(8080);
