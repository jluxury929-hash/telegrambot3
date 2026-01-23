/**
 * ===============================================================================
 * APEX PREDATOR v9000: MULTI-CHAIN EXECUTOR (STABLE 2026)
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

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const MY_EXECUTOR = "0x5aF9c921984e8694f3E89AE746Cf286fFa3F2610";

// ABI for YOUR custom ApexExecutor contract
const APEX_EXECUTOR_ABI = [
    "function executeBuy(address router, address token, uint256 minOut, uint256 deadline) external payable",
    "function executeSell(address router, address token, uint256 amtIn, uint256 minOut, uint256 deadline) external",
    "function emergencyWithdraw(address token) external"
];

// --- NETWORK DEFINITIONS (UPDATED WITH EXECUTOR) ---
const NETWORKS = {
    ETH: { 
        id: 'ethereum', type: 'EVM', rpc: 'https://rpc.mevblocker.io', 
        router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', 
        executor: MY_EXECUTOR 
    },
    SOL: { 
        id: 'solana', type: 'SVM', rpc: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com' 
    },
    BASE: { 
        id: 'base', type: 'EVM', rpc: 'https://mainnet.base.org', 
        router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', 
        executor: MY_EXECUTOR 
    },
    BSC: { 
        id: 'bsc', type: 'EVM', rpc: 'https://bsc-dataseed.binance.org/', 
        router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', 
        executor: MY_EXECUTOR 
    },
    ARB: { 
        id: 'arbitrum', type: 'EVM', rpc: 'https://arb1.arbitrum.io/rpc', 
        router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24', 
        executor: MY_EXECUTOR 
    }
};

let SYSTEM = { currentNetwork: 'SOL', autoPilot: false, isLocked: false, tradeAmount: "0.01", activePosition: null };
let evmWallet, evmSigner, evmProvider, apexContract, solWallet;
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ==========================================
//  CORE INITIALIZATION
// ==========================================

async function initNetwork(netKey) {
    SYSTEM.currentNetwork = netKey;
    const net = NETWORKS[netKey];

    if (net.type === 'EVM' && evmWallet) {
        evmProvider = new JsonRpcProvider(net.rpc);
        evmSigner = evmWallet.connect(evmProvider);
        // CRITICAL FIX: Link the contract object to YOUR executor address
        apexContract = new Contract(net.executor, APEX_EXECUTOR_ABI, evmSigner);
        console.log(`[NET] Switched to ${netKey} | Linked to Executor: ${net.executor}`.green);
    }
}

// ==========================================
//  EXECUTION ENGINE (CONTRACT CALLS)
// ==========================================

async function buyEVM(chatId, tokenAddr, amountEth) {
    try {
        const net = NETWORKS[SYSTEM.currentNetwork];
        const deadline = Math.floor(Date.now() / 1000) + 60;
        
        const tx = await apexContract.executeBuy(
            net.router, 
            tokenAddr, 
            0, // minOut
            deadline, 
            { value: ethers.parseEther(amountEth), gasLimit: 300000 }
        );
        
        bot.sendMessage(chatId, `⚔️ **CONTRACT BUY SENT:** ${tx.hash}`);
        await tx.wait();
        return { amountOut: 1 };
    } catch(e) {
        bot.sendMessage(chatId, `❌ **CONTRACT FAIL:** ${e.message}`);
        return null;
    }
}

async function sellEVM(chatId, tokenAddr, amountToken) {
    try {
        const net = NETWORKS[SYSTEM.currentNetwork];
        const deadline = Math.floor(Date.now() / 1000) + 60;

        const tx = await apexContract.executeSell(
            net.router,
            tokenAddr,
            amountToken,
            0, 
            deadline,
            { gasLimit: 350000 }
        );
        
        bot.sendMessage(chatId, `💸 **CONTRACT SELL SENT:** ${tx.hash}`);
        await tx.wait();
        return { hash: tx.hash };
    } catch(e) {
        bot.sendMessage(chatId, `❌ **CONTRACT FAIL:** ${e.message}`);
        return null;
    }
}

// ==========================================
//  SOLANA & RPG LOGIC (RETAINED)
// ==========================================

// ... Insert your runNeuralScanner, executeBuy, executeSell logic here ...

bot.onText(/\/status/, async (msg) => {
    bot.sendMessage(msg.chat.id, `📊 **APEX STATUS**\nNet: ${SYSTEM.currentNetwork}\nExecutor: ${MY_EXECUTOR.slice(0,10)}... ✅`);
});

http.createServer((req, res) => res.end("APEX v9000 ONLINE")).listen(8080);
console.log("APEX v9000 UNIVERSAL MASTER ONLINE".magenta);
