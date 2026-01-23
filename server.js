/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL SIGNAL v10000.1 (AUTHENTICATED)
 * ===============================================================================
 * ENGINE: Jupiter Ultra Swap API (v1) + Standard EVM
 * AUTH: Integrated API Key for High-Speed Execution
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, JsonRpcProvider, Contract } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- CONFIGURATION ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1"; 
const JUP_API_KEY = "1b6fd053-7ccd-4bf5-848b-c349d7474e72"; // YOUR API KEY

// --- 5-CHAIN NETWORK DEFINITIONS ---
const NETWORKS = {
    ETH: {
        id: 'ethereum', type: 'EVM',
        rpc: 'https://rpc.mevblocker.io',
        router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        scanMode: 'VOLUME', query: 'WETH'
    },
    SOL: {
        id: 'solana', type: 'SVM',
        rpc: 'https://api.mainnet-beta.solana.com',
        scanMode: 'BOOST'
    },
    BASE: {
        id: 'base', type: 'EVM',
        rpc: 'https://mainnet.base.org',
        router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
        weth: '0x4200000000000000000000000000000000000006',
        scanMode: 'BOOST'
    },
    BSC: {
        id: 'bsc', type: 'EVM',
        rpc: 'https://bsc-dataseed.binance.org/',
        router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
        weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        scanMode: 'BOOST'
    },
    ARB: {
        id: 'arbitrum', type: 'EVM',
        rpc: 'https://arb1.arbitrum.io/rpc',
        router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
        weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        scanMode: 'VOLUME', query: 'WETH'
    }
};

// --- GLOBAL STATE ---
let SYSTEM = {
    currentNetwork: 'SOL', 
    autoPilot: false,
    isLocked: false,
    riskProfile: 'MEDIUM',
    strategyMode: 'DAY',
    tradeAmount: "0.01", 
    activePosition: null,
    pendingTarget: null,
    lastTradedToken: null
};

// --- WALLET STATE ---
let evmWallet = null, evmSigner = null, evmProvider = null, evmRouter = null;
let solWallet = null;
const solConnection = new Connection(NETWORKS.SOL.rpc, 'confirmed');

const bot = new TelegramBot(TELEGRAM_TOKEN, {
    polling: { interval: 300, autoStart: true, params: { timeout: 10 } }
});

// ==========================================
//  RPG SYSTEM
// ==========================================
let PLAYER = { level: 1, xp: 0, nextLevelXp: 1000, class: "DATA ANALYST" };

const addXP = (amount, chatId) => {
    PLAYER.xp += amount;
    if (PLAYER.xp >= PLAYER.nextLevelXp) {
        PLAYER.level++;
        PLAYER.xp -= PLAYER.nextLevelXp;
        PLAYER.nextLevelXp = Math.floor(PLAYER.nextLevelXp * 1.5);
        bot.sendMessage(chatId, `🆙 **PROMOTION:** Level ${PLAYER.level} (${getRankName(PLAYER.level)})`);
    }
};
const getRankName = (lvl) => (lvl < 5 ? "DATA ANALYST" : lvl < 10 ? "PATTERN SEER" : "MARKET GOD");

// ==========================================
//  SETTINGS
// ==========================================
const RISK_PROFILES = {
    LOW:    { slippage: 50,  stopLoss: 10, label: "LOW" },
    MEDIUM: { slippage: 200, stopLoss: 20, label: "MEDIUM" },
    HIGH:   { slippage: 500, stopLoss: 40, label: "HIGH" }
};
const STRATEGY_MODES = {
    SCALP:  { trail: 5,  minConf: 80 }, 
    DAY:    { trail: 15, minConf: 85 },  
    MOON:   { trail: 40, minConf: 90 }  
};

