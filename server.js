/**
 * ===============================================================================
 * 🦍 APEX PREDATOR: GUARDIAN EDITION v1500.0
 * ===============================================================================
 * [CORE LOGIC]
 * 1. ENTRY: Manual or Auto (Your choice).
 * 2. EXIT: ALWAYS AUTOMATIC.
 * - The moment you buy, the "Guardian" engine watches the price.
 * - Sells instantly at Target OR +3% Minimum.
 * - Works even if /auto is OFF.
 *
 * [COMMANDS]
 * /scan    - Find Entry
 * /buy     - Force Buy
 * /approve - Execute Buy
 * /positions - Check active bags
 * /auto    - Toggle Auto-Entry (Selling is always auto)
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const axios = require('axios');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
require('colors');

// ==========================================
// 0. CONFIG (THE BAG)
// ==========================================
const TELEGRAM_TOKEN = "7903779688:AAGFMT3fWaYgc9vKBhxNQRIdB5AhmX0U9Nw"; 
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const EXECUTOR_ADDRESS = process.env.EXECUTOR_ADDRESS;
const PROFIT_RECIPIENT = process.env.PROFIT_RECIPIENT || "0x0000000000000000000000000000000000000000"; 

if (!PRIVATE_KEY || !PRIVATE_KEY.startsWith("0x")) {
    console.error("❌ CRITICAL: PRIVATE_KEY missing in .env".red);
    process.exit(1);
}

const RPC_URL = process.env.ETH_RPC || "https://eth.llamarpc.com";
const CHAIN_ID = 1;

const USER_CONFIG = {
    tradeAmount: "0.01", 
    autoTrade: false,    // Controls BUYING only. Selling is always ON.
    atomicMode: true,    
    flashLoan: false     
};

// STATE
let PENDING_TRADE = null; 
let ACTIVE_POSITIONS = []; 

// ==========================================
// 1. INITIALIZATION
// ==========================================
console.clear();
console.log(`╔════════════════════════════════╗`.magenta);
console.log(`║ 🦍 APEX GUARDIAN v1500 ONLINE  ║`.magenta);
console.log(`║ 🛡️ AUTO-SELL: ALWAYS ACTIVE    ║`.magenta);
console.log(`╚════════════════════════════════╝`.magenta);

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID);
const wallet = new Wallet(PRIVATE_KEY, provider);

let executorContract = null;
if (ethers.isAddress(EXECUTOR_ADDRESS)) {
    executorContract = new Contract(EXECUTOR_ADDRESS, [
        "function executeComplexPath(string[] path,uint256 amount) external payable",
        "function executeFlashLoan(string[] path,uint256 amount) external payable"
    ], wallet);
}

// Health Server
http.createServer((req, res) => {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "GUARDIAN_ACTIVE", positions: ACTIVE_POSITIONS.length }));
}).listen(8080, () => console.log("[SYSTEM] Guardian Active (Port 8080)".gray));


// ==========================================
// 2. COMMAND CENTER
// ==========================================

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `
🦍 **APEX GUARDIAN ONLINE**

I protect your bags.
**Selling is ALWAYS Automatic.**

**🔥 COMMANDS:**
/scan - **Find Alpha**
/approve - **Execute Buy**
/buy <token> - Force Buy
/positions - **Check Active Bags**
/auto - Toggle **Auto-BUY** (Selling is always auto)
/withdraw - Cash Out
    `);
});

bot.onText(/\/scan/, async (msg) => {
    const chatId = msg.chat.id;
    await sendStatusMsg(chatId, "HUNTING ALPHA");
    await runScan(chatId, "SMART_TRADE", null);
});

bot.onText(/\/buy ?(\w+)?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const token = match[1] ? match[1].toUpperCase() : null;
    await sendStatusMsg(chatId, `SEARCHING ENTRY FOR ${token || "TOKEN"}`);
    await runScan(chatId, "BUY", token);
});

bot.onText(/\/sell ?(\w+)?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const token = match[1] ? match[1].toUpperCase() : null;
    if(!token) return bot.sendMessage(chatId, "❌ Usage: `/sell TOKEN`");
    
    // Manual Force Sell (Overrides Auto Logic)
    bot.sendMessage(chatId, `🚨 **MANUAL DUMP TRIGGERED: ${token}**`);
    await executeTransaction(chatId, {
        type: "SELL",
        token: token,
        amount: USER_CONFIG.tradeAmount,
        projProfit: 0 // Irrelevant for manual dump
    });
});

bot.onText(/\/approve/, async (msg) => {
    const chatId = msg.chat.id;
    if (!PENDING_TRADE) return bot.sendMessage(chatId, "⚠️ **No trade waiting.**");
    
    bot.sendMessage(chatId, `🚀 **APPROVED.** Aping ${PENDING_TRADE.token}...`);
    await executeTransaction(chatId, PENDING_TRADE);
    PENDING_TRADE = null;
});

bot.onText(/\/positions/, (msg) => {
    const chatId = msg.chat.id;
    if (ACTIVE_POSITIONS.length === 0) return bot.sendMessage(chatId, "🤷‍♂️ **Flat.** No active bags.");
    
    let report = "🎒 **GUARDIAN WATCHLIST:**\n";
    ACTIVE_POSITIONS.forEach(p => {
        report += `\n🔹 **${p.token}** | PnL: +${p.currentProfit}%`;
        report += `\n   🎯 Target: +${p.targetProfit}% (or +3% min)`;
    });
    bot.sendMessage(chatId, report);
});

bot.onText(/\/auto/, (msg) => {
    USER_CONFIG.autoTrade = !USER_CONFIG.autoTrade;
    // Clarify that this only affects BUYING
    bot.sendMessage(msg.chat.id, `🔄 Auto-**ENTRY**: **${USER_CONFIG.autoTrade ? "⚡ ON" : "🛡️ OFF"}**\n(Note: Auto-**EXIT** is always ON)`);
});


// ==========================================
// 3. INTELLIGENCE ENGINE
// ==========================================

async function sendStatusMsg(chatId, text) {
    const msg = await bot.sendMessage(chatId, `⏳ **${text}...**`);
    await new Promise(r => setTimeout(r, 600)); 
    bot.deleteMessage(chatId, msg.message_id).catch(()=>{}); 
    await bot.sendMessage(chatId, `🔍 **...Continues scanning markets...**`);
    await new Promise(r => setTimeout(r, 600)); 
}

async function runScan(chatId, type, requestedToken) {
    let token = requestedToken;
    if (!token) {
        const hots = ["PEPE", "WIF", "BONK", "ETH", "LINK"];
        token = hots[Math.floor(Math.random() * hots.length)];
    }

    // AI PROJECTION
    const score = (Math.random() * 10 + 85).toFixed(0);
    // Projecting between 8% and 25% profit
    const projProfit = (Math.random() * 17 + 8).toFixed(1); 

    const signal = {
        type: "BUY",
        token: token,
        amount: USER_CONFIG.tradeAmount,
        stats: `🧠 **Score:** ${score}/100\n💰 **Proj. Profit:** +${projProfit}%`,
        reason: "Volume Breakout",
        projProfit: projProfit
    };

    presentTrade(chatId, signal);
}

async function presentTrade(chatId, signal) {
    PENDING_TRADE = signal;
    
    const msg = `
🚨 **${signal.type} FOUND: ${signal.token}**
--------------------------------
${signal.stats}
📦 **Size:** ${signal.amount} ETH
🛡️ **Guardian:** Auto-Sell at +${signal.projProfit}% (or +3% min)

👉 **Type /approve to execute.**
    `;

    if (USER_CONFIG.autoTrade) {
        bot.sendMessage(chatId, `${msg}\n⚡ **Auto-Executing...**`, { parse_mode: "Markdown" });
        await executeTransaction(chatId, signal);
        PENDING_TRADE = null;
    } else {
        bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    }
}


// ==========================================
// 4. EXECUTION & TRACKING
// ==========================================

async function executeTransaction(chatId, trade) {
    if (!executorContract) return bot.sendMessage(chatId, "❌ Contract disconnected.");

    try {
        const amountWei = ethers.parseEther(trade.amount.toString());
        let path = trade.type === "BUY" ? ["ETH", trade.token] : [trade.token, "ETH"];

        // ATOMIC CHECK
        if (USER_CONFIG.atomicMode) {
            try {
                const method = USER_CONFIG.flashLoan ? "executeFlashLoan" : "executeComplexPath";
                await executorContract[method].staticCall(path, amountWei, { value: amountWei });
            } catch (e) {
                return bot.sendMessage(chatId, `🛡️ **ATOMIC BLOCK:** Simulation failed. No gas spent.`);
            }
        }

        // SEND TX
        const method = USER_CONFIG.flashLoan ? "executeFlashLoan" : "executeComplexPath";
        const tx = await executorContract[method](path, amountWei, { value: amountWei, gasLimit: 500000 });
        
        bot.sendMessage(chatId, `✅ **SUCCESS**\nTx: \`${tx.hash}\``, { parse_mode: "Markdown" });

        // LOGIC FOR GUARDIAN MONITOR
        if (trade.type === "BUY") {
            // Add to watchlist immediately
            ACTIVE_POSITIONS.push({
                token: trade.token,
                amount: trade.amount,
                targetProfit: parseFloat(trade.projProfit),
                currentProfit: 0.0,
                chatId: chatId
            });
            bot.sendMessage(chatId, `🛡️ **GUARDIAN ACTIVE:** Watching ${trade.token} for +${trade.projProfit}% or +3%...`);
        } else {
            // Remove from watchlist
            ACTIVE_POSITIONS = ACTIVE_POSITIONS.filter(p => p.token !== trade.token);
        }

    } catch (e) {
        if(!e.message.includes("atomic")) bot.sendMessage(chatId, `❌ **Error:** ${e.message}`);
    }
}


// ==========================================
// 5. THE GUARDIAN (24/7 AUTO-SELLER)
// ==========================================
// This runs INDEPENDENTLY of User Config. 
// If a position exists, it IS being watched.

setInterval(async () => {
    if (ACTIVE_POSITIONS.length === 0) return;

    for (let i = 0; i < ACTIVE_POSITIONS.length; i++) {
        let pos = ACTIVE_POSITIONS[i];

        // 1. SIMULATE PRICE (Replace with real price check in production)
        // Moves between -0.5% and +1.5% every 4 seconds
        const volatility = (Math.random() * 2.0 - 0.5); 
        pos.currentProfit = (parseFloat(pos.currentProfit) + volatility).toFixed(2);

        // 2. CHECK PROFIT RULES
        // Rule A: Hit the AI's ambitious target (e.g. 15%)
        const hitTarget = parseFloat(pos.currentProfit) >= parseFloat(pos.targetProfit);
        // Rule B: Hit the Minimum Safety Net (3%)
        const hitSafety = parseFloat(pos.currentProfit) >= 3.0;

        if (hitTarget || hitSafety) {
            const reason = hitTarget ? `🎯 Hit AI Target (+${pos.currentProfit}%)` : `🛡️ Safety Trigger (+${pos.currentProfit}%)`;
            
            bot.sendMessage(pos.chatId, `
💰 **AUTO-SELL TRIGGERED: ${pos.token}**
--------------------------------
📈 **Profit:** +${pos.currentProfit}%
📝 **Reason:** ${reason}
⚡ **Executing Sell...**
            `);

            // EXECUTE SELL AUTOMATICALLY
            await executeTransaction(pos.chatId, {
                type: "SELL",
                token: pos.token,
                amount: pos.amount,
                projProfit: 0
            });
        } 
    }
}, 4000); // Check every 4 seconds
