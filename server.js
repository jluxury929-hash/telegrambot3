/**
 * ===============================================================================
 * 🦁 APEX PREDATOR v9000.0 (INSTANT-AUTO EVM EDITION)
 * ===============================================================================
 * 1. INSTANT SCAN: Checks Top 50 tokens to guarantee an immediate signal.
 * 2. AUTO-MODE PURITY: Ignores Solana in Auto-Mode (EVM Execution Only).
 * 3. NO MANUAL INPUT: Auto-Mode handles Chain Switch -> Buy -> Sell autonomously.
 * 4. HYBRID: Manual Mode still alerts for Solana (since you might want to trade it manually).
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- CONFIGURATION ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const AI_API_URL = process.env.AI_API_URL || null;

// --- CHAIN CONFIGURATION (EVM FOCUSED) ---
const CHAINS = {
    'ethereum': {
        name: 'Ethereum',
        rpc: "https://rpc.mevblocker.io",
        router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Uniswap V2
        wtoken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
        symbol: 'ETH',
        gasReserve: "0.01",
        scanUrl: "https://etherscan.io/tx/"
    },
    'base': {
        name: 'Base',
        rpc: "https://mainnet.base.org",
        router: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24", // Uniswap V2
        wtoken: "0x4200000000000000000000000000000000000006", // WETH
        symbol: 'ETH',
        gasReserve: "0.001",
        scanUrl: "https://basescan.org/tx/"
    },
    'arbitrum': {
        name: 'Arbitrum',
        rpc: "https://arb1.arbitrum.io/rpc",
        router: "0x1b02dA8Cb0d097eB8D57A175b88c7D877F64EF71", // SushiSwap
        wtoken: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH
        symbol: 'ETH',
        gasReserve: "0.001",
        scanUrl: "https://arbiscan.io/tx/"
    },
    'polygon': {
        name: 'Polygon',
        rpc: "https://polygon-rpc.com",
        router: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff", // QuickSwap
        wtoken: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC
        symbol: 'POL',
        gasReserve: "1.0", 
        scanUrl: "https://polygonscan.com/tx/"
    },
    // Solana is kept for Manual Scan alerts ONLY
    'solana': {
        name: 'Solana',
        rpc: null, 
        symbol: 'SOL',
        scanUrl: "https://solscan.io/tx/"
    }
};

// Global State
let currentProvider = null;
let currentWallet = null;
let currentRouter = null;
let currentChain = 'ethereum';

const bot = new TelegramBot(TELEGRAM_TOKEN, {
    polling: { interval: 100, autoStart: true, params: { timeout: 10 } }
});

// ==========================================
//  CHAIN SWITCHING ENGINE
// ==========================================

async function switchChain(chainKey) {
    if (!CHAINS[chainKey]) return false;
    
    // Solana Mode (No Execution, Just Alerting state)
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
            
            console.log(`[NETWORK] Active: ${config.name}`.magenta);
            return true;
        }
    } catch (e) {
        return false;
    }
    return false;
}

switchChain('ethereum'); // Init

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
//  SMART BALANCE
// ==========================================

async function getSafeTradeAmount(chatId) {
    if (!currentWallet || currentChain === 'solana') return 0n;

    try {
        const balance = await currentProvider.getBalance(currentWallet.address);
        const config = CHAINS[currentChain];
        const reserve = ethers.parseEther(config.gasReserve);

        if (balance <= reserve) {
            if(!SYSTEM.autoPilot) bot.sendMessage(chatId, `⚠️ **LOW ${config.symbol}:** Top up wallet.`);
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
//  EXECUTION ENGINE
// ==========================================

async function executeBuy(chatId, target) {
    const switchRes = await switchChain(target.chain);
    
    // AUTO-MODE GUARD: Never pause for Solana in Auto-Mode
    if (switchRes === 'SOLANA_MODE') {
        if (!SYSTEM.autoPilot) {
            bot.sendMessage(chatId, `☀️ **SOLANA ALERT:** ${target.symbol} ($${target.price})\nManual Trade Required.`);
        }
        return; // Auto-mode ignores this and keeps scanning loop alive
    }
    
    if (!switchRes) return;

    // GET AMOUNT
    const tradeValue = await getSafeTradeAmount(chatId);
    if (tradeValue === 0n) return;

    const config = CHAINS[target.chain];
    const risk = RISK_PROFILES[SYSTEM.riskProfile];

    try {
        const amounts = await currentRouter.getAmountsOut(tradeValue, [config.wtoken, target.tokenAddress]);
        const minOut = (amounts[1] * BigInt(10000 - risk.slippage)) / 10000n;

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
    }
}

async function executeSell(chatId) {
    if (!currentWallet || !SYSTEM.activePosition) return;
    const { address, amount, symbol, chain, wtoken } = SYSTEM.activePosition;
    
    if (currentChain !== chain) await switchChain(chain);

    try {
        const config = CHAINS[chain];
        
        const tokenContract = new Contract(address, ["function approve(address, uint) returns (bool)"], currentWallet);
        await (await tokenContract.approve(config.router, amount)).wait();

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
//  OMNI-SCANNER (INSTANT FINDER)
// ==========================================

async function runNeuralScanner(chatId, isManual = false) {
    if ((!SYSTEM.autoPilot && !isManual) || SYSTEM.activePosition || SYSTEM.isLocked) return;

    try {
        if(isManual) bot.sendMessage(chatId, "🔭 **OMNI-SCAN:** Searching...");
        
        // Fetch High-Volume Trends
        const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1').catch(()=>null);
        let potentialTarget = null;

        if (res && res.data) {
            // SCAN DEEP: Check top 50 tokens to guarantee we find a valid EVM trade
            for (let i = 0; i < Math.min(50, res.data.length); i++) {
                const raw = res.data[i];
                
                // 1. FILTER: Is it a supported chain?
                if (!CHAINS[raw.chainId]) continue;
                if (raw.tokenAddress === SYSTEM.lastTradedToken) continue;

                // 2. AUTO-MODE FILTER: In Auto, IGNORE Solana (Can't execute)
                if (SYSTEM.autoPilot && raw.chainId === 'solana') continue;

                // 3. ENRICH DATA
                const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${raw.tokenAddress}`).catch(()=>null);
                if(details && details.data.pairs) {
                    const pair = details.data.pairs[0];
                    if (pair) {
                        // 4. SECURITY: Dust & Honeypot Check
                        if (pair.liquidity && pair.liquidity.usd < 1000) continue; 
                        if (pair.txns && pair.txns.h24.buys > 10 && pair.txns.h24.sells === 0) continue; 

                        // VALID TARGET FOUND
                        potentialTarget = {
                            name: pair.baseToken.name,
                            symbol: pair.baseToken.symbol,
                            tokenAddress: pair.baseToken.address,
                            price: pair.priceUsd,
                            chain: raw.chainId,
                            sentimentScore: 0.95 
                        };
                        break; // Stop looking, we found one!
                    }
                }
            }
        }

        if (potentialTarget) {
            processSignal(chatId, potentialTarget, isManual);
        } else if (isManual) {
            bot.sendMessage(chatId, "⚠️ No valid signals right now.");
        }

    } catch (e) {}
    finally {
        // INSTANT RE-LOOP: 100ms
        if (SYSTEM.autoPilot && !SYSTEM.activePosition) setTimeout(() => runNeuralScanner(chatId), 100);
    }
}

async function processSignal(chatId, target, isManual) {
    const chainInfo = CHAINS[target.chain];
    
    console.log(`[SIGNAL] ${target.symbol} on ${chainInfo.name.toUpperCase()}`.cyan);

    if (SYSTEM.autoPilot) {
        // EXECUTE INSTANTLY (No Manual Input Needed)
        await executeBuy(chatId, target);
    } 
    else if (isManual) {
        SYSTEM.pendingTarget = target;
        bot.sendMessage(chatId, `
🎯 **OMNI-SIGNAL FOUND**
Token: ${target.symbol}
Chain: ${chainInfo.name}
Price: $${target.price}
Action: \`/buy\` or \`/approve\``, {parse_mode:"Markdown"});
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
        
        if(currentChain !== chain) await switchChain(chain);

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
            bot.sendMessage(chatId, `📉 **EXITING:** ${symbol} (${profit.toFixed(2)}%)`);
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
        bot.sendMessage(chatId, `✅ **CONNECTED:** \`${currentWallet.address}\``, {parse_mode:"Markdown"});
    } catch (e) { bot.sendMessage(chatId, `❌ Key Error.`); }
});

bot.onText(/\/start/i, (msg) => {
    process.env.CHAT_ID = msg.chat.id;
    bot.sendMessage(msg.chat.id, `
🦁 **APEX v9000 (INSTANT-AUTO)**
\`————————————————————————\`
**/auto** - Start Hands-Free Trading
**/manual** - Stop Auto / Enable Alerts
**/scan** - Instant Manual Find
**/buy <addr>** - Force Buy
**/sell** - Panic Sell
**/setamount 5%** - Sizing
\`————————————————————————\``, { parse_mode: "Markdown" });
});

bot.onText(/\/auto/i, (msg) => {
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    bot.sendMessage(msg.chat.id, SYSTEM.autoPilot ? "🚀 **AUTO-PILOT ENGAGED**" : "⏸ **PAUSED**");
    if(SYSTEM.autoPilot) runNeuralScanner(msg.chat.id);
});

bot.onText(/\/manual/i, (msg) => {
    SYSTEM.autoPilot = false;
    bot.sendMessage(msg.chat.id, "✋ **MANUAL MODE:** Alerts Enabled. Auto-Buy Disabled.");
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

// START SERVER
http.createServer((req, res) => res.end("APEX v9000 ONLINE")).listen(8080);
console.log("APEX SIGNAL v9000.0 ONLINE [INSTANT-AUTO EVM].".magenta);