// ==========================================
//  AUTH & NETWORK
// ==========================================
bot.onText(/\/connect (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const rawMnemonic = match[1].trim();
    try { await bot.deleteMessage(chatId, msg.message_id); } catch(e){}

    if (!bip39.validateMnemonic(rawMnemonic)) return bot.sendMessage(chatId, "❌ **INVALID SEED.**");

    try {
        evmWallet = ethers.HDNodeWallet.fromPhrase(rawMnemonic);
        const seed = bip39.mnemonicToSeedSync(rawMnemonic);
        const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
        solWallet = Keypair.fromSeed(derivedSeed);

        await initNetwork(SYSTEM.currentNetwork);

        bot.sendMessage(chatId, `
🔗 **NEURAL LINK ESTABLISHED**
\`————————————————————————————\`
**EVM:** \`${evmWallet.address}\`
**SOL:** \`${solWallet.publicKey.toString()}\`
\`————————————————————————————\`
`, {parse_mode: 'Markdown'});
    } catch (e) { bot.sendMessage(chatId, `❌ Error: ${e.message}`); }
});

async function initNetwork(netKey) {
    SYSTEM.currentNetwork = netKey;
    const net = NETWORKS[netKey];
    if (net.type === 'EVM' && evmWallet) {
        evmProvider = new JsonRpcProvider(net.rpc);
        evmSigner = evmWallet.connect(evmProvider);
        evmRouter = new Contract(net.router, [
            "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
            "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])",
            "function approve(address spender, uint256 amount) external returns (bool)",
            "function balanceOf(address owner) view returns (uint)"
        ], evmSigner);
    }
    console.log(`[NET] Switched to ${netKey}`.yellow);
}

// ==========================================
//  EXECUTION ENGINES
// ==========================================

async function executeUltraSwap(chatId, direction, tokenAddress, amountInput) {
    if (!solWallet) return bot.sendMessage(chatId, "❌ Wallet Not Connected");

    try {
        const slip = RISK_PROFILES[SYSTEM.riskProfile].slippage;
        const inputMint = direction === 'BUY' ? 'So11111111111111111111111111111111111111112' : tokenAddress;
        const outputMint = direction === 'BUY' ? tokenAddress : 'So11111111111111111111111111111111111111112';
        const amount = direction === 'BUY' ? Math.floor(amountInput * LAMPORTS_PER_SOL).toString() : SYSTEM.activePosition.tokenAmount.toString();

        // --- AUTH CONFIG ---
        const config = { headers: { 'x-api-key': JUP_API_KEY } };

        const orderUrl = `${JUP_ULTRA_API}/order?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&taker=${solWallet.publicKey.toString()}&slippageBps=${slip}`;
        const orderRes = await axios.get(orderUrl, config);
        const { transaction, requestId, outAmount } = orderRes.data;

        if (!transaction) throw new Error("Ultra: No transaction returned");

        const txBuffer = Buffer.from(transaction, 'base64');
        const tx = VersionedTransaction.deserialize(txBuffer);
        tx.sign([solWallet]);
        const signedTxBase64 = Buffer.from(tx.serialize()).toString('base64');

        const execRes = await axios.post(`${JUP_ULTRA_API}/execute`, { signedTransaction: signedTxBase64, requestId: requestId }, config);
        const { status, signature } = execRes.data;

        if (status === 'Success') {
            bot.sendMessage(chatId, `🚀 **ULTRA CONFIRMED:** https://solscan.io/tx/${signature}`);
            return { amountOut: outAmount, hash: signature };
        } else throw new Error(`Execution Failed`);

    } catch (e) {
        bot.sendMessage(chatId, `⚠️ **ULTRA ERROR:** ${e.response?.data?.error || e.message}`);
        return null;
    }
}

