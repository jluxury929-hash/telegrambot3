/**
 * ===============================================================================
 * APEX PREDATOR: NEURAL SIGNAL v7000.2 (TELEGRAM CONNECT EDITION)
 * ===============================================================================
 * COMMAND: /connect <12 words> -> Generates ETH & SOL Wallets instantly
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

// Global Variables (Start Empty)
let evmWallet = null;
let solWallet = null;
let evmProvider = null;
let evmRouter = null;
const solConnection = new Connection(NETWORKS.SOL.rpc, 'confirmed');

const bot = new TelegramBot(TELEGRAM_TOKEN, {
    polling: { interval: 300, autoStart: true, params: { timeout: 10 } }
});

// --- COMMAND: CONNECT ---
bot.onText(/\/connect (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const rawMnemonic = match[1].trim();

    // 1. DELETE MESSAGE IMMEDIATELY FOR SAFETY
    try {
        await bot.deleteMessage(chatId, msg.message_id);
    } catch (e) {
        bot.sendMessage(chatId, "⚠️ Warning: Could not delete your message. Delete it manually!");
    }

    // 2. Validate Mnemonic
    if (!bip39.validateMnemonic(rawMnemonic)) {
        return bot.sendMessage(chatId, "❌ **INVALID SEED PHRASE.** Check spelling.");
    }

    try {
        // 3. Generate EVM Wallet (Eth, Base, Bsc)
        evmWallet = ethers.HDNodeWallet.fromPhrase(rawMnemonic);

        // 4. Generate Solana Wallet
        const seed = bip39.mnemonicToSeedSync(rawMnemonic);
        const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString('hex')).key;
        solWallet = Keypair.fromSeed(derivedSeed);

        // 5. Initialize Network
        initNetwork(SYSTEM.currentNetwork);

        bot.sendMessage(chatId, `
✅ **NEURAL LINK ESTABLISHED**
\`————————————————————————————\`
**EVM Address:** \`${evmWallet.address}\`
**SOL Address:** \`${solWallet.publicKey.toString()}\`
\`————————————————————————————\`
_Seed phrase processed and scrubbed from chat._
`, { parse_mode: 'Markdown' });

        console.log(`[AUTH] User connected via Telegram.`.green);

    } catch (e) {
        bot.sendMessage(chatId, `❌ **CONNECTION FAILED:** ${e.message}`);
    }
});

// --- NETWORK INIT HELPER ---
function initNetwork(netKey) {
    SYSTEM.currentNetwork = netKey;
    const net = NETWORKS[netKey];
    
    if (net.type === 'EVM' && evmWallet) {
        evmProvider = new JsonRpcProvider(net.rpc);
        const connectedWallet = evmWallet.connect(evmProvider);
        evmRouter = new Contract(net.router, [
            "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
            "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])",
            "function approve(address spender, uint256 amount) external returns (bool)"
        ], connectedWallet);
    }
}

// ==========================================
//  TRADING LOGIC
// ==========================================

async function executeSolanaSwap(chatId, direction, tokenAddress, amountInSol) {
    if (!solWallet) return bot.sendMessage(chatId, "❌ Connect wallet first: /connect <words>");
    
    try {
        const inputMint = direction === 'BUY' ? 'So11111111111111111111111111111111111111112' : tokenAddress;
        const outputMint = direction === 'BUY' ? tokenAddress : 'So11111111111111111111111111111111111111112';
        const amount = direction === 'BUY' 
            ? Math.floor(amountInSol * LAMPORTS_PER_SOL) 
            : Math.floor(SYSTEM.activePosition.tokenAmount);

        const quoteUrl = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=200`;
        const quoteResponse = await (await fetch(quoteUrl)).json();
        
        if (!quoteResponse || quoteResponse.error) throw new Error("Jupiter: No Route");

        const { swapTransaction } = await (await fetch('https://quote-api.jup.ag/v6/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                quoteResponse,
                userPublicKey: solWallet.publicKey.toString(),
                wrapAndUnwrapSol: true
            })
        })).json();

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

async function executeEvmSwap(chatId, direction, tokenAddress, amountEth) {
    if (!evmWallet) return bot.sendMessage(chatId, "❌ Connect wallet first: /connect <words>");
    try {
        const net = NETWORKS[SYSTEM.currentNetwork];
        const connectedWallet = evmWallet.connect(evmProvider);
        const router = evmRouter.connect(connectedWallet);

        const path = direction === 'BUY' ? [net.weth, tokenAddress] : [tokenAddress, net.weth];
        const value = direction === 'BUY' ? ethers.parseEther(amountEth) : SYSTEM.activePosition.rawAmount;

        let tx;
        if (direction === 'BUY') {
            tx = await router.swapExactETHForTokens(
                0, path, connectedWallet.address, Math.floor(Date.now()/1000)+120,
                { value: value, gasLimit: 300000 }
            );
        } else {
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

async function runNeuralScanner(chatId) {
    if (!SYSTEM.autoPilot || SYSTEM.isLocked || !evmWallet) return; 
    
    try {
        const chainId = NETWORKS[SYSTEM.currentNetwork].id;
        const res = await axios.get(`https://api.dexscreener.com/token-boosts/top/v1`);
        const valid = res.data.find(t => t.chainId === chainId);
        
        if (valid && (!SYSTEM.activePosition)) {
            const data = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${valid.tokenAddress}`);
            const pair = data.data.pairs[0];
            
            if (pair) {
                 bot.sendMessage(chatId, `💡 **SIGNAL:** ${pair.baseToken.symbol} on ${SYSTEM.currentNetwork}`);
                 const res = SYSTEM.currentNetwork === 'SOL' 
                    ? await executeSolanaSwap(chatId, 'BUY', pair.baseToken.address, SYSTEM.tradeAmount)
                    : await executeEvmSwap(chatId, 'BUY', pair.baseToken.address, SYSTEM.tradeAmount);

                 if (res) {
                     SYSTEM.activePosition = {
                         symbol: pair.baseToken.symbol,
                         tokenAddress: pair.baseToken.address,
                         entryPrice: pair.priceUsd,
                         tokenAmount: res.amountOut,
                         rawAmount: res.amountOut
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
    // Basic placeholder for profit logic
    if(!SYSTEM.activePosition) return;
    setTimeout(() => monitorPosition(chatId), 5000);
}

// --- COMMANDS ---
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `
⚡ **APEX PREDATOR v7000.2 (CONNECT MODE)** ⚡
1. Type: \`/connect <your 12 words>\`
2. Type: \`/network SOL\` or \`/network BASE\`
3. Type: \`/auto\`
`);
});

bot.onText(/\/network (.+)/, (msg, match) => {
    const net = match[1].toUpperCase();
    if(NETWORKS[net]) {
        initNetwork(net);
        bot.sendMessage(msg.chat.id, `✅ Network switched to ${net}`);
    }
});

bot.onText(/\/auto/, (msg) => {
    if (!evmWallet && !solWallet) return bot.sendMessage(msg.chat.id, "❌ Connect first!");
    SYSTEM.autoPilot = !SYSTEM.autoPilot;
    bot.sendMessage(msg.chat.id, `Auto-Pilot: ${SYSTEM.autoPilot}`);
    if(SYSTEM.autoPilot) runNeuralScanner(msg.chat.id);
});

bot.onText(/\/wallet/, (msg) => {
    if (!evmWallet) return bot.sendMessage(msg.chat.id, "❌ No wallet connected.");
    bot.sendMessage(msg.chat.id, `
🔐 **ACTIVE SESSIONS**
ETH/Base: \`${evmWallet.address}\`
Solana: \`${solWallet.publicKey.toString()}\`
    `, {parse_mode: 'Markdown'});
});

console.log("APEX v7000.2 ONLINE. Waiting for /connect...".magenta);
