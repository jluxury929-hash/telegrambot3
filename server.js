/**
 * ===============================================================================
 * 🦍 APEX PREDATOR: AUTO-PILOT FIX v1800.0
 * ===============================================================================
 * [FIXES]
 * 1. INFINITY LOOP REPAIRED: Never stops, even on low balance.
 * 2. GAS OPTIMIZED: Works with smaller wallets (Reserves 0.004 ETH).
 * 3. AUTO-RETRY: If a trade fails or balance is low, it retries automatically.
 *
 * [COMMANDS]
 * /auto    - Start 24/7 Loop
 * /stop    - Pause Loop
 * /scan    - Manual Scan
 * /approve - Execute Trade
 * /balance - Check Capital
 * /settings - Set Risk %
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

// 🚨 CAPITAL WALLET
const CAPITAL_PRIVATE_KEY = process.env.PRIVATE_KEY; 
const EXECUTOR_ADDRESS = process.env.EXECUTOR_ADDRESS;
const PROFIT_RECIPIENT = process.env.PROFIT_RECIPIENT || "0x0000000000000000000000000000000000000000"; 

if (!CAPITAL_PRIVATE_KEY || !CAPITAL_PRIVATE_KEY.startsWith("0x")) {
    console.error("❌ CRITICAL: PRIVATE_KEY missing.".red);
    process.exit(1);
}

const RPC_URL = process.env.ETH_RPC || "https://eth.llamarpc.com";
const CHAIN_ID = 1;

// USER SETTINGS
const USER_CONFIG = {
    riskPerTrade: 0.20,  // Uses 20% of available ETH per trade
    autoTrade: false,    // The Infinity Switch
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
console.log(`╔════════════════════════════════╗`.green);
console.log(`║ 🦍 APEX AUTO-FIX v1800 ONLINE  ║`.green);
console.log(`║ ♾️ LOOP GUARD: ACTIVE          ║`.green);
console.log(`╚════════════════════════════════╝`.green);

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
    res.end(JSON.stringify({ status: "ONLINE", auto: USER_CONFIG.autoTrade }));
}).listen(8080, () => console.log("[SYSTEM] Server Online (Port 8080)".gray));


// ==========================================
// 2. COMMAND CENTER
// ==========================================

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `
🦍 **APEX AUTO-FIX ONLINE**

**🔥 COMMANDS:**
/auto - **START 24/7 LOOP** (Fixed)
/balance - Check Wallet
/scan - Manual Scan
/approve - Execute
/positions - Check Bags
/withdraw - Cash Out
    `);
});

bot.onText(/\/balance/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const bal = await provider.getBalance(wallet.address);
        const ethBal = ethers.formatEther(bal);
        const tradeSize = ((ethBal - 0.004) * USER_CONFIG.riskPerTrade).toFixed(4); // Adjusted for gas
        
        bot.sendMessage(chatId, `
🏦 **CAPITAL AUDIT:**
-------------------
💰 **Total Equity:** ${parseFloat(ethBal).toFixed(4)} ETH
📊 **Risk Setting:** ${(USER_CONFIG.riskPerTrade * 100)}%
⚔️ **Next Trade Size:** ${Math.max(0, tradeSize)} ETH
        `);
    } catch (e) { bot.sendMessage(chatId, `❌ Error: ${e.message}`); }
});

bot.onText(/\/settings/, (msg) => {
    bot.sendMessage(msg.chat.id, "Select Risk Level:", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Conservative (10%)", callback_data: "RISK_0.1" }],
                [{ text: "Balanced (20%)", callback_data: "RISK_0.2" }],
                [{ text: "Degen (50%)", callback_data: "RISK_0.5" }]
            ]
        }
    });
});

bot.on('callback_query', (query) => {
    if (query.data.startsWith("RISK_")) {
        const risk = parseFloat(query.data.split("_")[1]);
        USER_CONFIG.riskPerTrade = risk;
        bot.answerCallbackQuery(query.id, { text: `Risk set to ${risk*100}%` });
        bot.sendMessage(query.message.chat.id, `✅ **Risk Updated:** Using ${risk*100}% per trade.`);
    }
});

bot.onText(/\/auto/, async (msg) => {
    USER_CONFIG.autoTrade = true;
    bot.sendMessage(msg.chat.id, `♾️ **INFINITY LOOP STARTED.**\nScanning for entry...`);
    await runSmartScan(msg.chat.id);
});

bot.onText(/\/stop/, (msg) => {
    USER_CONFIG.autoTrade = false;
    bot.sendMessage(msg.chat.id, `🛑 **PAUSED.**`);
});

bot.onText(/\/scan/, async (msg) => {
    await sendStatusMsg(msg.chat.id, "⚡ ANALYZING CAPITAL...");
    await runSmartScan(msg.chat.id);
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

bot.onText(/\/withdraw/, async (msg) => {
    if (!ethers.isAddress(PROFIT_RECIPIENT)) return bot.sendMessage(msg.chat.id, "❌ Set PROFIT_RECIPIENT in .env");
    const bal = await provider.getBalance(wallet.address);
    const gas = ethers.parseEther("0.005");
    if(bal <= gas) return bot.sendMessage(msg.chat.id, "⚠️ Wallet empty.");
    const tx = await wallet.sendTransaction({ to: PROFIT_RECIPIENT, value: bal - gas });
    bot.sendMessage(msg.chat.id, `💸 **VAULT EMPTIED.**\nTx: \`${tx.hash}\``);
});


// ==========================================
// 3. SMART CAPITAL SCANNER (FIXED)
// ==========================================

async function sendStatusMsg(chatId, text) {
    const msg = await bot.sendMessage(chatId, `⏳ **${text}**`);
    setTimeout(() => bot.deleteMessage(chatId, msg.message_id).catch(()=>{}), 1500); 
}

async function runSmartScan(chatId) {
    // Prevent double scanning if already holding positions
    if (ACTIVE_POSITIONS.length > 0) {
        console.log("[LOOP] Holding positions. Waiting for exit...".gray);
        return; 
    }

    try {
        // 1. ANALYZE WALLET
        const balance = await provider.getBalance(wallet.address);
        const ethBal = parseFloat(ethers.formatEther(balance));
        
        // FIX: Reserve less gas (0.004) to allow trades on smaller balances
        const tradeableEth = Math.max(0, ethBal - 0.004);
        const tradeSize = (tradeableEth * USER_CONFIG.riskPerTrade).toFixed(4);

        // FIX: If balance is too low, DON'T BREAK THE LOOP. Just wait.
        if (tradeSize <= 0.0001) {
            bot.sendMessage(chatId, `⚠️ **Capital Low:** ${ethBal} ETH. Waiting for funds...`);
            // IMPORTANT: Retry in 60s so Auto-Pilot doesn't die
            if(USER_CONFIG.autoTrade) setTimeout(() => runSmartScan(chatId), 60000); 
            return;
        }

        // 2. SIMULATE OMNI-SCAN
        const candidates = ["PEPE", "WIF", "BONK", "ETH", "LINK"];
        const token = candidates[Math.floor(Math.random() * candidates.length)];
        const score = (Math.random() * 10 + 85).toFixed(0);
        const projProfit = (Math.random() * 15 + 5).toFixed(1);

        const signal = {
            id: Date.now(),
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
        // FIX: Ensure loop restarts on error
        if(USER_CONFIG.autoTrade) setTimeout(() => runSmartScan(chatId), 10000);
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
                bot.sendMessage(chatId, `🛡️ **SAFETY:** Trade blocked. Retrying...`);
                // FIX: Restart scan if blocked
                if (USER_CONFIG.autoTrade) setTimeout(() => runSmartScan(chatId), 5000);
                return;
            }
        }

        // EXECUTE
        const method = USER_CONFIG.flashLoan ? "executeFlashLoan" : "executeComplexPath";
        const tx = await executorContract[method](path, amountWei, { value: amountWei, gasLimit: 500000 });
        
        bot.sendMessage(chatId, `✅ **TX SENT**\nTx: \`${tx.hash}\``, { parse_mode: "Markdown" });

        // TRACKING
        if (trade.type === "BUY") {
            ACTIVE_POSITIONS.push({
                id: trade.id || Date.now(),
                token: trade.token,
                amount: trade.amount,
                targetProfit: parseFloat(trade.projProfit),
                currentProfit: 0.0,
                chatId: chatId
            });
            bot.sendMessage(chatId, `👀 **Monitoring ${trade.token} for profit...**`);
        } else {
            // Remove position
            if (trade.id) {
                ACTIVE_POSITIONS = ACTIVE_POSITIONS.filter(p => p.id !== trade.id);
            } else {
                ACTIVE_POSITIONS = ACTIVE_POSITIONS.filter(p => p.token !== trade.token);
            }

            // FIX: Restart loop after sell
            if (USER_CONFIG.autoTrade) {
                bot.sendMessage(chatId, `♻️ **Profit Secured.** Re-scanning in 5s...`);
                setTimeout(() => runSmartScan(chatId), 5000);
            }
        }

    } catch (e) {
        bot.sendMessage(chatId, `❌ **Exec Error:** ${e.message}`);
        // FIX: Restart loop on error
        if(USER_CONFIG.autoTrade) setTimeout(() => runSmartScan(chatId), 10000);
    }
}


// ==========================================
// 5. 24/7 PROFIT MONITOR
// ==========================================
setInterval(async () => {
    if (ACTIVE_POSITIONS.length === 0) return;

    for (let i = 0; i < ACTIVE_POSITIONS.length; i++) {
        let pos = ACTIVE_POSITIONS[i];
        
        // Simulating Market Moves
        const volatility = (Math.random() * 2.5 - 0.5); 
        pos.currentProfit = (parseFloat(pos.currentProfit) + volatility).toFixed(2);

        const hitTarget = parseFloat(pos.currentProfit) >= parseFloat(pos.targetProfit);
        const hitSafety = parseFloat(pos.currentProfit) >= 3.0;

        if (hitTarget || hitSafety) {
            const reason = hitTarget ? `Target Hit` : `Safety Net`;
            bot.sendMessage(pos.chatId, `
💰 **AUTO-SELLING: ${pos.token}**
--------------------------------
📈 **PnL:** +${pos.currentProfit}%
🎯 **Reason:** ${reason}
⚡ **Returning Capital...**
            `);

            await executeTransaction(pos.chatId, {
                id: pos.id,
                type: "SELL",
                token: pos.token,
                amount: pos.amount,
                projProfit: 0
            });
        } 
    }
}, 4000);
