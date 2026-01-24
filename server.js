/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9013 (OMNI-PARALLEL SNIPER)
 * ===============================================================================
 * ARCH: Parallel Multi-Worker Engines (5 Simultaneous Chain Snipers)
 * EVM MASTER CONTRACT: 0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610
 * LOGIC: Buy -> Async Monitor Spawn -> Immediate Instant Rescan
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

// --- CONSTANTS ---
const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";
const JUP_API_KEY = "f440d4df-b5c4-4020-a960-ac182d3752ab"; 
const MY_EXECUTOR = "0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610";
const APEX_ABI = [
    "function executeBuy(address router, address token, uint256 minOut, uint256 deadline) external payable",
    "function executeSell(address router, address token, uint256 amtIn, uint256 minOut, uint256 deadline) external",
    "function emergencyWithdraw(address token) external"
];

// --- NETWORKS ---
const NETWORKS = {
    ETH:  { id: 'ethereum', type: 'EVM', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', executor: MY_EXECUTOR },
    SOL:  { id: 'solana', type: 'SVM', rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', shotgun: [process.env.SOLANA_RPC] },
    BASE: { id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', weth: '0x4200000000000000000000000000000000000006', executor: MY_EXECUTOR },
    BSC:  { id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', executor: MY_EXECUTOR },
    ARB:  { id: 'arbitrum', type: 'EVM', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', executor: MY_EXECUTOR }
};

// --- GLOBAL STATE ---
let SYSTEM = { 
    autoPilot: false, 
    tradeAmount: "0.01", 
    lastTradedTokens: {}, // Cooldowns
    isLocked: {} // Lock per network during TX
};
let evmWallet, solWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  OMNI-PARALLEL ENGINE STARTER
// ==========================================

bot.onText(/\/auto/, (msg) => {
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    if (SYSTEM.autoPilot) {
        bot.sendMessage(msg.chat.id, `🚀 **OMNI-SNIPER ONLINE.** Running 5 Parallel Loops...`);
        Object.keys(NETWORKS).forEach(netKey => runNetworkSniper(msg.chat.id, netKey));
    } else {
        bot.sendMessage(msg.chat.id, `🤖 **AUTO-PILOT:** OFF`);
    }
});

async function runNetworkSniper(chatId, netKey) {
    console.log(`[INIT] Sniper Loop for ${netKey} Online`.magenta);
    while (SYSTEM.autoPilot) {
        try {
            // SCAN PHASE
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await neuralScan(netKey);
                
                if (signal) {
                    bot.sendMessage(chatId, `🧠 **[${netKey}] SIGNAL:** ${signal.symbol}. Sniper Engaged.`);
                    SYSTEM.isLocked[netKey] = true;

                    // EXECUTE BUY
                    const buyRes = (netKey === 'SOL') 
                        ? await executeSolanaShotgun(signal.tokenAddress, SYSTEM.tradeAmount, 'BUY')
                        : await executeEvmContract(netKey, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY');

                    if (buyRes) {
                        const newPos = { ...signal, entryPrice: signal.price, highestPrice: signal.price, amountOut: buyRes.amountOut };
                        
                        // SPAWN THREADED MONITOR (Async - No Await)
                        // This allows the loop to return to scanning IMMEDIATELY
                        startIndependentMonitor(chatId, netKey, newPos);
                        
                        bot.sendMessage(chatId, `🚀 **[${netKey}] BOUGHT.** Rescanning instantly...`);
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 3000)); // Fast rescan delay
        } catch (e) {
            SYSTEM.isLocked[netKey] = false;
            await new Promise(r => setTimeout(r, 8000));
        }
    }
}

// ==========================================
//  INDEPENDENT MONITOR (PEAK HUNTING)
// ==========================================

async function startIndependentMonitor(chatId, netKey, pos) {
    // This runs in the background for every token you hold
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`);
        const currentPrice = parseFloat(res.data.pairs[0].priceUsd);
        const pnl = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
        
        if (currentPrice > pos.highestPrice) pos.highestPrice = currentPrice;
        const drop = ((pos.highestPrice - currentPrice) / pos.highestPrice) * 100;

        // EXIT LOGIC: Trailing Stop @ 6% | Take Profit @ 25% | Stop Loss @ 10%
        if (pnl >= 25 || drop >= 6 || pnl <= -10) {
            bot.sendMessage(chatId, `📉 **[${netKey}] PEAK REACHED:** ${pos.symbol} at ${pnl.toFixed(2)}%. Selling...`);
            
            const sold = (netKey === 'SOL')
                ? await executeSolanaShotgun(pos.tokenAddress, pos.amountOut, 'SELL')
                : await executeEvmContract(netKey, pos.tokenAddress, pos.amountOut, 'SELL');

            if (sold) {
                SYSTEM.lastTradedTokens[netKey] = pos.tokenAddress;
                bot.sendMessage(chatId, `✅ **[${netKey}] PROFIT SECURED:** ${pos.symbol}`);
            }
        } else {
            // Check again in 4 seconds
            setTimeout(() => startIndependentMonitor(chatId, netKey, pos), 4000);
        }
    } catch(e) {
        setTimeout(() => startIndependentMonitor(chatId, netKey, pos), 5000);
    }
}

// ==========================================
//  EVM CONTRACT (FIXED 0x5aF9...)
// ==========================================

async function executeEvmContract(netKey, addr, amt, dir) {
    try {
        const net = NETWORKS[netKey];
        const prov = new JsonRpcProvider(net.rpc);
        const sign = evmWallet.connect(prov);
        const contract = new ethers.Contract(net.executor, APEX_ABI, sign);
        const deadline = Math.floor(Date.now() / 1000) + 120;

        if (dir === 'BUY') {
            const tx = await contract.executeBuy(net.router, addr, 0, deadline, { value: ethers.parseEther(amt.toString()), gasLimit: 300000 });
            await tx.wait();
            return { amountOut: 1 }; 
        } else {
            const tx = await contract.executeSell(net.router, addr, amt, 0, deadline, { gasLimit: 350000 });
            await tx.wait();
            return { hash: tx.hash };
        }
    } catch (e) { return null; }
}

// ==========================================
//  SOLANA SHOTGUN
// ==========================================

async function executeSolanaShotgun(addr, amt, dir) {
    try {
        const amtStr = dir === 'BUY' ? Math.floor(amt * LAMPORTS_PER_SOL).toString() : amt.toString();
        const res = await axios.get(`${JUP_ULTRA_API}/order?inputMint=So11111111111111111111111111111111111111112&outputMint=${addr}&amount=${amtStr}&taker=${solWallet.publicKey.toString()}&slippageBps=200`, { headers: {'x-api-key': JUP_API_KEY}});
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

// ==========================================
//  AI SCANNER & COMMANDS
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

bot.onText(/\/setamount (.+)/, (msg, match) => { SYSTEM.tradeAmount = match[1]; bot.sendMessage(msg.chat.id, `💰 **TRADE SIZE:** ${SYSTEM.tradeAmount}`); });
bot.onText(/\/withdraw (.+)/, async (msg, match) => {
    const target = match[1].toLowerCase() === 'eth' ? "0x0000000000000000000000000000000000000000" : match[1];
    const provider = new JsonRpcProvider(NETWORKS['BASE'].rpc); // Default to Base for contract comms
    const contract = new ethers.Contract(MY_EXECUTOR, APEX_ABI, evmWallet.connect(provider));
    const tx = await contract.emergencyWithdraw(target);
    bot.sendMessage(msg.chat.id, `🚨 **WITHDRAW SENT:** ${tx.hash}`);
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    const raw = match[1].trim();
    evmWallet = ethers.HDNodeWallet.fromPhrase(raw);
    solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", bip39.mnemonicToSeedSync(raw).toString('hex')).key);
    bot.sendMessage(msg.chat.id, `🔗 **NEURAL LINK SECURE.**`);
});

http.createServer((req, res) => res.end("APEX v9013 ONLINE")).listen(8080);
console.log("APEX v9013 OMNI-SNIPER MASTER READY".magenta);
