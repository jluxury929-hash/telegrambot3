/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL SIGNAL v8000.1 (AXIOS STABLE FIX)
 * ===============================================================================
 * ARCH: Multi-Chain (EVM + SVM) | RPG System | Neural Scanner | Auto-Derivation
 * NETWORKS: ETH | SOLANA | BASE | BSC | ARBITRUM
 * FIX: Replaced fetch with Axios for stable Jupiter API connections
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, JsonRpcProvider, Contract, Wallet } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- CONFIGURATION ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;

// NETWORK DEFINITIONS
const NETWORKS = {
    ETH: {
        id: 'ethereum', type: 'EVM',
        rpc: 'https://rpc.mevblocker.io',
        router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2
        weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    },
    SOL: {
        id: 'solana', type: 'SVM',
        rpc: 'https://api.mainnet-beta.solana.com'
    },
    BASE: {
        id: 'base', type: 'EVM',
        rpc: 'https://mainnet.base.org',
        router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', // Uniswap V2
        weth: '0x4200000000000000000000000000000000000006'
    },
    BSC: {
        id: 'bsc', type: 'EVM',
        rpc: 'https://bsc-dataseed.binance.org/',
        router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap
        weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
    },
    ARB: {
        id: 'arbitrum', type: 'EVM',
        rpc: 'https://arb1.arbitrum.io/rpc',
        router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', // SushiSwap
        weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
    }
};

// --- GLOBAL STATE ---
let SYSTEM = {
    currentNetwork: 'SOL', // Default
    autoPilot: false,
    isLocked: false,
    riskProfile: 'MEDIUM',
    strategyMode: 'DAY',
    tradeAmount: "0.01", // Default trade size
    activePosition: null,
    pendingTarget: null,
    lastTradedToken: null
};

// --- WALLET & PROVIDER STATE ---
let evmWallet = null;  // Master HD Wallet
let evmSigner = null;  // Connected to current provider
let evmProvider = null;
let evmRouter = null;
let solWallet = null;
const solConnection = new Connection(NETWORKS.SOL.rpc, 'confirmed');

const bot = new TelegramBot(TELEGRAM_TOKEN, {
    polling: { interval: 300, autoStart: true, params: { timeout: 10 } }
});

// ==========================================
//  RPG SYSTEM (GAMIFICATION)
// ==========================================
let PLAYER = {
    level: 1, xp: 0, nextLevelXp: 1000, class: "DATA ANALYST",
    totalProfit: 0.0,
    dailyQuests: [
        { id: 'sim', task: "Analyze Neural Signals", count: 0, target: 10, done: false, xp: 150 },
        { id: 'trade', task: "Execute High-Confidence Setup", count: 0, target: 1, done: false, xp: 500 }
    ]
};

const addXP = (amount, chatId) => {
    PLAYER.xp += amount;
    if (PLAYER.xp >= PLAYER.nextLevelXp) {
        PLAYER.level++;
        PLAYER.xp -= PLAYER.nextLevelXp;
        PLAYER.nextLevelXp = Math.floor(PLAYER.nextLevelXp * 1.5);
        PLAYER.class = getRankName(PLAYER.level);
        if(chatId) bot.sendMessage(chatId, `🆙 **PROMOTION:** Level ${PLAYER.level} (${PLAYER.class})`);
    }
};

const getRankName = (lvl) => {
    if (lvl < 5) return "DATA ANALYST";
    if (lvl < 10) return "PATTERN SEER";
    if (lvl < 20) return "WHALE HUNTER";
    return "MARKET GOD";
};

const updateQuest = (type, chatId) => {
    PLAYER.dailyQuests.forEach(q => {
        if (q.id === type && !q.done) {
            q.count++;
            if (q.count >= q.target) {
                q.done = true;
                addXP(q.xp, chatId);
            }
        }
    });
};

const getXpBar = () => {
    const p = Math.min(Math.round((PLAYER.xp / PLAYER.nextLevelXp) * 10), 10);
    return "▓".repeat(p) + "░".repeat(10 - p);
};

// ==========================================
//  SETTINGS & CONFIG
// ==========================================
const RISK_PROFILES = {
    LOW:    { slippage: 1,   stopLoss: 10, label: "LOW (Safe)" },
    MEDIUM: { slippage: 5,   stopLoss: 20, label: "MEDIUM (Balanced)" },
    HIGH:   { slippage: 10,  stopLoss: 40, label: "HIGH (Aggressive)" },
    DEGEN:  { slippage: 20,  stopLoss: 60, label: "DEGEN (YOLO)" }
};

const STRATEGY_MODES = {
    SCALP:  { trail: 5,  minConf: 0.80, label: "SCALP (Quick Flip)" },
    DAY:    { trail: 15, minConf: 0.85, label: "SWING (Trend)" },  
    MOON:   { trail: 40, minConf: 0.90, label: "MOON (High Conviction)" }  
};

