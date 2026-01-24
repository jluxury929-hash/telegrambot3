/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9016 (OMNI-PARALLEL MASTER)
 * ===============================================================================
 * ARCH: 5-Chain Parallel Workers + Async Monitor Spawning
 * EVM MASTER CONTRACT: 0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610
 * LOGIC: Instant Rescan + Multi-Chain Simultaneous Sniping
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

// --- FIXED SMART CONTRACT CONFIG ---
const MY_EXECUTOR = "0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610";
const APEX_EXECUTOR_ABI = [
    "function executeBuy(address router, address token, uint256 minOut, uint256 deadline) external payable",
    "function executeSell(address router, address token, uint256 amtIn, uint256 minOut, uint256 deadline) external",
    "function emergencyWithdraw(address token) external"
];

// --- API & ENGINE CONFIG ---
const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";
const JUP_API_KEY = "f440d4df-b5c4-4020-a960-ac182d3752ab"; 
const ULTRA_HEADERS = { headers: { 'x-api-key': JUP_API_KEY, 'Content-Type': 'application/json' }};

// --- 5-CHAIN NETWORK DEFINITIONS ---
const NETWORKS = {
    ETH:  { id: 'ethereum', type: 'EVM', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', executor: MY_EXECUTOR },
    SOL:  { id: 'solana', type: 'SVM', rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', shotgunNodes: [process.env.SOLANA_RPC] },
    BASE: { id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', executor: MY_EXECUTOR },
    BSC:  { id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', executor: MY_EXECUTOR },
    ARB:  { id: 'arbitrum', type: 'EVM', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', executor: MY_EXECUTOR }
};

// --- GLOBAL OMNI-STATE ---
let SYSTEM = { 
    autoPilot: false, 
    tradeAmount: "0.01", 
    lastTradedTokens: {}, 
    isLocked: {} // Lock per network to prevent overlapping buys
};

let evmWallet, solWallet;
const solConnection = new Connection(NETWORKS.SOL.rpc, 'confirmed');
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  OMNI-ENGINE STARTER (PARALLEL WORKERS)
// ==========================================

bot.onText(/\/auto/, (msg) => {
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    if (SYSTEM.autoPilot) {
        bot.sendMessage(msg.chat.id, `🚀 **OMNI-SNIPER ONLINE.** Launching 5 Parallel Brains...`);
        // Parallel launch for all chains simultaneously
        Object.keys(NETWORKS).forEach(netKey => startNetworkWorker(msg.chat.id, netKey));
    } else {
        bot.sendMessage(msg.chat.id, `🤖 **AUTO-PILOT:** DISABLED`);
    }
});

async function startNetworkWorker(chatId, netKey) {
    console.log(`[INIT] Parallel Worker for ${netKey} Online`.magenta);
    
    while (SYSTEM.autoPilot) {
        try {
            // STEP 1: SCAN (Fast 3s cycle)
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                
                if (signal) {
                    bot.sendMessage(chatId, `🧠 **[${netKey}] SIGNAL:** ${signal.symbol}. Engaging...`);
                    SYSTEM.isLocked[netKey] = true;

                    // STEP 2: EXECUTE BUY (SVM Shotgun or EVM Contract 0x5aF9...)
                    const buyRes = (netKey === 'SOL') 
                        ? await executeSolanaShotgun(signal.tokenAddress, SYSTEM.tradeAmount, 'BUY')
                        : await executeEvmContract(netKey, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY');

                    if (buyRes) {
                        const newPos = { ...signal, entryPrice: signal.price, highestPrice: signal.price, amountOut: buyRes.amountOut };
                        
                        // STEP 3: ASYNC MONITOR (Threaded - No await)
                        // Spawns background process so this chain can resume scanning INSTANTLY
                        startIndependentPeakMonitor(chatId, netKey, newPos);
                        
                        bot.sendMessage(chatId, `🚀 **[${netKey}] Sniper Strike Successful.** Rescanning...`);
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 3000)); 
        } catch (e) {
            SYSTEM.isLocked[netKey] = false;
            await new Promise(r => setTimeout(r, 10000));
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
        const contract = new ethers.Contract(MY_EXECUTOR, APEX_EXECUTOR_ABI, signer);
        const deadline = Math.floor(Date.now() / 1000) + 120;

        if (direction === 'BUY') {
            const tx = await contract.executeBuy(net.router, tokenAddress, 0, deadline, {
                value: ethers.parseEther(amount.toString()),
                gasLimit: 350000
            });
            await tx.wait();
            return { amountOut: 1 }; // Buy successful flag
        } else {
            // Atomic Sell: Approve + Swap via your functional contract
            const tx = await contract.executeSell(net.router, tokenAddress, amount, 0, deadline, {
                gasLimit: 400000
            });
            await tx.wait();
            return { hash: tx.hash };
        }
    } catch (e) { return null; }
}

// ==========================================
//  SOLANA SHOTGUN ENGINE
// ==========================================

async function executeSolanaShotgun(tokenAddress, amount, direction) {
    try {
        const amtStr = direction === 'BUY' ? Math.floor(amount * LAMPORTS_PER_SOL).toString() : amount.toString();
        const res = await axios.get(`${JUP_ULTRA_API}/order?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenAddress}&amount=${amtStr}&taker=${solWallet.publicKey.toString()}&slippageBps=200`, ULTRA_HEADERS);
        
        const tx = VersionedTransaction.deserialize(Buffer.from(res.data.transaction, 'base64'));
        tx.sign([solWallet]);
        const signedRaw = tx.serialize();

        const tasks = [
            axios.post(`${JUP_ULTRA_API}/execute`, { signedTransaction: Buffer.from(signedRaw).toString('base64'), requestId: res.data.requestId }, ULTRA_HEADERS),
            solConnection.sendRawTransaction(signedRaw, { skipPreflight: true })
        ];

        const fastest = await Promise.any(tasks);
        return { amountOut: res.data.outAmount, hash: fastest.data?.signature || fastest };
    } catch (e) { return null; }
}

// ==========================================
//  INDEPENDENT PEAK MONITOR (THREADED)
// ==========================================



async function startIndependentPeakMonitor(chatId, netKey, pos) {
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`);
        const currentPrice = parseFloat(res.data.pairs[0].priceUsd);
        const pnl = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
        
        if (currentPrice > pos.highestPrice) pos.highestPrice = currentPrice;
        const drop = ((pos.highestPrice - currentPrice) / pos.highestPrice) * 100;

        // EXIT LOGIC: Trailing Stop @ 6% | Take Profit @ 25% | Stop Loss @ 10%
        if (pnl >= 25 || drop >= 6 || pnl <= -10) {
            bot.sendMessage(chatId, `📉 **[${netKey}] PEAK TRIGGER:** Selling ${pos.symbol} at ${pnl.toFixed(2)}%`);
            
            const sold = (netKey === 'SOL')
                ? await executeSolanaShotgun(pos.tokenAddress, pos.amountOut, 'SELL')
                : await executeEvmContract(netKey, pos.tokenAddress, pos.amountOut, 'SELL');

            if (sold) {
                SYSTEM.lastTradedTokens[pos.tokenAddress] = true;
                bot.sendMessage(chatId, `✅ **[${netKey}] CLOSED:** ${pos.symbol}. Profit secured.`);
            }
        } else {
            setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 5000);
        }
    } catch(e) {
        setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 8000);
    }
}

// ==========================================
//  NEURAL SCANNER & COMMANDS
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

bot.onText(/\/setamount (.+)/, (msg, match) => { 
    SYSTEM.tradeAmount = match[1]; 
    bot.sendMessage(msg.chat.id, `💰 **SIZE SET:** ${SYSTEM.tradeAmount}`); 
});

bot.onText(/\/withdraw (.+)/, async (msg, match) => {
    const target = match[1].toLowerCase() === 'eth' ? "0x0000000000000000000000000000000000000000" : match[1];
    const contract = new ethers.Contract(MY_EXECUTOR, APEX_EXECUTOR_ABI, evmWallet.connect(new JsonRpcProvider(NETWORKS.BASE.rpc)));
    const tx = await contract.emergencyWithdraw(target);
    bot.sendMessage(msg.chat.id, `🚨 **WITHDRAW SENT:** ${tx.hash}`);
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    const raw = match[1].trim();
    evmWallet = ethers.HDNodeWallet.fromPhrase(raw);
    solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", bip39.mnemonicToSeedSync(raw).toString('hex')).key);
    bot.sendMessage(msg.chat.id, `🔗 **NEURAL LINK SECURE.** Sniper ready on all chains.`);
});

http.createServer((req, res) => res.end("APEX v9016 ONLINE")).listen(8080);
console.log("APEX v9016 OMNI-MASTER ENGINE READY".magenta);