async function executeEvmSwap(chatId, direction, tokenAddress, amountEth) {
    if (!evmSigner) return bot.sendMessage(chatId, "❌ EVM Wallet Not Connected");
    try {
        const net = NETWORKS[SYSTEM.currentNetwork];
        const path = direction === 'BUY' ? [net.weth, tokenAddress] : [tokenAddress, net.weth];
        
        if (direction === 'BUY') {
            const value = ethers.parseEther(amountEth);
            
            // GAS SAFETY CHECK
            const balance = await evmProvider.getBalance(evmSigner.address);
            if (balance < value) {
                return bot.sendMessage(chatId, `⚠️ **INSUFFICIENT FUNDS:** Have ${ethers.formatEther(balance)}, Need ${amountEth}`);
            }

            const tx = await evmRouter.swapExactETHForTokens(
                0, path, evmSigner.address, Math.floor(Date.now()/1000)+120,
                { value: value, gasLimit: 350000 }
            );
            bot.sendMessage(chatId, `🚀 **${SYSTEM.currentNetwork} TX:** ${tx.hash}`);
            await tx.wait();
            return { amountOut: 0 }; 
        } else {
            const token = new Contract(tokenAddress, ["function approve(address, uint) returns (bool)", "function balanceOf(address) view returns (uint)"], evmSigner);
            const bal = await token.balanceOf(evmSigner.address);
            if (bal == 0) throw new Error("No tokens to sell");
            
            await (await token.approve(net.router, bal)).wait();
            const tx = await evmRouter.swapExactTokensForETH(
                bal, 0, path, evmSigner.address, Math.floor(Date.now()/1000)+120,
                { gasLimit: 350000 }
            );
            bot.sendMessage(chatId, `🚀 **${SYSTEM.currentNetwork} SELL:** ${tx.hash}`);
            return { amountOut: 0 };
        }
    } catch(e) {
        bot.sendMessage(chatId, `⚠️ **EVM ERROR:** ${e.message}`);
        return null;
    }
}

// ==========================================
//  "THE GAUNTLET" (Advanced Analysis)
// ==========================================

function analyzeTarget(pair) {
    let score = 0;
    let reasons = [];

    // 1. LIQUIDITY CHECK
    if (pair.liquidity.usd > 100000) score += 30;
    else if (pair.liquidity.usd > 20000) score += 20;
    else if (pair.liquidity.usd > 10000) score += 10;
    else return { score: 0, reason: "LIQUIDITY TOO LOW (<$10k)" }; 

    // 2. VOLUME CHECK
    if (pair.volume.h24 > 500000) score += 30;
    else if (pair.volume.h24 > 100000) score += 20;
    else if (pair.volume.h24 > 15000) score += 10;
    else return { score: 0, reason: "VOLUME TOO LOW (<$15k)" }; 

    // 3. MOMENTUM CHECK (1H Price Change)
    const p1h = pair.priceChange.h1;
    if (p1h > 0 && p1h < 15) score += 20; // Steady organic growth
    else if (p1h >= 15 && p1h < 50) score += 15; // Fast pump
    else if (p1h >= 50 && p1h < 200) score += 5; // DANGER ZONE (FOMO)
    else if (p1h >= 200) return { score: 0, reason: "ALREADY PUMPED (>200%)" }; 
    else if (p1h < 0) score -= 10; 

    // 4. MARKET CAP CHECK (Optional Safety)
    if (pair.fdv > 10000000) score += 10; 
    else if (pair.fdv < 50000) score -= 10; 

    // 5. BUY/SELL PRESSURE
    const buys = pair.txns.h1.buys;
    const sells = pair.txns.h1.sells;
    if (buys > sells) score += 10;

    return { score, reason: reasons.join(", ") };
}

// ==========================================
//  OMNI-SCANNER
// ==========================================

