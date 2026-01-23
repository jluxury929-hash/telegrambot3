/**
 * ===============================================================================
 * 🦁 APEX PREDATOR v8000.0 (OMNI-CHAIN WARLORD)
 * ===============================================================================
 * 1. MULTI-CHAIN: Supports Ethereum, Base, Arbitrum, Polygon (Auto-Execute).
 * 2. SOLANA SCANNER: Detects SOL signals (Alert Mode).
 * 3. DYNAMIC ROUTING: Automatically switches Router/RPC based on target chain.
 * 4. SMART GAS: Adjusts gas reserve based on chain cost (L1 vs L2).
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
require('colors');

// --- CONFIGURATION ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const AI_API_URL = process.env.AI_API_URL || null;

// --- CHAIN CONFIGURATION (The Brains) ---
const CHAINS = {
    'ethereum': {
        name: 'Ethereum',
        rpc: "https://rpc.mevblocker.io",
        router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Uniswap V2
        symbol: 'ETH',
        gasReserve: "0.01", // Higher reserve for L1
        scanUrl: "https://etherscan.io/tx/"
    },
    'base': {
        name: 'Base',
        rpc: "https://mainnet.base.org",
        router: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24", // Uniswap V2 on Base
        symbol: 'ETH',
        gasReserve: "0.001", // Low reserve for L2
        scanUrl: "https://basescan.org/tx/"
    },
    'arbitrum': {
        name: 'Arbitrum',
        rpc: "https://arb1.arbitrum.io/rpc",
        router: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24", // Uniswap V2 on Arb
        symbol: 'ETH',
        gasReserve: "0.001",
        scanUrl: "https://arbiscan.io/tx/"
    },
    'polygon': {
        name: 'Polygon',
        rpc: "https://polygon-rpc.com",
        router: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff", // QuickSwap
        symbol: 'POL',
        gasReserve: "1.0", // Reserve 1 MATIC/POL
        scanUrl: "https://polygonscan.com/tx/"
    },
    'solana': {
        name: 'Solana',
        rpc: "https://api.mainnet-beta.solana.com", 
        symbol: 'SOL',
        router: null, // Solana uses different lib
        scanUrl: "https://solscan.io/tx/"
    }
};

// Global Variables (Dynamic)
let currentProvider = null;
let currentWallet = null;
let currentRouter = null;
let currentChain = 'ethereum'; // Default

// Initialize Bot
const bot = new TelegramBot(TELEGRAM_TOKEN, {
    polling: { interval: 100, autoStart: true, params: { timeout: 10 } }
});

// ==========================================
//  CHAIN SWITCHER ENGINE
// ==========================================

async function switchChain(chainKey) {
    if (!CHAINS[chainKey]) return false;
    if (chainKey === 'solana') return 'SOLANA_MODE'; // Special handling

    try {
        // Setup new provider
        const newProvider = new JsonRpcProvider(CHAINS[chainKey].rpc);
        // Setup new wallet
        if (process.env.PRIVATE_KEY) {
            const newWallet = new Wallet(process.env.PRIVATE_KEY, newProvider);
            // Setup new router
            const newRouter = new Contract(CHAINS[chainKey].router, [
                "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
                "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])",
                "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"
            ], newWallet);

            // Commit changes
            currentProvider = newProvider;
            currentWallet = newWallet;
            currentRouter = newRouter;
            currentChain = chainKey;
            
            console.log(`[NETWORK] Switched to ${CHAINS[chainKey].name}`.magenta);
            return true;
        }
    } catch (e) {
        console.log(`[ERROR] Failed to switch to ${chainKey}: ${e.message}`.red);
        return false;
    }
    return false;
}

// Initialize Default Chain
switchChain('ethereum');

// ==========================================
//  SYSTEM STATE
// ==========================================

const RISK_PROFILES = {
    LOW:    { slippage: 50,   stopLoss: 5,  gasMultiplier: 110n, label: "LOW" },
    MEDIUM: { slippage: 200,  stopLoss: 15, gasMultiplier: 125n, label: "MEDIUM" },
    HIGH:   { slippage: 500,  stopLoss: 30, gasMultiplier: 150n, label: "HIGH" },
    DEGEN:  { slippage: 2000, stopLoss: 50, gasMultiplier: 200n, label: "DEGEN" }
};

const STRATEGY_MODES = {
    SCALP:  { trail: 2,  minConf: 0.80, label: "SCALP (2% Drop)" },
    DAY:    { trail: 8,  minConf: 0.85, label: "SWING (8% Drop)" },  
    MOON:   { trail: 20, minConf: 0.90, label: "MOON (20% Drop)" }  
};

let SYSTEM = {
    autoPilot: false,
    isLocked: false,
    nonce: null,
    riskProfile: 'HIGH', 
    strategyMode: 'SCALP',
    tradeStyle: 'PERCENT', 
    tradeValue: 5, 
    
    activePosition: null,
    pendingTarget: null,
    lastTradedToken: null
};

// ==========================================
//  OMNI-CHAIN SECURITY & SIZING
// ==========================================

async function checkTokenSecurity(tokenAddress, chain) {
    if (chain === 'solana') return { safe: true }; // DexScreener handles Sol checks well

    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
        if (!res.data || !res.data.pairs) return { safe: false, reason: "No Data" };

        const pair = res.data.pairs[0];
        
        if (pair.liquidity && pair.liquidity.usd < 1000) return { safe: false, reason: "Low Liquidity" };
        
        // Honeypot Check
        if (pair.txns.h24.buys > 10 && pair.txns.h24.sells === 0) {
            return { safe: false, reason: "HONEYPOT (0 Sells)" };
        }

        return { safe: true };
    } catch (e) { return { safe: false, reason: "API Error" }; }
}

async function getSafeTradeAmount(chatId) {
    if (!currentWallet) return 0n;

    try {
        const balance = await currentProvider.getBalance(currentWallet.address);
        const reserve = ethers.parseEther(CHAINS[currentChain].gasReserve);
        const symbol = CHAINS[currentChain].symbol;

        if (balance <= reserve) {
            bot.sendMessage(chatId, `⚠️ **LOW ${symbol}:** Bal: ${ethers.formatEther(balance)} < Reserve: ${ethers.formatEther(reserve)}`);
            return 0n;
        }

        let amount = 0n;
        const safeBalance = balance - reserve;

        if (SYSTEM.tradeStyle === 'PERCENT') {
            const percentBn = BigInt(Math.floor(SYSTEM.tradeValue * 100)); 
            amount = (safeBalance * percentBn) / 10000n;
        } else {
            amount = ethers.parseEther(SYSTEM.tradeValue.toString());
        }

        if (amount > safeBalance) amount = safeBalance;
        if (amount <= 0n) return 0n;

        return amount;

    } catch (e) { return 0n; }
}

// ==========================================
//  OMNI-CHAIN EXECUTION ENGINE
// ==========================================

async function executeBuy(chatId, target) {
    // 1. SWITCH CHAIN
    const switchResult = await switchChain(target.chain);
    
    if (switchResult === 'SOLANA_MODE') {
        return bot.sendMessage(chatId, `☀️ **SOLANA SIGNAL:** ${target.symbol} ($${target.price})\n⚠️ Execution requires Phantom/Solflare manual trade.`);
    }
    
    if (!switchResult) return bot.sendMessage(chatId, `❌ **ERROR:** Could not switch to ${target.chain}`);

    // 2. SECURITY CHECK
    const security = await checkTokenSecurity(target.tokenAddress, target.chain);
    if (!security.safe) {
        if(!SYSTEM.autoPilot) bot.sendMessage(chatId, `⚠️ **SKIP:** ${security.reason}`);
        return;
    }

    // 3. GET AMOUNT
    const tradeValue = await getSafeTradeAmount(chatId);
    if (tradeValue === 0n) return;

    // 4. PREPARE & EXECUTE
    const risk = RISK_PROFILES[SYSTEM.riskProfile];
    const wethAddress = target.chain === 'polygon' ? "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270" : WETH; // Poly WMATIC check

    try {
        // Quick liquidity check
        const amounts = await currentRouter.getAmountsOut(tradeValue, [wethAddress, target.tokenAddress]);
        const minOut = (amounts[1] * BigInt(10000 - risk.slippage)) / 10000n;

        // Broadcast
        bot.sendMessage(chatId, `🚀 **EXECUTING ON ${CHAINS[target.chain].name.toUpperCase()}...**`);
        
        const tx = await currentRouter.swapExactETHForTokens(
            minOut, 
            [wethAddress, target.tokenAddress], 
            currentWallet.address, 
            Math.floor(Date.now()/1000)+120,
            { value: tradeValue, gasLimit: 500000 } // Generic gas limit for L2s
        );
        
        const receipt = await tx.wait();
        const link = `${CHAINS[target.chain].scanUrl}${receipt.hash}`;

        SYSTEM.activePosition = {
            address: target.tokenAddress,
            symbol: target.symbol,
            entryPrice: tradeValue,
            amount: minOut,
            highestPriceSeen: tradeValue,
            chain: target.chain,
            weth: wethAddress
        };
        
        bot.sendMessage(chatId, `✅ **BOUGHT:** ${target.symbol}\n🔗 [View Transaction](${link})`, {parse_mode: "Markdown", disable_web_page_preview: true});
        runProfitMonitor(chatId);

    } catch(e) {
        console.log(e);
        bot.sendMessage(chatId, `❌ **FAIL:** ${e.code || e.message}`);
    }
}

async function executeSell(chatId) {
    if (!currentWallet || !SYSTEM.activePosition) return;
    const { address, amount, symbol, chain, weth } = SYSTEM.activePosition;
    
    // Ensure we are on the right chain
    if (currentChain !== chain) await switchChain(chain);

    try {
        const tokenContract = new Contract(address, ["function approve(address, uint) returns (bool)"], currentWallet);
        await (await tokenContract.approve(CHAINS[chain].router, amount)).wait();

        const tx = await currentRouter.swapExactTokensForETH(
            amount, 0n, [address, weth], currentWallet.address, Math.floor(Date.now()/1000)+120,
            { gasLimit: 500000 }
        );
        
        const receipt = await tx.wait();
        SYSTEM.activePosition = null;
        bot.sendMessage(chatId, `💰 **SOLD:** ${symbol} secured.\n🔗 [View Transaction](${CHAINS[chain].scanUrl}${receipt.hash})`, {parse_mode: "Markdown", disable_web_page_preview: true});
        
        if (SYSTEM.autoPilot) runNeuralScanner(chatId);

    } catch(e) {
        bot.sendMessage(chatId, `❌ **SELL ERROR:** ${e.message}`);
    }
}

// ==========================================
//  OMNI-SCANNER
// ==========================================

async function runNeuralScanner(chatId, isManual = false) {
    if ((!SYSTEM.autoPilot && !isManual) || SYSTEM.activePosition || SYSTEM.isLocked || !wallet) return;

    try {
        if(isManual) bot.sendMessage(chatId, "🔭 **OMNI-SCAN:** Scanning ETH, BASE, ARB, POLY, SOL...");
        
        const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1').catch(()=>null);
        let potentialTarget = null;

        if (res && res.data) {
            for (const raw of res.data) {
                // Filter supported chains
                if (!CHAINS[raw.chainId]) continue;
                if (raw.tokenAddress === SYSTEM.lastTradedToken) continue;

                // Enrich
                const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${raw.tokenAddress}`).catch(()=>null);
                if(details && details.data.pairs) {
                    const pair = details.data.pairs[0];
                    if (pair && pair.liquidity && pair.liquidity.usd > 1000) {
                        potentialTarget = {
                            name: pair.baseToken.name,
                            symbol: pair.baseToken.symbol,
                            tokenAddress: pair.baseToken.address,
                            price: pair.priceUsd,
                            chain: raw.chainId, // Vital: captures 'solana', 'base', etc.
                            sentimentScore: 0.85 
                        };
                        break;
                    }
                }
            }
        }

        if (potentialTarget) {
            // Found a target (on any supported chain)
            processSignal(chatId, potentialTarget, isManual);
        } else if (isManual) {
            bot.sendMessage(chatId, "⚠️ No signals found.");
        }

    } catch (e) {}
    finally {
        if (SYSTEM.autoPilot && !SYSTEM.activePosition) setTimeout(() => runNeuralScanner(chatId), 100);
    }
}

async function processSignal(chatId, target, isManual) {
    // Check Chain Config
    const chainInfo = CHAINS[target.chain];
    
    console.log(`[SIGNAL] ${target.symbol} on ${chainInfo.name.toUpperCase()}`.cyan);

    if (SYSTEM.autoPilot) {
        await executeBuy(chatId, target);
    } else {
        SYSTEM.pendingTarget = target;
        bot.sendMessage(chatId, `
🎯 **SIGNAL FOUND**
Token: ${target.symbol}
Chain: ${chainInfo.name}
Price: $${target.price}
Action: \`/buy\` or \`/approve\``);
    }
}

// ==========================================
//  PROFIT MONITOR
// ==========================================

async function runProfitMonitor(chatId) {
    if (!SYSTEM.activePosition || SYSTEM.isLocked) return;
    SYSTEM.isLocked = true;

    try {
        const { address, amount, entryPrice, highestPriceSeen, symbol, chain, weth } = SYSTEM.activePosition;
        
        // Ensure we are monitoring the right chain
        if(currentChain !== chain) await switchChain(chain);

        const amounts = await currentRouter.getAmountsOut(amount, [address, weth]);
        const currentVal = amounts[1];
        
        const currentFloat = parseFloat(ethers.formatEther(currentVal));
        const highestFloat = parseFloat(ethers.formatEther(highestPriceSeen));

        if (currentFloat > highestFloat) SYSTEM.activePosition.highestPriceSeen = currentVal;

        const drop = ((highestFloat - currentFloat) / highestFloat) * 100;
        const profit = ((currentFloat - parseFloat(ethers.formatEther(entryPrice))) / parseFloat(ethers.formatEther(entryPrice))) * 100;
        
        const trail = STRATEGY_MODES[SYSTEM.strategyMode].trail;
        const stop = RISK_PROFILES[SYSTEM.riskProfile].stopLoss;

        process.stdout.write(`\r[${chain.toUpperCase()}] ${symbol} PnL: ${profit.toFixed(2)}% | Drop: ${drop.toFixed(2)}%   `);

        if ((drop >= trail && profit > 0.5) || profit <= -stop) {
            const msg = profit > 0 ? `📉 **PROFIT SECURED:**` : `🛑 **STOP LOSS:**`;
            bot.sendMessage(chatId, `${msg} ${symbol} (${profit.toFixed(2)}%). Selling...`);
            await executeSell(chatId);
        }

    } catch (e) { }
    finally {
        SYSTEM.isLocked = false;
        setTimeout(() => runProfitMonitor(chatId), 1000);
    }
}

// ==========================================
//  COMMANDS
// ==========================================

bot.onText(/\/connect\s+(.+)/i, async (msg, match) => {
    const chatId = msg.chat.id;
    process.env.CHAT_ID = chatId; 
    try {
        process.env.PRIVATE_KEY = match[1]; // Store key temporarily in env
        await switchChain('ethereum'); // Init on ETH
        const bal = await currentProvider.getBalance(currentWallet.address);
        bot.sendMessage(chatId, `✅ **CONNECTED:** ${currentWallet.address}\nETH Bal: ${ethers.formatEther(bal).slice(0,6)}`);
    } catch (e) { bot.sendMessage(chatId, `❌ Key Error.`); }
});

bot.onText(/\/start/i, (msg) => {
    process.env.CHAT_ID = msg.chat.id;
    bot.sendMessage(msg.chat.id, `
🦁 **APEX v8000 (OMNI-CHAIN)**
\`————————————————————————\`
**/auto** - Start Omni-Scan
**/scan** - Manual Scan
**/buy <addr>** - Force Buy
**/sell** - Sell Current
**/setamount 5%** - Sizing
\`————————————————————————\``, { parse_mode: "Markdown" });
});

