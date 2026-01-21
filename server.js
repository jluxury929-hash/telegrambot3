/**
 * ===============================================================================
 * 🦍 APEX PREDATOR: OMEGA TOTALITY v100000.0
 * 🎮 GAMIFIED INTENT ENGINE (RPG + MEV SHIELD)
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- CONFIGURATION ---
const PRIVATE_KEY = process.env.PRIVATE_KEY; 
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; 

// 🛡️ MEV-SHIELDED CLUSTER POOL
const RPC_POOL = [
    "https://rpc.mevblocker.io",        // Primary
    "https://rpc.flashbots.net/fast",   // Secondary
    "https://eth.llamarpc.com"          // Fallback
];

const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Initialize Provider & Wallet
const network = ethers.Network.from(1); 
let provider = new JsonRpcProvider(RPC_POOL[0], network, { staticNetwork: network });
let wallet = new Wallet(PRIVATE_KEY, provider);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Prevent Polling Errors
bot.on('polling_error', (error) => console.log(`[POLLING ERROR] ${error.code}`.red));

let router = new Contract(ROUTER_ADDR, [
    "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
    "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])",
    "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"
], wallet);

// ==========================================
// 🎮 GAME STATE (RPG LAYER)
// ==========================================

let PLAYER = {
    level: 1,
    xp: 0,
    nextLevelXp: 1000,
    class: "HUNTING CUB", 
    dailyQuests: [
        { id: 'sim', task: "Scan 5 Tokens", count: 0, target: 5, done: false, xp: 150 },
        { id: 'trade', task: "Execute 1 MEV-Shielded Trade", count: 0, target: 1, done: false, xp: 500 }
    ],
    inventory: ["MEV Shield v1 (Active)", "Gas Goggles (Active)"],
    streak: 1
};

// --- RPG LOGIC HELPERS ---
const addXP = (amount, chatId) => {
    PLAYER.xp += amount;
    // Check Level Up
    if (PLAYER.xp >= PLAYER.nextLevelXp) {
        PLAYER.level++;
        PLAYER.xp -= PLAYER.nextLevelXp;
        PLAYER.nextLevelXp = Math.floor(PLAYER.nextLevelXp * 1.5);
        PLAYER.class = getRankName(PLAYER.level);
        bot.sendMessage(chatId, `🎉 **LEVEL UP!**\nYou are now Level ${PLAYER.level} (${PLAYER.class}).\n*Inventory upgraded.*`);
    }
};

const getRankName = (lvl) => {
    if (lvl < 5) return "HUNTING CUB";
    if (lvl < 10) return "APEX STRIKER";
    if (lvl < 20) return "WHALE HUNTER";
    return "MARKET GOD";
};

const updateQuest = (type, chatId) => {
    let questCompleted = false;
    PLAYER.dailyQuests.forEach(q => {
        if (q.id === type && !q.done) {
            q.count++;
            if (q.count >= q.target) {
                q.done = true;
                addXP(q.xp, chatId);
                questCompleted = true;
                bot.sendMessage(chatId, `✅ **QUEST COMPLETE:** ${q.task}\n+${q.xp} XP`);
            }
        }
    });
};

const getXpBar = () => {
    const progress = Math.min(Math.round((PLAYER.xp / PLAYER.nextLevelXp) * 10), 10);
    return "🟩".repeat(progress) + "⬜".repeat(10 - progress);
};

// ==========================================
// ⚙️ SYSTEM STATE (TRADING ENGINE)
// ==========================================

const SYSTEM = {
    autoPilot: false,
    isLocked: false,
    nonce: null,
    tradeAmount: "0.01",   
    slippage: 50,          
    minGasBuffer: ethers.parseEther("0.008"),
    trailingStopPercent: 5, 
    activePosition: null   
};

// ==========================================
// 🚀 SATURATION ENGINE (BUY/SELL)
// ==========================================

async function forceConfirm(chatId, type, tokenSym, txBuilder) {
    let attempt = 1;
    SYSTEM.nonce = await provider.getTransactionCount(wallet.address, "latest");

    const broadcast = async (bribe) => {
        const fee = await provider.getFeeData();
        const maxFee = (fee.maxFeePerGas || fee.gasPrice) + bribe;

        const txReq = await txBuilder(bribe, maxFee, SYSTEM.nonce);
        const signedTx = await wallet.signTransaction(txReq);

        RPC_POOL.forEach(url => {
            axios.post(url, { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [signedTx] }).catch(() => {});
        });

        return await provider.broadcastTransaction(signedTx);
    };

    const initialBribe = (await provider.getFeeData()).maxPriorityFeePerGas * 150n / 100n;
    bot.sendMessage(chatId, `🛡️ **${type} ${tokenSym}:** Broadcasting via MEV-Shield Cluster...`);
    
    let tx = await broadcast(initialBribe);
    let currentBribe = initialBribe;

    while (true) {
        try {
            const receipt = await Promise.race([
                tx.wait(1),
                new Promise((_, reject) => setTimeout(() => reject(new Error("STALL")), 12000))
            ]);

            if (receipt && receipt.status === 1n) {
                bot.sendMessage(chatId, `✅ **CONFIRMED:** ${type} ${tokenSym} Successful. Block: ${receipt.blockNumber}`);
                
                // 🎮 RPG UPDATE: Successful Trade
                addXP(100, chatId); // Base XP for trading
                updateQuest('trade', chatId); // Check trade quest
                
                return receipt;
            }
        } catch (err) {
            if (attempt < 5) {
                attempt++;
                currentBribe = (currentBribe * 160n) / 100n; 
                bot.sendMessage(chatId, `🔄 **STALL:** Bumping gas to ${ethers.formatUnits(currentBribe, 'gwei')} Gwei...`);
                tx = await broadcast(currentBribe);
            } else {
                bot.sendMessage(chatId, `❌ **ABORT:** ${type} Failed. Network too congested.`);
                return null;
            }
        }
    }
}

// ==========================================
// 📉 DYNAMIC PEAK MONITOR
// ==========================================

async function runProfitMonitor(chatId) {
    if (!SYSTEM.activePosition || SYSTEM.isLocked) return;
    SYSTEM.isLocked = true;

    try {
        const { address, amount, entryPrice, highestPriceSeen, symbol } = SYSTEM.activePosition;
        const amounts = await router.getAmountsOut(amount, [address, WETH]);
        const currentEthValue = amounts[1];
        
        const currentPriceFloat = parseFloat(ethers.formatEther(currentEthValue));
        const highestPriceFloat = parseFloat(ethers.formatEther(highestPriceSeen));

        // Update Peak
        if (currentPriceFloat > highestPriceFloat) {
            SYSTEM.activePosition.highestPriceSeen = currentEthValue;
        }

        const dropFromPeak = ((highestPriceFloat - currentPriceFloat) / highestPriceFloat) * 100;
        const totalProfit = ((currentPriceFloat - parseFloat(ethers.formatEther(entryPrice))) / parseFloat(ethers.formatEther(entryPrice))) * 100;

        if (dropFromPeak >= SYSTEM.trailingStopPercent && totalProfit > 1) {
            if (SYSTEM.autoPilot) {
                bot.sendMessage(chatId, `📉 **PEAK REVERSAL:** ${symbol} dropped ${dropFromPeak.toFixed(2)}% from top. Securing ${totalProfit.toFixed(2)}% profit.`);
                await executeSell(chatId);
            } else {
                bot.sendMessage(chatId, `⚠️ **PEAK DETECTED:** ${symbol} reversed from top!\n💰 **Profit:** ${totalProfit.toFixed(2)}%\nType \`/sell ${symbol}\` NOW.`);
            }
        } 
        else if (totalProfit <= -15) {
             if (SYSTEM.autoPilot) {
                bot.sendMessage(chatId, `🛡️ **STOP LOSS:** ${symbol} down 15%. Exiting.`);
                await executeSell(chatId);
             }
        }

    } catch (e) { console.log(`[MONITOR] Tracking...`.gray); }
    finally {
        SYSTEM.isLocked = false;
        setTimeout(() => runProfitMonitor(chatId), 4000); 
    }
}

async function executeSell(chatId) {
    const { address, amount, symbol } = SYSTEM.activePosition;
    
    const tokenContract = new Contract(address, ["function approve(address, uint) returns (bool)"], wallet);
    await (await tokenContract.approve(ROUTER_ADDR, amount)).wait();

    const receipt = await forceConfirm(chatId, "SELL", symbol, async (bribe, maxFee, nonce) => {
        return await router.swapExactTokensForETH.populateTransaction(
            amount, 0n, [address, WETH], wallet.address, Math.floor(Date.now()/1000)+120,
            { gasLimit: 450000, maxPriorityFeePerGas: bribe, maxFeePerGas: maxFee, nonce: nonce }
        );
    });

    if (receipt) {
        SYSTEM.activePosition = null;
        if (SYSTEM.autoPilot) {
            bot.sendMessage(chatId, "♻️ **ROTATION:** Sell complete. Scanning for next alpha...");
            runScanner(chatId);
        }
    }
}

// ==========================================
// 🔭 SCANNER & ENTRY
// ==========================================

async function runScanner(chatId) {
    if (SYSTEM.activePosition) return; 

    try {
        // 🎮 RPG UPDATE: Quest Progress
        updateQuest('sim', chatId);

        const bal = await provider.getBalance(wallet.address);
        if (bal < SYSTEM.minGasBuffer) {
            bot.sendMessage(chatId, `🛑 **HALT:** Low Balance (${ethers.formatEther(bal)} ETH).`);
            SYSTEM.autoPilot = false;
            return;
        }

        const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
        const target = res.data ? res.data[0] : null;

        if (target) {
            const tradeValue = ethers.parseEther(SYSTEM.tradeAmount);
            const amounts = await router.getAmountsOut(tradeValue, [WETH, target.tokenAddress]);
            const minOut = (amounts[1] * BigInt(10000 - SYSTEM.slippage)) / 10000n;

            const receipt = await forceConfirm(chatId, "BUY", target.symbol, async (bribe, maxFee, nonce) => {
                return await router.swapExactETHForTokens.populateTransaction(
                    minOut, [WETH, target.tokenAddress], wallet.address, Math.floor(Date.now()/1000)+120,
                    { value: tradeValue, gasLimit: 400000, maxPriorityFeePerGas: bribe, maxFeePerGas: maxFee, nonce: nonce, type: 2 }
                );
            });

            if (receipt) {
                SYSTEM.activePosition = {
                    address: target.tokenAddress,
                    symbol: target.symbol,
                    entryPrice: tradeValue,
                    amount: minOut,
                    highestPriceSeen: tradeValue 
                };
                runProfitMonitor(chatId); 
            }
        }
    } catch (e) { console.log(`[SCAN]`.gray); }
    finally {
        if (SYSTEM.autoPilot && !SYSTEM.activePosition) setTimeout(() => runScanner(chatId), 5000);
    }
}

// ==========================================
// 🕹️ COMMANDS & UI
// ==========================================

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `
🦍 **APEX TOTALITY: THE GREAT HUNT** \`————————————————————————————\`
**Welcome to the Arena, Operator.**

🔹 **GAME COMMANDS:**
\`/profile\` - Check Level, XP, Rank.
\`/quests\` - View Daily Bounties.
\`/inventory\` - Tactical Gear.

🔹 **TRADING COMMANDS:**
\`/auto\` - Toggle Infinite Rotation.
\`/manual\` - Peak Signal Spotter Mode.
\`/status\` - Wallet & Engine Status.

**Current Difficulty:** \`REAL-MONEY (MAINNET)\`
*Gear up. The next block is yours.*
\`————————————————————————————\``, { parse_mode: "Markdown" });
});

bot.onText(/\/profile/, (msg) => {
    bot.sendMessage(msg.chat.id, `
👤 **OPERATOR PROFILE: ${msg.from.first_name}**
\`————————————————————————————\`
🎖 **Level:** \`${PLAYER.level}\`
🏷 **Class:** \`${PLAYER.class}\`
🔥 **Win Streak:** \`${PLAYER.streak} Days\`

**XP PROGRESS:** [${PLAYER.xp}/${PLAYER.nextLevelXp}]
${getXpBar()}

📦 **INVENTORY:** \`${PLAYER.inventory.join(", ")}\`
\`————————————————————————————\``, { parse_mode: "Markdown" });
});

bot.onText(/\/quests/, (msg) => {
    const questList = PLAYER.dailyQuests.map(q => `${q.done ? '✅' : '⬜'} ${q.task} (${q.count}/${q.target})`).join("\n");
    bot.sendMessage(msg.chat.id, `
📜 **DAILY BOUNTIES**
\`————————————————————————————\`
Complete these to earn bonus XP!

${questList}

🎁 **Reward:** \`XP Boost & Status\`
\`————————————————————————————\``, { parse_mode: "Markdown" });
});

bot.onText(/\/inventory/, (msg) => {
    bot.sendMessage(msg.chat.id, `
🎒 **TACTICAL GEAR**
\`————————————————————————————\`
🛡 **MEV Shield:** \`ACTIVE\` (Cluster Broadcasting Enabled)
🥽 **Gas Goggles:** \`ACTIVE\` (Auto-Bribe Escalation)
🧪 **Sim-Vial:** \`Infinite\` (Scanning DEXs continuously)
\`————————————————————————————\``, { parse_mode: "Markdown" });
});

bot.onText(/\/status/, async (msg) => {
    const bal = await provider.getBalance(wallet.address);
    let bag = SYSTEM.activePosition ? `${SYSTEM.activePosition.symbol}` : "None";
    bot.sendMessage(msg.chat.id, `
📊 **ENGINE STATUS**
\`————————————————————————————\`
💰 **Exact Balance:** \`${ethers.formatUnits(bal, 18)}\` ETH
🤖 **Mode:** ${SYSTEM.autoPilot ? '🟢 AUTO-PILOT' : '🔴 MANUAL'}
💼 **Holding:** ${bag}
🛡 **MEV Protection:** \`CLUSTER ACTIVE\`
\`————————————————————————————\``, { parse_mode: "Markdown" });
});

bot.onText(/\/auto/, (msg) => {
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    if (SYSTEM.autoPilot) {
        bot.sendMessage(msg.chat.id, "🚀 **AUTOPILOT ENGAGED.**\nLogic: Buy -> Track Peak -> Sell on Reversal -> Rotate.");
        runScanner(msg.chat.id);
    } else {
        bot.sendMessage(msg.chat.id, "🛑 **AUTOPILOT OFF.** Switching to Manual Signal Mode.");
        runProfitMonitor(msg.chat.id); 
    }
});

bot.onText(/\/sell (.+)/, async (msg, match) => {
    if (SYSTEM.activePosition) {
        await executeSell(msg.chat.id);
    } else {
        bot.sendMessage(msg.chat.id, "⚠️ No active position to sell.");
    }
});

bot.onText(/\/manual/, (msg) => {
    SYSTEM.autoPilot = false;
    bot.sendMessage(msg.chat.id, "👀 **MANUAL MODE:** I will watch the charts. Wait for my 'PEAK REVERSAL' signal.");
    if (SYSTEM.activePosition) runProfitMonitor(msg.chat.id);
});

http.createServer((req, res) => res.end("V100000_RPG_ONLINE")).listen(8080);
console.log("🦍 APEX TOTALITY v100000 ONLINE [RPG + TRADING MERGED].".magenta);
