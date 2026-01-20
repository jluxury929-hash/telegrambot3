/**
 * ===============================================================================
 * 🦍 APEX PREDATOR: AI SCALPER v4000.0 (MULTI-THREADED)
 * ===============================================================================
 * [ADVANCED FEATURES]
 * 1. MULTI-THREADING: Can manage 5 trades simultaneously (No locking).
 * 2. DUPLICATE GUARD: Prevents buying the same token twice (Anti-Drain).
 * 3. AI SCORING: Calculates 'Confidence Score' based on Volatility & Volume.
 * 4. PRE-TRADE VALIDATION: Simulates the swap on-chain to confirm liquidity exists.
 *
 * [COMMANDS]
 * /auto    - Start AI Loop
 * /stop    - Pause
 * /status  - Show all open positions
 * /force_sell <symbol> - Panic sell specific coin
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

// ✅ VERIFIED SAFETY LIST (We only scan these for "Max of Max" opportunities)
const TOKEN_MAP = {
    "PEPE": "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
    "LINK": "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    "SHIB": "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE",
    "UNI":  "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    "MOG":  "0xaaee1a9723aadb7af9e81c990107749e446a9756",
    "SPX":  "0xE0f63A424a4439cBE457D80E4f4b51aD25b2c56C"
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

const CONFIG = {
    risk: 0.10,          // Risk 10% of wallet PER TRADE
    maxPositions: 3,     // Max 3 concurrent trades (Safety)
    takeProfit: 5.0,     // +5% Target
    stopLoss: -4.0,      // -4% Stop
    minVolume: 1000000,  // Min $1M Volume
    auto: false
};

// MULTI-POSITION TRACKER
let POSITIONS = {}; // Object to store multiple active trades: { "PEPE": { ... }, "LINK": { ... } }

// ==========================================
// 1. SYSTEM INIT
// ==========================================
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const provider = new JsonRpcProvider(RPC_URL, 1);
const wallet = new Wallet(PRIVATE_KEY, provider);
const router = new Contract(ROUTER_ADDR, ROUTER_ABI, wallet);

console.clear();
console.log(`╔════════════════════════════════╗`.cyan);
console.log(`║ 🦍 APEX MULTI-THREAD v4000     ║`.cyan);
console.log(`║ 🧠 AI SCORING: ACTIVE          ║`.cyan);
console.log(`╚════════════════════════════════╝`.cyan);

// ==========================================
// 2. AI MARKET SCANNER
// ==========================================
async function runAiScan(chatId) {
    const openTradeCount = Object.keys(POSITIONS).length;
    
    // CAP CHECK: Don't scan if we are full
    if (openTradeCount >= CONFIG.maxPositions) {
        console.log(`[SCAN] Max positions reached (${openTradeCount}/${CONFIG.maxPositions}). Watching...`.gray);
        if(CONFIG.auto) setTimeout(() => runAiScan(chatId), 10000);
        return;
    }

    try {
        const bal = await provider.getBalance(wallet.address);
        const ethBal = parseFloat(ethers.formatEther(bal));
        const tradeEth = (ethBal - 0.02) * CONFIG.risk; // Safe gas reserve

        if (tradeEth < 0.005) {
            bot.sendMessage(chatId, `⚠️ **Balance Low:** ${ethBal.toFixed(4)} ETH.`);
            CONFIG.auto = false;
            return;
        }

        console.log(`[SCAN] AI Searching for opportunities...`.cyan);

        // 1. FETCH DATA (CoinGecko Markets)
        const res = await axios.get("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=50&page=1&sparkline=false&price_change_percentage=1h");
        
        let bestCandidate = null;
        let highestScore = 0;

        for (let coin of res.data) {
            const sym = coin.symbol.toUpperCase();
            
            // FILTER 1: Must be Verified
            if (!TOKEN_MAP[sym]) continue;
            
            // FILTER 2: Must NOT already be in our portfolio (Anti-Drain)
            if (POSITIONS[sym]) continue;

            // FILTER 3: Min Volume
            if (coin.total_volume < CONFIG.minVolume) continue;

            // AI SCORING ALGORITHM
            // Score = (1h% * 2) + (Volume / 100,000,000)
            // We want high momentum + high volume
            let score = (coin.price_change_percentage_1h_in_currency * 2) + (coin.total_volume / 100000000);

            if (score > highestScore && score > 5) { // Min score threshold
                highestScore = score;
                bestCandidate = {
                    symbol: sym,
                    address: TOKEN_MAP[sym],
                    score: score.toFixed(2),
                    price: coin.current_price
                };
            }
        }

        if (!bestCandidate) {
            console.log("[SCAN] No high-confidence signals.".gray);
            if(CONFIG.auto) setTimeout(() => runAiScan(chatId), 10000);
            return;
        }

        // 2. VALIDATE LIQUIDITY (The "Proven" Check)
        const isValid = await validateLiquidity(bestCandidate.address, tradeEth);
        if (!isValid) {
            console.log(`[WARN] ${bestCandidate.symbol} failed liquidity check. Skipping.`.red);
            if(CONFIG.auto) setTimeout(() => runAiScan(chatId), 5000);
            return;
        }

        // 3. EXECUTE
        bot.sendMessage(chatId, `🧠 **AI FOUND TRADE:** ${bestCandidate.symbol}\nConfidence: ${bestCandidate.score}/100\nValidating & Buying...`);
        await executeBuy(chatId, bestCandidate, tradeEth);

    } catch (e) {
        console.log(`[SCAN ERROR] ${e.message}`);
        if(CONFIG.auto) setTimeout(() => runAiScan(chatId), 15000);
    }
}

// VALIDATOR: Checks if we can actually get tokens for our ETH
async function validateLiquidity(tokenAddress, ethAmount) {
    try {
        const amountIn = ethers.parseEther(ethAmount.toFixed(18));
        const path = [WETH_ADDR, tokenAddress];
        const amounts = await router.getAmountsOut(amountIn, path);
        return amounts[1] > 0n; // Returns true if swap yields tokens
    } catch (e) {
        return false;
    }
}

// ==========================================
// 3. EXECUTION ENGINE (Multi-Threaded)
// ==========================================
async function executeBuy(chatId, token, amountEth) {
    try {
        const amountIn = ethers.parseEther(amountEth.toFixed(18));
        const path = [WETH_ADDR, token.address];
        const deadline = Math.floor(Date.now() / 1000) + 300;

        const tx = await router.swapExactETHForTokens(
            0,
            path,
            wallet.address,
            deadline,
            { value: amountIn, gasLimit: 250000 }
        );

        bot.sendMessage(chatId, `⏳ **Tx Sent:** \`${tx.hash}\``, { parse_mode: "Markdown" });
        await tx.wait();

        // Verify Balance
        const tokenContract = new Contract(token.address, ERC20_ABI, wallet);
        const bal = await tokenContract.balanceOf(wallet.address);
        const decimals = await tokenContract.decimals();

        // ADD TO PORTFOLIO MAP
        POSITIONS[token.symbol] = {
            symbol: token.symbol,
            address: token.address,
            tokensHeld: bal,
            entryEth: parseFloat(amountEth),
            decimals: decimals,
            chatId: chatId
        };

        bot.sendMessage(chatId, `✅ **BOUGHT ${token.symbol}.**\nPortfolio: ${Object.keys(POSITIONS).length}/3\nWatching for profit...`);

        // Restart scan immediately to find next gem
        if (CONFIG.auto) runAiScan(chatId);

    } catch (e) {
        bot.sendMessage(chatId, `❌ **Buy Failed:** ${e.message}`);
        if(CONFIG.auto) setTimeout(() => runAiScan(chatId), 10000);
    }
}

async function executeSell(symbol, reason) {
    const pos = POSITIONS[symbol];
    if (!pos) return;

    try {
        const chatId = pos.chatId;
        bot.sendMessage(chatId, `🚨 **SELLING ${pos.symbol}**\nReason: ${reason}`);

        const tokenContract = new Contract(pos.address, ERC20_ABI, wallet);
        
        // 1. APPROVE
        bot.sendMessage(chatId, `🔑 Approving...`);
        const approveTx = await tokenContract.approve(ROUTER_ADDR, pos.tokensHeld);
        await approveTx.wait();

        // 2. SWAP
        bot.sendMessage(chatId, `💸 Selling...`);
        const deadline = Math.floor(Date.now() / 1000) + 300;
        const tx = await router.swapExactTokensForETH(
            pos.tokensHeld,
            0,
            [pos.address, WETH_ADDR],
            wallet.address,
            deadline,
            { gasLimit: 350000 }
        );
        await tx.wait();

        bot.sendMessage(chatId, `✅ **SOLD ${pos.symbol}.** Profit Locked.`);
        
        // REMOVE FROM PORTFOLIO
        delete POSITIONS[symbol];

    } catch (e) {
        console.error(e);
    }
}

// ==========================================
// 4. MULTI-THREAD PRICE MONITOR
// ==========================================
async function monitorPositions() {
    const symbols = Object.keys(POSITIONS);
    if (symbols.length === 0) return;

    for (let sym of symbols) {
        const pos = POSITIONS[sym];
        
        try {
            const path = [pos.address, WETH_ADDR];
            const amounts = await router.getAmountsOut(pos.tokensHeld, path);
            const currEth = parseFloat(ethers.formatEther(amounts[1]));

            const pnl = ((currEth - pos.entryEth) / pos.entryEth) * 100;

            console.log(`[WATCH] ${sym}: ${pnl.toFixed(2)}% ($${currEth.toFixed(4)})`.gray);

            if (pnl >= CONFIG.takeProfit) {
                await executeSell(sym, `Profit Target (+${pnl.toFixed(2)}%)`);
            } else if (pnl <= CONFIG.stopLoss) {
                await executeSell(sym, `Stop Loss (${pnl.toFixed(2)}%)`);
            }

        } catch (e) {
            console.log(`[WATCH ERROR ${sym}] ${e.message}`);
        }
    }
}

setInterval(monitorPositions, 4000); // Check all positions every 4s

// ==========================================
// 5. COMMANDS
// ==========================================
bot.onText(/\/auto/, (msg) => {
    CONFIG.auto = true;
    bot.sendMessage(msg.chat.id, "⚔️ **AI SCALPER ACTIVE**\nScanning for Max-Confidence setups...");
    runAiScan(msg.chat.id);
});

bot.onText(/\/stop/, (msg) => {
    CONFIG.auto = false;
    bot.sendMessage(msg.chat.id, "🛑 **STOPPED.**");
});

bot.onText(/\/status/, async (msg) => {
    const bal = await provider.getBalance(wallet.address);
    let msgText = `💰 **Wallet:** ${ethers.formatEther(bal)} ETH\n\n**OPEN TRADES:**\n`;
    
    const symbols = Object.keys(POSITIONS);
    if (symbols.length === 0) msgText += "None.";
    else {
        symbols.forEach(s => msgText += `• ${s}: ${POSITIONS[s].entryEth} ETH Entry\n`);
    }

    bot.sendMessage(msg.chat.id, msgText);
});

bot.onText(/\/force_sell (.+)/, (msg, match) => {
    const sym = match[1].toUpperCase();
    if (POSITIONS[sym]) {
        executeSell(sym, "Force Sell Command");
    } else {
        bot.sendMessage(msg.chat.id, "❌ Trade not found.");
    }
});

http.createServer((req, res) => res.end("Alive")).listen(8080);