bot.onText(/\/auto/i, (msg) => {
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    bot.sendMessage(msg.chat.id, SYSTEM.autoPilot ? "🚀 **OMNI-AUTO ENGAGED**" : "⏸ **PAUSED**");
    if(SYSTEM.autoPilot) runNeuralScanner(msg.chat.id);
});

bot.onText(/\/setamount\s+(.+)/i, (msg, match) => {
    const input = match[1].trim();
    if (input.endsWith('%')) {
        SYSTEM.tradeStyle = 'PERCENT';
        SYSTEM.tradeValue = parseFloat(input.replace('%', ''));
        bot.sendMessage(msg.chat.id, `⚖️ **SIZE:** ${SYSTEM.tradeValue}%`);
    } else {
        SYSTEM.tradeStyle = 'FIXED';
        SYSTEM.tradeValue = parseFloat(input);
        bot.sendMessage(msg.chat.id, `⚖️ **SIZE:** ${SYSTEM.tradeValue} Native Token`);
    }
});

bot.onText(/\/scan/i, (msg) => runNeuralScanner(msg.chat.id, true));

bot.onText(/\/buy(?:\s+(.+))?/i, async (msg, match) => {
    const addr = match[1];
    if(addr) {
        // Assume Ethereum for manual address entry unless specified
        await executeBuy(msg.chat.id, { tokenAddress: addr, symbol: "MANUAL", chain: 'ethereum' });
    } else if (SYSTEM.pendingTarget) {
        await executeBuy(msg.chat.id, SYSTEM.pendingTarget);
    }
});

