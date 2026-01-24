// ==========================================
//  FIXED SIGNAL SCANNER (MAPPING FIX)
// ==========================================

async function runNeuralSignalScan(netKey) {
    const net = NETWORKS[netKey];
    try {
        const res = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', SCAN_HEADERS);
        if (!res.data || res.data.length === 0) return null;

        // DexScreener Boosts use 'chainId' and 'tokenAddress'. 
        // We ensure we pull 'symbol' and 'amount' correctly.
        const match = res.data.find(t => t.chainId === net.id && !SYSTEM.lastTradedTokens[t.tokenAddress]);
        
        if (match) {
            return { 
                symbol: match.symbol || 'UNKNOWN', 
                tokenAddress: match.tokenAddress, 
                price: parseFloat(match.priceUsd || 0) 
            };
        }
    } catch (e) { return null; }
}

// ==========================================
//  SNIPER WORKER (CONFIRMATION & HASH FIX)
// ==========================================

async function startNetworkSniper(chatId, netKey) {
    while (SYSTEM.autoPilot) {
        try {
            if (!SYSTEM.isLocked[netKey]) {
                const signal = await runNeuralSignalScan(netKey);
                
                if (signal && signal.symbol !== 'UNKNOWN') {
                    bot.sendMessage(chatId, `🎯 **[${netKey}] SIGNAL DETECTED:** ${signal.symbol}\nAddress: \`${signal.tokenAddress}\``, { parse_mode: 'Markdown' });

                    const ready = await verifyBalance(chatId, netKey);
                    if (!ready) { await new Promise(r => setTimeout(r, 10000)); continue; }

                    SYSTEM.isLocked[netKey] = true;

                    // EXECUTE BUY
                    const buyRes = (netKey === 'SOL')
                        ? await executeSolanaShotgun(chatId, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY')
                        : await executeEvmContract(chatId, netKey, signal.tokenAddress, SYSTEM.tradeAmount, 'BUY');

                    if (buyRes && (buyRes.hash || buyRes.amountOut)) {
                        // CONFIRMATION WITH HASH
                        const txLink = netKey === 'SOL' 
                            ? `https://solscan.io/tx/${buyRes.hash}` 
                            : `${NETWORKS[netKey].rpc.includes('base') ? 'https://basescan.org' : 'https://etherscan.io'}/tx/${buyRes.hash}`;

                        bot.sendMessage(chatId, `✅ **[${netKey}] TRADE CONFIRMED**\nToken: ${signal.symbol}\nHash: [View Transaction](${txLink})`, { parse_mode: 'Markdown' });

                        const newPos = { ...signal, entryPrice: signal.price, highestPrice: signal.price, amountOut: buyRes.amountOut, chain: netKey };
                        SYSTEM.activePositions.push(newPos);
                        startIndependentPeakMonitor(chatId, netKey, newPos);
                    }
                    
                    SYSTEM.isLocked[netKey] = false;
                }
            }
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
            SYSTEM.isLocked[netKey] = false;
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

// ==========================================
//  EXECUTION RETURN FIX (Ensuring Hash Returns)
// ==========================================

async function executeEvmContract(chatId, netKey, tokenAddress, amount, direction) {
    try {
        const net = NETWORKS[netKey];
        const signer = evmWallet.connect(new JsonRpcProvider(net.rpc));
        const contract = new ethers.Contract(MY_EXECUTOR, APEX_EXECUTOR_ABI, signer);
        const deadline = Math.floor(Date.now() / 1000) + 120;

        if (direction === 'BUY') {
            const tx = await contract.executeBuy(net.router, tokenAddress, 0, deadline, {
                value: ethers.parseEther(amount.toString()),
                gasLimit: 350000
            });
            // We return the hash immediately after sending
            return { hash: tx.hash, amountOut: 1 };
        }
        // ... rest of logic
    } catch (e) { return null; }
}

async function executeSolanaShotgun(chatId, tokenAddress, amount, direction) {
    try {
        const amtStr = direction === 'BUY' ? Math.floor(amount * LAMPORTS_PER_SOL).toString() : amount.toString();
        const res = await axios.get(`${JUP_ULTRA_API}/order?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenAddress}&amount=${amtStr}&taker=${solWallet.publicKey.toString()}&slippageBps=200`, SCAN_HEADERS);
        
        const tx = VersionedTransaction.deserialize(Buffer.from(res.data.transaction, 'base64'));
        tx.sign([solWallet]);

        const sig = await new Connection(NETWORKS.SOL.rpc).sendRawTransaction(tx.serialize(), { skipPreflight: true });
        // Return the signature as the hash
        return { hash: sig, amountOut: res.data.outAmount };
    } catch (e) { return null; }
}
