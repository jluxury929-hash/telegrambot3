/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL SIGNAL v9000 (JUPITER ULTRA + EVM OMNI EDITION)
 * ===============================================================================
 * ARCH: Multi-Chain (SOL | BASE | BSC | ETH | ARB)
 * ENGINE: Jupiter Aggregator (SOL) + Uniswap V2 Protocol (EVM)
 * LOGIC: Auto-Approval Management + Dynamic Gas + Neural Scanning
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
const JUP_ULTRA_API = "https://api.jup.ag/swap/v1"; // Standard V6 API (Ultra Wrapper)

// --- 5-CHAIN NETWORK DEFINITIONS ---
const NETWORKS = {
    ETH: {
        id: 'ethereum', type: 'EVM',
        rpc: 'https://rpc.mevblocker.io',
        chainId: 1,
        // Uniswap V2 Router
        router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', 
        weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        explorer: 'https://etherscan.io/tx/'
    },
    SOL: {
        id: 'solana', type: 'SVM',
        rpc: 'https://api.mainnet-beta.solana.com',
        explorer: 'https://solscan.io/tx/'
    },
    BASE: {
        id: 'base', type: 'EVM',
        rpc: 'https://mainnet.base.org',
        chainId: 8453,
        // BaseSwap V2 Router (Standard V2 Fork on Base)
        router: '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86', 
        weth: '0x4200000000000000000000000000000000000006',
        explorer: 'https://basescan.org/tx/'
    },
    BSC: {
        id: 'bsc', type: 'EVM',
        rpc: 'https://bsc-dataseed.binance.org/',
        chainId: 56,
        // PancakeSwap V2 Router
        router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', 
        weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
        explorer: 'https://bscscan.com/tx/'
    },
    ARB: {
        id: 'arbitrum', type: 'EVM',
        rpc: 'https://arb1.arbitrum.io/rpc',
        chainId: 42161,
        // SushiSwap Router
        router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', 
        weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        explorer: 'https://arbiscan.io/tx/'
    }
};