bot.onText(/\/approve/i, (msg) => {
    if(SYSTEM.pendingTarget) executeBuy(msg.chat.id, SYSTEM.pendingTarget);
});

bot.onText(/\/sell/i, (msg) => executeSell(msg.chat.id));

bot.onText(/\/status/i, async (msg) => {
    const bal = await currentProvider.getBalance(currentWallet.address);
    const sym = CHAINS[currentChain].symbol;
    bot.sendMessage(msg.chat.id, `
📊 **STATUS**
**Chain:** ${CHAINS[currentChain].name}
**Bal:** ${ethers.formatEther(bal).slice(0,6)} ${sym}
**Mode:** ${SYSTEM.autoPilot ? 'AUTO' : 'MANUAL'}
**Pos:** ${SYSTEM.activePosition ? SYSTEM.activePosition.symbol : 'Idle'}`, {parse_mode:"Markdown"});
});

// Added SETTINGS, RISK, MODE, RESTART, MANUAL from v2500
bot.onText(/\/settings/i, (msg) => {
    const risk = RISK_PROFILES[SYSTEM.riskProfile];
    const strat = STRATEGY_MODES[SYSTEM.strategyMode];
    bot.sendMessage(msg.chat.id, `⚙️ **CONFIG:** ${risk.label} | ${strat.label}`, { parse_mode: "Markdown" });
});

