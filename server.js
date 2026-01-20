/**
 * ===============================================================================
 * 🦍 APEX PREDATOR: CONFIRMATION ENGINE v3100.0
 * ===============================================================================
 * [RELIABILITY UPGRADES]
 * 1. TRANSACTION WAITING: Uses tx.wait() to ensure the block is mined.
 * 2. RECEIPT VALIDATION: Checks 'status === 1' before marking a buy as successful.
 * 3. ETHERSCAN LOGGING: Provides a direct link to the blockchain for every trade.
 * 4. ERROR DIAGNOSTICS: Reports exactly why a trade failed (Gas, Slippage, etc).
 * ===============================================================================
 */

require('dotenv').config();
const { ethers, Wallet, Contract, JsonRpcProvider } = require('ethers');
const axios = require('axios');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
require('colors');

const TELEGRAM_TOKEN = "7903779688:AAGFMT3fWaYgc9vKBhxNQRIdB5AhmX0U9Nw"; 
const PRIVATE_KEY = process.env.PRIVATE_KEY; 
const RPC_URL = process.env.ETH_RPC || "https://eth.llamarpc.com"; 

const ROUTER_ADDR = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; 
const WETH_ADDR = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// ✅ YOUR TOKEN MAP
const TOKEN_MAP = {
    "PEPE": "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
    "LINK": "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    "WIF":  "0x...", // Ensure this is the correct ETH contract for WIF
    "SHIB": "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE"
};

const ROUTER_ABI = [
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];
const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)"
];

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const provider = new JsonRpcProvider(RPC_URL, 1);
const wallet = new Wallet(PRIVATE_KEY, provider);
const router = new Contract(ROUTER_ADDR, ROUTER_ABI, wallet);

let ACTIVE_POSITION = null;

// ==========================================
// EXECUTION WITH CONFIRMATION
// ==========================================

async function executeBuy(chatId, token, amountEth) {
    try {
        bot.sendMessage(chatId, `🚀 **INITIATING BUY: ${token.symbol}**\nAllocating ${amountEth} ETH...`);

        const amountInWei = ethers.parseEther(amountEth.toFixed(18));
        const path = [WETH_ADDR, token.address];
        const deadline = Math.floor(Date.now() / 1000) + 300;

        // 1. Send Transaction
        const tx = await router.swapExactETHForTokens(
            0, // Min amount (Set higher for slippage protection)
            path,
            wallet.address,
            deadline,
            { value: amountInWei, gasLimit: 300000 }
        );

        bot.sendMessage(chatId, `⏳ **Transaction Pending...**\nHash: [View on Etherscan](https://etherscan.io/tx/${tx.hash})`, { parse_mode: "Markdown" });

        // 2. WAIT FOR CONFIRMATION
        const receipt = await tx.wait();

        if (receipt.status === 1) {
            // SUCCESS
            const tokenContract = new Contract(token.address, ERC20_ABI, wallet);
            const bal = await tokenContract.balanceOf(wallet.address);

            ACTIVE_POSITION = {
                symbol: token.symbol,
                address: token.address,
                tokensHeld: bal,
                entryEth: amountEth,
                chatId: chatId
            };

            bot.sendMessage(chatId, `✅ **TRADE CONFIRMED!**\nBlock: ${receipt.blockNumber}\nTokens: ${ethers.formatUnits(bal, 18)} ${token.symbol}`);
            console.log(`[SUCCESS] Buy Confirmed for ${token.symbol}`.green);
        } else {
            // REVERTED
            bot.sendMessage(chatId, `❌ **TRADE REVERTED.** The blockchain rejected the transaction. Check gas or slippage.`);
            console.log(`[FAILED] Transaction Reverted`.red);
        }

    } catch (e) {
        bot.sendMessage(chatId, `⚠️ **Execution Error:** ${e.message}`);
        console.error(e);
    }
}

// ==========================================
// SCANNER & COMMANDS
// ==========================================

async function runScan(chatId) {
    if (ACTIVE_POSITION) return;

    try {
        const bal = await provider.getBalance(wallet.address);
        const ethBal = parseFloat(ethers.formatEther(bal));
        const tradeAmount = (ethBal - 0.01) * 0.10; // Risk 10%

        if (tradeAmount < 0.005) return;

        // Fetch Trending (Example Logic)
        const res = await axios.get('https://api.coingecko.com/api/v3/search/trending');
        const top = res.data.coins[0].item;
        
        if (TOKEN_MAP[top.symbol]) {
            await executeBuy(chatId, { symbol: top.symbol, address: TOKEN_MAP[top.symbol] }, tradeAmount);
        }
    } catch (e) { console.log("Scan wait..."); }
}

bot.onText(/\/auto/, (msg) => {
    bot.sendMessage(msg.chat.id, "♾️ **Confirmation Engine Active.** Starting Loop...");
    setInterval(() => runScan(msg.chat.id), 30000);
});

bot.onText(/\/status/, async (msg) => {
    const bal = await provider.getBalance(wallet.address);
    bot.sendMessage(msg.chat.id, `💰 **Wallet:** ${ethers.formatEther(bal)} ETH\nStatus: ${ACTIVE_POSITION ? "Locked in " + ACTIVE_POSITION.symbol : "Scanning"}`);
});

http.createServer((req, res) => res.end("Ready")).listen(8080);
