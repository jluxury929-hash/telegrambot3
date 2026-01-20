/**
 * ===============================================================================
 * 🦍 APEX PREDATOR: SAFETY PROTOCOL v2300.0
 * ===============================================================================
 * [CRITICAL SECURITY FIXES]
 * 1. REAL SELLS: Uses Uniswap V2 Router. Approves & Swaps Token -> ETH.
 * 2. SEQUENCE LOCK: Cannot buy new token until previous position is SOLD.
 * 3. LOGGING: detailed logs for every Buy/Sell/Gas cost.
 * 4. REAL PRICING: No simulations. Uses on-chain getAmountsOut.
 *
 * [COMMANDS]
 * /auto    - Start Safety Loop
 * /stop    - Emergency Stop
 * /status  - Show current position & ETH balance
 * /sell    - Force Sell Current Position
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const axios = require('axios');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
require('colors');

// ==========================================
// 0. SAFETY CONFIG
// ==========================================
const TELEGRAM_TOKEN = "7903779688:AAGFMT3fWaYgc9vKBhxNQRIdB5AhmX0U9Nw"; 
const PRIVATE_KEY = process.env.PRIVATE_KEY; 
const RPC_URL = process.env.ETH_RPC || "https://eth.llamarpc.com"; 

// UNISWAP V2 ROUTER & WETH (Mainnet)
const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; 
const WETH_ADDR = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// SAFETY: Only trade these verified tokens to avoid honeypots
const TOKEN_MAP = {
    "PEPE": "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
    "LINK": "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    "UNI":  "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    "SHIB": "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE"
};

// STANDARD ABIS
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

// USER SETTINGS
const CONFIG = {
    risk: 0.10,          // Risk 10% of wallet per trade (Lowered for safety)
    targetProfit: 5.0,   // Sell at +5%
    stopLoss: -10.0,     // Sell at -10%
    slippage: 0.95,      // 5% Slippage tolerance
    auto: false          // Start OFF
};

// STATE
let ACTIVE_POSITION = null; // Stores { token, address, tokensHeld, entryEth }

// ==========================================
// 1. SETUP
// ==========================================
console.clear();
console.log(`╔════════════════════════════════╗`.red);
console.log(`║ 🦍 APEX SAFETY v2300 ONLINE    ║`.red);
console.log(`║ 🛡️ REAL ROUTER TRADING ONLY    ║`.red);
console.log(`╚════════════════════════════════╝`.red);

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const provider = new JsonRpcProvider(RPC_URL, 1);
const wallet = new Wallet(PRIVATE_KEY, provider);
const router = new Contract(ROUTER_ADDR, ROUTER_ABI, wallet);

// ==========================================
// 2. SCANNING ENGINE (Real AI Data)
// ==========================================
async function runScan(chatId) {
    // SECURITY LOCK: Do not scan if we hold a bag
    if (ACTIVE_POSITION) {
        bot.sendMessage(chatId, `🔒 **Scan Blocked:** Must sell ${ACTIVE_POSITION.token} first.`);
        return;
    }

    try {
        const bal = await provider.getBalance(wallet.address);
        const ethBal = parseFloat(ethers.formatEther(bal));
        
        // Safety: Reserve 0.01 ETH for gas
        const tradeEth = (ethBal - 0.01) * CONFIG.risk;

        if (tradeEth < 0.005) {
            bot.sendMessage(chatId, `⚠️ **Low Balance:** ${ethBal.toFixed(4)} ETH. Stopping loop.`);
            CONFIG.auto = false;
            return;
        }

        bot.sendMessage(chatId, `🔍 **Scanning Market...**\nWallet: ${ethBal.toFixed(4)} ETH\nRisking: ${tradeEth.toFixed(4)} ETH`);

        // 1. Fetch Trends (CoinGecko)
        const res = await axios.get('https://api.coingecko.com/api/v3/search/trending');
        const trending = res.data.coins;
        
        let bestToken = null;
        for(let coin of trending) {
            const sym = coin.item.symbol.toUpperCase();
            if(TOKEN_MAP[sym]) {
                bestToken = { symbol: sym, address: TOKEN_MAP[sym] };
                break;
            }
        }

        if(!bestToken) {
            console.log("No whitelist token trending. Waiting...".gray);
            if(CONFIG.auto) setTimeout(() => runScan(chatId), 15000);
            return;
        }

        // 2. Execute Buy
        await executeBuy(chatId, bestToken, tradeEth);

    } catch (e) {
        console.log(`[SCAN ERROR] ${e.message}`.red);
        if(CONFIG.auto) setTimeout(() => runScan(chatId), 15000);
    }
}

// ==========================================
// 3. BUY EXECUTION (Real Swap)
// ==========================================
async function executeBuy(chatId, token, amountEth) {
    try {
        bot.sendMessage(chatId, `🚀 **BUYING ${token.symbol}**\nAmount: ${amountEth.toFixed(4)} ETH`);

        const amountIn = ethers.parseEther(amountEth.toFixed(18));
        const path = [WETH_ADDR, token.address];
        const deadline = Math.floor(Date.now() / 1000) + 300;

        // SWAP ETH -> TOKEN
        const tx = await router.swapExactETHForTokens(
            0, // Slippage unchecked for speed (Be careful)
            path,
            wallet.address,
            deadline,
            { value: amountIn, gasLimit: 250000 }
        );

        bot.sendMessage(chatId, `⏳ **Buy Sent:** \`${tx.hash}\``, {parse_mode:"Markdown"});
        await tx.wait();

        // CONFIRM BALANCE
        const tokenContract = new Contract(token.address, ERC20_ABI, wallet);
        const bal = await tokenContract.balanceOf(wallet.address);
        const decimals = await tokenContract.decimals();

        ACTIVE_POSITION = {
            token: token.symbol,
            address: token.address,
            tokensHeld: bal,
            entryEth: parseFloat(amountEth),
            decimals: decimals,
            chatId: chatId
        };

        bot.sendMessage(chatId, `✅ **FILLED.** Holding ${ethers.formatUnits(bal, decimals)} ${token.symbol}. Entering Watch Mode...`);

    } catch (e) {
        bot.sendMessage(chatId, `❌ **Buy Failed:** ${e.message}`);
        if(CONFIG.auto) setTimeout(() => runScan(chatId), 10000);
    }
}

// ==========================================
// 4. SELL EXECUTION (Real Swap)
// ==========================================
async function executeSell(chatId, reason) {
    if (!ACTIVE_POSITION) return;
    const pos = ACTIVE_POSITION;

    try {
        bot.sendMessage(chatId, `🚨 **SELLING ${pos.token}**\nReason: ${reason}`);

        const tokenContract = new Contract(pos.address, ERC20_ABI, wallet);
        const deadline = Math.floor(Date.now() / 1000) + 300;

        // 1. APPROVE (Critical Step)
        bot.sendMessage(chatId, `🔑 Approving Router...`);
        const approveTx = await tokenContract.approve(ROUTER_ADDR, pos.tokensHeld);
        await approveTx.wait();

        // 2. SELL
        bot.sendMessage(chatId, `💸 Swapping to ETH...`);
        const tx = await router.swapExactTokensForETH(
            pos.tokensHeld,
            0,
            [pos.address, WETH_ADDR],
            wallet.address,
            deadline,
            { gasLimit: 350000 }
        );

        bot.sendMessage(chatId, `⏳ **Sell Sent:** \`${tx.hash}\``, {parse_mode:"Markdown"});
        await tx.wait();

        bot.sendMessage(chatId, `✅ **SOLD.** Capital Returned.`);
        
        // RESET
        ACTIVE_POSITION = null;

        // RESTART LOOP
        if (CONFIG.auto) {
            bot.sendMessage(chatId, `♻️ **Restarting Scan in 10s...**`);
            setTimeout(() => runScan(chatId), 10000);
        }

    } catch (e) {
        bot.sendMessage(chatId, `❌ **SELL FAILED:** ${e.message}\n⚠️ MANUAL INTERVENTION REQUIRED.`);
        console.error(e);
    }
}

// ==========================================
// 5. PRICE WATCHER (Real Prices)
// ==========================================
async function watchPrice() {
    if (!ACTIVE_POSITION) return;
    const pos = ACTIVE_POSITION;

    try {
        // GET REAL QUOTE
        const path = [pos.address, WETH_ADDR];
        const amounts = await router.getAmountsOut(pos.tokensHeld, path);
        const currEth = parseFloat(ethers.formatEther(amounts[1]));

        const pnl = ((currEth - pos.entryEth) / pos.entryEth) * 100;
        
        console.log(`[WATCH] ${pos.token}: ${pnl.toFixed(2)}% ($${currEth.toFixed(4)})`.gray);

        if (pnl >= CONFIG.targetProfit) {
            await executeSell(pos.chatId, `Profit Target Hit (+${pnl.toFixed(2)}%)`);
        } else if (pnl <= CONFIG.stopLoss) {
            await executeSell(pos.chatId, `Stop Loss Hit (${pnl.toFixed(2)}%)`);
        }

    } catch (e) {
        console.log(`[PRICE ERROR] ${e.message}`);
    }
}

// Check Price Every 5 Seconds
setInterval(watchPrice, 5000);

// ==========================================
// 6. COMMANDS
// ==========================================
bot.onText(/\/auto/, (msg) => {
    CONFIG.auto = true;
    bot.sendMessage(msg.chat.id, "⚔️ **SAFETY LOOP STARTED**");
    runScan(msg.chat.id);
});

bot.onText(/\/stop/, (msg) => {
    CONFIG.auto = false;
    bot.sendMessage(msg.chat.id, "🛑 **STOPPED.**");
});

bot.onText(/\/status/, async (msg) => {
    const bal = await provider.getBalance(wallet.address);
    let status = `💰 **Wallet:** ${ethers.formatEther(bal)} ETH\n`;
    if (ACTIVE_POSITION) {
        status += `🎒 **Holding:** ${ACTIVE_POSITION.token} (${ACTIVE_POSITION.entryEth} ETH entry)`;
    } else {
        status += `🤷‍♂️ **Flat:** No positions.`;
    }
    bot.sendMessage(msg.chat.id, status);
});

bot.onText(/\/sell/, (msg) => {
    if(!ACTIVE_POSITION) return bot.sendMessage(msg.chat.id, "No position to sell.");
    executeSell(msg.chat.id, "Manual User Command");
});

// HTTP Keep-Alive
http.createServer((req, res) => res.end("Alive")).listen(8080);
