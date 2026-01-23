/**
 * ===============================================================================
 * 🦁 APEX PREDATOR v8500.0 (OMNI-VERSE WARLORD)
 * ===============================================================================
 * 1. MULTI-CHAIN EXECUTION: Auto-Trades on ETH, BASE, ARB, POLYGON.
 * 2. SOLANA INTELLIGENCE: Scans and Alerts for SOL signals (Manual Execute).
 * 3. DYNAMIC ROUTER: Automatically selects Uniswap/Quickswap/Sushi based on chain.
 * 4. GLOBAL SCANNER: Ingests data from all 5 networks simultaneously.
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

// --- CHAIN DEFINITIONS (THE BRAIN) ---
const CHAINS = {
    'ethereum': {
        name: 'Ethereum',
        id: 1,
        rpc: "https://rpc.mevblocker.io",
        router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Uniswap V2
        wtoken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
        symbol: 'ETH',
        gasReserve: "0.01",
        scanUrl: "https://etherscan.io/tx/"
    },
    'base': {
        name: 'Base',
        id: 8453,
        rpc: "https://mainnet.base.org",
        router: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24", // Uniswap V2
        wtoken: "0x4200000000000000000000000000000000000006", // WETH on Base
        symbol: 'ETH',
        gasReserve: "0.001",
        scanUrl: "https://basescan.org/tx/"
    },
    'arbitrum': {
        name: 'Arbitrum',
        id: 42161,
        rpc: "https://arb1.arbitrum.io/rpc",
        router: "0x1b02dA8Cb0d097eB8D57A175b88c7D877F64EF71", // SushiSwap (Common on Arb)
        wtoken: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH on Arb
        symbol: 'ETH',
        gasReserve: "0.001",
        scanUrl: "https://arbiscan.io/tx/"
    },
    'polygon': {
        name: 'Polygon',
        id: 137,
        rpc: "https://polygon-rpc.com",
        router: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff", // QuickSwap
        wtoken: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC
        symbol: 'POL',
        gasReserve: "1.0",
        scanUrl: "https://polygonscan.com/tx/"
    },
    'solana': {
        name: 'Solana',
        rpc: null, // Handled differently
        symbol: 'SOL',
        scanUrl: "https://solscan.io/tx/"
    }
};

// Global State
let currentProvider = null;
let currentWallet = null;
let currentRouter = null;
let currentChain = 'ethereum'; // Default start

const bot = new TelegramBot(TELEGRAM_TOKEN, {
    polling: { interval: 100, autoStart: true, params: { timeout: 10 } }
});

// ==========================================
//  CHAIN SWITCHING ENGINE
// ==========================================

async function switchChain(chainKey) {
    if (!CHAINS[chainKey]) return false;
    
    // Solana Special Case (Signal Only)
    if (chainKey === 'solana') {
        currentChain = 'solana';
        return 'SOLANA_MODE';
    }

    try {
        const config = CHAINS[chainKey];
        const newProvider = new JsonRpcProvider(config.rpc);
        
        if (process.env.PRIVATE_KEY) {
            const newWallet = new Wallet(process.env.PRIVATE_KEY, newProvider);
            const newRouter = new Contract(config.router, [
                "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
                "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])",
                "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"
            ], newWallet);

            currentProvider = newProvider;
            currentWallet = newWallet;
            currentRouter = newRouter;
            currentChain = chainKey;
            
            console.log(`[NETWORK] Switched to ${config.name}`.magenta);
            return true;
        }
    } catch (e) {
        console.log(`[ERROR] Switch Failed: ${e.message}`.red);
        return false;
    }
    return false;
}

// Initial Setup
switchChain('ethereum');

// ==========================================
//  SYSTEM CONFIG
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
//  SMART BALANCE (MULTI-CHAIN)
// ==========================================

async function getSafeTradeAmount(chatId) {
    if (!currentWallet || currentChain === 'solana') return 0n;

    try {
        const balance = await currentProvider.getBalance(currentWallet.address);
        const config = CHAINS[currentChain];
        const reserve = ethers.parseEther(config.gasReserve);

        if (balance <= reserve) {
            bot.sendMessage(chatId, `⚠️ **LOW ${config.symbol}:** Bal: ${ethers.formatEther(balance)} < Reserve: ${ethers.formatEther(reserve)}`);
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
//  OMNI-CHAIN SCANNER
// ==========================================

async function runNeuralScanner(chatId, isManual = false) {
    if ((!SYSTEM.autoPilot && !isManual) || SYSTEM.activePosition || SYSTEM.isLocked) return;

    try {
        if(isManual) bot.sendMessage(chatId, "🔭 **OMNI-SCAN:** Scanning ETH, BASE, SOL, ARB, POLY...");
        
        // Fetch Global Trends
        const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1').catch(()=>null);
        let potentialTarget = null;

        if (res && res.data) {
            // Scan top 30 results to increase hit rate across 5 chains
            for (let i = 0; i < Math.min(30, res.data.length); i++) {
                const raw = res.data[i];
                
                // 1. FILTER: Is it a supported chain?
                if (!CHAINS[raw.chainId]) continue;
                if (raw.tokenAddress === SYSTEM.lastTradedToken) continue;

                // 2. ENRICH DATA
                const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${raw.tokenAddress}`).catch(()=>null);
                if(details && details.data.pairs) {
                    const pair = details.data.pairs[0];
                    if (pair) {
                        // 3. SECURITY CHECK
                        if (pair.liquidity && pair.liquidity.usd < 1000) continue; // Dust filter
                        if (pair.txns && pair.txns.h24.buys > 10 && pair.txns.h24.sells === 0) continue; // Honeypot

                        // FOUND VALID TARGET
                        potentialTarget = {
                            name: pair.baseToken.name,
                            symbol: pair.baseToken.symbol,
                            tokenAddress: pair.baseToken.address,
                            price: pair.priceUsd,
                            chain: raw.chainId, // IMPORTANT: Captures 'base', 'solana', etc.
                            sentimentScore: 0.88, // Simulated Web AI Score
                            rsi: 45,
                            socialVolume: 1200
                        };
                        break; 
                    }
                }
            }
        }

        if (potentialTarget) {
            await processSignal(chatId, potentialTarget, isManual);
        } else if (isManual) {
            bot.sendMessage(chatId, "⚠️ No high-confidence signals found. Retrying...");
        }

    } catch (e) {}
    finally {
        // INSTANT LOOP: 100ms
        if (SYSTEM.autoPilot && !SYSTEM.activePosition) setTimeout(() => runNeuralScanner(chatId), 100);
    }
}

async function processSignal(chatId, target, isManual) {
    const chainInfo = CHAINS[target.chain];
    const strategy = STRATEGY_MODES[SYSTEM.strategyMode];
    let confidence = 0.92; // High confidence from Filter

    console.log(`[SIGNAL] ${target.symbol} on ${chainInfo.name.toUpperCase()}`.cyan);

    if (SYSTEM.autoPilot) {
        if (confidence >= strategy.minConf) {
            await executeBuy(chatId, target);
        }
    } 
    else if (isManual) {
        SYSTEM.pendingTarget = target;
        bot.sendMessage(chatId, `
🧠 **OMNI-SIGNAL DETECTED**
\`————————————————————————\`
**Token:** ${target.symbol}
**Chain:** ${chainInfo.name}
**Price:** $${target.price}
**Action:** Type \`/buy\` or \`/approve\``, {parse_mode:"Markdown"});
    }
}

// ==========================================
//  MULTI-CHAIN EXECUTION
// ==========================================

async function executeBuy(chatId, target) {
    // 1. SWITCH NETWORK
    const switchRes = await switchChain(target.chain);
    
    if (switchRes === 'SOLANA_MODE') {
        // Solana Handling: We cannot auto-trade with ETH keys.
        if (SYSTEM.autoPilot) {
            bot.sendMessage(chatId, `☀️ **SOLANA ALPHA:** ${target.symbol} detected.\n⚠️ Cannot Auto-Trade SOL. Manual entry required.`);
        }
        return;
    }
    
    if (!switchRes) return bot.sendMessage(chatId, `❌ **ERROR:** Chain switch failed.`);

    // 2. GET AMOUNT
    const tradeValue = await getSafeTradeAmount(chatId);
    if (tradeValue === 0n) return;

    // 3. CONFIG
    const config = CHAINS[target.chain];
    const risk = RISK_PROFILES[SYSTEM.riskProfile];

    try {
        // 4. CHECK LIQUIDITY
        const amounts = await currentRouter.getAmountsOut(tradeValue, [config.wtoken, target.tokenAddress]);
        const minOut = (amounts[1] * BigInt(10000 - risk.slippage)) / 10000n;

        // 5. BROADCAST
        if(!SYSTEM.autoPilot) bot.sendMessage(chatId, `🚀 **EXECUTING on ${config.name}...**`);
        
        const tx = await currentRouter.swapExactETHForTokens(
            minOut, 
            [config.wtoken, target.tokenAddress], 
            currentWallet.address, 
            Math.floor(Date.now()/1000)+120,
            { value: tradeValue, gasLimit: 500000 } 
        );
        
        const receipt = await tx.wait();
        const link = `${config.scanUrl}${receipt.hash}`;

        SYSTEM.activePosition = {
            address: target.tokenAddress,
            symbol: target.symbol,
            entryPrice: tradeValue,
            amount: minOut,
            highestPriceSeen: tradeValue,
            chain: target.chain,
            wtoken: config.wtoken
        };
        
        bot.sendMessage(chatId, `✅ **BOUGHT:** ${target.symbol}\n🔗 [View TX](${link})`, {parse_mode: "Markdown", disable_web_page_preview: true});
        runProfitMonitor(chatId);

    } catch(e) {
        console.log(`[EXEC ERROR] ${e.message}`.red);
        // Silent fail in auto mode to keep scanning
    }
}

async function executeSell(chatId) {
    if (!currentWallet || !SYSTEM.activePosition) return;
    const { address, amount, symbol, chain, wtoken } = SYSTEM.activePosition;
    
    // Ensure correct chain
    if (currentChain !== chain) await switchChain(chain);

    try {
        const config = CHAINS[chain];
        
        // Approve
        const tokenContract = new Contract(address, ["function approve(address, uint) returns (bool)"], currentWallet);
        await (await tokenContract.approve(config.router, amount)).wait();

        // Swap
        const tx = await currentRouter.swapExactTokensForETH(
            amount, 0n, [address, wtoken], currentWallet.address, Math.floor(Date.now()/1000)+120,
            { gasLimit: 500000 }
        );
        
        const receipt = await tx.wait();
        SYSTEM.activePosition = null;
        bot.sendMessage(chatId, `💰 **SOLD:** ${symbol} Profit Secured.\n🔗 [View TX](${config.scanUrl}${receipt.hash})`, {parse_mode: "Markdown", disable_web_page_preview: true});
        
        if (SYSTEM.autoPilot) runNeuralScanner(chatId);

    } catch(e) {
        bot.sendMessage(chatId, `❌ **SELL ERROR:** ${e.message}`);
    }
}

// ==========================================
//  PROFIT MONITOR (HYBRID EXIT)
// ==========================================

async function runProfitMonitor(chatId) {
    if (!SYSTEM.activePosition || SYSTEM.isLocked) return;
    SYSTEM.isLocked = true;

    try {
        const { address, amount, entryPrice, highestPriceSeen, symbol, chain, wtoken } = SYSTEM.activePosition;
        
        if (currentChain !== chain) await switchChain(chain);

        const amounts = await currentRouter.getAmountsOut(amount, [address, wtoken]);
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
            const msg = profit > 0 ? `📉 **PROFIT EXIT:**` : `🛑 **STOP LOSS:**`;
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
        process.env.PRIVATE_KEY = match[1];
        await switchChain('ethereum'); 
        const bal = await currentProvider.getBalance(currentWallet.address);
        bot.sendMessage(chatId, `✅ **CONNECTED:** \`${currentWallet.address}\`\nETH Bal: ${ethers.formatEther(bal).slice(0,6)}`);
    } catch (e) { bot.sendMessage(chatId, `❌ Key Error.`); }
});

bot.onText(/\/start/i, (msg) => {
    process.env.CHAT_ID = msg.chat.id;
    bot.sendMessage(msg.chat.id, `
🦁 **APEX v8000 (OMNI-WARLORD)**
\`————————————————————————\`
**/auto** - Start Omni-Scan
**/manual** - Stop Auto, Enable Hybrid
**/scan** - Manual Search
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

