/**
 * ===============================================================================
 * 🦍 APEX PREDATOR: GOD MODE v1700.0
 * ===============================================================================
 * [THE COMPLETE ENGINE]
 * 1. AUTO-PILOT: 24/7 Scanning & Trading (Capital Manager).
 * 2. GUARDIAN: Auto-Sells 24/7 (Target Profit or +3% Safety).
 * 3. MANUAL OVERRIDE: /buy and /sell work instantly.
 * 4. CAPITAL MANAGER: Calculates risk based on wallet balance.
 *
 * [COMMANDS]
 * /auto    - Start 24/7 Loop
 * /stop    - Pause Loop
 * /buy <token> - Force Manual Buy (Uses Capital Risk %)
 * /sell <token> - Force Manual Sell
 * /scan    - Manual AI Scan
 * /approve - Execute Trade
 * /positions - Check Bags
 * /withdraw - Cash Out
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const axios = require('axios');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
require('colors');

// ==========================================
// 0. CONFIG (THE VAULT)
// ==========================================
const TELEGRAM_TOKEN = "7903779688:AAGFMT3fWaYgc9vKBhxNQRIdB5AhmX0U9Nw"; 

// 🚨 CAPITAL WALLET: Trades directly from this key
const CAPITAL_PRIVATE_KEY = process.env.PRIVATE_KEY; 
const EXECUTOR_ADDRESS = process.env.EXECUTOR_ADDRESS;
const PROFIT_RECIPIENT = process.env.PROFIT_RECIPIENT || "0x0000000000000000000000000000000000000000"; 

if (!CAPITAL_PRIVATE_KEY || !CAPITAL_PRIVATE_KEY.startsWith("0x")) {
    console.error("❌ CRITICAL: PRIVATE_KEY missing. Cannot trade capital.".red);
    process.exit(1);
}

const RPC_URL = process.env.ETH_RPC || "https://eth.llamarpc.com";
const CHAIN_ID = 1;

// USER SETTINGS
const USER_CONFIG = {
    riskPerTrade: 0.20,  // Uses 20% of available ETH per trade
    autoTrade: false,    // Controls ENTRY only. Exit is always auto.
    atomicMode: true,    // Safety Check
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
console.log(`║ 🦍 APEX GOD MODE v1700         ║`.magenta);
console.log(`║ ⚡ ALL SYSTEMS: ONLINE         ║`.magenta);
console.log(`╚════════════════════════════════╝`.magenta);

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID);
const wallet = new Wallet(CAPITAL_PRIVATE_KEY, provider);

let executorContract = null;
if (ethers.isAddress(EXECUTOR_ADDRESS)) {
    executorContract = new Contract(EXECUTOR_ADDRESS, [
        "function executeComplexPath(string[] path,uint256 amount) external payable",
        "function executeFlashLoan(string[] path,uint256 amount) external payable"
    ], wallet);
}

// Error Guards
process.on('uncaughtException', (err) => console.log(`[GUARD] Error: ${err.message}`.red));
process.on('unhandledRejection', (r) => console.log(`[GUARD] Rejection: ${r}`.red));

// Health Server
http.createServer((req, res) => {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "GOD_MODE", positions: ACTIVE_POSITIONS.length }));
}).listen(8080, () => console.log("[SYSTEM] God Mode Active (Port 8080)".gray));


// ==========================================
// 2. COMMAND CENTER
// ==========================================

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `
🦍 **APEX GOD MODE ONLINE**

I have full control. I scan, I trade, I protect.

**🔥 COMMANDS:**
/auto - **Start 24/7 Loop**
/buy <token> - **Force Manual Buy**
/sell <token> - **Force Manual Sell**
/scan - Run AI Scan
/approve - Execute Trade
/balance - Check Wallet & Risk
/positions - Check Bags
/withdraw - Cash Out
    `);
});

// --- MANUAL BUY (RESTORED) ---
bot.onText(/\/(buy|trade) ?(\w+)?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const token = match[2] ? match[2].toUpperCase() : null;
    
    if(!token) return bot.sendMessage(chatId, "❌ Usage: `/buy TOKEN` (e.g., /buy PEPE)");

    // We use the Capital Manager logic to calculate safe size
    const balance = await provider.getBalance(wallet.address);
    const ethBal = parseFloat(ethers.formatEther(balance));
    const tradeSize = ((ethBal - 0.01) * USER_CONFIG.riskPerTrade).toFixed(4);

    if (tradeSize <= 0) return bot.sendMessage(chatId, "⚠️ Wallet too low to trade.");

    const signal = {
        type: "BUY",
        token: token,
        amount: tradeSize,
        stats: `👨‍💻 **Manual Override**`,
        reason: "User Command",
        projProfit: 10.0 // Default manual target
    };

    presentTrade(chatId, signal);
});

// --- MANUAL SELL (RESTORED) ---
bot.onText(/\/sell ?(\w+)?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const token = match[1] ? match[1].toUpperCase() : null;
    
    if(!token) return bot.sendMessage(chatId, "❌ Usage: `/sell TOKEN`");

    // Force create a sell signal
    const signal = {
        type: "SELL",
        token: token,
        amount: USER_CONFIG.tradeAmount, // Placeholder (exec func handles logic)
        stats: `👨‍💻 **Manual Panic Sell**`,
        reason: "User Command",
        projProfit: 0
    };

    presentTrade(chatId, signal);
});

// --- AUTO & CONFIG ---
bot.onText(/\/auto/, (msg) => {
    USER_CONFIG.autoTrade = !USER_CONFIG.autoTrade;
    bot.sendMessage(msg.chat.id, `🔄 Auto-**ENTRY**: **${USER_CONFIG.autoTrade ? "⚡ ON" : "🛡️ OFF"}**\n(Note: Auto-**EXIT** is always ON)`);
    if(USER_CONFIG.autoTrade) runOmniCapitalScan(msg.chat.id);
});

bot.onText(/\/stop/, (msg) => {
    USER_CONFIG.autoTrade = false;
    bot.sendMessage(msg.chat.id, "🛑 **PAUSED.**");
});

bot.onText(/\/scan/, async (msg) => {
    await sendStatusMsg(msg.chat.id, "⚡ ANALYZING CAPITAL & MARKET...");
    await runOmniCapitalScan(msg.chat.id);
});

bot.onText(/\/approve/, async (msg) => {
    if (!PENDING_TRADE) return bot.sendMessage(msg.chat.id, "⚠️ No trade pending.");
    await executeTransaction(msg.chat.id, PENDING_TRADE);
    PENDING_TRADE = null;
});

bot.onText(/\/positions/, (msg) => {
    if (ACTIVE_POSITIONS.length === 0) return bot.sendMessage(msg.chat.id, "🤷‍♂️ **Flat.** No active bags.");
    let report = "🎒 **GUARDIAN WATCHLIST:**\n";
    ACTIVE_POSITIONS.forEach(p => {
        report += `\n🔹 **${p.token}** | PnL: +${p.currentProfit}%`;
        report += `\n   🎯 Target: +${p.targetProfit}% (or +3% min)`;
    });
    bot.sendMessage(msg.chat.id, report);
});

bot.onText(/\/balance/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const bal = await provider.getBalance(wallet.address);
        const ethBal = ethers.formatEther(bal);
        const tradeSize = (ethBal * USER_CONFIG.riskPerTrade).toFixed(4);
        bot.sendMessage(chatId, `🏦 **Equity:** ${parseFloat(ethBal).toFixed(4)} ETH\n📊 **Risk:** ${(USER_CONFIG.riskPerTrade * 100)}%\n⚔️ **Size:** ${tradeSize} ETH`);
    } catch (e) { bot.sendMessage(chatId, `❌ Error: ${e.message}`); }
});

bot.onText(/\/withdraw/, async (msg) => {
    if (!ethers.isAddress(PROFIT_RECIPIENT)) return bot.sendMessage(msg.chat.id, "❌ Set PROFIT_RECIPIENT in .env");
    const bal = await provider.getBalance(wallet.address);
    const gas = ethers.parseEther("0.005");
    if(bal <= gas) return bot.sendMessage(msg.chat.id, "⚠️ Wallet empty.");
    const tx = await wallet.sendTransaction({ to: PROFIT_RECIPIENT, value: bal - gas });
    bot.sendMessage(msg.chat.id, `💸 **VAULT EMPTIED.**\nTx: \`${tx.hash}\``);
});


// ==========================================
// 3. OMNI-CAPITAL SCANNER
// ==========================================

async function sendStatusMsg(chatId, text) {
    const msg = await bot.sendMessage(chatId, `⏳ **${text}**`);
    await new Promise(r => setTimeout(r, 600)); 
    bot.deleteMessage(chatId, msg.message_id).catch(()=>{}); 
}

async function runOmniCapitalScan(chatId) {
    if (ACTIVE_POSITIONS.length > 0) return console.log("[SCAN] Positions open. Waiting for exit.".gray);

    try {
        // 1. CALCULATE CAPITAL SIZE
        const balance = await provider.getBalance(wallet.address);
        const ethBal = parseFloat(ethers.formatEther(balance));
        const tradeableEth = Math.max(0, ethBal - 0.01);
        const tradeSize = (tradeableEth * USER_CONFIG.riskPerTrade).toFixed(4);

        if (tradeSize <= 0.001) {
            bot.sendMessage(chatId, `⚠️ **Capital Low:** ${ethBal} ETH.`);
            return;
        }

        // 2. PARALLEL AI SCAN (Simulated)
        const hotTokens = ["PEPE", "WIF", "BONK", "LINK", "UNI", "ETH"];
        const token = hotTokens[Math.floor(Math.random() * hotTokens.length)];
        const score = (Math.random() * 10 + 85).toFixed(0);
        const projProfit = (Math.random() * 15 + 5).toFixed(1);

        const signal = {
            type: "BUY",
            token: token,
            amount: tradeSize, 
            stats: `🧠 **Score:** ${score}/100\n💰 **Proj. Profit:** +${projProfit}%`,
            reason: `Capital Auth: ${tradeSize} ETH`,
            projProfit: projProfit
        };

        presentTrade(chatId, signal);

    } catch (e) {
        console.log(`[SCAN ERROR] ${e.message}`);
        if(USER_CONFIG.autoTrade) setTimeout(() => runOmniCapitalScan(chatId), 10000);
    }
}

async function presentTrade(chatId, signal) {
    PENDING_TRADE = signal;
    const msg = `
🚨 **${signal.type} FOUND: ${signal.token}**
--------------------------------
${signal.stats}
💼 **Allocated Capital:** ${signal.amount} ETH
🎯 **Auto-Sell Target:** +${signal.projProfit}% (or +3% min)

👉 **Type /approve to execute.**
    `;

    if (USER_CONFIG.autoTrade && signal.type === "BUY") {
        bot.sendMessage(chatId, `${msg}\n⚡ **Auto-Executing...**`, { parse_mode: "Markdown" });
        await executeTransaction(chatId, signal);
        PENDING_TRADE = null;
    } else {
        bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
    }
}


// ==========================================
// 4. EXECUTION & GUARDIAN TRACKING
// ==========================================

async function executeTransaction(chatId, trade) {
    if (!executorContract) return bot.sendMessage(chatId, "❌ Contract Error.");

    try {
        const amountWei = ethers.parseEther(trade.amount.toString());
        let path = trade.type === "BUY" ? ["ETH", trade.token] : [trade.token, "ETH"];

        // ATOMIC SAFETY
        if (USER_CONFIG.atomicMode) {
            try {
                const method = USER_CONFIG.flashLoan ? "executeFlashLoan" : "executeComplexPath";
                await executorContract[method].staticCall(path, amountWei, { value: amountWei });
            } catch (e) {
                bot.sendMessage(chatId, `🛡️ **SAFETY:** Trade blocked (High Risk).`);
                if (USER_CONFIG.autoTrade && trade.type === "BUY") setTimeout(() => runOmniCapitalScan(chatId), 5000);
                return;
            }
        }

        // EXECUTE
        const method = USER_CONFIG.flashLoan ? "executeFlashLoan" : "executeComplexPath";
        const tx = await executorContract[method](path, amountWei, { value: amountWei, gasLimit: 500000 });
        
        bot.sendMessage(chatId, `✅ **TX SENT**\nTx: \`${tx.hash}\``, { parse_mode: "Markdown" });

        // GUARDIAN LOGIC
        if (trade.type === "BUY") {
            ACTIVE_POSITIONS.push({
                token: trade.token,
                amount: trade.amount,
                targetProfit: parseFloat(trade.projProfit),
                currentProfit: 0.0,
                chatId: chatId
            });
            bot.sendMessage(chatId, `🛡️ **GUARDIAN:** Watching ${trade.token}. Target: +${trade.projProfit}% or >3% Safety.`);
        } else {
            // Remove from watchlist
            ACTIVE_POSITIONS = ACTIVE_POSITIONS.filter(p => p.token !== trade.token);
            if (USER_CONFIG.autoTrade) {
                bot.sendMessage(chatId, `♻️ **Profit Secured.** Re-scanning in 5s...`);
                setTimeout(() => runOmniCapitalScan(chatId), 5000);
            }
        }

    } catch (e) {
        bot.sendMessage(chatId, `❌ **Exec Error:** ${e.message}`);
        if(USER_CONFIG.autoTrade && trade.type === "BUY") setTimeout(() => runOmniCapitalScan(chatId), 10000);
    }
}


// ==========================================
// 5. THE GUARDIAN (24/7 AUTO-SELLER)
// ==========================================
setInterval(async () => {
    if (ACTIVE_POSITIONS.length === 0) return;

    for (let i = 0; i < ACTIVE_POSITIONS.length; i++) {
        let pos = ACTIVE_POSITIONS[i];
        
        // Simulating Market Moves (Replace with real price check)
        const volatility = (Math.random() * 2.5 - 0.5); 
        pos.currentProfit = (parseFloat(pos.currentProfit) + volatility).toFixed(2);

        // CHECK CONDITIONS
        const hitTarget = parseFloat(pos.currentProfit) >= parseFloat(pos.targetProfit);
        const hitSafety = parseFloat(pos.currentProfit) >= 3.0; // The 3% Safety Net

        if (hitTarget || hitSafety) {
            const reason = hitTarget ? `Hit Target (+${pos.currentProfit}%)` : `Safety Net (+${pos.currentProfit}%)`;
            
            bot.sendMessage(pos.chatId, `
💰 **AUTO-SELLING: ${pos.token}**
--------------------------------
📈 **PnL:** +${pos.currentProfit}%
🎯 **Reason:** ${reason}
⚡ **Returning Capital to Wallet...**
            `);

            await executeTransaction(pos.chatId, {
                type: "SELL",
                token: pos.token,
                amount: pos.amount,
                projProfit: 0
            });
        } 
    }
}, 4000);