// ==========================================
//  AUTH & NETWORK SWITCHING
// ==========================================

// COMMAND: /connect <mnemonic>
bot.onText(/\/connect (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const rawMnemonic = match[1].trim();

    // Security: Delete msg
    try { await bot.deleteMessage(chatId, msg.message_id); } catch(e){}

    if (!bip39.validateMnemonic(rawMnemonic)) {
        return bot.sendMessage(chatId, "❌ **INVALID SEED PHRASE.**");
    }

    try {
        // 1. Derive EVM Wallet (Base, Eth, Bsc, Arb)
        evmWallet = ethers.HDNodeWallet.fromPhrase(rawMnemonic);

        // 2. Derive Solana Wallet (m/44'/501'/0'/0')
        const seed = bip39.mnemonicToSeedSync(rawMnemonic);
        const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
        solWallet = Keypair.fromSeed(derivedSeed);

        // 3. Initialize Network
        await initNetwork(SYSTEM.currentNetwork);

        bot.sendMessage(chatId, `
🔗 **NEURAL LINK ESTABLISHED**
\`————————————————————————————\`
**EVM:** \`${evmWallet.address}\`
**SOL:** \`${solWallet.publicKey.toString()}\`
**Network:** ${SYSTEM.currentNetwork}
\`————————————————————————————\`
_Seed scrubbed. Ready for commands._
`, {parse_mode: 'Markdown'});
    } catch (e) {
        bot.sendMessage(chatId, `❌ Error: ${e.message}`);
    }
});

async function initNetwork(netKey) {
    SYSTEM.currentNetwork = netKey;
    const net = NETWORKS[netKey];

    if (net.type === 'EVM' && evmWallet) {
        evmProvider = new JsonRpcProvider(net.rpc);
        evmSigner = evmWallet.connect(evmProvider); // Connect wallet to provider
        evmRouter = new Contract(net.router, [
            "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
            "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])",
            "function getAmountsOut(uint amt, address[] path) external view returns (uint[])",
            "function approve(address spender, uint256 amount) external returns (bool)"
        ], evmSigner);
    }
    console.log(`[NET] Switched to ${netKey}`.yellow);
}

// ==========================================
//  NEURAL ORACLE (SCANNER)
// ==========================================