async function runNeuralScanner(chatId) {
    if (!SYSTEM.autoPilot || SYSTEM.isLocked || (!evmWallet && !solWallet)) return;

    try {
        const netConfig = NETWORKS[SYSTEM.currentNetwork];
        let targets = [];

        // --- STEP 1: FETCH DATA ---
        if (netConfig.scanMode === 'BOOST') {
            const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
            const boostMatch = res.data.find(t => t.chainId === netConfig.id && t.tokenAddress !== SYSTEM.lastTradedToken);
            if (boostMatch) targets.push(boostMatch.tokenAddress);
        } else {
            const query = netConfig.query || 'WETH';
            const searchRes = await axios.get(`https://api.dexscreener.com/latest/dex/search/?q=${query}`);
            const movers = searchRes.data.pairs
                .filter(p => p.chainId === netConfig.id && p.quoteToken.symbol !== 'USDT')
                .sort((a,b) => b.volume.h24 - a.volume.h24);
            if (movers.length > 0) targets.push(movers[0].baseToken.address);
        }

        // --- STEP 2: RUN "THE GAUNTLET" ---
        if (targets.length > 0) {
            const address = targets[0];
            const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
            const pair = details.data.pairs[0];

            if (pair) {
                const analysis = analyzeTarget(pair);
                const confidence = analysis.score;

                if (confidence >= STRATEGY_MODES[SYSTEM.strategyMode].minConf) {
                    await processSignal(chatId, pair, confidence);
                } else {
                    console.log(`[FILTER] Skipped ${pair.baseToken.symbol} (Score: ${confidence}/100) - ${analysis.reason}`.gray);
                }
            }
        }

    } catch (e) { console.log(`[SCAN] ${SYSTEM.currentNetwork} Searching...`.gray); }
    
    if (SYSTEM.autoPilot) setTimeout(() => runNeuralScanner(chatId), 3000);
}

async function processSignal(chatId, pair, confidence) {
    const target = {
        symbol: pair.baseToken.symbol,
        tokenAddress: pair.baseToken.address,
        price: parseFloat(pair.priceUsd),
        score: confidence
    };

    console.log(`[SIGNAL] ${target.symbol} | Score: ${confidence}/100`.green);

    SYSTEM.pendingTarget = target;
    bot.sendMessage(chatId, `
🎯 **SNIPER TARGET ACQUIRED**
Token: ${target.symbol}
Net: ${SYSTEM.currentNetwork}
Score: ${confidence}/100
Price: $${target.price}
Change: ${pair.priceChange.h1}%
Liquidity: $${pair.liquidity.usd.toLocaleString()}
    `, { parse_mode: 'Markdown' });

    if (SYSTEM.autoPilot) await executeBuy(chatId);
}

// ==========================================
//  EXECUTION WRAPPERS
// ==========================================

async function executeBuy(chatId) {
    if (!SYSTEM.pendingTarget) return;
    const target = SYSTEM.pendingTarget;
    SYSTEM.isLocked = true;

    let result = null;
    if (SYSTEM.currentNetwork === 'SOL') {
        result = await executeUltraSwap(chatId, 'BUY', target.tokenAddress, SYSTEM.tradeAmount);
    } else {
        result = await executeEvmSwap(chatId, 'BUY', target.tokenAddress, SYSTEM.tradeAmount);
    }

    if (result) {
        SYSTEM.activePosition = { ...target, tokenAmount: result.amountOut, rawAmount: result.amountOut, entryPrice: target.price, highestPrice: target.price };
        SYSTEM.pendingTarget = null;
        addXP(500, chatId);
        runProfitMonitor(chatId);
    } else {
        SYSTEM.isLocked = false;
    }
}

async function executeSell(chatId) {
    if (!SYSTEM.activePosition) return;
    bot.sendMessage(chatId, `📉 **SELLING:** ${SYSTEM.activePosition.symbol}...`);
    
    let result = null;
    if (SYSTEM.currentNetwork === 'SOL') {
        result = await executeUltraSwap(chatId, 'SELL', SYSTEM.activePosition.tokenAddress, 0);
    } else {
        result = await executeEvmSwap(chatId, 'SELL', SYSTEM.activePosition.tokenAddress, 0);
    }
    
    if (result || result === null) {
        SYSTEM.lastTradedToken = SYSTEM.activePosition.tokenAddress;
        SYSTEM.activePosition = null;
        SYSTEM.isLocked = false;
        bot.sendMessage(chatId, `✅ **CLOSED.** Resuming Scan.`);
        if (SYSTEM.autoPilot) runNeuralScanner(chatId);
    }
}

