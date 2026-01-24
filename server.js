/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9010 (PERPETUAL MASTER)
 * ===============================================================================
 * ARCH: Infinite Neural Web Cycle (Scraper -> Validation -> Peak Exit)
 * ENGINE: SVM (Jupiter Ultra Shotgun) | EVM (Atomic Smart Executor)
 * SPECS: 24/7 Perpetual Rebuying | /setamount | /withdraw | RPG System
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

// --- CONSTANTS ---
const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";
const MY_EXECUTOR = "0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610";
const APEX_ABI = [
    "function executeBuy(address router, address token, uint256 minOut, uint256 deadline) external payable",
    "function executeSell(address router, address token, uint256 amtIn, uint256 minOut, uint256 deadline) external",
    "function emergencyWithdraw(address token) external"
];

// --- 5-CHAIN NETWORK DEFINITIONS ---
const NETWORKS = {
    ETH:  { id: 'ethereum', type: 'EVM', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', executor: MY_EXECUTOR },
    SOL:  { id: 'solana', type: 'SVM', rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', shotgun: [process.env.SOLANA_RPC, 'https://api.mainnet-beta.solana.com'] },
    BASE: { id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', weth: '0x4200000000000000000000000000000000000006', executor: MY_EXECUTOR },
    BSC:  { id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', executor: MY_EXECUTOR },
    ARB:  { id: 'arbitrum', type: 'EVM', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', executor: MY_EXECUTOR }
};

// --- GLOBAL STATE ---
let SYSTEM = { currentNetwork: 'SOL', autoPilot: false, isLocked: false, tradeAmount: "0.01", activePosition: null, pendingTarget: null, lastTradedToken: null, riskProfile: 'MEDIUM', strategyMode: 'DAY' };
let PLAYER = { level: 1, xp: 0, nextLevelXp: 1000, class: "DATA ANALYST", dailyQuests: [{ id: 'sim', target: 10, count: 0, xp: 150 }, { id: 'trade', target: 1, count: 0, xp: 500 }] };
let evmWallet, evmSigner, evmProvider, apexContract, solWallet, solConnection;

const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  PERPETUAL NEURAL LOOP
// ==========================================

async function startPerpetualEngine(chatId) {
    bot.sendMessage(chatId, `🧠 **NEURAL ENGINE ONLINE.** Perpetual Cycle Activated.`);
   
    while (SYSTEM.autoPilot) {
        try {
            // STEP 1: WEB AI HUNTING
            if (!SYSTEM.activePosition && !SYSTEM.pendingTarget) {
                await runNeuralScannerOnce(chatId);
            }

            // STEP 2: MULTI-BURST EXECUTION
            if (SYSTEM.pendingTarget && !SYSTEM.activePosition && !SYSTEM.isLocked) {
                await executeNeuralBuy(chatId);
            }

            // Loop pacing (avoid API rate limits)
            await new Promise(r => setTimeout(r, 6000));
        } catch (e) {
            console.error(`[ENGINE ERROR] Cycle interrupted: ${e.message}`.red);
            SYSTEM.isLocked = false;
            await new Promise(r => setTimeout(r, 10000));
        }
    }
}

// ==========================================
//  SCANNER & MONITORING
// ==========================================

async function runNeuralScannerOnce(chatId) {
    const net = NETWORKS[SYSTEM.currentNetwork];
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
        const match = res.data.find(t => t.chainId === net.id && t.tokenAddress !== SYSTEM.lastTradedToken);

        if (match) {
            const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${match.tokenAddress}`);
            const pair = details.data.pairs[0];
           
            if (pair && pair.liquidity.usd > 5000 && pair.volume.h24 > 50000) {
                SYSTEM.pendingTarget = { symbol: pair.baseToken.symbol, tokenAddress: match.tokenAddress, price: parseFloat(pair.priceUsd) };
                bot.sendMessage(chatId, `🧠 **NEURAL SIGNAL:** ${pair.baseToken.symbol} at $${pair.priceUsd}. Engaging.`);
                addXP(150, chatId);
            }
        }
    } catch (e) { /* Loop will retry */ }
}

async function executeNeuralBuy(chatId) {
    const target = SYSTEM.pendingTarget;
    SYSTEM.isLocked = true;
    bot.sendMessage(chatId, `⚔️ **BURST ATTACK:** ${target.symbol} | Amount: ${SYSTEM.tradeAmount}...`);

    const result = (SYSTEM.currentNetwork === 'SOL')
        ? await executeSolanaShotgun(chatId, 'BUY', target.tokenAddress, SYSTEM.tradeAmount)
        : await executeEvmContract(chatId, 'BUY', target.tokenAddress, SYSTEM.tradeAmount);

    if (result) {
        SYSTEM.activePosition = { ...target, tokenAmount: result.amountOut || 0, entryPrice: target.price, highestPrice: target.price };
        SYSTEM.pendingTarget = null;
        updateQuest('trade', chatId);
        runPeakMonitor(chatId);
    } else {
        SYSTEM.pendingTarget = null;
        SYSTEM.isLocked = false;
    }
}

async function runPeakMonitor(chatId) {
    if (!SYSTEM.activePosition) return;
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${SYSTEM.activePosition.tokenAddress}`);
        const currentPrice = parseFloat(res.data.pairs[0].priceUsd);
        const pnl = ((currentPrice - SYSTEM.activePosition.entryPrice) / SYSTEM.activePosition.entryPrice) * 100;
       
        if (currentPrice > SYSTEM.activePosition.highestPrice) SYSTEM.activePosition.highestPrice = currentPrice;
        const dropFromPeak = ((SYSTEM.activePosition.highestPrice - currentPrice) / SYSTEM.activePosition.highestPrice) * 100;

        // EXIT AT PEAK: +25% profit target, -10% stop loss, or 6% trailing stop
        if (pnl >= 25 || dropFromPeak >= 6 || pnl <= -10) {
            bot.sendMessage(chatId, `📉 **PEAK SETTLED:** PnL: ${pnl.toFixed(2)}%. Selling...`);
            const sold = (SYSTEM.currentNetwork === 'SOL')
                ? await executeSolanaShotgun(chatId, 'SELL', SYSTEM.activePosition.tokenAddress, 0)
                : await executeEvmContract(chatId, 'SELL', SYSTEM.activePosition.tokenAddress, SYSTEM.activePosition.tokenAmount);
           
            if (sold) {
                SYSTEM.lastTradedToken = SYSTEM.activePosition.tokenAddress;
                SYSTEM.activePosition = null;
                SYSTEM.isLocked = false;
                bot.sendMessage(chatId, `✅ **CLOSED.** Restarting Cycle.`);
            }
        } else {
            setTimeout(() => runPeakMonitor(chatId), 5000);
        }
    } catch(e) { setTimeout(() => runPeakMonitor(chatId), 5000); }
}

// ==========================================
//  COMMANDS
// ==========================================

bot.onText(/\/setamount (.+)/, (msg, match) => {
    SYSTEM.tradeAmount = match[1];
    bot.sendMessage(msg.chat.id, `💰 **SIZE UPDATED:** ${SYSTEM.tradeAmount} ${SYSTEM.currentNetwork}`);
});

bot.onText(/\/auto/, (msg) => {
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    if (SYSTEM.autoPilot) startPerpetualEngine(msg.chat.id);
    bot.sendMessage(msg.chat.id, `🤖 **AUTO-PILOT:** ${SYSTEM.autoPilot ? 'ACTIVE' : 'OFF'}`);
});

bot.onText(/\/withdraw (.+)/, async (msg, match) => {
    if (!apexContract) return;
    const target = match[1].toLowerCase() === 'eth' ? "0x0000000000000000000000000000000000000000" : match[1];
    const tx = await apexContract.emergencyWithdraw(target);
    bot.sendMessage(msg.chat.id, `🚨 **WITHDRAW SENT:** ${tx.hash}`);
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    const rawMnemonic = match[1].trim();
    evmWallet = ethers.HDNodeWallet.fromPhrase(rawMnemonic);
    const seed = bip39.mnemonicToSeedSync(rawMnemonic);
    solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
    await initNetwork(SYSTEM.currentNetwork);
    bot.sendMessage(msg.chat.id, `🔗 **NEURAL LINK SECURE.** EVM: ${evmWallet.address.slice(0,6)}...`);
});

bot.onText(/\/status/, (msg) => {
    bot.sendMessage(msg.chat.id, `📊 **STATUS**\nRank: ${PLAYER.class} (Lvl ${PLAYER.level})\nNet: ${SYSTEM.currentNetwork}\nAmt: ${SYSTEM.tradeAmount}\nActive: ${SYSTEM.activePosition ? SYSTEM.activePosition.symbol : 'None'}`);
});

// ==========================================
//  HELPERS (EXECUTION)
// ==========================================

async function executeSolanaShotgun(chatId, dir, addr, amt) {
    try {
        const taker = solWallet.publicKey.toString();
        const amtStr = dir === 'BUY' ? Math.floor(amt * LAMPORTS_PER_SOL).toString() : SYSTEM.activePosition.tokenAmount.toString();
        const res = await axios.get(`${JUP_ULTRA_API}/order?inputMint=So11111111111111111111111111111111111111112&outputMint=${addr}&amount=${amtStr}&taker=${taker}&slippageBps=200`);
        const tx = VersionedTransaction.deserialize(Buffer.from(res.data.transaction, 'base64'));
        tx.sign([solWallet]);
        const tasks = [
            axios.post(`${JUP_ULTRA_API}/execute`, { signedTransaction: Buffer.from(tx.serialize()).toString('base64'), requestId: res.data.requestId }),
            new Connection(NETWORKS.SOL.shotgun[0]).sendRawTransaction(tx.serialize(), { skipPreflight: true })
        ];
        const fastest = await Promise.any(tasks);
        return { amountOut: res.data.outAmount, hash: fastest.data?.signature || fastest };
    } catch (e) { return null; }
}

async function executeEvmContract(chatId, dir, addr, amt) {
    try {
        const net = NETWORKS[SYSTEM.currentNetwork];
        if (dir === 'BUY') {
            const tx = await apexContract.executeBuy(net.router, addr, 0, Math.floor(Date.now()/1000)+120, { value: ethers.parseEther(amt.toString()), gasLimit: 300000 });
            await tx.wait(); return { amountOut: 1 };
        } else {
            const tx = await apexContract.executeSell(net.router, addr, amt, 0, Math.floor(Date.now()/1000)+120, { gasLimit: 350000 });
            await tx.wait(); return { hash: tx.hash };
        }
    } catch (e) { return null; }
}

async function initNetwork(netKey) {
    const net = NETWORKS[netKey];
    if (net.type === 'EVM' && evmWallet) {
        evmProvider = new JsonRpcProvider(net.rpc);
        evmSigner = evmWallet.connect(evmProvider);
        apexContract = new ethers.Contract(net.executor, APEX_ABI, evmSigner);
    } else {
        solConnection = new Connection(net.rpc, 'confirmed');
    }
}

function addXP(amt, chatId) {
    PLAYER.xp += amt;
    if (PLAYER.xp >= PLAYER.nextLevelXp) { PLAYER.level++; PLAYER.xp = 0; PLAYER.nextLevelXp *= 1.5; bot.sendMessage(chatId, `🆙 **PROMOTED:** Level ${PLAYER.level}`); }
}
function updateQuest(type, chatId) { PLAYER.dailyQuests.forEach(q => { if(q.id === type && q.count < q.target) { q.count++; if(q.count === q.target) addXP(q.xp, chatId); } }); }

http.createServer((req, res) => res.end("APEX v9010 ONLINE")).listen(8080);
console.log("APEX v9010 PERPETUAL MASTER READY".magenta);