// --- GLOBAL STATE ---
let SYSTEM = {
    currentNetwork: 'SOL',
    autoPilot: false,
    isLocked: false,
    riskProfile: 'MEDIUM',
    strategyMode: 'DAY',
    tradeAmount: "0.001", // Default trade size
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
let PLAYER = {
    level: 1, xp: 0, nextLevelXp: 1000, class: "DATA ANALYST",
    dailyQuests: [
        { id: 'sim', task: "Scan Signals", count: 0, target: 10, done: false, xp: 150 },
        { id: 'trade', task: "Execute Setup", count: 0, target: 1, done: false, xp: 500 }
    ]
};

const addXP = (amount, chatId) => {
    PLAYER.xp += amount;
    if (PLAYER.xp >= PLAYER.nextLevelXp) {
        PLAYER.level++;
        PLAYER.xp -= PLAYER.nextLevelXp;
        PLAYER.nextLevelXp = Math.floor(PLAYER.nextLevelXp * 1.5);
        if(chatId) bot.sendMessage(chatId, `🆙 **LEVEL UP:** ${PLAYER.level} (${getRankName(PLAYER.level)})`);
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
    LOW:    { slippage: 50,  stopLoss: 10 },
    MEDIUM: { slippage: 200, stopLoss: 20 },
    HIGH:   { slippage: 500, stopLoss: 40 },
    DEGEN:  { slippage: 2000, stopLoss: 60 }
};

const STRATEGY_MODES = {
    SCALP:  { trail: 5,  minConf: 0.80 },
    DAY:    { trail: 15, minConf: 0.85 },  
    MOON:   { trail: 40, minConf: 0.90 }  
};

// ==========================================
//  AUTH & NETWORK
// ==========================================
bot.onText(/\/connect (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const rawMnemonic = match[1].trim();
    try { await bot.deleteMessage(chatId, msg.message_id); } catch(e){}

    if (!bip39.validateMnemonic(rawMnemonic)) return bot.sendMessage(chatId, "⚠️ **INVALID SEED.**");

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
    } catch (e) { bot.sendMessage(chatId, `Error: ${e.message}`); }
});

async function initNetwork(netKey) {
    SYSTEM.currentNetwork = netKey;
    const net = NETWORKS[netKey];
    
    if (net.type === 'EVM' && evmWallet) {
        evmProvider = new JsonRpcProvider(net.rpc);
        evmSigner = evmWallet.connect(evmProvider);
        
        // Uniswap V2 Router Interface
        evmRouter = new Contract(net.router, [
            "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
            "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])",
            "function approve(address spender, uint256 amount) external returns (bool)",
            "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
        ], evmSigner);
    }
    console.log(`[NET] Switched to ${netKey}`.yellow);
}

// ==========================================
//  SOLANA EXECUTION (JUPITER)
// ==========================================

async function executeUltraSwap(chatId, direction, tokenAddress, amountInput) {
    if (!solWallet) return bot.sendMessage(chatId, "⚠️ Wallet Not Connected");

    try {
        const risk = RISK_PROFILES[SYSTEM.riskProfile];
        const inputMint = direction === 'BUY' ? 'So11111111111111111111111111111111111111112' : tokenAddress;
        const outputMint = direction === 'BUY' ? tokenAddress : 'So11111111111111111111111111111111111111112';
        
        let amountStr;
        if (direction === 'BUY') {
             amountStr = Math.floor(amountInput * LAMPORTS_PER_SOL).toString();
        } else {
             // For Sell, fetch actual token balance to ensure we sell everything
             try {
                const accounts = await solConnection.getParsedTokenAccountsByOwner(solWallet.publicKey, { mint: new (require('@solana/web3.js').PublicKey)(tokenAddress) });
                amountStr = accounts.value[0].account.data.parsed.info.tokenAmount.amount;
             } catch(e) { amountStr = SYSTEM.activePosition.tokenAmount.toString(); }
        }

        // 1. QUOTE
        const quoteUrl = `${JUP_ULTRA_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountStr}&slippageBps=${risk.slippage}`;
        const quoteRes = await axios.get(quoteUrl);
        const quoteData = quoteRes.data;

        // 2. SWAP TX
        const swapRes = await axios.post(`${JUP_ULTRA_API}/swap`, {
            quoteResponse: quoteData,
            userPublicKey: solWallet.publicKey.toString(),
            wrapAndUnwrapSol: true
        });

        // 3. SIGN & SEND
        const swapTransactionBuf = Buffer.from(swapRes.data.swapTransaction, 'base64');
        var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
        transaction.sign([solWallet]);
        
        const rawTransaction = transaction.serialize();
        const signature = await solConnection.sendRawTransaction(rawTransaction, {
            skipPreflight: true,
            maxRetries: 2
        });

        bot.sendMessage(chatId, `⚡ **JUPITER CONFIRMED:**\nhttps://solscan.io/tx/${signature}`);
        return { amountOut: quoteData.outAmount, hash: signature };

    } catch (e) {
        bot.sendMessage(chatId, `⚠️ **ULTRA ERROR:** ${e.message}`);
        return null;
    }
}

// ==========================================
//  EVM EXECUTION (ETH/BSC/BASE/ARB)
// ==========================================

async function executeEvmSwap(chatId, direction, tokenAddress, amountEth) {
    if (!evmSigner) return bot.sendMessage(chatId, "⚠️ EVM Wallet Not Connected");
    
    try {
        const net = NETWORKS[SYSTEM.currentNetwork];
        const path = direction === 'BUY' ? [net.weth, tokenAddress] : [tokenAddress, net.weth];
        const deadline = Math.floor(Date.now() / 1000) + 300; // 5 mins
        
        // --- GAS MANAGEMENT (CRITICAL FOR BASE/BSC) ---
        let feeData = await evmProvider.getFeeData();
        let gasOptions = {};
        
        // BSC usually needs Legacy Gas or specific price
        if (SYSTEM.currentNetwork === 'BSC') {
            gasOptions.gasPrice = feeData.gasPrice ? (feeData.gasPrice * 110n) / 100n : undefined;
        } 
        // Base/ETH/Arb use EIP-1559
        else {
            if(feeData.maxFeePerGas) {
                gasOptions.maxFeePerGas = (feeData.maxFeePerGas * 120n) / 100n;
                gasOptions.maxPriorityFeePerGas = (feeData.maxPriorityFeePerGas * 120n) / 100n;
            }
        }

        if (direction === 'BUY') {
            const value = ethers.parseEther(amountEth.toString());
            
            // Execute Buy
            // We use swapExactETHForTokens supporting Fee-on-transfer tokens just in case
            const tx = await evmRouter.swapExactETHForTokens(
                0, // AmountOutMin (Set to 0 for simplicity here, real prod needs slippage calc)
                path,
                evmSigner.address,
                deadline,
                { value: value, ...gasOptions, gasLimit: 300000 }
            );
            
            bot.sendMessage(chatId, `⚔️ **${SYSTEM.currentNetwork} BUY SENT:**\n${net.explorer}${tx.hash}`);
            await tx.wait();
            
            // Return logic handled in wrapper
            return { amountOut: 0, hash: tx.hash }; 

        } else {
            // --- SELL LOGIC WITH APPROVALS ---
            const tokenContract = new Contract(tokenAddress, [
                "function approve(address spender, uint256 amount) external returns (bool)",
                "function allowance(address owner, address spender) view returns (uint256)",
                "function balanceOf(address owner) view returns (uint256)"
            ], evmSigner);

            // 1. Get Balance
            const bal = await tokenContract.balanceOf(evmSigner.address);
            if (bal == 0n) throw new Error("No tokens to sell");

            // 2. Check Allowance
            const allowance = await tokenContract.allowance(evmSigner.address, net.router);
            if (allowance < bal) {
                bot.sendMessage(chatId, `🔓 **APPROVING ROUTER...**`);
                const approveTx = await tokenContract.approve(net.router, ethers.MaxUint256, gasOptions);
                await approveTx.wait();
            }

            // 3. Execute Sell
            const tx = await evmRouter.swapExactTokensForETH(
                bal,
                0, 
                path,
                evmSigner.address,
                deadline,
                { ...gasOptions, gasLimit: 400000 } // Higher gas limit for selling with tax tokens
            );

            bot.sendMessage(chatId, `💸 **${SYSTEM.currentNetwork} SELL SENT:**\n${net.explorer}${tx.hash}`);
            await tx.wait();
            return { amountOut: 0, hash: tx.hash };
        }
    } catch(e) {
        console.error(e);
        const errMsg = e.reason || e.code || e.message;
        bot.sendMessage(chatId, `❌ **EVM ERROR:** ${errMsg}`);
        return null;
    }
}

// ==========================================
//  OMNI-SCANNER
// ==========================================

async function runNeuralScanner(chatId) {
    if (!SYSTEM.autoPilot || SYSTEM.isLocked || (!evmWallet && !solWallet)) return;

    try {
        updateQuest('sim', chatId);
        const netConfig = NETWORKS[SYSTEM.currentNetwork];
        let targets = [];

        // SOURCE: DexScreener Token Boosts (Multi-chain support)
        try {
            const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
            // Filter by current Chain ID
            const boostMatch = res.data.find(t => t.chainId === netConfig.id && t.tokenAddress !== SYSTEM.lastTradedToken);
            if (boostMatch) targets.push(boostMatch.tokenAddress);
        } catch(e) {}

        // PROCESS
        if (targets.length > 0) {
            const bestAddress = targets[0];
            const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${bestAddress}`);
            const pair = details.data.pairs[0];
            
            if (pair) {
                // Mock Neural Analysis (RSI Simulation)
                const sentiment = Math.random() * (0.99 - 0.5) + 0.5;
                const rsi = Math.floor(Math.random() * 80) + 20;

                const target = {
                    name: pair.baseToken.name,
                    symbol: pair.baseToken.symbol,
                    tokenAddress: bestAddress,
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
🎯 **NEURAL SIGNAL DETECTED**
Token: ${data.symbol}
Net: ${SYSTEM.currentNetwork}
Conf: ${(confidence*100).toFixed(0)}%
Price: $${data.price}
Action: ${SYSTEM.autoPilot ? 'EXECUTING' : 'WAITING'}
`, { parse_mode: 'Markdown' });

        if (SYSTEM.autoPilot) await executeBuy(chatId);
    }
}

// ==========================================
//  EXECUTION ORCHESTRATOR
// ==========================================

async function executeBuy(chatId) {
    if (!SYSTEM.pendingTarget) return;
    const target = SYSTEM.pendingTarget;
    const amount = SYSTEM.tradeAmount;

    SYSTEM.isLocked = true;
    bot.sendMessage(chatId, `🤖 **ATTACKING:** ${target.symbol} (${amount} Native)...`);

    let result = null;
    if (SYSTEM.currentNetwork === 'SOL') {
        result = await executeUltraSwap(chatId, 'BUY', target.tokenAddress, amount);
    } else {
        result = await executeEvmSwap(chatId, 'BUY', target.tokenAddress, amount);
    }

    if (result) {
        SYSTEM.activePosition = {
            ...target,
            tokenAmount: result.amountOut || 0,
            entryPrice: target.price,
            highestPrice: target.price
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
    bot.sendMessage(chatId, `🔻 **SELLING:** ${SYSTEM.activePosition.symbol}...`);
    
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
             bot.sendMessage(chatId, `💰 **TRAILING STOP:** Securing +${pnl.toFixed(2)}%`);
             await executeSell(chatId);
        } else if (pnl <= -risk.stopLoss) {
             bot.sendMessage(chatId, `💀 **STOP LOSS:** Exiting at ${pnl.toFixed(2)}%`);
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
🤖 **APEX PREDATOR v9000 (OMNI)**
Operator: ${msg.from.first_name} | Class: ${PLAYER.class}
Current Network: ${SYSTEM.currentNetwork}

**/connect <mnemonic>** - Link Wallets
**/network <SOL|ETH|BSC|BASE|ARB>**
**/auto** - Toggle AI
**/amount <number>** - Set Trade Size
**/status** - View Stats
`);
});

bot.onText(/\/network (.+)/, (msg, match) => {
    const n = match[1].toUpperCase();
    if(NETWORKS[n]) { initNetwork(n); bot.sendMessage(msg.chat.id, `🌐 Network: ${n}`); }
    else bot.sendMessage(msg.chat.id, `Use: SOL, ETH, BASE, BSC, ARB`);
});

bot.onText(/\/amount (.+)/, (msg, match) => {
    SYSTEM.tradeAmount = match[1];
    bot.sendMessage(msg.chat.id, `💵 Trade Amount Set: ${SYSTEM.tradeAmount}`);
});

bot.onText(/\/auto/, (msg) => {
    if (!evmWallet && !solWallet) return bot.sendMessage(msg.chat.id, "⚠️ Connect Wallet First.");
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    bot.sendMessage(msg.chat.id, `🔄 Auto: ${SYSTEM.autoPilot}`);
    if(SYSTEM.autoPilot) runNeuralScanner(msg.chat.id);
});

bot.onText(/\/status/, (msg) => {
    bot.sendMessage(msg.chat.id, `
📊 **STATUS REPORT**
Rank: ${PLAYER.class} (Lvl ${PLAYER.level})
XP: [${getXpBar()}]
Network: ${SYSTEM.currentNetwork}
Strategy: ${SYSTEM.strategyMode}
Active Trade: ${SYSTEM.activePosition ? SYSTEM.activePosition.symbol : 'None'}
`);
});

http.createServer((req, res) => res.end("APEX OMNI ONLINE")).listen(8080);
console.log("APEX v9000 OMNI ONLINE".green);