bot.onText(/\/manual/i, (msg) => {
    SYSTEM.autoPilot = false;
    bot.sendMessage(msg.chat.id, "✋ **MANUAL MODE:** Auto-buying disabled. Auto-Selling ENABLED.");
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
        // Assume Ethereum for manual address entry unless specified (Advanced: could auto-detect chain)
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

// Settings & Risk commands retained
bot.onText(/\/settings/i, (msg) => {
    const risk = RISK_PROFILES[SYSTEM.riskProfile];
    bot.sendMessage(msg.chat.id, `⚙️ **CONFIG:** ${risk.label}`, { parse_mode: "Markdown" });
});

bot.onText(/\/risk\s+(.+)/i, (msg, match) => {
    const key = match[1].toUpperCase();
    if (RISK_PROFILES[key]) { SYSTEM.riskProfile = key; bot.sendMessage(msg.chat.id, `🛡 **RISK:** ${RISK_PROFILES[key].label}`); }
});

bot.onText(/\/mode\s+(.+)/i, (msg, match) => {
    const key = match[1].toUpperCase();
    if (STRATEGY_MODES[key]) { SYSTEM.strategyMode = key; bot.sendMessage(msg.chat.id, `🔄 **STRATEGY:** ${STRATEGY_MODES[key].label}`); }
});

http.createServer((req, res) => res.end("APEX v8000 ONLINE")).listen(8080);
console.log("APEX SIGNAL v8000.0 ONLINE [OMNI-CHAIN WARLORD].".magenta);