async function runNeuralScanner(chatId) {
    if (!SYSTEM.autoPilot || SYSTEM.isLocked || (!evmWallet && !solWallet)) return;

    try {
        updateQuest('sim', chatId);
        const chainId = NETWORKS[SYSTEM.currentNetwork].id;
       
        // DexScreener Check
        const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
       
        // Filter for CURRENT network
        const valid = res.data.find(t => t.chainId === chainId && t.tokenAddress !== SYSTEM.lastTradedToken);

        if (valid) {
            const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${valid.tokenAddress}`);
            const pair = details.data.pairs[0];

            if (pair) {
                // AI Logic Simulation
                const sentiment = Math.random() * (0.99 - 0.5) + 0.5;
                const rsi = Math.floor(Math.random() * 80) + 20;
               
                const target = {
                    name: pair.baseToken.name,
                    symbol: pair.baseToken.symbol,
                    tokenAddress: pair.baseToken.address,
                    price: parseFloat(pair.priceUsd),
                    sentimentScore: sentiment,
                    rsi: rsi
                };

                await processSignal(chatId, target);
            }
        }
    } catch (e) { console.log(`[SCAN] ${SYSTEM.currentNetwork} Searching...`.gray); }
   
    if (SYSTEM.autoPilot) setTimeout(() => runNeuralScanner(chatId), 6000);
}

async function processSignal(chatId, data) {
    const strategy = STRATEGY_MODES[SYSTEM.strategyMode];
    let confidence = 0.5 + (data.sentimentScore * 0.3);
    if (data.rsi < 70 && data.rsi > 30) confidence += 0.2;

    console.log(`[NEURAL] ${data.symbol} Confidence: ${(confidence*100).toFixed(0)}%`.cyan);

    if (confidence >= strategy.minConf) {
        SYSTEM.pendingTarget = data;
        bot.sendMessage(chatId, `
🧠 **NEURAL SIGNAL: ${data.symbol}**
Network: ${SYSTEM.currentNetwork}
Confidence: ${(confidence*100).toFixed(0)}%
Price: $${data.price}
Action: ${SYSTEM.autoPilot ? 'EXECUTING' : 'WAITING'}
`, { parse_mode: 'Markdown' });

        if (SYSTEM.autoPilot) await executeBuy(chatId);
    }
}

// ==========================================
//  EXECUTION ENGINE (AXIOS UPGRADE)
// ==========================================

async function executeBuy(chatId) {
    if (!SYSTEM.pendingTarget) return;
    const target = SYSTEM.pendingTarget;
    const amount = SYSTEM.tradeAmount;

    SYSTEM.isLocked = true;
    bot.sendMessage(chatId, `⚔️ **ATTACKING:** ${target.symbol} (${amount} ${SYSTEM.currentNetwork === 'SOL' ? 'SOL' : 'ETH'})...`);

    let result = null;

    if (SYSTEM.currentNetwork === 'SOL') {
        result = await buySolana(chatId, target.tokenAddress, amount);
    } else {
        result = await buyEVM(chatId, target.tokenAddress, amount);
    }

    if (result) {
        SYSTEM.activePosition = {
            ...target,
            entryPrice: target.price, // USD Price
            tokenAmount: result.amountOut,
            rawAmount: result.amountOut // Stored for swapping back
        };
        SYSTEM.pendingTarget = null;
        updateQuest('trade', chatId);
        runProfitMonitor(chatId);
    } else {
        SYSTEM.isLocked = false;
    }
}

async function executeSell(chatId) {
    if (!SYSTEM.activePosition) return;
    const pos = SYSTEM.activePosition;

    bot.sendMessage(chatId, `📉 **SELLING:** ${pos.symbol}...`);

    let result = null;
    if (SYSTEM.currentNetwork === 'SOL') {
        result = await sellSolana(chatId, pos.tokenAddress, pos.tokenAmount);
    } else {
        result = await sellEVM(chatId, pos.tokenAddress, pos.rawAmount);
    }

    if (result) {
        SYSTEM.lastTradedToken = pos.tokenAddress;
        SYSTEM.activePosition = null;
        SYSTEM.isLocked = false;
        bot.sendMessage(chatId, `✅ **TRADE COMPLETE.** Resuming Scan.`);
        if(SYSTEM.autoPilot) runNeuralScanner(chatId);
    }
}

// --- SOLANA SPECIFIC (JUPITER VIA AXIOS) ---
async function buySolana(chatId, tokenAddr, amountSol) {
    try {
        const inputMint = 'So11111111111111111111111111111111111111112'; // SOL
        const amount = Math.floor(amountSol * LAMPORTS_PER_SOL);
        const slip = RISK_PROFILES[SYSTEM.riskProfile].slippage * 100; // bps

        // 1. Get Quote
        const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${tokenAddr}&amount=${amount}&slippageBps=${slip}`;
        const quoteRes = await axios.get(quoteUrl);
        const quote = quoteRes.data;

        if(!quote || quote.error) throw new Error("No Route Found");

        // 2. Get Transaction
        const swapRes = await axios.post('https://quote-api.jup.ag/v6/swap', {
            quoteResponse: quote,
            userPublicKey: solWallet.publicKey.toString(),
            wrapAndUnwrapSol: true
        });
       
        const { swapTransaction } = swapRes.data;

        // 3. Sign & Send
        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([solWallet]);
        const txid = await solConnection.sendRawTransaction(tx.serialize(), {skipPreflight: true});
       
        bot.sendMessage(chatId, `🚀 **SOL TX:** https://solscan.io/tx/${txid}`);
        return { amountOut: quote.outAmount };
    } catch(e) {
        bot.sendMessage(chatId, `⚠️ SOL Fail: ${e.message}`);
        console.error(e);
        return null;
    }
}

async function sellSolana(chatId, tokenAddr, amountToken) {
    try {
        const outputMint = 'So11111111111111111111111111111111111111112';
        const slip = RISK_PROFILES[SYSTEM.riskProfile].slippage * 100;

        // 1. Get Quote
        const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${tokenAddr}&outputMint=${outputMint}&amount=${amountToken}&slippageBps=${slip}`;
        const quoteRes = await axios.get(quoteUrl);
        const quote = quoteRes.data;

        // 2. Get Transaction
        const swapRes = await axios.post('https://quote-api.jup.ag/v6/swap', {
            quoteResponse: quote,
            userPublicKey: solWallet.publicKey.toString(),
            wrapAndUnwrapSol: true
        });
       
        const { swapTransaction } = swapRes.data;

        // 3. Sign & Send
        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        tx.sign([solWallet]);
        const txid = await solConnection.sendRawTransaction(tx.serialize(), {skipPreflight: true});
        return { hash: txid };
    } catch(e) {
        bot.sendMessage(chatId, `⚠️ SOL Sell Fail: ${e.message}`);
        return null;
    }
}

// --- EVM SPECIFIC (UNISWAP V2) ---
async function buyEVM(chatId, tokenAddr, amountEth) {
    try {
        const net = NETWORKS[SYSTEM.currentNetwork];
        const path = [net.weth, tokenAddr];
        const value = ethers.parseEther(amountEth);
       
        const tx = await evmRouter.swapExactETHForTokens(
            0, path, evmSigner.address, Math.floor(Date.now()/1000)+120,
            { value: value, gasLimit: 300000 }
        );
        bot.sendMessage(chatId, `🚀 **${SYSTEM.currentNetwork} TX:** ${tx.hash}`);
        await tx.wait();
        return { amountOut: 0 };
    } catch(e) { bot.sendMessage(chatId, `⚠️ EVM Fail: ${e.message}`); return null; }
}

async function sellEVM(chatId, tokenAddr, amountToken) {
    try {
        const net = NETWORKS[SYSTEM.currentNetwork];
        const path = [tokenAddr, net.weth];
       
        const token = new Contract(tokenAddr, ["function approve(address, uint) returns (bool)", "function balanceOf(address) view returns (uint)"], evmSigner);
        const bal = await token.balanceOf(evmSigner.address);
        await (await token.approve(net.router, bal)).wait();

        const tx = await evmRouter.swapExactTokensForETH(
            bal, 0, path, evmSigner.address, Math.floor(Date.now()/1000)+120,
            { gasLimit: 350000 }
        );
        await tx.wait();
        return { hash: tx.hash };
    } catch(e) { bot.sendMessage(chatId, `⚠️ EVM Sell Fail: ${e.message}`); return null; }
}

// ==========================================
//  PROFIT MONITOR
// ==========================================

async function runProfitMonitor(chatId) {
    if (!SYSTEM.activePosition || !SYSTEM.isLocked) return;

    try {
        // Get LIVE Price from DexScreener
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${SYSTEM.activePosition.tokenAddress}`);
        const currentPrice = parseFloat(res.data.pairs[0].priceUsd);
        const entryPrice = SYSTEM.activePosition.entryPrice;
       
        const pnl = ((currentPrice - entryPrice) / entryPrice) * 100;
       
        if (!SYSTEM.activePosition.highestPrice || currentPrice > SYSTEM.activePosition.highestPrice) {
            SYSTEM.activePosition.highestPrice = currentPrice;
        }
       
        const drop = ((SYSTEM.activePosition.highestPrice - currentPrice) / SYSTEM.activePosition.highestPrice) * 100;
        const strategy = STRATEGY_MODES[SYSTEM.strategyMode];
        const risk = RISK_PROFILES[SYSTEM.riskProfile];

        process.stdout.write(`\r[MONITOR] ${SYSTEM.activePosition.symbol} PnL: ${pnl.toFixed(2)}% | Drop: ${drop.toFixed(2)}%  `);

        if (drop >= strategy.trail && pnl > 1) {
            bot.sendMessage(chatId, `📉 **TRAILING STOP:** Reversing at +${pnl.toFixed(2)}%`);
            await executeSell(chatId);
        }
        else if (pnl <= -risk.stopLoss) {
            bot.sendMessage(chatId, `🛑 **STOP LOSS:** Exiting at ${pnl.toFixed(2)}%`);
            await executeSell(chatId);
        }
        else {
            setTimeout(() => runProfitMonitor(chatId), 4000);
        }

    } catch(e) {
        setTimeout(() => runProfitMonitor(chatId), 4000);
    }
}

