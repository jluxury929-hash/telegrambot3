/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9015 (OMNI-PARALLEL MASTER)
 * ===============================================================================
 * ARCH: 5-Chain Parallel Workers + Async Monitor Spawning
 * EVM MASTER CONTRACT: 0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610
 * LOGIC: Instant Rescan + Multi-Chain Simultaneous + Contract Sniping
 * SPECS: 24/7 Perpetual Hunt | /setamount | /withdraw | /auto
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
    lastTradedTokens: {}, 
    isLocked: {} // Per-network transaction lock
};

let evmWallet, solWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  OMNI-PARALLEL ENGINE STARTER
// ==========================================

bot.onText(/\/auto/, (msg) => {
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    if (SYSTEM.autoPilot) {
        bot.sendMessage(msg.chat.id, `🚀 **OMNI-ENGINE ONLINE.** Spawning 5 Parallel Sniper Threads...`);
        // Parallel launch for all chains simultaneously
        Object.keys(NETWORKS).forEach(netKey => startNetworkSniper(msg.chat.id, netKey));
    } else {
        bot.sendMessage(msg.chat.id, `🤖 **AUTO-PILOT:** DISABLED`);
    }
});

async function startNetworkSniper(chatId, netKey) {
    console.log(`[INIT] Parallel Sniper for ${netKey} Online`.magenta);
    
    while (SYSTEM.autoPilot) {
        try {
            // Check if network is busy with a transaction
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                
                if (signal) {
                    bot.sendMessage(chatId, `🧠 **[${netKey}] SIGNAL:** ${signal.symbol}. Engaging Sniper...`);
                    SYSTEM.isLocked[netKey] = true;

                    // EXECUTE BUY (Contract for EVM, Shotgun for SOL)
                    const buyRes = (netKey === 'SOL') 
                        ? await executeSolanaShotgun(signal.tokenAddress, SYSTEM.tradeAmount, 'BUY')
                        : await executeEvmContract(netKey, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY');

                    if (buyRes) {
                        const newPos = { 
                            ...signal, 
                            entryPrice: signal.price, 
                            highestPrice: signal.price, 
                            amountOut: buyRes.amountOut 
                        };
                        
                        // SPAWN ASYNC MONITOR (Threaded - No await)
                        // This is what allows instant rescanning after a buy
                        startIndependentPeakMonitor(chatId, netKey, newPos);
                        
                        bot.sendMessage(chatId, `🚀 **[${netKey}] Sniped ${signal.symbol}.** Rescanning instantly...`);
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 2000)); // Ultra-fast scan cycle
        } catch (e) {
            SYSTEM.isLocked[netKey] = false;
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

// ==========================================
//  EVM CONTRACT EXECUTION (FIXED 0x5aF9...)
// ==========================================



async function executeEvmContract(netKey, tokenAddress, amount, direction) {
    try {
        const net = NETWORKS[netKey];
        const provider = new JsonRpcProvider(net.rpc);
        const signer = evmWallet.connect(provider);
        const contract = new ethers.Contract(net.executor, APEX_ABI, signer);
        const deadline = Math.floor(Date.now() / 1000) + 120;

        if (direction === 'BUY') {
            const tx = await contract.executeBuy(net.router, tokenAddress, 0, deadline, {
                value: ethers.parseEther(amount.toString()),
                gasLimit: 350000
            });
            await tx.wait();
            return { amountOut: 1 }; // Placeholder for successful buy
        } else {
            // Atomic Sell: Approve + Swap in one call
            const tx = await contract.executeSell(net.router, tokenAddress, amount, 0, deadline, {
                gasLimit: 400000
            });
            await tx.wait();
            return { hash: tx.hash };
        }
    } catch (e) { return null; }
}

// ==========================================
//  SVM SHOTGUN EXECUTION (SOLANA)
// ==========================================

async function executeSolanaShotgun(tokenAddress, amount, direction) {
    try {
        const amtStr = direction === 'BUY' ? Math.floor(amount * LAMPORTS_PER_SOL).toString() : amount.toString();
        const res = await axios.get(`${JUP_ULTRA_API}/order?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenAddress}&amount=${amtStr}&taker=${solWallet.publicKey.toString()}&slippageBps=200`, { headers: {'x-api-key': JUP_API_KEY}});
        
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
//  INDEPENDENT PEAK MONITOR (THREADED)
// ==========================================

async function startIndependentPeakMonitor(chatId, netKey, pos) {
    // Spawns a background thread for every single position held
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`);
        const currentPrice = parseFloat(res.data.pairs[0].priceUsd);
        const pnl = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
        
        if (currentPrice > pos.highestPrice) pos.highestPrice = currentPrice;
        const drop = ((pos.highestPrice - currentPrice) / pos.highestPrice) * 100;

        // PEAK EXIT: Trailing Stop @ 6% | Take Profit @ 25% | Stop Loss @ 10%
        if (pnl >= 25 || drop >= 6 || pnl <= -10) {
            bot.sendMessage(chatId, `📉 **[${netKey}] PEAK REACHED:** Selling ${pos.symbol} at ${pnl.toFixed(2)}%`);
            
            const sold = (netKey === 'SOL')
                ? await executeSolanaShotgun(pos.tokenAddress, pos.amountOut, 'SELL')
                : await executeEvmContract(netKey, pos.tokenAddress, pos.amountOut, 'SELL');

            if (sold) {
                SYSTEM.lastTradedTokens[pos.tokenAddress] = true;
                bot.sendMessage(chatId, `✅ **[${netKey}] CLOSED:** ${pos.symbol}. Profit Secured.`);
            }
        } else {
            setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 4000);
        }
    } catch(e) {
        setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 5000);
    }
}

// ==========================================
//  AI SCANNER & COMMANDS
// ==========================================

async function runNeuralSignalScan(netKey) {
    const net = NETWORKS[netKey];
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
        const match = res.data.find(t => t.chainId === net.id && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        if (match) {
            const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${match.tokenAddress}`);
            const pair = details.data.pairs[0];
            if (pair && pair.liquidity.usd > 5000 && pair.volume.h24 > 30000) {
                return { symbol: pair.baseToken.symbol, tokenAddress: match.tokenAddress, price: parseFloat(pair.priceUsd) };
            }
        }
    } catch (e) { return null; }
}

bot.onText(/\/setamount (.+)/, (msg, match) => { SYSTEM.tradeAmount = match[1]; bot.sendMessage(msg.chat.id, `💰 **SIZE:** ${SYSTEM.tradeAmount}`); });

bot.onText(/\/withdraw (.+)/, async (msg, match) => {
    const target = match[1].toLowerCase() === 'eth' ? "0x0000000000000000000000000000000000000000" : match[1];
    const contract = new ethers.Contract(MY_EXECUTOR, APEX_ABI, evmWallet.connect(new JsonRpcProvider(NETWORKS.BASE.rpc)));
    const tx = await contract.emergencyWithdraw(target);
    bot.sendMessage(msg.chat.id, `🚨 **WITHDRAW SENT:** ${tx.hash}`);
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    const seed = bip39.mnemonicToSeedSync(match[1].trim());
    evmWallet = ethers.HDNodeWallet.fromPhrase(match[1].trim());
    solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
    bot.sendMessage(msg.chat.id, `🔗 **NEURAL LINK SECURE.** Sniper threads ready.`);
});

http.createServer((req, res) => res.end("APEX v9015 ONLINE")).listen(8080);
console.log("APEX v9015 OMNI-MASTER ENGINE READY".magenta);
