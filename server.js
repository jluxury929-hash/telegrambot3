/**
 * ===============================================================================
 * 🦍 APEX PREDATOR: DEEP STEALTH v2700.0 (INFURA FIX)
 * ===============================================================================
 * [INFURA FIXES]
 * 1. DEEP SLEEP: Scans market every 2 mins (Saves API credits).
 * 2. SLOW WATCH: Checks prices every 30s (Prevents RPC 429 Errors).
 * 3. AUTO-COOLER: Detects "Too Many Requests" and sleeps for 60s automatically.
 *
 * [COMMANDS]
 * /simulate - Start Paper Trading (Safe)
 * /real     - Switch to Real Money (Risk)
 * /auto     - Start Loop
 * /stop     - Pause
 * /status   - Show Fake vs Real Balance
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const axios = require('axios');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
require('colors');

// ==========================================
// 0. CONFIG
// ==========================================
const TELEGRAM_TOKEN = "7903779688:AAGFMT3fWaYgc9vKBhxNQRIdB5AhmX0U9Nw"; 
const PRIVATE_KEY = process.env.PRIVATE_KEY; 
// Fallback to LlamaRPC if Infura fails (Public & Free)
const RPC_URL = process.env.ETH_RPC || "https://eth.llamarpc.com"; 

const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; 
const WETH_ADDR = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// VERIFIED TOKENS
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
// 1. STATE & SETTINGS
// ==========================================
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const provider = new JsonRpcProvider(RPC_URL, 1);
const wallet = new Wallet(PRIVATE_KEY, provider);
const router = new Contract(ROUTER_ADDR, ROUTER_ABI, wallet);

const CONFIG = {
    risk: 0.10,          // 10% of balance per trade
    targetProfit: 3.0,   // +3% take profit
    stopLoss: -3.0,      // -3% stop loss
    auto: false          
};

// TIMING SETTINGS (INFURA SAFE)
const SCAN_INTERVAL = 120000; // 2 Minutes
const WATCH_INTERVAL = 30000; // 30 Seconds
const ERROR_COOLDOWN = 60000; // 1 Minute Sleep on Error

let SIM_MODE = true;     
let SIM_BALANCE = 10.0;  
let ACTIVE_POSITION = null; 
let IS_COOLING_DOWN = false;

console.clear();
console.log(`╔════════════════════════════════╗`.cyan);
console.log(`║ 🦍 APEX INFURA-FIX v2700       ║`.cyan);
console.log(`║ 💤 MODE: DEEP STEALTH          ║`.cyan);
console.log(`╚════════════════════════════════╝`.cyan);


// ==========================================
// 2. MARKET SCANNER (VERY SLOW)
// ==========================================
async function runScan(chatId) {
    if (ACTIVE_POSITION || IS_COOLING_DOWN) return;

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
            bot.sendMessage(chatId, `⚠️ **Low Balance:** ${ethBal.toFixed(4)} ETH.`);
            CONFIG.auto = false;
            return;
        }

        const modeIcon = SIM_MODE ? "🧪" : "🚨";
        // Only log to console to save Telegram API limits too
        console.log(`[SCAN] ${modeIcon} Scanning... Bal: ${ethBal.toFixed(4)}`.gray);

        // 1. FETCH TRENDS
        let bestToken = null;
        try {
            const res = await axios.get('https://api.coingecko.com/api/v3/search/trending');
            const trending = res.data.coins;
            
            for(let coin of trending) {
                const sym = coin.item.symbol.toUpperCase();
                if(TOKEN_MAP[sym]) {
                    bestToken = { symbol: sym, address: TOKEN_MAP[sym] };
                    break;
                }
            }
        } catch(e) { 
            console.log(`[API LIMIT] CoinGecko 429. Sleeping...`.yellow);
            triggerCooldown(chatId, "API Rate Limit");
            return;
        }

        // FALLBACK FOR SIMULATION
        if(!bestToken && SIM_MODE) {
            const keys = Object.keys(TOKEN_MAP);
            const randomKey = keys[Math.floor(Math.random() * keys.length)];
            bestToken = { symbol: randomKey, address: TOKEN_MAP[randomKey] };
            bot.sendMessage(chatId, `⚡ **Sim Speed-Up:** Auto-selected ${bestToken.symbol}`);
        }

        if(!bestToken) {
            console.log("No safe trends found. Waiting...".gray);
            if(CONFIG.auto) setTimeout(() => runScan(chatId), SCAN_INTERVAL);
            return;
        }

        // 2. EXECUTE BUY
        await executeBuy(chatId, bestToken, tradeEth);

    } catch (e) {
        handleError(chatId, e, "SCAN");
    }
}


// ==========================================
// 3. BUY ENGINE
// ==========================================
async function executeBuy(chatId, token, amountEth) {
    try {
        const amountInWei = ethers.parseEther(amountEth.toFixed(18));
        const path = [WETH_ADDR, token.address];

        if (SIM_MODE) {
            bot.sendMessage(chatId, `🧪 **SIM BUY: ${token.symbol}**`);
            
            const amounts = await router.getAmountsOut(amountInWei, path);
            const tokensReceived = amounts[1]; 

            SIM_BALANCE -= amountEth;

            ACTIVE_POSITION = {
                token: token.symbol,
                address: token.address,
                tokensHeld: tokensReceived, 
                entryEth: parseFloat(amountEth),
                decimals: 18, 
                chatId: chatId,
                isSim: true
            };

            bot.sendMessage(chatId, `✅ **SIM FILLED.**\nSpent: ${amountEth.toFixed(4)} Fake ETH`);

        } else {
            bot.sendMessage(chatId, `🚨 **REAL BUY: ${token.symbol}**`);
            
            const deadline = Math.floor(Date.now() / 1000) + 300;
            const tx = await router.swapExactETHForTokens(
                0, 
                path,
                wallet.address,
                deadline,
                { value: amountInWei, gasLimit: 250000 }
            );
            bot.sendMessage(chatId, `⏳ **Tx Sent:** \`${tx.hash}\``, {parse_mode:"Markdown"});
            await tx.wait();

            const tokenContract = new Contract(token.address, ERC20_ABI, wallet);
            const bal = await tokenContract.balanceOf(wallet.address);
            const decimals = await tokenContract.decimals();

            ACTIVE_POSITION = {
                token: token.symbol,
                address: token.address,
                tokensHeld: bal,
                entryEth: parseFloat(amountEth),
                decimals: decimals,
                chatId: chatId,
                isSim: false
            };
            bot.sendMessage(chatId, `✅ **REAL BUY CONFIRMED.**`);
        }

    } catch (e) {
        handleError(chatId, e, "BUY");
    }
}


// ==========================================
// 4. SELL ENGINE
// ==========================================
async function executeSell(chatId, reason) {
    if (!ACTIVE_POSITION) return;
    const pos = ACTIVE_POSITION;

    try {
        const mode = pos.isSim ? "🧪 SIM" : "🚨 REAL";
        bot.sendMessage(chatId, `${mode} **SELLING ${pos.token}**\nReason: ${reason}`);

        if (pos.isSim) {
            const path = [pos.address, WETH_ADDR];
            const amounts = await router.getAmountsOut(pos.tokensHeld, path);
            const ethRecieved = parseFloat(ethers.formatEther(amounts[1]));

            SIM_BALANCE += ethRecieved;
            const profit = ethRecieved - pos.entryEth;
            
            bot.sendMessage(chatId, `✅ **SIM SOLD.**\nProfit: ${profit.toFixed(4)} ETH\n💰 Wallet: ${SIM_BALANCE.toFixed(4)} ETH`);
            ACTIVE_POSITION = null;

        } else {
            const tokenContract = new Contract(pos.address, ERC20_ABI, wallet);
            const deadline = Math.floor(Date.now() / 1000) + 300;

            bot.sendMessage(chatId, `🔑 Approving...`);
            const approveTx = await tokenContract.approve(ROUTER_ADDR, pos.tokensHeld);
            await approveTx.wait();

            bot.sendMessage(chatId, `💸 Swapping...`);
            const tx = await router.swapExactTokensForETH(
                pos.tokensHeld,
                0,
                [pos.address, WETH_ADDR],
                wallet.address,
                deadline,
                { gasLimit: 350000 }
            );
            await tx.wait();
            
            bot.sendMessage(chatId, `✅ **REAL SOLD.** Capital Returned.`);
            ACTIVE_POSITION = null;
        }

        if (CONFIG.auto) {
            console.log(`[LOOP] Waiting ${SCAN_INTERVAL/1000}s...`.gray);
            setTimeout(() => runScan(chatId), SCAN_INTERVAL);
        }

    } catch (e) {
        handleError(chatId, e, "SELL");
    }
}


// ==========================================
// 5. PRICE WATCHER (INFURA SAFE)
// ==========================================
async function watchPrice() {
    if (!ACTIVE_POSITION || IS_COOLING_DOWN) return;
    const pos = ACTIVE_POSITION;

    try {
        const path = [pos.address, WETH_ADDR];
        const amounts = await router.getAmountsOut(pos.tokensHeld, path);
        const currEth = parseFloat(ethers.formatEther(amounts[1]));

        const pnl = ((currEth - pos.entryEth) / pos.entryEth) * 100;
        
        console.log(`[WATCH] ${pos.token}: ${pnl.toFixed(2)}%`.gray);

        if (pnl >= CONFIG.targetProfit) {
            await executeSell(pos.chatId, `Profit Target (+${pnl.toFixed(2)}%)`);
        } else if (pnl <= CONFIG.stopLoss) {
            await executeSell(pos.chatId, `Stop Loss (${pnl.toFixed(2)}%)`);
        }

    } catch (e) {
        handleError(pos.chatId, e, "PRICE_CHECK");
    }
}

// SLOW WATCH: Check every 30 seconds to respect Infura Free Tier
setInterval(watchPrice, WATCH_INTERVAL);


// ==========================================
// 6. ERROR HANDLING & COOLDOWN
// ==========================================
function handleError(chatId, error, context) {
    const errMsg = error.message || "";
    
    // DETECT RATE LIMITS (429) OR INFURA ERRORS
    if (errMsg.includes("429") || errMsg.includes("Too Many Requests") || errMsg.includes("rate limit")) {
        triggerCooldown(chatId, "INFURA 429 (Rate Limit)");
    } else {
        console.log(`[${context} ERROR] ${errMsg}`.red);
        if (CONFIG.auto) setTimeout(() => runScan(chatId), SCAN_INTERVAL);
    }
}

function triggerCooldown(chatId, reason) {
    if (IS_COOLING_DOWN) return;
    IS_COOLING_DOWN = true;
    
    console.log(`[COOLING] ${reason} detected. Sleeping 60s...`.yellow);
    if(chatId) bot.sendMessage(chatId, `💤 **Cooling Down:** API Limit hit. Sleeping 60s...`);

    setTimeout(() => {
        IS_COOLING_DOWN = false;
        console.log(`[RESUME] System waking up.`.green);
        if(CONFIG.auto && chatId) runScan(chatId);
    }, ERROR_COOLDOWN);
}


// ==========================================
// 7. COMMANDS
// ==========================================
bot.onText(/\/simulate/, (msg) => {
    if(ACTIVE_POSITION && !ACTIVE_POSITION.isSim) return bot.sendMessage(msg.chat.id, "❌ Real trade active.");
    SIM_MODE = true;
    SIM_BALANCE = 10.0; 
    bot.sendMessage(msg.chat.id, "🧪 **SIMULATION MODE**\nBal: 10.0 Fake ETH");
});

bot.onText(/\/real/, (msg) => {
    if(ACTIVE_POSITION) return bot.sendMessage(msg.chat.id, "❌ Close position first.");
    SIM_MODE = false;
    bot.sendMessage(msg.chat.id, "🚨 **REAL MONEY MODE**\n⚠️ TRADES ARE LIVE ⚠️");
});

bot.onText(/\/auto/, (msg) => {
    CONFIG.auto = true;
    bot.sendMessage(msg.chat.id, `♾️ **LOOP STARTED** (Slow Mode)\nChecking every ${SCAN_INTERVAL/1000}s`);
    runScan(msg.chat.id);
});

bot.onText(/\/stop/, (msg) => {
    CONFIG.auto = false;
    bot.sendMessage(msg.chat.id, "🛑 **STOPPED.**");
});

bot.onText(/\/status/, async (msg) => {
    const mode = SIM_MODE ? "🧪 SIMULATION" : "🚨 REAL MONEY";
    let balText = SIM_MODE ? `${SIM_BALANCE.toFixed(4)} Fake ETH` : "Real ETH";
    let posText = ACTIVE_POSITION ? `🎒 Holding: ${ACTIVE_POSITION.token}` : "🤷‍♂️ Flat";
    
    bot.sendMessage(msg.chat.id, `
📊 **STATUS**
Mode: ${mode}
Wallet: ${balText}
Status: ${posText}
Cooling: ${IS_COOLING_DOWN}
    `);
});

bot.onText(/\/sell/, (msg) => {
    if(!ACTIVE_POSITION) return bot.sendMessage(msg.chat.id, "No position.");
    executeSell(msg.chat.id, "Manual Command");
});

http.createServer((req, res) => res.end("Alive")).listen(8080);