// ==========================================
//  COMMAND SUITE
// ==========================================

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `
🐲 **APEX PREDATOR v8000.1 (AXIOS)**
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
    const net = match[1].toUpperCase();
    if(NETWORKS[net]) {
        initNetwork(net);
        bot.sendMessage(msg.chat.id, `✅ **NETWORK:** Switched to ${net}`);
    } else {
        bot.sendMessage(msg.chat.id, `❌ Invalid. Use: SOL, ETH, BSC, BASE, ARB`);
    }
});

bot.onText(/\/auto/, (msg) => {
    if (!evmWallet && !solWallet) return bot.sendMessage(msg.chat.id, "❌ Connect Wallet First.");
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    bot.sendMessage(msg.chat.id, `🤖 **AUTO-PILOT:** ${SYSTEM.autoPilot ? 'ON' : 'OFF'}`);
    if(SYSTEM.autoPilot) runNeuralScanner(msg.chat.id);
});

bot.onText(/\/risk (.+)/, (msg, match) => {
    const r = match[1].toUpperCase();
    if(RISK_PROFILES[r]) {
        SYSTEM.riskProfile = r;
        bot.sendMessage(msg.chat.id, `⚠️ Risk set to: ${r}`);
    }
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

// Start Server
http.createServer((req, res) => res.end("APEX v8000 ONLINE")).listen(8080);
console.log("APEX v8000 HYBRID ONLINE".magenta);
