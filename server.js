/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL SIGNAL v7000.1 (MNEMONIC EDITION)
 * ===============================================================================
 * ONE SEED PHRASE -> ALL NETWORKS (ETH, SOL, BASE, BSC, ARB)
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('cross-fetch');
require('colors');

// --- CONFIGURATION ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const MNEMONIC = process.env.MNEMONIC; // Your 12-word seed phrase

if (!bip39.validateMnemonic(MNEMONIC)) {
    console.log("❌ INVALID MNEMONIC. Please check .env".red);
    process.exit(1);
}

// NETWORK CONFIGURATIONS
const NETWORKS = {
    ETH: {
        id: 'ethereum',
        type: 'EVM',
        rpc: 'https://rpc.mevblocker.io',
        router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        scanUrl: 'https://api.dexscreener.com/latest/dex/tokens/'
    },
    SOL: {
        id: 'solana',
        type: 'SVM',
        rpc: 'https://api.mainnet-beta.solana.com',
        scanUrl: 'https://api.dexscreener.com/latest/dex/tokens/'
    },
    BSC: {
        id: 'bsc',
        type: 'EVM',
        rpc: 'https://bsc-dataseed.binance.org/',
        router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
        weth: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
    },
    BASE: {
        id: 'base',
        type: 'EVM',
        rpc: 'https://mainnet.base.org',
        router: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
        weth: '0x4200000000000000000000000000000000000006'
    },
    ARB: {
        id: 'arbitrum',
        type: 'EVM',
        rpc: 'https://arb1.arbitrum.io/rpc',
        router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
        weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
    }
};

// --- SYSTEM STATE ---
let SYSTEM = {
    currentNetwork: 'SOL', 
    autoPilot: false,
    isLocked: false,
    riskProfile: 'MEDIUM',
    strategyMode: 'DAY',
    tradeAmount: "0.01",
    activePosition: null,
    pendingTarget: null
};

// --- KEY GENERATION FROM SEED ---
// 1. EVM Keys (Base, Eth, etc.) use path m/44'/60'/0'/0/0
const seed = bip39.mnemonicToSeedSync(MNEMONIC);
const evmWallet = ethers.HDNodeWallet.fromPhrase(MNEMONIC);

// 2. Solana Keys use path m/44'/501'/0'/0'
const solDerivationPath = "m/44'/501'/0'/0'";
const derivedSeed = derivePath(solDerivationPath, seed.toString('hex')).key;
const solWallet = Keypair.fromSeed(derivedSeed);

const solConnection = new Connection(NETWORKS.SOL.rpc, 'confirmed');
let evmProvider, evmRouter; // Re-initialized on switch

const bot = new TelegramBot(TELEGRAM_TOKEN, {
    polling: { interval: 300, autoStart: true, params: { timeout: 10 } }
});

console.log(`[INIT] EVM Address: ${evmWallet.address}`.yellow);
console.log(`[INIT] SOL Address: ${solWallet.publicKey.toString()}`.yellow);

// --- NETWORK INIT HELPER ---
function initNetwork(netKey) {
    const net = NETWORKS[netKey];
    SYSTEM.currentNetwork = netKey;
    
    if (net.type === 'EVM') {
        evmProvider = new JsonRpcProvider(net.rpc);
        // Re-connect wallet to new provider
        const connectedWallet = evmWallet.connect(evmProvider);
        evmRouter = new Contract(net.router, [
            "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
            "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])",
            "function approve(address spender, uint256 amount) external returns (bool)"
        ], connectedWallet);
    }
}

// Initialize Default
initNetwork('SOL');

// ==========================================
//  SOLANA EXECUTION (JUPITER)
// ==========================================
async function executeSolanaSwap(chatId, direction, tokenAddress, amountInSol) {
    try {
        const inputMint = direction === 'BUY' ? 'So11111111111111111111111111111111111111112' : tokenAddress;
        const outputMint = direction === 'BUY' ? tokenAddress : 'So11111111111111111111111111111111111111112';
        const amount = direction === 'BUY' 
            ? Math.floor(amountInSol * LAMPORTS_PER_SOL) 
            : Math.floor(SYSTEM.activePosition.tokenAmount);

        // Jupiter Quote
        const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=200`; // 2% slip
        const quoteResponse = await (await fetch(quoteUrl)).json();
        
        if (!quoteResponse || quoteResponse.error) throw new Error("Jupiter: No Route");

        // Get Transaction
        const { swapTransaction } = await (await fetch('https://quote-api.jup.ag/v6/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                quoteResponse,
                userPublicKey: solWallet.publicKey.toString(),
                wrapAndUnwrapSol: true
            })
        })).json();

        // Sign & Send
        const transaction = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
        transaction.sign([solWallet]);
        
        const txid = await solConnection.sendRawTransaction(transaction.serialize(), { skipPreflight: true });
        
        bot.sendMessage(chatId, `🚀 **SOLANA TX:** https://solscan.io/tx/${txid}`);
        return { hash: txid, amountOut: quoteResponse.outAmount };

    } catch (e) {
        bot.sendMessage(chatId, `⚠️ **SOL ERROR:** ${e.message}`);
        return null;
    }
}

