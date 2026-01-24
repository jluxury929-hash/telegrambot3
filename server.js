/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9024 (OMNI-PARALLEL MASTER)
 * ===============================================================================
 * FIX: /auto polling conflict protection (Graceful Polling Recovery)
 * FIX: Mnemonic length guard (Prevents TypeError on bad seed input)
 * LOGIC: Parallel Chain Workers -> Neural Scanning -> Smart Execution
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

// --- FIXED CONFIG ---
const MY_EXECUTOR = "0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610";
const APEX_ABI = [
    "function executeBuy(address router, address token, uint256 minOut, uint256 deadline) external payable",
    "function executeSell(address router, address token, uint256 amtIn, uint256 minOut, uint256 deadline) external",
    "function emergencyWithdraw(address token) external"
];
const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";
const JUP_API_KEY = "f440d4df-b5c4-4020-a960-ac182d3752ab"; 
const SCAN_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0', 'x-api-key': JUP_API_KEY }};

// --- 5-CHAIN NETWORK DEFINITIONS ---
const NETWORKS = {
    ETH:  { id: 'ethereum', type: 'EVM', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', executor: MY_EXECUTOR },
    SOL:  { id: 'solana', type: 'SVM', rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com' },
    BASE: { id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', executor: MY_EXECUTOR },
    BSC:  { id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', executor: MY_EXECUTOR },
    ARB:  { id: 'arbitrum', type: 'EVM', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', executor: MY_EXECUTOR }
};

let SYSTEM = { autoPilot: false, tradeAmount: "0.01", lastTradedTokens: {}, isLocked: {} };
let evmWallet, solWallet;

// --- FIX: TELEGRAM POLLING CONFLICT GUARD ---
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) {
        console.warn(`[SYSTEM] Update conflict! Ensure no other bot instances are running.`.yellow);
    }
});

// ==========================================
//  OMNI-SNIPER ENGINE (/auto Logic)
// ==========================================

bot.onText(/\/auto/, (msg) => {
    if (!evmWallet || !solWallet) return bot.sendMessage(msg.chat.id, "❌ **WALLET NOT FOUND:** Use `/connect` first.");
    
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    if (SYSTEM.autoPilot) {
        bot.sendMessage(msg.chat.id, `🚀 **OMNI-ENGINE ONLINE.** Scanning 5 chains simultaneously...`);
        // Start parallel workers
        Object.keys(NETWORKS).forEach(netKey => startNetworkSniper(msg.chat.id, netKey));
    } else { 
        bot.sendMessage(msg.chat.id, `🤖 **AUTO-PILOT OFF.**`); 
    }
});

async function startNetworkSniper(chatId, netKey) {
    console.log(`[INIT] Parallel thread for ${netKey} active.`.magenta);
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                
                if (signal) {
                    bot.sendMessage(chatId, `🧠 **[${netKey}] SIGNAL:** ${signal.symbol}. Engaging Sniper.`);
                    
                    const ready = await verifyBalance(chatId, netKey);
                    if (!ready) { 
                        await new Promise(r => setTimeout(r, 15000)); // Wait longer if broke
                        continue; 
                    }

                    SYSTEM.isLocked[netKey] = true;

                    const buyRes = (netKey === 'SOL') 
                        ? await executeSolanaShotgun(chatId, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY')
                        : await executeEvmContract(chatId, netKey, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY');

                    if (buyRes) {
                        const newPos = { ...signal, entryPrice: signal.price, highestPrice: signal.price, amountOut: buyRes.amountOut };
                        startIndependentPeakMonitor(chatId, netKey, newPos);
                        bot.sendMessage(chatId, `🚀 **[${netKey}] BOUGHT ${signal.symbol}.** Monitoring for peak...`);
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 2000)); // Rate limit safety
        } catch (e) {
            SYSTEM.isLocked[netKey] = false;
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

// ==========================================
//  SIGNAL SCANNER (INSTANT RECURSION)
// ==========================================

async function runNeuralSignalScan(netKey) {
    const net = NETWORKS[netKey];
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        if (!res.data || res.data.length === 0) return null;

        const match = res.data.find(t => t.chainId === net.id && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        if (match) {
            return { symbol: match.symbol || 'GEMS', tokenAddress: match.tokenAddress, price: parseFloat(match.priceUsd || 0) };
        }
    } catch (e) { return null; }
}

// ==========================================
//  DIAGNOSTIC BALANCE CHECKER
// ==========================================

async function verifyBalance(chatId, netKey) {
    try {
        if (netKey === 'SOL') {
            const conn = new Connection(NETWORKS.SOL.rpc);
            const bal = await conn.getBalance(solWallet.publicKey);
            const needed = (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 10000000; 
            if (bal < needed) {
                bot.sendMessage(chatId, `⚠️ **[SOL] WARNING:** Insufficient Balance. Need ~${needed/LAMPORTS_PER_SOL} SOL.`);
                return false;
            }
        } else {
            const prov = new JsonRpcProvider(NETWORKS[netKey].rpc);
            const bal = await prov.getBalance(evmWallet.address);
            const needed = ethers.parseEther(SYSTEM.tradeAmount) + ethers.parseEther("0.005");
            if (bal < needed) {
                bot.sendMessage(chatId, `⚠️ **[${netKey}] WARNING:** Insufficient Gas/Trade amount.`);
                return false;
            }
        }
        return true;
    } catch (e) { return false; }
}

// ==========================================
//  EXECUTION LOGIC
// ==========================================

async function executeEvmContract(chatId, netKey, addr, amt, dir) {
    try {
        const net = NETWORKS[netKey];
        const signer = evmWallet.connect(new JsonRpcProvider(net.rpc));
        const contract = new ethers.Contract(MY_EXECUTOR, APEX_ABI, signer);
        const deadline = Math.floor(Date.now() / 1000) + 120;

        if (dir === 'BUY') {
            const tx = await contract.executeBuy(net.router, addr, 0, deadline, {
                value: ethers.parseEther(amt.toString()),
                gasLimit: 350000
            });
            bot.sendMessage(chatId, `⏳ **[${netKey}] PENDING:** ${tx.hash}`);
            await tx.wait();
            return { amountOut: 1 };
        } else {
            const tx = await contract.executeSell(net.router, addr, amt, 0, deadline, { gasLimit: 400000 });
            await tx.wait();
            return { hash: tx.hash };
        }
    } catch (e) {
        bot.sendMessage(chatId, `❌ **[${netKey}] FAIL:** ${e.reason || e.message}`);
        return null;
    }
}

async function executeSolanaShotgun(chatId, addr, amt, dir) {
    try {
        const amtStr = dir === 'BUY' ? Math.floor(amt * LAMPORTS_PER_SOL).toString() : amt.toString();
        const res = await axios.get(`${JUP_ULTRA_API}/order?inputMint=So11111111111111111111111111111111111111112&outputMint=${addr}&amount=${amtStr}&taker=${solWallet.publicKey.toString()}&slippageBps=200`, SCAN_HEADERS);
        const tx = VersionedTransaction.deserialize(Buffer.from(res.data.transaction, 'base64'));
        tx.sign([solWallet]);
        const sig = await (new Connection(NETWORKS.SOL.rpc)).sendRawTransaction(tx.serialize(), { skipPreflight: true });
        bot.sendMessage(chatId, `⏳ **[SOL] PENDING:** ${sig}`);
        return { amountOut: res.data.outAmount, hash: sig };
    } catch (e) {
        bot.sendMessage(chatId, `❌ **[SOL] FAIL:** ${e.message}`);
        return null;
    }
}

// ==========================================
//  PEAK MONITOR
// ==========================================

async function startIndependentPeakMonitor(chatId, netKey, pos) {
    try {
        const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${pos.tokenAddress}`, SCAN_HEADERS);
        const curPrice = parseFloat(res.data.pairs[0].priceUsd);
        const pnl = ((curPrice - pos.entryPrice) / pos.entryPrice) * 100;
        
        if (curPrice > pos.highestPrice) pos.highestPrice = curPrice;
        const drop = ((pos.highestPrice - curPrice) / pos.highestPrice) * 100;

        if (pnl >= 25 || drop >= 6 || pnl <= -10) {
            bot.sendMessage(chatId, `📉 **[${netKey}] EXIT:** Selling ${pos.symbol} at ${pnl.toFixed(2)}%`);
            const sold = (netKey === 'SOL')
                ? await executeSolanaShotgun(chatId, pos.tokenAddress, pos.amountOut, 'SELL')
                : await executeEvmContract(chatId, netKey, pos.tokenAddress, pos.amountOut, 'SELL');
            if (sold) SYSTEM.lastTradedTokens[pos.tokenAddress] = true;
        } else { 
            setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 5000); 
        }
    } catch(e) { 
        setTimeout(() => startIndependentPeakMonitor(chatId, netKey, pos), 8000); 
    }
}

// ==========================================
//  COMMANDS
// ==========================================

bot.onText(/\/connect (.+)/, async (msg, match) => {
    const raw = match[1].trim();
    try {
        if (!bip39.validateMnemonic(raw)) return bot.sendMessage(msg.chat.id, "❌ **INVALID SEED:** Phrase must be 12 or 24 valid BIP39 words.");
        
        evmWallet = ethers.HDNodeWallet.fromPhrase(raw);
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", (await bip39.mnemonicToSeed(raw)).toString('hex')).key);
        bot.sendMessage(msg.chat.id, `🔗 **NEURAL LINK SECURE.** Sniper ready.`);
    } catch (e) { bot.sendMessage(msg.chat.id, `❌ **SEED ERROR.**`); }
});

http.createServer((req, res) => res.end("APEX v9024 ONLINE")).listen(8080);
console.log("APEX v9024 OMNI-MASTER READY".magenta);