bot.onText(/\/risk\s+(.+)/i, (msg, match) => {
    const input = match[1].toUpperCase();
    const map = { 'SAFE': 'LOW', 'BALANCED': 'MEDIUM', 'AGGRESSIVE': 'HIGH', 'DEGEN': 'DEGEN' };
    const key = map[input] || input;
    if (RISK_PROFILES[key]) { SYSTEM.riskProfile = key; bot.sendMessage(msg.chat.id, `🛡 **RISK:** ${RISK_PROFILES[key].label}`); }
});

bot.onText(/\/mode\s+(.+)/i, (msg, match) => {
    const key = match[1].toUpperCase();
    const map = { 'SHORT': 'SCALP', 'LONG': 'MOON', 'MID': 'DAY' };
    const finalKey = map[key] || key;
    if (STRATEGY_MODES[finalKey]) { SYSTEM.strategyMode = finalKey; bot.sendMessage(msg.chat.id, `🔄 **STRATEGY:** ${STRATEGY_MODES[finalKey].label}`); }
});

bot.onText(/\/restart/i, (msg) => {
    SYSTEM.autoPilot = false; SYSTEM.isLocked = false; SYSTEM.activePosition = null; SYSTEM.pendingTarget = null;
    bot.sendMessage(msg.chat.id, `🔄 **RESET**`);
});

bot.onText(/\/manual/i, (msg) => {
    SYSTEM.autoPilot = false;
    bot.sendMessage(msg.chat.id, "✋ **MANUAL MODE:** Auto-buying disabled. Auto-Selling ENABLED. Use `/buy` or `/scan`.");
});

http.createServer((req, res) => res.end("APEX v8000 ONLINE")).listen(8080);
console.log("APEX SIGNAL v8000.0 ONLINE [OMNI-CHAIN WARLORD].".magenta);