async function runProfitMonitor(chatId) {
    if (!SYSTEM.activePosition) return;
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${SYSTEM.activePosition.tokenAddress}`);
        const currentPrice = parseFloat(res.data.pairs[0].priceUsd);
        const pnl = ((currentPrice - SYSTEM.activePosition.entryPrice) / SYSTEM.activePosition.entryPrice) * 100;
        
        if (currentPrice > SYSTEM.activePosition.highestPrice) SYSTEM.activePosition.highestPrice = currentPrice;
        const drop = ((SYSTEM.activePosition.highestPrice - currentPrice) / SYSTEM.activePosition.highestPrice) * 100;
        
        process.stdout.write(`\r[MONITOR] ${SYSTEM.activePosition.symbol} PnL: ${pnl.toFixed(2)}% | Drop: ${drop.toFixed(2)}%  `);

        const strategy = STRATEGY_MODES[SYSTEM.strategyMode];
        const risk = RISK_PROFILES[SYSTEM.riskProfile];

        if (drop >= strategy.trail && pnl > 1) {
             bot.sendMessage(chatId, `📉 **TRAILING STOP:** Securing +${pnl.toFixed(2)}%`);
             await executeSell(chatId);
        } else if (pnl <= -risk.stopLoss) {
             bot.sendMessage(chatId, `🛑 **STOP LOSS:** Exiting at ${pnl.toFixed(2)}%`);
             await executeSell(chatId);
        } else {
             setTimeout(() => runProfitMonitor(chatId), 4000);
        }
    } catch(e) { setTimeout(() => runProfitMonitor(chatId), 4000); }
}

// ==========================================
//  COMMANDS
// ==========================================
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `
🐲 **APEX PREDATOR v10000.1 (AUTHENTICATED)**
Operator: ${msg.from.first_name} | Class: ${PLAYER.class}
Current Network: ${SYSTEM.currentNetwork}

**/connect <mnemonic>** - Link Wallets
**/network <SOL|ETH|BSC|BASE|ARB>**
**/auto** - Toggle AI
**/risk <low|medium|high>**
**/mode <scalp|day|moon>**
**/status** - View Stats
`);
});

bot.onText(/\/network (.+)/, (msg, match) => { 
    const n = match[1].toUpperCase(); 
    if(NETWORKS[n]) { initNetwork(n); bot.sendMessage(msg.chat.id, `✅ Network: ${n}`); } 
    else bot.sendMessage(msg.chat.id, `❌ Use: SOL, ETH, BASE, BSC, ARB`);
});

bot.onText(/\/auto/, (msg) => { 
    if (!evmWallet && !solWallet) return bot.sendMessage(msg.chat.id, "❌ Connect Wallet First.");
    SYSTEM.autoPilot = !SYSTEM.autoPilot; 
    bot.sendMessage(msg.chat.id, `🤖 Auto: ${SYSTEM.autoPilot}`); 
    if(SYSTEM.autoPilot) runNeuralScanner(msg.chat.id); 
});

bot.onText(/\/status/, (msg) => {
    bot.sendMessage(msg.chat.id, `
📊 **STATUS REPORT**
Rank: ${PLAYER.class} (Lvl ${PLAYER.level})
XP: [${getXpBar()}]
Network: ${SYSTEM.currentNetwork}
Mode: ${SYSTEM.strategyMode}
Active Trade: ${SYSTEM.activePosition ? SYSTEM.activePosition.symbol : 'None'}
`);
});

http.createServer((req, res) => res.end("APEX v10000 ONLINE")).listen(8080);
console.log("APEX v10000 ARCHITECT ONLINE".green);
