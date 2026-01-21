/**
* ===============================================================================
* 🦍 APEX TOTALITY v20.0 | THE RPG GAMIFICATION (LEVELS, XP, & QUESTS)
* ===============================================================================
*/

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// --- 🎮 1. GAME STATE ARCHITECTURE ---
let PLAYER = {
level: 1,
xp: 450,
nextLevelXp: 1000,
class: "HUNTING CUB 🐾", // Dynamic Title
dailyQuests: [
{ task: "Run 3 Simulations", done: false },
{ task: "Protect 0.05 ETH MEV", done: false }
],
inventory: ["MEV Shield v1", "Gas Goggles"],
streak: 5 // Consecutive days active
};

// --- 🎖️ 2. LEVELING LOGIC ---
const getXpBar = () => {
const progress = Math.round((PLAYER.xp / PLAYER.nextLevelXp) * 10);
return "🟦".repeat(progress) + "⬛".repeat(10 - progress);
};

// ==========================================
// 🚀 3. GAMIFIED COMMANDS
// ==========================================

bot.onText(/\/profile/, (msg) => {
bot.sendMessage(msg.chat.id, `
🎮 **OPERATOR PROFILE: ${msg.from.first_name}**
\`————————————————————————————\`
🏅 **Level:** \`${PLAYER.level}\`
🏷️ **Class:** \`${PLAYER.class}\`
🔥 **Win Streak:** \`${PLAYER.streak} Days\`

**XP PROGRESS:** [${PLAYER.xp}/${PLAYER.nextLevelXp}]
${getXpBar()}

🎒 **INVENTORY:** \`${PLAYER.inventory.join(", ")}\`
\`————————————————————————————\``, { parse_mode: "Markdown" });
});

bot.onText(/\/quests/, (msg) => {
const questList = PLAYER.dailyQuests.map(q => `${q.done ? '✅' : '⚔️'} ${q.task}`).join("\n");
bot.sendMessage(msg.chat.id, `
📜 **DAILY BOUNTIES**
\`————————————————————————————\`
Complete these to earn bonus XP and reduce trading fees!

${questList}

🎁 **Reward for all:** \`+250 XP & 0.1x Gas Discount\`
\`————————————————————————————\``, { parse_mode: "Markdown" });
});

bot.onText(/\/inventory/, (msg) => {
bot.sendMessage(msg.chat.id, `
🎒 **TACTICAL GEAR**
\`————————————————————————————\`
🛡️ **MEV Shield:** \`ACTIVE\` (Reduces Sandwich risk by 99%)
🥽 **Gas Goggles:** \`ACTIVE\` (Reveals hidden Gwei trends)
🧪 **Sim-Vial:** \`3 Charges\` (Free high-fidelity simulations)

*Unlock more gear by leveling up.*
\`————————————————————————————\``, { parse_mode: "Markdown" });
});

// ==========================================
// ✨ 4. THE RPG START SCREEN
// ==========================================

bot.onText(/\/start/, (msg) => {
bot.sendMessage(msg.chat.id, `
🦍 **APEX TOTALITY: THE GREAT HUNT** 🦍
\`————————————————————————————\`
**Welcome to the Arena, Operator.**

🎖️ \`/profile\` - Check your Level, XP, and Rank.
📜 \`/quests\` - View daily missions for rewards.
🎒 \`/inventory\` - Manage your tactical MEV gear.
🧪 \`/simulate\` - Enter the Training Sandbox.

**Current Difficulty:** \`${SYSTEM.riskMode}\`
**Mission Horizon:** \`${SYSTEM.horizon}\`

*Gear up. The next block is yours.*
\`————————————————————————————\``, { parse_mode: "Markdown" });
});

console.log("🦍 APEX TOTALITY v20.0 | RPG BUILD ONLINE".magenta);
