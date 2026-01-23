/**
 * ===============================================================================
 * 🦁 APEX PREDATOR: OMEGA TOTALITY v3000.0 (OMNI-FUSION ETERNAL)
 * ===============================================================================
 * FIX LOG: 
 * 1. Fixed BigInt Decimal SyntaxError (gasBuffer).
 * 2. Standardized Ethers v6 BigInt math for bribes.
 * 3. Unified Auto-Pilot State Machine.
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const { FlashbotsBundleProvider, FlashbotsBundleResolution } = require('@flashbots/ethers-provider-bundle');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
require('colors');

// --- CONFIGURATION ---
const { TELEGRAM_TOKEN, PRIVATE_KEY, RPC_URL, CHAT_ID } = process.env;
const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; 
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Initialize Providers
const provider = new JsonRpcProvider(RPC_URL || "https://rpc.flashbots.net");
let wallet, router, flashbotsProvider, bot;

// ==========================================
// SYSTEM & PLAYER STATE
// ==========================================
let SYSTEM = {
    autoPilot: false,
    state: "HUNTING",      
    pendingTarget: null,   
    activePosition: null,  
    tradeAmount: "0.02",   
    scannedTokens: new Set(),
    config: { trailingStop: 10, stopLoss: 15, minLiquidity: 30000 },
    // FIXED: Convert 0.0001 ETH buffer to BigInt Wei (100,000,000,000,000 Wei)
    gasBuffer: ethers.parseUnits("0.0001", "ether")
};

let PLAYER = {
    level: 1, xp: 0, nextLevelXp: 1000, class: "HUNTING CUB",
    totalProfitEth: 0.0,
    wins: 0
};

// ==========================================
// 1. QUANTUM FORCE EXECUTION
// ==========================================
async function executeQuantumStrike(type, tokenAddress, amountInEth) {
    if (!wallet || !flashbotsProvider) return false;
    
    const blockNumber = await provider.getBlockNumber();
    const nonce = await provider.getTransactionCount(wallet.address, "latest");
    const feeData = await provider.getFeeData();
    
    // Predatory Bribing: Calculate 250% priority tip using BigInt math
    const priorityFee = (feeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei")) * 25n / 10n;
    const maxFee = (feeData.maxFeePerGas || ethers.parseUnits("20", "gwei")) + priorityFee;

    let bundleTxs = [];

    try {
        if (type === "BUY") {
            const amountIn = ethers.parseEther(amountInEth.toString());
            const amounts = await router.getAmountsOut(amountIn, [WETH, tokenAddress]);
            const minOut = (amounts[1] * 90n) / 100n; 

            const buyTx = await router.swapExactETHForTokens.populateTransaction(
                minOut, [WETH, tokenAddress], wallet.address, Math.floor(Date.now()/1000)+120,
                { value: amountIn, gasLimit: 350000n }
            );

            const signedBuy = await wallet.signTransaction({
                ...buyTx, type: 2, chainId: 1, nonce, maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee
            });
            bundleTxs.push({ signedTransaction: signedBuy });

        } else {
            const tokenContract = new Contract(tokenAddress, ["function approve(address, uint) returns (bool)", "function balanceOf(address) view returns (uint)"], wallet);
            const bal = await tokenContract.balanceOf(wallet.address);
            
            const approveTx = await tokenContract.approve.populateTransaction(ROUTER_ADDR, bal, { gasLimit: 65000n });
            const signedApprove = await wallet.signTransaction({
                ...approveTx, type: 2, chainId: 1, nonce, maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee
            });

            const sellTx = await router.swapExactTokensForETH.populateTransaction(
                bal, 0n, [tokenAddress, WETH], wallet.address, Math.floor(Date.now()/1000)+120, { gasLimit: 380000n }
            );
            const signedSell = await wallet.signTransaction({
                ...sellTx, type: 2, chainId: 1, nonce: nonce + 1n, maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee
            });

            bundleTxs.push({ signedTransaction: signedApprove }, { signedTransaction: signedSell });
        }

        // PRE-FLIGHT SIMULATION
        const sim = await flashbotsProvider.simulate(bundleTxs, blockNumber + 1);
        if ("error" in sim || sim.firstRevert) {
            if (CHAT_ID) bot.sendMessage(CHAT_ID, `🛡 **SHIELD:** Transaction simulation failed. Aborted to save gas.`);
            return false;
        }

        // BUNDLE BROADCAST
        const res = await flashbotsProvider.sendBundle(bundleTxs, blockNumber + 1);
        const wait = await res.wait();

        if (wait === FlashbotsBundleResolution.BundleIncluded) {
            if (CHAT_ID) bot.sendMessage(CHAT_ID, `🏆 **WIN:** Atomic bundle mined in Block ${blockNumber + 1}.`);
            handleTradeSuccess(type, tokenAddress, amountInEth);
            return true;
        }
        return false;

    } catch (e) {
        console.log(`[STRIKE ERROR]`.red, e.message);
        return false;
    }
}

// ==========================================
// 2. DUAL-CORE INTELLIGENCE
// ==========================================
async function runAutoPilot() {
    if (!SYSTEM.autoPilot) return setTimeout(runAutoPilot, 3000);

    if (SYSTEM.state === "HUNTING" && !SYSTEM.activePosition) {
        try {
            const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
            const target = res.data.find(t => !SYSTEM.scannedTokens.has(t.tokenAddress));
            
            if (target) {
                const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${target.tokenAddress}`);
                const pair = details.data.pairs?.[0];
                
                if (pair && pair.liquidity.usd > SYSTEM.config.minLiquidity) {
                    SYSTEM.scannedTokens.add(target.tokenAddress);
                    if (CHAT_ID) bot.sendMessage(CHAT_ID, `🎯 **LOCK:** ${pair.baseToken.symbol} identified. Striking...`);
                    await executeQuantumStrike("BUY", target.tokenAddress, SYSTEM.tradeAmount);
                }
            }
        } catch (e) { console.log("Scan cycle idle...".gray); }
    }

    if (SYSTEM.state === "MONITORING" && SYSTEM.activePosition) {
        try {
            const pos = SYSTEM.activePosition;
            const amounts = await router.getAmountsOut(ethers.parseEther("1"), [pos.address, WETH]);
            const currentEth = parseFloat(ethers.formatEther(amounts[1]));
            
            if (currentEth > pos.highWaterMark) pos.highWaterMark = currentEth;
            const drop = ((pos.highWaterMark - currentEth) / pos.highWaterMark) * 100;

            if (drop >= SYSTEM.config.trailingStop) {
                if (CHAT_ID) bot.sendMessage(CHAT_ID, `📉 **EXIT:** Peak reversal hit (${drop.toFixed(1)}%). Liquidating...`);
                await executeQuantumStrike("SELL", pos.address, "0");
            }
        } catch (e) { console.log("Price tracking...".gray); }
    }

    setTimeout(runAutoPilot, 4000);
}

// ==========================================
// 3. RPG & HELPERS
// ==========================================
function handleTradeSuccess(type, addr, amt) {
    if (type === "BUY") {
        SYSTEM.activePosition = { address: addr, entry: amt, highWaterMark: amt };
        SYSTEM.state = "MONITORING";
        addXP(200);
    } else {
        SYSTEM.activePosition = null;
        SYSTEM.state = "HUNTING";
        addXP(1000);
        PLAYER.wins++;
    }
}

function addXP(amount) {
    PLAYER.xp += amount;
    if (PLAYER.xp >= PLAYER.nextLevelXp) {
        PLAYER.level++;
        PLAYER.xp = 0;
        PLAYER.nextLevelXp = Math.floor(PLAYER.nextLevelXp * 1.6);
        if (CHAT_ID) bot.sendMessage(CHAT_ID, `🆙 **LEVEL UP:** You are now a Level ${PLAYER.level} ${getRankName(PLAYER.level)}!`);
    }
}

function getRankName(lvl) {
    if (lvl < 5) return "HUNTING CUB";
    if (lvl < 10) return "APEX STRIKER";
    return "MARKET GOD";
}

// ==========================================
// INITIALIZATION
// ==========================================
async function startSystem() {
    console.log(`[SYSTEM] Booting APEX Core...`.yellow);
    
    wallet = new Wallet(PRIVATE_KEY, provider);
    flashbotsProvider = await FlashbotsBundleProvider.create(provider, Wallet.createRandom());
    
    router = new Contract(ROUTER_ADDR, [
        "function swapExactETHForTokens(uint min, address[] path, address to, uint dead) external payable returns (uint[])",
        "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint dead) external returns (uint[])",
        "function getAmountsOut(uint amt, address[] path) external view returns (uint[])"
    ], wallet);

    bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

    bot.onText(/\/auto/, (msg) => {
        SYSTEM.autoPilot = !SYSTEM.autoPilot;
        bot.sendMessage(msg.chat.id, `🤖 **AUTO-PILOT:** ${SYSTEM.autoPilot ? 'ENGAGED' : 'DISABLED'}`);
    });

    bot.onText(/\/status/, (msg) => {
        bot.sendMessage(msg.chat.id, `📊 **TELEMETRY**\nLevel: ${PLAYER.level}\nState: ${SYSTEM.state}\nWins: ${PLAYER.wins}`);
    });

    console.log("🦁 APEX PREDATOR v3000.0 ONLINE".magenta);
    runAutoPilot();
}

startSystem();

// Simple HTTP server to satisfy container health checks
http.createServer((req, res) => {
    res.writeHead(200);
    res.end("APEX_ALIVE");
}).listen(8080);
