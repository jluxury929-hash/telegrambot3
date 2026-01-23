/**
 * ===============================================================================
 * 🦁 APEX PREDATOR: OMEGA TOTALITY v3500.0 (ANTI-CHASE / ATOMIC)
 * ===============================================================================
 * UPGRADES:
 * 1. PRE-COG: Sniffs mempool for buys > 2 ETH to front-run them in 1 block.
 * 2. ATOMIC BUNDLE: Uses Flashbots to ensure Buy + Whale Buy mine together.
 * 3. NO CHASE: You enter before the price moves on-chain.
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle'); // Required
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
const http = require('http');
require('colors');

// --- CONFIG ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const WSS_NODE_URL = process.env.WSS_NODE_URL; 
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const RPC_POOL = [
    "https://rpc.flashbots.net",        // Flashbots Primary
    "https://rpc.mevblocker.io",
    "https://eth.llamarpc.com"
];

const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Initialize
const network = ethers.Network.from(1);
let provider = new JsonRpcProvider(RPC_POOL[0], network, { staticNetwork: network });
let flashbotsProvider = null;
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

let wallet = null;
let router = null;

// ==========================================
//  SYSTEM & RPG STATE
// ==========================================
let PLAYER = {
    level: 1, xp: 0, nextLevelXp: 1000, class: "HUNTING CUB",
    totalProfitEth: 0.0,
    dailyQuests: [{ id: 'pre-cog', task: "Whale Front-run", count: 0, target: 1, done: false, xp: 1000 }]
};

let SYSTEM = {
    autoPilot: false,
    tradeAmount: "0.05",
    activePosition: null,
    scannedTokens: new Set()
};

// ==========================================
//  THE ANTI-CHASE ENGINE (FRONT-RUNNING)
// ==========================================

async function startPreCog() {
    if (!WSS_NODE_URL) return console.log("[WARN] No WSS Node for Pre-Cog.".red);
    const ws = new WebSocket(WSS_NODE_URL);

    ws.on('open', () => {
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newPendingTransactions"] }));
        console.log("[PRE-COG] Sniffer active. Monitoring Dark Forest...".cyan);
    });

    ws.on('message', async (data) => {
        const res = JSON.parse(data);
        if (res.params && res.params.result) {
            const txHash = res.params.result;
            const tx = await provider.getTransaction(txHash).catch(() => null);
            
            // Check if transaction is a Uniswap V2 Buy
            if (tx && tx.to && tx.to.toLowerCase() === ROUTER_ADDR.toLowerCase() && tx.data.startsWith('0x7ff36ab5')) {
                const value = parseFloat(ethers.formatEther(tx.value));
                if (value >= 2.0) { // Threshold: Whales only
                    const tokenAddress = '0x' + tx.data.substring(tx.data.length - 40);
                    if (!SYSTEM.scannedTokens.has(tokenAddress)) {
                        console.log(`[WHALE] Detected ${value} ETH buy for ${tokenAddress}`.green);
                        executePredictiveStrike(tokenAddress, tx);
                    }
                }
            }
        }
    });
}

async function executePredictiveStrike(tokenAddress, whaleTx) {
    if (!flashbotsProvider || SYSTEM.activePosition) return;

    const blockNumber = await provider.getBlockNumber();
    const nonce = await provider.getTransactionCount(wallet.address);
    const feeData = await provider.getFeeData();

    // BRIBE: Pay slightly more than whale to ensure our Buy is first
    const priorityFee = whaleTx.maxPriorityFeePerGas ? (whaleTx.maxPriorityFeePerGas * 115n / 100n) : ethers.parseUnits("3", "gwei");
    const maxFee = whaleTx.maxFeePerGas ? (whaleTx.maxFeePerGas * 110n / 100n) : feeData.maxFeePerGas;

    try {
        // 1. Transaction: Our Buy
        const buyTx = await router.swapExactETHForTokens.populateTransaction(
            0, [WETH, tokenAddress], wallet.address, Math.floor(Date.now()/1000)+120,
            { value: ethers.parseEther(SYSTEM.tradeAmount), gasLimit: 250000n }
        );

        const signedBuy = await wallet.signTransaction({
            ...buyTx, type: 2, chainId: 1, nonce,
            maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee
        });

        // 2. Bundle our Buy with the Whale's Buy
        const bundle = [
            { signedTransaction: signedBuy },
            { signedTransaction: whaleTx.raw } // This requires the node to provide raw hex
        ];

        console.log(`[ATOMIC] Blasting bundle for Block ${blockNumber + 1}`.magenta);
        const res = await flashbotsProvider.sendBundle(bundle, blockNumber + 1);
        
        // Success Logic...
        SYSTEM.activePosition = { address: tokenAddress };
        SYSTEM.scannedTokens.add(tokenAddress);
    } catch (e) {}
}

// ==========================================
//  INITIALIZATION
// ==========================================

async function init() {
    if (PRIVATE_KEY) {
        wallet = new Wallet(PRIVATE_KEY, provider);
        flashbotsProvider = await FlashbotsBundleProvider.create(provider, Wallet.createRandom());
        router = new Contract(ROUTER_ADDR, [
            "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
            "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"
        ], wallet);
        console.log(`[INIT] Apex Core Online.`.green);
        startPreCog();
    }
}

const getXpBar = () => {
    const p = Math.min(Math.round((PLAYER.xp / 1000) * 10), 10);
    return "🟩".repeat(p) + "⬛".repeat(10 - p);
};

bot.onText(/\/start/i, (msg) => {
    bot.sendMessage(msg.chat.id, `
 **APEX TOTALITY V3500.0** CLEARANCE: LEVEL ${PLAYER.level}
 XP STATUS: [${getXpBar()}]
 MODE: ANTI-CHASE CORE ACTIVE
 
 *System monitoring mempool for predictive strikes.*`, { parse_mode: "Markdown" });
});

init();
http.createServer((req, res) => res.end("V3500_ONLINE")).listen(8080);