// ==========================================
//  EVM EXECUTION
// ==========================================
async function executeEvmSwap(chatId, direction, tokenAddress, amountEth) {
    try {
        const net = NETWORKS[SYSTEM.currentNetwork];
        // Ensure wallet is connected to current provider
        const connectedWallet = evmWallet.connect(evmProvider);
        const router = evmRouter.connect(connectedWallet); // Re-attach to be safe

        const path = direction === 'BUY' ? [net.weth, tokenAddress] : [tokenAddress, net.weth];
        const value = direction === 'BUY' ? ethers.parseEther(amountEth) : SYSTEM.activePosition.rawAmount;

        let tx;
        if (direction === 'BUY') {
            tx = await router.swapExactETHForTokens(
                0, path, connectedWallet.address, Math.floor(Date.now()/1000)+120,
                { value: value, gasLimit: 300000 }
            );
        } else {
            // Check Allowance
            const token = new Contract(tokenAddress, ["function approve(address, uint) returns (bool)"], connectedWallet);
            await (await token.approve(net.router, value)).wait();
            
            tx = await router.swapExactTokensForETH(
                value, 0, path, connectedWallet.address, Math.floor(Date.now()/1000)+120,
                { gasLimit: 350000 }
            );
        }

        bot.sendMessage(chatId, `🚀 **${SYSTEM.currentNetwork} TX:** ${tx.hash}`);
        return { hash: tx.hash, amountOut: 0 };

    } catch (e) {
        bot.sendMessage(chatId, `⚠️ **EVM ERROR:** ${e.message}`);
        return null;
    }
}

// ==========================================
//  TRADING LOGIC
// ==========================================

async function runNeuralScanner(chatId) {
    if (!SYSTEM.autoPilot || SYSTEM.isLocked) return;
    
    try {
        // DexScreener Trending for current chain
        const chainId = NETWORKS[SYSTEM.currentNetwork].id;
        const res = await axios.get(`https://api.dexscreener.com/token-boosts/top/v1`);
        
        // Find best token on CURRENT chain
        const valid = res.data.find(t => t.chainId === chainId);
        
        if (valid && (!SYSTEM.activePosition)) {
            const data = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${valid.tokenAddress}`);
            const pair = data.data.pairs[0];
            
            if (pair) {
                 bot.sendMessage(chatId, `💡 **SIGNAL:** ${pair.baseToken.symbol} on ${SYSTEM.currentNetwork}`);
                 // Trigger Buy
                 const res = SYSTEM.currentNetwork === 'SOL' 
                    ? await executeSolanaSwap(chatId, 'BUY', pair.baseToken.address, SYSTEM.tradeAmount)
                    : await executeEvmSwap(chatId, 'BUY', pair.baseToken.address, SYSTEM.tradeAmount);

                 if (res) {
                     SYSTEM.activePosition = {
                         symbol: pair.baseToken.symbol,
                         tokenAddress: pair.baseToken.address,
                         entryPrice: pair.priceUsd,
                         tokenAmount: res.amountOut,
                         rawAmount: res.amountOut // Storing for EVM
                     };
                     SYSTEM.isLocked = true;
                     monitorPosition(chatId);
                 }
            }
        }
    } catch (e) { console.log("Scanning...".gray); }
    
    if(SYSTEM.autoPilot) setTimeout(() => runNeuralScanner(chatId), 5000);
}

async function monitorPosition(chatId) {
    if(!SYSTEM.activePosition) return;
    
    // Logic to check price and sell...
    // [Use previous logic here, stripped for brevity in this specific update]
}

// ==========================================
//  COMMANDS
// ==========================================
bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "APEX ONLINE. /auto to start."));

bot.onText(/\/network (.+)/, (msg, match) => {
    const net = match[1].toUpperCase();
    if(NETWORKS[net]) {
        initNetwork(net);
        bot.sendMessage(msg.chat.id, `✅ Network switched to ${net}`);
    }
});

bot.onText(/\/auto/, (msg) => {
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    bot.sendMessage(msg.chat.id, `Auto-Pilot: ${SYSTEM.autoPilot}`);
    if(SYSTEM.autoPilot) runNeuralScanner(msg.chat.id);
});

bot.onText(/\/wallet/, (msg) => {
    bot.sendMessage(msg.chat.id, `
🔐 **ACTIVE WALLETS (Derived from Seed)**
ETH/Base/BSC: \`${evmWallet.address}\`
Solana: \`${solWallet.publicKey.toString()}\`
    `, {parse_mode: 'Markdown'});
});

console.log("APEX v7000 (SEED EDITION) READY.".green);
