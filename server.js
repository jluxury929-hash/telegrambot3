/**
 * ===============================================================================
 * 🦍 APEX PREDATOR: SIMULATION & REALITY v2400.0
 * ===============================================================================
 * [HYBRID ENGINE]
 * 1. SIMULATE (/simulate): Trades with 10.0 FAKE ETH using REAL market data.
 * 2. REAL (/real): Trades with REAL WALLET ETH using REAL transactions.
 * 3. SAFETY: Logic prevents accidental real trades when in Sim mode.
 * 4. LOGIC: Uses Uniswap 'getAmountsOut' to calculate exact simulation results.
 *
 * [COMMANDS]
 * /simulate - Start Paper Trading (Fake Money, Real Data)
 * /real     - Switch to Real Money Mode (DANGEROUS)
 * /auto     - Start Loop (in whatever mode is selected)
 * /stop     - Pause
 * /status   - Show Mode & Balance
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
// 1. STATE & SETTINGS
// ==========================================
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const provider = new JsonRpcProvider(RPC_URL, 1);
const wallet = new Wallet(PRIVATE_KEY, provider);
const router = new Contract(ROUTER_ADDR, ROUTER_ABI, wallet);

const CONFIG = {
    risk: 0.10,          
    targetProfit: 5.0,   
    stopLoss: -5.0,     
    auto: false          
};

// SIMULATION STATE
let SIM_MODE = true; // Default to Safe Mode
let SIM_BALANCE = 10.0; // 10 ETH Fake Balance

// TRADING STATE
let ACTIVE_POSITION = null; 

console.clear();
console.log(`╔════════════════════════════════╗`.cyan);
console.log(`║ 🦍 APEX HYBRID v2400 ONLINE    ║`.cyan);
console.log(`║ 🧪 DEFAULT MODE: SIMULATION    ║`.cyan);
console.log(`╚════════════════════════════════╝`.cyan);


// ==========================================
// 2. MARKET SCANNER
// ==========================================
async function runScan(chatId) {
    if (ACTIVE_POSITION) {
        bot.sendMessage(chatId, `🔒 **Holding Position:** ${ACTIVE_POSITION.token}. Waiting for sell.`);
        return;
    }

    try {
        // DETERMINE BALANCE (Real vs Fake)
        let ethBal, tradeEth;
        
        if (SIM_MODE) {
            ethBal = SIM_BALANCE;
            tradeEth = ethBal * CONFIG.risk; // No gas reserve needed for sim
        } else {
            const bal = await provider.getBalance(wallet.address);
            ethBal = parseFloat(ethers.formatEther(bal));
            tradeEth = (ethBal - 0.01) * CONFIG.risk;
        }

        if (tradeEth < 0.005) {
            bot.sendMessage(chatId, `⚠️ **Low Balance (${SIM_MODE ? "Sim" : "Real"}):** ${ethBal.toFixed(4)} ETH.`);
            CONFIG.auto = false;
            return;
        }

        const modeIcon = SIM_MODE ? "🧪" : "🚨";
        bot.sendMessage(chatId, `${modeIcon} **Scanning (${SIM_MODE ? "Sim" : "Real"})...**\n💰 Bal: ${ethBal.toFixed(4)} ETH\n🎲 Bet: ${tradeEth.toFixed(4)} ETH`);

        // 1. FETCH TRENDS (Real Data)
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

        // 2. EXECUTE BUY (Router Logic handles Sim vs Real)
        await executeBuy(chatId, bestToken, tradeEth);

    } catch (e) {
        console.log(`[SCAN ERROR] ${e.message}`.red);
        if(CONFIG.auto) setTimeout(() => runScan(chatId), 15000);
    }
}


// ==========================================
// 3. BUY ENGINE (Hybrid)
// ==========================================
async function executeBuy(chatId, token, amountEth) {
    try {
        const amountInWei = ethers.parseEther(amountEth.toFixed(18));
        const path = [WETH_ADDR, token.address];

        if (SIM_MODE) {
            // --- SIMULATION PATH ---
            bot.sendMessage(chatId, `🧪 **SIMULATING BUY: ${token.symbol}**`);
            
            // Call Router (View Only) to get Real Rate
            const amounts = await router.getAmountsOut(amountInWei, path);
            const tokensReceived = amounts[1]; // Amount of Tokens for ETH

            // Deduct Fake ETH
            SIM_BALANCE -= amountEth;

            ACTIVE_POSITION = {
                token: token.symbol,
                address: token.address,
                tokensHeld: tokensReceived, // BigInt
                entryEth: parseFloat(amountEth),
                decimals: 18, // Assume 18 for sim, or fetch if needed
                chatId: chatId,
                isSim: true
            };

            bot.sendMessage(chatId, `✅ **SIMULATED FILL.**\nSpent: ${amountEth.toFixed(4)} Fake ETH\nGot: ${ethers.formatEther(tokensReceived)} ${token.symbol}\nNew Fake Bal: ${SIM_BALANCE.toFixed(4)} ETH`);

        } else {
            // --- REALITY PATH ---
            bot.sendMessage(chatId, `🚨 **EXECUTING REAL BUY: ${token.symbol}**`);
            
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
            bot.sendMessage(chatId, `✅ **REAL BUY CONFIRMED.** Holding ${token.symbol}`);
        }

    } catch (e) {
        bot.sendMessage(chatId, `❌ **Buy Failed:** ${e.message}`);
        if(CONFIG.auto) setTimeout(() => runScan(chatId), 10000);
    }
}


// ==========================================
// 4. SELL ENGINE (Hybrid)
// ==========================================
async function executeSell(chatId, reason) {
    if (!ACTIVE_POSITION) return;
    const pos = ACTIVE_POSITION;

    try {
        const mode = pos.isSim ? "🧪 SIM" : "🚨 REAL";
        bot.sendMessage(chatId, `${mode} **SELLING ${pos.token}**\nReason: ${reason}`);

        if (pos.isSim) {
            // --- SIMULATION SELL ---
            const path = [pos.address, WETH_ADDR];
            // Get Real Market Value for tokens
            const amounts = await router.getAmountsOut(pos.tokensHeld, path);
            const ethRecieved = parseFloat(ethers.formatEther(amounts[1]));

            SIM_BALANCE += ethRecieved;
            const profit = ethRecieved - pos.entryEth;

            bot.sendMessage(chatId, `✅ **SIMULATED SELL.**\nRecieved: ${ethRecieved.toFixed(4)} Fake ETH\nProfit: ${profit.toFixed(4)} ETH\n💰 Wallet: ${SIM_BALANCE.toFixed(4)} ETH`);
            
            ACTIVE_POSITION = null;

        } else {
            // --- REAL SELL ---
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
            
            bot.sendMessage(chatId, `✅ **REAL SELL CONFIRMED.** Capital Returned.`);
            ACTIVE_POSITION = null;
        }

        // RESTART LOOP
        if (CONFIG.auto) {
            bot.sendMessage(chatId, `♻️ **Restarting Scan in 10s...**`);
            setTimeout(() => runScan(chatId), 10000);
        }

    } catch (e) {
        bot.sendMessage(chatId, `❌ **SELL FAILED:** ${e.message}`);
    }
}


// ==========================================
// 5. PRICE WATCHER (Works for Sim & Real)
// ==========================================
async function watchPrice() {
    if (!ACTIVE_POSITION) return;
    const pos = ACTIVE_POSITION;

    try {
        const path = [pos.address, WETH_ADDR];
        const amounts = await router.getAmountsOut(pos.tokensHeld, path);
        const currEth = parseFloat(ethers.formatEther(amounts[1]));

        const pnl = ((currEth - pos.entryEth) / pos.entryEth) * 100;
        
        console.log(`[${pos.isSim ? "SIM" : "REAL"}] ${pos.token}: ${pnl.toFixed(2)}% ($${currEth.toFixed(4)})`.gray);

        if (pnl >= CONFIG.targetProfit) {
            await executeSell(pos.chatId, `Profit Target Hit (+${pnl.toFixed(2)}%)`);
        } else if (pnl <= CONFIG.stopLoss) {
            await executeSell(pos.chatId, `Stop Loss Hit (${pnl.toFixed(2)}%)`);
        }

    } catch (e) {
        console.log(`[PRICE ERROR] ${e.message}`);
    }
}

setInterval(watchPrice, 5000); // Check every 5s


// ==========================================
// 6. COMMANDS
// ==========================================
bot.onText(/\/simulate/, (msg) => {
    if(ACTIVE_POSITION && !ACTIVE_POSITION.isSim) return bot.sendMessage(msg.chat.id, "❌ Cannot switch: Real trade active.");
    SIM_MODE = true;
    SIM_BALANCE = 10.0; // Reset fake money
    bot.sendMessage(msg.chat.id, "🧪 **SIMULATION MODE ACTIVE**\nBalance: 10.0 Fake ETH\nRisk: Zero");
});

bot.onText(/\/real/, (msg) => {
    if(ACTIVE_POSITION) return bot.sendMessage(msg.chat.id, "❌ Cannot switch: Close position first.");
    SIM_MODE = false;
    bot.sendMessage(msg.chat.id, "🚨 **REAL MONEY MODE ACTIVE**\n⚠️ TRADES WILL SPEND REAL ETH ⚠️");
});

bot.onText(/\/auto/, (msg) => {
    CONFIG.auto = true;
    bot.sendMessage(msg.chat.id, `♾️ **LOOP STARTED** (${SIM_MODE ? "Sim" : "Real"})`);
    runScan(msg.chat.id);
});

bot.onText(/\/stop/, (msg) => {
    CONFIG.auto = false;
    bot.sendMessage(msg.chat.id, "🛑 **STOPPED.**");
});

bot.onText(/\/status/, async (msg) => {
    const mode = SIM_MODE ? "🧪 SIMULATION" : "🚨 REAL MONEY";
    let balText = "";
    
    if (SIM_MODE) {
        balText = `${SIM_BALANCE.toFixed(4)} Fake ETH`;
    } else {
        const bal = await provider.getBalance(wallet.address);
        balText = `${ethers.formatEther(bal)} Real ETH`;
    }

    let posText = ACTIVE_POSITION ? `🎒 Holding: ${ACTIVE_POSITION.token}` : "🤷‍♂️ Flat";
    
    bot.sendMessage(msg.chat.id, `
📊 **STATUS REPORT**
Mode: ${mode}
Wallet: ${balText}
Status: ${posText}
    `);
});

bot.onText(/\/sell/, (msg) => {
    if(!ACTIVE_POSITION) return bot.sendMessage(msg.chat.id, "No position.");
    executeSell(msg.chat.id, "Manual Command");
});

// HTTP Keep-Alive
http.createServer((req, res) => res.end("Alive")).listen(8080);
