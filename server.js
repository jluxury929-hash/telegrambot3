/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9011 (OMNI-PARALLEL MASTER)
 * ===============================================================================
 * ARCH: Parallel Neural Workers (5 Simultaneous Chain Loops)
 * ENGINE: Jupiter Ultra (v1) SVM + Smart Contract EVM (0x5aF9...)
 * LOGIC: Infinite Web Signal Loop -> Multi-Burst Buy -> Peak Exit -> Loop
 * SPECS: Constant 24/7 Cycle | /setamount | /withdraw | /auto
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

// --- CONSTANTS & CONFIG ---
const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";
const JUP_API_KEY = process.env.JUP_API_KEY || "f440d4df-b5c4-4020-a960-ac182d3752ab";
const MY_EXECUTOR = "0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610";
const APEX_ABI = [
    "function executeBuy(address router, address token, uint256 minOut, uint256 deadline) external payable",
    "function executeSell(address router, address token, uint256 amtIn, uint256 minOut, uint256 deadline) external",
    "function emergencyWithdraw(address token) external"
];

const NETWORKS = {
    ETH:  { id: 'ethereum', type: 'EVM', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', executor: MY_EXECUTOR },
    SOL:  { id: 'solana', type: 'SVM', rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', shotgun: [process.env.SOLANA_RPC, 'https://api.mainnet-beta.solana.com'] },
    BASE: { id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', weth: '0x4200000000000000000000000000000000000006', executor: MY_EXECUTOR },
    BSC:  { id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', executor: MY_EXECUTOR },
    ARB:  { id: 'arbitrum', type: 'EVM', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', executor: MY_EXECUTOR }
};

// --- GLOBAL STATE ---
let SYSTEM = { 
    autoPilot: false, tradeAmount: "0.01", 
    activePositions: {}, // Position tracking per chain
    lastTradedTokens: {}, // Cooldown tracking per chain
    riskProfile: 'MEDIUM', strategyMode: 'DAY'
};
let PLAYER = { level: 1, xp: 0, nextLevelXp: 1000, class: "DATA ANALYST" };
let evmWallet, evmSigner, apexContract, solWallet, solConnection;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  OMNI-PARALLEL ENGINE (THE LOOP)
// ==========================================

async function startOmniParallelEngine(chatId) {
    bot.sendMessage(chatId, `🚀 **OMNI-ENGINE ONLINE.** Spawning workers for all networks...`);
    
    // Launch one brain for every network in the config
    Object.keys(NETWORKS).forEach(netKey => {
        runNetworkWorker(chatId, netKey);
    });
}

async function runNetworkWorker(chatId, netKey) {
    console.log(`[WORKER] Brain spawned for ${netKey}`.magenta);
    
    while (SYSTEM.autoPilot) {
        try {
            // Only scan if not currently in a trade on this specific network
            if (!SYSTEM.activePositions[netKey]) {
                const signal = await neuralScan(netKey);
                if (signal) {
                    bot.sendMessage(chatId, `🧠 **[${netKey}] SIGNAL:** ${signal.symbol} Validated.`);
                    await executeOmniBuy(chatId, netKey, signal);
                }
            }
            await new Promise(r => setTimeout(r, 6000));
        } catch (e) {
            console.error(`[${netKey}] Loop Error: ${e.message}`.red);
            await new Promise(r => setTimeout(r, 10000));
        }
    }
}

// ==========================================
//  NEURAL WEB AI SCANNER
// ==========================================

async function neuralScan(netKey) {
    const net = NETWORKS[netKey];
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
        const match = res.data.find(t => t.chainId === net.id && t.tokenAddress !== SYSTEM.lastTradedTokens[netKey]);

        if (match) {
            const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${match.tokenAddress}`);
            const pair = details.data.pairs[0];
            if (pair && pair.liquidity.usd > 5000) {
                return { symbol: pair.baseToken.symbol, tokenAddress: match.tokenAddress, price: parseFloat(pair.priceUsd) };
            }
        }
    } catch (e) { return null; }
}

// ==========================================
//  OMNI-EXECUTION (SHOTGUN + CONTRACT)
// ==========================================

async function executeOmniBuy(chatId, netKey, signal) {
    bot.sendMessage(chatId, `⚔️ **[${netKey}] ATTACKING:** ${signal.symbol}...`);
    
    const result = (netKey === 'SOL')
        ? await executeSolanaShotgun(signal.tokenAddress, SYSTEM.tradeAmount, 'BUY')
        : await executeEvmContract(netKey, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY');

    if (result) {
        SYSTEM.activePositions[netKey] = { ...signal, entryPrice: signal.price, highestPrice: signal.price, tokenAmount: result.amountOut || 0 };
        runOmniProfitMonitor(chatId, netKey);
        addXP(250, chatId);
    }
}

async function runOmniProfitMonitor(chatId, netKey) {
    const pos = SYSTEM.activePositions[netKey];
    if (!pos) return;

    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`);
        const currentPrice = parseFloat(res.data.pairs[0].priceUsd);
        const pnl = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
        
        if (currentPrice > pos.highestPrice) pos.highestPrice = currentPrice;
        const drop = ((pos.highestPrice - currentPrice) / pos.highestPrice) * 100;

        // EXIT AT PEAK: +25% Target, -10% Stop Loss, 6% Trailing Stop
        if (pnl >= 25 || drop >= 6 || pnl <= -10) {
            bot.sendMessage(chatId, `📉 **[${netKey}] PEAK REACHED:** PnL: ${pnl.toFixed(2)}%. Selling...`);
            
            const sold = (netKey === 'SOL')
                ? await executeSolanaShotgun(pos.tokenAddress, 0, 'SELL')
                : await executeEvmContract(netKey, pos.tokenAddress, pos.tokenAmount, 'SELL');

            if (sold) {
                SYSTEM.lastTradedTokens[netKey] = pos.tokenAddress;
                delete SYSTEM.activePositions[netKey];
                addXP(500, chatId);
                bot.sendMessage(chatId, `✅ **[${netKey}] TRADE COMPLETE.**`);
            }
        } else {
            setTimeout(() => runOmniProfitMonitor(chatId, netKey), 5000);
        }
    } catch(e) { setTimeout(() => runOmniProfitMonitor(chatId, netKey), 5000); }
}

// ==========================================
//  COMMAND INTERFACE
// ==========================================

bot.onText(/\/setamount (.+)/, (msg, match) => {
    SYSTEM.tradeAmount = match[1];
    bot.sendMessage(msg.chat.id, `💰 **TRADE SIZE SET:** ${SYSTEM.tradeAmount}`);
});

bot.onText(/\/withdraw (.+)/, async (msg, match) => {
    if (!apexContract) return;
    const target = match[1].toLowerCase() === 'eth' ? "0x0000000000000000000000000000000000000000" : match[1];
    const tx = await apexContract.emergencyWithdraw(target);
    bot.sendMessage(msg.chat.id, `🚨 **WITHDRAW SENT:** ${tx.hash}`);
});

bot.onText(/\/auto/, (msg) => {
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    if (SYSTEM.autoPilot) startOmniParallelEngine(msg.chat.id);
    bot.sendMessage(msg.chat.id, `🤖 **AUTO-PILOT:** ${SYSTEM.autoPilot ? 'OMNI-PARALLEL ACTIVE' : 'OFF'}`);
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    const rawMnemonic = match[1].trim();
    try {
        evmWallet = ethers.HDNodeWallet.fromPhrase(rawMnemonic);
        const seed = bip39.mnemonicToSeedSync(rawMnemonic);
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        Object.keys(NETWORKS).forEach(n => initNetwork(n));
        bot.sendMessage(msg.chat.id, `🔗 **NEURAL LINK SECURE.** Ready on all chains.`);
    } catch(e) { bot.sendMessage(msg.chat.id, "❌ Invalid Seed"); }
});

bot.onText(/\/status/, (msg) => {
    const activeChains = Object.keys(SYSTEM.activePositions).join(', ') || 'None';
    bot.sendMessage(msg.chat.id, `📊 **STATUS**\nLvl: ${PLAYER.level} | Class: ${PLAYER.class}\nAmt: ${SYSTEM.tradeAmount}\nActive Trades: ${activeChains}`);
});

// ==========================================
//  CORE HELPERS
// ==========================================

async function executeSolanaShotgun(addr, amt, dir) {
    try {
        const taker = solWallet.publicKey.toString();
        const amtStr = dir === 'BUY' ? Math.floor(amt * LAMPORTS_PER_SOL).toString() : SYSTEM.activePositions['SOL'].tokenAmount.toString();
        const res = await axios.get(`${JUP_ULTRA_API}/order?inputMint=So11111111111111111111111111111111111111112&outputMint=${addr}&amount=${amtStr}&taker=${taker}&slippageBps=200`, { headers: {'x-api-key': JUP_API_KEY}});
        const tx = VersionedTransaction.deserialize(Buffer.from(res.data.transaction, 'base64'));
        tx.sign([solWallet]);
        const signedRaw = tx.serialize();
        const tasks = [
            axios.post(`${JUP_ULTRA_API}/execute`, { signedTransaction: Buffer.from(signedRaw).toString('base64'), requestId: res.data.requestId }, { headers: {'x-api-key': JUP_API_KEY}}),
            new Connection(NETWORKS.SOL.shotgun[0]).sendRawTransaction(signedRaw, { skipPreflight: true })
        ];
        const fastest = await Promise.any(tasks);
        return { amountOut: res.data.outAmount, hash: fastest.data?.signature || fastest };
    } catch (e) { return null; }
}

async function executeEvmContract(netKey, addr, amt, dir) {
    try {
        const net = NETWORKS[netKey];
        const deadline = Math.floor(Date.now() / 1000) + 120;
        if (dir === 'BUY') {
            const tx = await apexContract.executeBuy(net.router, addr, 0, deadline, { value: ethers.parseEther(amt.toString()), gasLimit: 300000 });
            await tx.wait(); return { amountOut: 1 };
        } else {
            const tx = await apexContract.executeSell(net.router, addr, amt, 0, deadline, { gasLimit: 350000 });
            await tx.wait(); return { hash: tx.hash };
        }
    } catch (e) { return null; }
}

async function initNetwork(netKey) {
    const net = NETWORKS[netKey];
    if (net.type === 'EVM' && evmWallet) {
        evmSigner = evmWallet.connect(new JsonRpcProvider(net.rpc));
        apexContract = new ethers.Contract(net.executor, APEX_ABI, evmSigner);
    } else { solConnection = new Connection(net.rpc, 'confirmed'); }
}

function addXP(amt, chatId) {
    PLAYER.xp += amt;
    if (PLAYER.xp >= PLAYER.nextLevelXp) {
        PLAYER.level++; PLAYER.xp = 0; PLAYER.nextLevelXp *= 1.5;
        bot.sendMessage(chatId, `🆙 **PROMOTED:** Level ${PLAYER.level} Master Hunter!`);
    }
}

http.createServer((req, res) => res.end("APEX v9011 ONLINE")).listen(8080);
console.log("APEX v9011 MASTER OMNI-PARALLEL READY".magenta);
