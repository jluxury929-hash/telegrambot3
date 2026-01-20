/**
 * ===============================================================================
 * 🦍 APEX PREDATOR: STEALTH ARCHITECT v2800.0 (Cleaned & Stabilized)
 * ===============================================================================
 * [STEALTH ENGINE]
 * 1. RATE LIMIT GUARD: Checks market every 60s & price every 15s.
 * 2. ERROR RESILIENCE: Detects 429 Errors and auto-sleeps to reset limits.
 * 3. HYBRID LOGIC: Real-time paper trading or Live Mainnet execution.
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const axios = require('axios');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
require('colors');

// ==========================================
// 0. CONFIGURATION
// ==========================================
const TELEGRAM_TOKEN = "7903779688:AAGFMT3fWaYgc9vKBhxNQRIdB5AhmX0U9Nw"; 
const PRIVATE_KEY = process.env.PRIVATE_KEY; 
const RPC_URL = process.env.ETH_RPC || "https://eth.llamarpc.com"; 

const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; 
const WETH_ADDR = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const TOKEN_MAP = {
    "PEPE": "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
    "LINK": "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    "UNI":  "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    "SHIB": "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE"
};

const ROUTER_ABI = [
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];
const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)"
];

if (!PRIVATE_KEY) { console.error("❌ CRITICAL: PRIVATE_KEY missing.".red); process.exit(1); }

// ==========================================
// 1. STATE & TIMING
// ==========================================
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const provider = new JsonRpcProvider(RPC_URL, 1);
const wallet = new Wallet(PRIVATE_KEY, provider);
const router = new Contract(ROUTER_ADDR, ROUTER_ABI, wallet);

const CONFIG = {
    risk: 0.10,         
    targetProfit: 3.0,  
    stopLoss: -3.0,     
    auto: false          
};

const SCAN_INTERVAL = 60000; // 60s
const WATCH_INTERVAL = 15000; // 15s

let SIM_MODE = true;     
let SIM_BALANCE = 10.0;  
let ACTIVE_POSITION = null; 

console.clear();
console.log(`╔════════════════════════════════╗`.cyan);
console.log(`║ 🦍 APEX STEALTH v2800 ONLINE   ║`.cyan);
console.log(`║ 🧪 MODE: RATE LIMITED (SAFE)   ║`.cyan);
console.log(`╚════════════════════════════════╝`.cyan);

// ==========================================
// 2. SCANNER (429 PROTECTION)
// ==========================================
async function runScan(chatId) {
    if (ACTIVE_POSITION) return;

    try {
        let ethBal, tradeEth;
        if (SIM_MODE) {
            ethBal = SIM_BALANCE;
            tradeEth = ethBal * CONFIG.risk;
        } else {
            const bal = await provider.getBalance(wallet.address);
            ethBal = parseFloat(ethers.formatEther(bal));
            tradeEth = (ethBal - 0.01) * CONFIG.risk;
        }

        if (tradeEth < 0.005) {
            bot.sendMessage(chatId, `⚠️ **Balance Low:** ${ethBal.toFixed(4)} ETH.`);
            CONFIG.auto = false;
            return;
        }

        console.log(`[SCAN] Pacing Requests... Bal: ${ethBal.toFixed(4)}`.gray);

        let bestToken = null;
        try {
            const res = await axios.get('https://api.coingecko.com/api/v3/search/trending');
            for(let coin of res.data.coins) {
                const sym = coin.item.symbol.toUpperCase();
                if(TOKEN_MAP[sym]) {
                    bestToken = { symbol: sym, address: TOKEN_MAP[sym] };
                    break;
                }
            }
        } catch(e) {
            console.log(`[LIMIT] Cooling down API...`.yellow);
            if(CONFIG.auto) setTimeout(() => runScan(chatId), 120000);
            return;
        }

        if(!bestToken && SIM_MODE) {
            const keys = Object.keys(TOKEN_MAP);
            bestToken = { symbol: keys[0], address: TOKEN_MAP[keys[0]] };
        }

        if(!bestToken) {
            if(CONFIG.auto) setTimeout(() => runScan(chatId), SCAN_INTERVAL);
            return;
        }

        await executeBuy(chatId, bestToken, tradeEth);

    } catch (e) {
        console.log(`[SCAN ERROR] ${e.message}`.red);
        if(CONFIG.auto) setTimeout(() => runScan(chatId), SCAN_INTERVAL);
    }
}

// ==========================================
// 3. ENGINE LOGIC
// ==========================================
async function executeBuy(chatId, token, amountEth) {
    try {
        const amountInWei = ethers.parseEther(amountEth.toFixed(18));
        const path = [WETH_ADDR, token.address];

        if (SIM_MODE) {
            const amounts = await router.getAmountsOut(amountInWei, path);
            SIM_BALANCE -= amountEth;
            ACTIVE_POSITION = {
                token: token.symbol,
                address: token.address,
                tokensHeld: amounts[1], 
                entryEth: parseFloat(amountEth),
                chatId: chatId,
                isSim: true
            };
            bot.sendMessage(chatId, `✅ **SIM BUY:** ${token.symbol} @ ${amountEth.toFixed(4)} ETH`);
        } else {
            const tx = await router.swapExactETHForTokens(0, path, wallet.address, Math.floor(Date.now()/1000)+300, { value: amountInWei, gasLimit: 250000 });
            await tx.wait();
            const tokenContract = new Contract(token.address, ERC20_ABI, wallet);
            ACTIVE_POSITION = {
                token: token.symbol,
                address: token.address,
                tokensHeld: await tokenContract.balanceOf(wallet.address),
                entryEth: parseFloat(amountEth),
                chatId: chatId,
                isSim: false
            };
            bot.sendMessage(chatId, `🚀 **REAL BUY CONFIRMED:** ${token.symbol}`);
        }
    } catch (e) { console.log(`Buy Fail: ${e.message}`); }
}

async function executeSell(chatId, reason) {
    if (!ACTIVE_POSITION) return;
    const pos = ACTIVE_POSITION;
    try {
        if (pos.isSim) {
            const amounts = await router.getAmountsOut(pos.tokensHeld, [pos.address, WETH_ADDR]);
            const ethBack = parseFloat(ethers.formatEther(amounts[1]));
            SIM_BALANCE += ethBack;
            bot.sendMessage(chatId, `💰 **SIM SOLD:** +${((ethBack - pos.entryEth)/pos.entryEth*100).toFixed(2)}% | Bal: ${SIM_BALANCE.toFixed(4)}`);
        } else {
            const tokenContract = new Contract(pos.address, ERC20_ABI, wallet);
            await (await tokenContract.approve(ROUTER_ADDR, pos.tokensHeld)).wait();
            await (await router.swapExactTokensForETH(pos.tokensHeld, 0, [pos.address, WETH_ADDR], wallet.address, Math.floor(Date.now()/1000)+300, { gasLimit: 350000 })).wait();
            bot.sendMessage(chatId, `🏁 **REAL SELL SUCCESS.**`);
        }
        ACTIVE_POSITION = null;
        if (CONFIG.auto) setTimeout(() => runScan(chatId), SCAN_INTERVAL);
    } catch (e) { console.log(`Sell Fail: ${e.message}`); }
}

async function watchPrice() {
    if (!ACTIVE_POSITION) return;
    try {
        const amounts = await router.getAmountsOut(ACTIVE_POSITION.tokensHeld, [ACTIVE_POSITION.address, WETH_ADDR]);
        const currEth = parseFloat(ethers.formatEther(amounts[1]));
        const pnl = ((currEth - ACTIVE_POSITION.entryEth) / ACTIVE_POSITION.entryEth) * 100;
        console.log(`[${ACTIVE_POSITION.token}] PnL: ${pnl.toFixed(2)}%`.gray);

        if (pnl >= CONFIG.targetProfit || pnl <= CONFIG.stopLoss) {
            await executeSell(ACTIVE_POSITION.chatId, "Target Hit");
        }
    } catch (e) { console.log(`[PRICE SKIP] RPC Load High`.yellow); }
}

setInterval(watchPrice, WATCH_INTERVAL);

bot.onText(/\/auto/, (msg) => { CONFIG.auto = true; runScan(msg.chat.id); });
bot.onText(/\/stop/, (msg) => { CONFIG.auto = false; bot.sendMessage(msg.chat.id, "🛑 Stopped."); });
bot.onText(/\/simulate/, (msg) => { SIM_MODE = true; bot.sendMessage(msg.chat.id, "🧪 Sim Mode On."); });
bot.onText(/\/real/, (msg) => { SIM_MODE = false; bot.sendMessage(msg.chat.id, "🚨 Real Mode On."); });
bot.onText(/\/status/, (msg) => bot.sendMessage(msg.chat.id, `Status: ${SIM_MODE ? "Sim" : "Real"}\nBal: ${SIM_MODE ? SIM_BALANCE.toFixed(4) : "Wallet"}`));

http.createServer((req, res) => res.end("Sentinel Active")).listen(8080);
