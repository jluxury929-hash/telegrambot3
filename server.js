/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL ULTRA v9018 (OMNI-PARALLEL MASTER)
 * ===============================================================================
 * FIX: Specific failure warnings for Balance, Slippage, and RPC Errors
 * ARCH: 5-Chain Parallel Workers + Async Monitor Spawning
 * EVM MASTER CONTRACT: 0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610
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
const APEX_EXECUTOR_ABI = [
    "function executeBuy(address router, address token, uint256 minOut, uint256 deadline) external payable",
    "function executeSell(address router, address token, uint256 amtIn, uint256 minOut, uint256 deadline) external",
    "function emergencyWithdraw(address token) external"
];
const JUP_ULTRA_API = "https://api.jup.ag/ultra/v1";
const JUP_API_KEY = "f440d4df-b5c4-4020-a960-ac182d3752ab"; 

const NETWORKS = {
    ETH:  { id: 'ethereum', type: 'EVM', rpc: 'https://rpc.mevblocker.io', router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', executor: MY_EXECUTOR },
    SOL:  { id: 'solana', type: 'SVM', rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com', shotgunNodes: [process.env.SOLANA_RPC] },
    BASE: { id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', executor: MY_EXECUTOR },
    BSC:  { id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', executor: MY_EXECUTOR },
    ARB:  { id: 'arbitrum', type: 'EVM', rpc: 'https://arb1.arbitrum.io/rpc', router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', executor: MY_EXECUTOR }
};

let SYSTEM = { autoPilot: false, tradeAmount: "0.01", lastTradedTokens: {}, isLocked: {} };
let evmWallet, solWallet;
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  BALANCE VERIFIER (THE LOGIC GUARD)
// ==========================================

async function checkFunds(chatId, netKey) {
    try {
        if (netKey === 'SOL') {
            const solConn = new Connection(NETWORKS.SOL.rpc);
            const bal = await solConn.getBalance(solWallet.publicKey);
            const needed = (parseFloat(SYSTEM.tradeAmount) * LAMPORTS_PER_SOL) + 10000000; // Trade + 0.01 SOL Gas
            if (bal < needed) {
                bot.sendMessage(chatId, `⚠️ **[SOL] INSUFFICIENT FUNDS:** You have ${bal/LAMPORTS_PER_SOL} SOL. Need ~${needed/LAMPORTS_PER_SOL} for trade + gas.`);
                return false;
            }
        } else {
            const prov = new JsonRpcProvider(NETWORKS[netKey].rpc);
            const bal = await prov.getBalance(evmWallet.address);
            const needed = ethers.parseEther(SYSTEM.tradeAmount) + ethers.parseEther("0.005"); // Trade + Gas buffer
            if (bal < needed) {
                bot.sendMessage(chatId, `⚠️ **[${netKey}] INSUFFICIENT FUNDS:** Need at least ${ethers.formatEther(needed)} for trade + gas.`);
                return false;
            }
        }
        return true;
    } catch (e) {
        bot.sendMessage(chatId, `❌ **[${netKey}] BALANCE ERROR:** RPC is lagging or unreachable.`);
        return false;
    }
}

// ==========================================
//  OMNI-WORKER WITH ACTIVE FEEDBACK
// ==========================================

async function startNetworkSniper(chatId, netKey) {
    bot.sendMessage(chatId, `🚀 **[${netKey}] WORKER ACTIVATED.**`);
    
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                
                if (signal) {
                    bot.sendMessage(chatId, `🧠 **[${netKey}] SIGNAL:** ${signal.symbol}. Validating...`);
                    
                    // 1. FUND CHECK
                    const funded = await checkFunds(chatId, netKey);
                    if (!funded) { SYSTEM.isLocked[netKey] = false; await new Promise(r => setTimeout(r, 30000)); continue; }

                    SYSTEM.isLocked[netKey] = true;

                    // 2. EXECUTION
                    const buyRes = (netKey === 'SOL') 
                        ? await executeSolanaShotgun(chatId, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY')
                        : await executeEvmContract(chatId, netKey, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY');

                    if (buyRes) {
                        const newPos = { ...signal, entryPrice: signal.price, highestPrice: signal.price, amountOut: buyRes.amountOut };
                        startIndependentPeakMonitor(chatId, netKey, newPos);
                        bot.sendMessage(chatId, `✅ **[${netKey}] Sniped ${signal.symbol}.** Rescanning...`);
                    } else {
                        bot.sendMessage(chatId, `❌ **[${netKey}] EXECUTION FAILED.** See console for trace.`);
                    }
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 2000)); 
        } catch (e) {
            SYSTEM.isLocked[netKey] = false;
            bot.sendMessage(chatId, `⚠️ **[${netKey}] CRITICAL ERROR:** ${e.message}`);
            await new Promise(r => setTimeout(r, 10000));
        }
    }
}

// ==========================================
//  EVM CONTRACT EXECUTION (DETAILED ERRORS)
// ==========================================

async function executeEvmContract(chatId, netKey, tokenAddress, amount, direction) {
    try {
        const net = NETWORKS[netKey];
        const provider = new JsonRpcProvider(net.rpc);
        const signer = evmWallet.connect(provider);
        const contract = new ethers.Contract(MY_EXECUTOR, APEX_EXECUTOR_ABI, signer);
        const deadline = Math.floor(Date.now() / 1000) + 120;

        if (direction === 'BUY') {
            bot.sendMessage(chatId, `⏳ **[${netKey}] Submitting Contract Buy...**`);
            const tx = await contract.executeBuy(net.router, tokenAddress, 0, deadline, {
                value: ethers.parseEther(amount.toString()),
                gasLimit: 350000
            });
            await tx.wait();
            return { amountOut: 1 };
        } else {
            const tx = await contract.executeSell(net.router, tokenAddress, amount, 0, deadline, { gasLimit: 400000 });
            await tx.wait();
            return { hash: tx.hash };
        }
    } catch (e) {
        bot.sendMessage(chatId, `❌ **[${netKey}] CONTRACT ERROR:** ${e.reason || e.message.slice(0, 50)}...`);
        return null;
    }
}

// ==========================================
//  SOLANA SHOTGUN (DETAILED ERRORS)
// ==========================================

async function executeSolanaShotgun(chatId, tokenAddress, amount, direction) {
    try {
        const amtStr = direction === 'BUY' ? Math.floor(amount * LAMPORTS_PER_SOL).toString() : amount.toString();
        const res = await axios.get(`${JUP_ULTRA_API}/order?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenAddress}&amount=${amtStr}&taker=${solWallet.publicKey.toString()}&slippageBps=200`, { headers: {'x-api-key': JUP_API_KEY}});
        
        if (res.data.error) {
            bot.sendMessage(chatId, `❌ **[SOL] JUPITER ERROR:** ${res.data.error}`);
            return null;
        }

        const tx = VersionedTransaction.deserialize(Buffer.from(res.data.transaction, 'base64'));
        tx.sign([solWallet]);
        const signedRaw = tx.serialize();

        const signature = await new Connection(NETWORKS.SOL.rpc).sendRawTransaction(signedRaw, { skipPreflight: true });
        bot.sendMessage(chatId, `⏳ **[SOL] BROADCASTED:** ${signature.slice(0, 10)}...`);
        return { amountOut: res.data.outAmount, hash: signature };
    } catch (e) {
        bot.sendMessage(chatId, `❌ **[SOL] EXECUTION ERROR:** RPC Node rejected TX.`);
        return null;
    }
}

// ... [Keep other scan/monitor/withdraw functions from v9015] ...

bot.onText(/\/auto/, (msg) => {
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    if (SYSTEM.autoPilot) {
        bot.sendMessage(msg.chat.id, `🚀 **OMNI-SNIPER ENGAGED.** Scanning all chains...`);
        Object.keys(NETWORKS).forEach(netKey => startNetworkSniper(msg.chat.id, netKey));
    } else { bot.sendMessage(msg.chat.id, `🤖 **AUTO-PILOT OFF.**`); }
});

bot.onText(/\/connect (.+)/, async (msg, match) => {
    try {
        const seed = bip39.mnemonicToSeedSync(match[1].trim());
        evmWallet = ethers.HDNodeWallet.fromPhrase(match[1].trim());
        solWallet = Keypair.fromSeed(derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key);
        bot.sendMessage(msg.chat.id, `🔗 **NEURAL LINK SECURE.**\nSOL: \`${solWallet.publicKey.toString()}\`\nEVM: \`${evmWallet.address}\``);
    } catch (e) { bot.sendMessage(msg.chat.id, `❌ **SEED ERROR:** Invalid phrase length.`); }
});

http.createServer((req, res) => res.end("APEX v9018 READY")).listen(8080);
console.log("APEX v9018 DIAGNOSTICS READY".magenta);
