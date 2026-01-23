/**
 * ===============================================================================
 * 🦁 APEX PREDATOR: OMEGA TOTALITY v3000.0 (OMNI-FUSION ETERNAL)
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const { FlashbotsBundleProvider, FlashbotsBundleResolution } = require('@flashbots/ethers-provider-bundle');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
const http = require('http');
require('colors');

// --- CONFIGURATION ---
const { TELEGRAM_TOKEN, PRIVATE_KEY, WSS_NODE_URL, RPC_URL, CHAT_ID } = process.env;
const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; 
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Initialize Providers
const provider = new JsonRpcProvider(RPC_URL || "https://rpc.flashbots.net");
let wallet, router, flashbotsProvider, bot;

// ==========================================
// SYSTEM & PLAYER STATE (The Strategist)
// ==========================================
let SYSTEM = {
    autoPilot: false,
    state: "HUNTING",      // HUNTING, MONITORING, EXECUTING
    pendingTarget: null,   // Locked target address
    activePosition: null,  // { address, entryPrice, highWaterMark, amount }
    tradeAmount: "0.02",   
    scannedTokens: new Set(),
    config: { trailingStop: 10, stopLoss: 15, minLiquidity: 30000 },
    gasBuffer: 0.0001n     // Quantum Low Buffer
};

let PLAYER = {
    level: 1, xp: 0, nextLevelXp: 1000, class: "HUNTING CUB",
    totalProfitEth: 0.0,
    inventory: ["MEV Shield v3", "Quantum Goggles"]
};

// ==========================================
// 1. QUANTUM FORCE EXECUTION (The Muscle)
// ==========================================
async function executeQuantumStrike(type, tokenAddress, amountInEth) {
    if (!wallet || !flashbotsProvider) return false;
    
    const blockNumber = await provider.getBlockNumber();
    const nonce = await provider.getTransactionCount(wallet.address, "latest");
    const feeData = await provider.getFeeData();
    
    // Predatory Bribing: 250% of network priority to "Win the Block"
    const priorityFee = (feeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei")) * 25n / 10n;
    const maxFee = (feeData.maxFeePerGas || ethers.parseUnits("20", "gwei")) + priorityFee;

    let bundleTxs = [];

    try {
        if (type === "BUY") {
            const amountIn = ethers.parseEther(amountInEth.toString());
            const amounts = await router.getAmountsOut(amountIn, [WETH, tokenAddress]);
            const minOut = (amounts[1] * 90n) / 100n; // 10% Slippage protection

            const buyTx = await router.swapExactETHForTokens.populateTransaction(
                minOut, [WETH, tokenAddress], wallet.address, Math.floor(Date.now()/1000)+120,
                { value: amountIn, gasLimit: 350000n }
            );

            const signedBuy = await wallet.signTransaction({
                ...buyTx, type: 2, chainId: 1, nonce, maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee
            });
            bundleTxs.push({ signedTransaction: signedBuy });

        } else {
            // Quantum Exit: Bundle Approve + Sell in ONE block
            const tokenContract = new Contract(tokenAddress, ["function approve(address, uint) returns (bool)", "function balanceOf(address) view returns (uint)"], wallet);
            const bal = await tokenContract.balanceOf(wallet.address);
            
            const approveTx = await tokenContract.approve.populateTransaction(ROUTER_ADDR, bal, { gasLimit: 60000n });
            const signedApprove = await wallet.signTransaction({
                ...approveTx, type: 2, chainId: 1, nonce: nonce, maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee
            });

            const sellTx = await router.swapExactTokensForETH.populateTransaction(
                bal, 0n, [tokenAddress, WETH], wallet.address, Math.floor(Date.now()/1000)+120, { gasLimit: 350000n }
            );
            const signedSell = await wallet.signTransaction({
                ...sellTx, type: 2, chainId: 1, nonce: nonce + 1n, maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee
            });

            bundleTxs.push({ signedTransaction: signedApprove }, { signedTransaction: signedSell });
        }

        // PRE-FLIGHT SIMULATION (The Honeypot Detector)
        const sim = await flashbotsProvider.simulate(bundleTxs, blockNumber + 1);
        if ("error" in sim || sim.firstRevert) {
            bot.sendMessage(CHAT_ID, `🛡 **ATOMIC SHIELD:** Trade blocked (Honeypot or High Tax). $0 Gas spent.`);
            return false;
        }

        // SOCKET FLOOD BROADCAST
        const res = await flashbotsProvider.sendBundle(bundleTxs, blockNumber + 1);
        const wait = await res.wait();

        if (wait === FlashbotsBundleResolution.BundleIncluded) {
            bot.sendMessage(CHAT_ID, `🏆 **OBLITERATED:** Block ${blockNumber + 1} Captured.`);
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
// 2. DUAL-CORE INTELLIGENCE (The Brain)
// ==========================================
async function runAutoPilot() {
    if (!SYSTEM.autoPilot) return setTimeout(runAutoPilot, 3000);

    // HUNTING PHASE
    if (SYSTEM.state === "HUNTING" && !SYSTEM.activePosition) {
        try {
            const res = await axios.get('https://api.dexscreener.com/token-boosts/top/v1');
            const target = res.data.find(t => !SYSTEM.scannedTokens.has(t.tokenAddress));
            
            if (target) {
                const details = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${target.tokenAddress}`);
                const pair = details.data.pairs?.[0];
                
                if (pair && pair.liquidity.usd > SYSTEM.config.minLiquidity) {
                    SYSTEM.scannedTokens.add(target.tokenAddress);
                    bot.sendMessage(CHAT_ID, `🎯 **TARGET LOCKED:** ${pair.baseToken.symbol}. Executing Strike...`);
                    await executeQuantumStrike("BUY", target.tokenAddress, SYSTEM.tradeAmount);
                }
            }
        } catch (e) { console.log("Scan idle...".gray); }
    }

    // MONITORING PHASE (Trailing Stop)
    if (SYSTEM.state === "MONITORING" && SYSTEM.activePosition) {
        try {
            const pos = SYSTEM.activePosition;
            const amounts = await router.getAmountsOut(ethers.parseEther("1"), [pos.address, WETH]);
            const currentEth = parseFloat(ethers.formatEther(amounts[1]));
            
            if (currentEth > pos.highWaterMark) pos.highWaterMark = currentEth;
            const drop = ((pos.highWaterMark - currentEth) / pos.highWaterMark) * 100;

            if (drop >= SYSTEM.config.trailingStop) {
                bot.sendMessage(CHAT_ID, `📉 **PEAK REVERSAL:** Dropped ${drop.toFixed(2)}%. Exiting...`);
                await executeQuantumStrike("SELL", pos.address, "0");
            }
        } catch (e) { console.log("Monitoring price...".gray); }
    }

    setTimeout(runAutoPilot, 4000);
}

// ==========================================
// 3. RPG & USER INTERFACE
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
        bot.sendMessage(CHAT_ID, `🆙 **PROMOTION:** Operator Level ${PLAYER.level} reached!`);
    }
}

// ==========================================
// INITIALIZATION
// ==========================================
async function startSystem() {
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
        bot.sendMessage(msg.chat.id, `🤖 **AUTO-PILOT:** ${SYSTEM.autoPilot ? 'ENGAGED' : 'OFF'}`);
    });

    bot.onText(/\/buy (.+)/, async (msg, match) => {
        const addr = match[1];
        bot.sendMessage(msg.chat.id, `⚔️ **GOD MODE:** Forcing strike on ${addr}...`);
        await executeQuantumStrike("BUY", addr, SYSTEM.tradeAmount);
    });

    console.log("🦁 APEX PREDATOR v3000.0 ONLINE".magenta);
    runAutoPilot();
}

startSystem();
http.createServer((req, res) => res.end("APEX_ALIVE")).listen(8080);
