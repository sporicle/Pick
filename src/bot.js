
function toggleAccordion(header) {
    const accordion = header.parentElement;
    accordion.classList.toggle('active');
}

function decodeBase58(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
        let carry = BASE58_ALPHABET.indexOf(str[i]);
        if (carry < 0) throw new Error('Invalid base58 character');
        
        for (let j = 0; j < bytes.length; j++) {
            carry += bytes[j] * 58;
            bytes[j] = carry & 0xff;
            carry >>= 8;
        }
        
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }
    

    for (let i = 0; i < str.length && str[i] === '1'; i++) {
        bytes.push(0);
    }
    
    return new Uint8Array(bytes.reverse());
}

let connection;
let wallet;
let botRunning = false;
let stats = {
    totalWins: 0,
    solClaimed: 0,
    lastBetRound: 0,
    roundsPlayed: 0,
    roundsWon: 0,
    roundsSkipped: 0
};
let currentRoundId = null;
let monitorTimeout = null;
let transactionInProgress = false;
let claimInProgress = false;
let betHistory = [];
let blockhashCache = { blockhash: null, lastFetchedSlot: null };
let consecutiveErrors = 0;
let lastLifetimeRewardsSol = 0;
let processedRounds = new Set();
let motherlodeCache = { value: 0, lastFetched: 0, lastRound: 0 };

function obfuscateRpcUrl(url) {
    if (!url) return '';

    if (url.length <= 20) return url;
    const start = url.substring(0, 10);
    const end = url.substring(url.length - 10);
    const middle = '*'.repeat(Math.max(8, url.length - 20));
    return start + middle + end;
}

function maskRpcUrlInput() {
    const rpcInput = document.getElementById('rpcUrl');
    const actualUrl = rpcInput.value;
    
    if (actualUrl && actualUrl.length > 0) {

        rpcInput.setAttribute('data-actual-url', actualUrl);
        rpcInput.value = obfuscateRpcUrl(actualUrl);
    }
}

function unmaskRpcUrlInput() {
    const rpcInput = document.getElementById('rpcUrl');
    const actualUrl = rpcInput.getAttribute('data-actual-url');
    
    if (actualUrl) {
        rpcInput.value = actualUrl;
        rpcInput.removeAttribute('data-actual-url');
    }
}

function getActualRpcUrl() {
    const rpcInput = document.getElementById('rpcUrl');
    const actualUrl = rpcInput.getAttribute('data-actual-url');
    return actualUrl || rpcInput.value;
}

function loadPersistedData() {

    const savedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (savedSettings) {
        try {
            const settings = JSON.parse(savedSettings);
            if (settings.rpcUrl) {
                document.getElementById('rpcUrl').value = settings.rpcUrl;

                setTimeout(maskRpcUrlInput, 100);
            }
            if (settings.betAmount) document.getElementById('betAmount').value = settings.betAmount;
            if (settings.secondaryBetAmount) document.getElementById('secondaryBetAmount').value = settings.secondaryBetAmount;
            if (settings.orePrice) document.getElementById('orePrice').value = settings.orePrice;
            if (settings.orePriceMultiplier !== undefined) document.getElementById('orePriceMultiplier').value = settings.orePriceMultiplier;
            if (settings.evThreshold) document.getElementById('evThreshold').value = settings.evThreshold;
            if (settings.lowestSquaresCount !== undefined) document.getElementById('lowestSquaresCount').value = settings.lowestSquaresCount;
            if (settings.lowestSquaresSkip !== undefined) document.getElementById('lowestSquaresSkip').value = settings.lowestSquaresSkip;
            if (settings.lowestSquaresSlots !== undefined) document.getElementById('lowestSquaresSlots').value = settings.lowestSquaresSlots;
            if (settings.varianceReduction !== undefined) document.getElementById('varianceReduction').checked = settings.varianceReduction;

            if (settings.strategy !== undefined) {

                let strategy = settings.strategy;
                if (strategy === 'standard') {
                    strategy = 'xLowest';
                } else if (strategy === 'forceOptimal') {
                    strategy = 'optimal';
                }
                document.getElementById('strategySelect').value = strategy;
            } else {

                if (settings.forceOptimal) {
                    document.getElementById('strategySelect').value = 'optimal';
                } else {

                    document.getElementById('strategySelect').value = 'xLowest';
                }
            }
            log('✓ Settings loaded from storage', 'info');
        } catch (error) {
            console.error('Error loading settings:', error);
        }
        } else {

        const defaultRpcUrl = '';
        document.getElementById('rpcUrl').value = defaultRpcUrl;
        setTimeout(maskRpcUrlInput, 100);
        saveSettings();
    }

    const savedStats = localStorage.getItem(STORAGE_KEYS.STATS);
    if (savedStats) {
        try {
            const loadedStats = JSON.parse(savedStats);
            stats = { ...stats, ...loadedStats };
            updateStats();
            log('✓ Stats loaded from storage', 'info');
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }

    const savedHistory = localStorage.getItem(STORAGE_KEYS.HISTORY);
    if (savedHistory) {
        try {
            betHistory = JSON.parse(savedHistory);
            updateHistoryDisplay();
            updatePnlMetrics();
            updateStats();
            log(`✓ Loaded ${betHistory.length} bets from history`, 'info');
        } catch (error) {
            console.error('Error loading history:', error);
        }
    }
}

function saveSettings() {
    const settings = {
        rpcUrl: getActualRpcUrl(),
        betAmount: document.getElementById('betAmount').value,
        secondaryBetAmount: document.getElementById('secondaryBetAmount').value,
        orePrice: document.getElementById('orePrice').value,
        orePriceMultiplier: document.getElementById('orePriceMultiplier').value,
        evThreshold: document.getElementById('evThreshold').value,
        strategy: document.getElementById('strategySelect').value,
        lowestSquaresCount: document.getElementById('lowestSquaresCount').value,
        lowestSquaresSkip: document.getElementById('lowestSquaresSkip').value,
        lowestSquaresSlots: document.getElementById('lowestSquaresSlots').value,
        varianceReduction: document.getElementById('varianceReduction').checked
    };
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
}

function saveStats() {
    localStorage.setItem(STORAGE_KEYS.STATS, JSON.stringify(stats));
}

function saveHistory() {
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(betHistory));
}

function clearPersistedData() {
    localStorage.removeItem(STORAGE_KEYS.SETTINGS);
    localStorage.removeItem(STORAGE_KEYS.STATS);
    localStorage.removeItem(STORAGE_KEYS.HISTORY);
    log('✓ All stored data cleared', 'info');
}

function findPDA(seeds) {
    const encoder = new TextEncoder();
    const seedBuffers = seeds.map(seed => {
        if (typeof seed === 'string') {
            return encoder.encode(seed);
        }
        return seed;
    });
    return solanaWeb3.PublicKey.findProgramAddressSync(
        seedBuffers,
        new solanaWeb3.PublicKey(PROGRAM_ID)
    )[0];
}

function boardPDA() {
    return findPDA(['board']);
}

function roundPDA(roundId) {
    const buffer = new Uint8Array(8);
    const view = new DataView(buffer.buffer);
    view.setBigUint64(0, BigInt(roundId), true);
    return findPDA(['round', buffer]);
}

function minerPDA(authority) {
    return findPDA(['miner', authority.toBuffer()]);
}

function automationPDA(authority) {
    return findPDA(['automation', authority.toBuffer()]);
}

function treasuryPDA() {
    return findPDA(['treasury']);
}

function log(message, type = 'info') {
    const logContainer = document.getElementById('logContainer');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const timestamp = new Date().toLocaleTimeString();
    

    const formattedMessage = message.replace(
        /(https:\/\/solscan\.io\/tx\/[a-zA-Z0-9]+)/g, 
        '<a href="$1" target="_blank" style="color: #58a6ff; text-decoration: underline;">signature</a>'
    );
    
    entry.innerHTML = `<span class="timestamp">[${timestamp}]</span>${formattedMessage}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
    console.log(`[${type.toUpperCase()}] ${message}`);
}

function updateStatus(status, className) {
    const statusDisplay = document.getElementById('statusDisplay');
    statusDisplay.textContent = status;
    statusDisplay.className = `status ${className}`;
}

async function refreshConnection() {
    const rpcUrl = getActualRpcUrl();
    connection = new solanaWeb3.Connection(rpcUrl, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000
    });
    log('🔄 Connection refreshed', 'info');
    return connection;
}

async function getFreshBlockhash(currentSlot) {

    if (blockhashCache.blockhash && blockhashCache.lastFetchedSlot && 
        currentSlot - blockhashCache.lastFetchedSlot < 100) {
        return blockhashCache;
    }
    
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    blockhashCache = { blockhash, lastFetchedSlot: currentSlot };
    return blockhashCache;
}

function updateStats() {
    let actualWinRate = '-';
    if (betHistory.length > 0) {
        const validBets = betHistory.filter(bet => 
            bet.betSquares && bet.betSquares.length > 0 && 
            bet.result !== 'Skipped' && !bet.result.startsWith('Missed')
        );
        
        if (validBets.length > 0) {
            const wins = validBets.filter(bet => bet.won === true).length;
            actualWinRate = ((wins / validBets.length) * 100).toFixed(1) + '%';
        }
    }
    document.getElementById('actualWinRate').textContent = actualWinRate;
    
    document.getElementById('roundsPlayed').textContent = stats.roundsPlayed;
    document.getElementById('roundsWon').textContent = stats.roundsWon;
    document.getElementById('roundsSkipped').textContent = stats.roundsSkipped;
    

    let expectedWinRate = '-';
    if (betHistory.length > 0) {
        const validBets = betHistory.filter(bet => 
            bet.betSquares && bet.betSquares.length > 0 && 
            bet.result !== 'Skipped' && !bet.result.startsWith('Missed')
        );
        
        if (validBets.length > 0) {
            const totalExpectedWinRate = validBets.reduce((sum, bet) => {
                const skip = bet.skip !== undefined ? bet.skip : 0;
                const availableSquares = 25 - skip;
                return sum + (bet.betSquares.length / availableSquares) * 100;
            }, 0);
            const avgExpectedWinRate = totalExpectedWinRate / validBets.length;
            expectedWinRate = avgExpectedWinRate.toFixed(1) + '%';
        }
    }
    document.getElementById('expectedWinRate').textContent = expectedWinRate;
    
    saveStats();
}

function updateDeployedGrid(deployed) {
    const grid = document.getElementById('deployedGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    

    const values = deployed.map(val => Number(val));
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;
    

    const betAmount = parseFloat(document.getElementById('betAmount').value) || 0.01;
    const skip = parseInt(document.getElementById('lowestSquaresSkip').value) || 0;
    const varianceReductionEnabled = document.getElementById('varianceReduction').checked;

    let optimalStrategy = calculateOptimalEV(deployed, betAmount, skip, 25, 0, varianceReductionEnabled);
    const optimalSquares = optimalStrategy ? optimalStrategy.indices : [];
    

    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        

        if (optimalSquares.includes(i)) {
            cell.classList.add('optimal-square');
        }
        

        const value = Number(deployed[i]);
        const normalized = (value - minVal) / range;
        const r = Math.floor(45 + normalized * 68);
        const g = Math.floor(53 + normalized * 75);
        const b = Math.floor(72 + normalized * 78);
        
        cell.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
        

        const indexDiv = document.createElement('div');
        indexDiv.className = 'cell-index';
        indexDiv.textContent = `#${i}`;
        
        const valueDiv = document.createElement('div');
        valueDiv.className = 'cell-value';
        const solValue = value / 1_000_000_000;
        valueDiv.textContent = solValue.toFixed(4);
        
        cell.appendChild(indexDiv);
        cell.appendChild(valueDiv);
        
        grid.appendChild(cell);
    }
}

async function getBoardData() {
    const boardAddress = boardPDA();
    const response = await connection.getAccountInfoAndContext(boardAddress);
    if (!response.value) {
        throw new Error('Board account not found');
    }
    const view = new DataView(response.value.data.buffer);
    return {
        round_id: view.getBigUint64(8, true),
        start_slot: view.getBigUint64(16, true),
        end_slot: view.getBigUint64(24, true),
        slot: response.context.slot
    };
}

async function getRoundData(roundId, commitment = 'processed') {
    const roundAddress = roundPDA(roundId);
    const response = await connection.getAccountInfoAndContext(roundAddress, commitment);
    if (!response.value) {
        throw new Error('Round account not found');
    }
    const view = new DataView(response.value.data.buffer);
    const deployed = [];
    for (let i = 0; i < 25; i++) {
        deployed.push(view.getBigUint64(16 + (i * 8), true));
    }
    return { deployed, slot: response.context.slot };
}

async function getMinerData() {
    const minerAddress = minerPDA(wallet.publicKey);
    const accountInfo = await connection.getAccountInfo(minerAddress);
    if (!accountInfo) {
        return null;
    }
    const view = new DataView(accountInfo.data.buffer);
    

    
    return {
        rewards_sol: view.getBigUint64(488, true),
        rewards_ore: view.getBigUint64(496, true),
        refined_ore: view.getBigUint64(504, true),
        checkpoint_id: view.getBigUint64(448, true),
        round_id: view.getBigUint64(512, true),
        lifetime_rewards_sol: view.getBigUint64(520, true)
    };
}

async function getTreasuryData(forceRefresh = false) {
    const now = Date.now();
    const currentRoundId = Number(document.getElementById('currentRound')?.textContent || 0);
    

    if (!forceRefresh && 
        motherlodeCache.value > 0 && 
        (now - motherlodeCache.lastFetched) < MOTHERLODE_CACHE_TTL &&
        currentRoundId === motherlodeCache.lastRound) {
        return { motherlode: motherlodeCache.value };
    }
    
    const treasuryAddress = treasuryPDA();
    const accountInfo = await connection.getAccountInfo(treasuryAddress);
    if (!accountInfo) {
        throw new Error('Treasury account not found');
    }
    const view = new DataView(accountInfo.data.buffer);
    

    const motherlodeValue = Number(view.getBigUint64(16, true)) / Number(10n ** BigInt(11));
    

    motherlodeCache = {
        value: motherlodeValue,
        lastFetched: now,
        lastRound: currentRoundId
    };
    
    return {
        motherlode: motherlodeValue
    };
}

function findXLowestTiles(deployed, count, skip = 0) {

    const tiles = deployed.map((value, index) => ({ index, value }));
    

    tiles.sort((a, b) => Number(a.value - b.value));
    

    const lowestTiles = tiles.slice(skip, skip + count);
    const indices = lowestTiles.map(t => t.index);
    
    return indices;
}

function calculateEV(deployed, tileIndices, betAmount, motherlode = 0) {

    const orePrice = parseFloat(document.getElementById('orePrice').value);
    

    const betLamports = betAmount * LAMPORTS_PER_SOL;
    const totalSquares = 25;
    
    let totalEV = 0;
    const totalBet = tileIndices.length * betLamports;
    

    for (let winningSquare = 0; winningSquare < totalSquares; winningSquare++) {

        const didBetOnWinner = tileIndices.includes(winningSquare);
        
        if (!didBetOnWinner) {

            continue;
        }
        

        const yourShareOnWinner = betLamports;
        const totalOnWinner = Number(deployed[winningSquare]) + yourShareOnWinner;
        

        let losingSol = 0;
        for (let i = 0; i < totalSquares; i++) {
            if (i !== winningSquare) {
                const yourBetOnSquare = tileIndices.includes(i) ? betLamports : 0;
                losingSol += Number(deployed[i]) + yourBetOnSquare;
            }
        }
        

        const distributableSol = losingSol * 0.89;
        
        const yourProportionalShare = yourShareOnWinner / totalOnWinner;
        const yourPortion = yourProportionalShare * distributableSol;
        

        const oreReward = 1.0 + (motherlode * (1 / 625));
        const oreRewardAfterRefining = oreReward * 0.9;
        const expectedOreReward = yourProportionalShare * oreRewardAfterRefining;
        const oreValueInSol = expectedOreReward * orePrice;
        

        const yourReturn = yourShareOnWinner + yourPortion + 
                           (oreValueInSol * LAMPORTS_PER_SOL);
        

        totalEV += (1 / totalSquares) * yourReturn;
    }
    

    const netEV = (totalEV - totalBet) / LAMPORTS_PER_SOL;
    
    return netEV;
}

function calculateOptimalEV(deployed, betPerSquare, skip = 0, maxSquares = 25, motherlode = 0, varianceReduction = false) {

    const deployedArray = deployed.map(val => Number(val));
    

    const sortedByValue = deployedArray.map((val, idx) => ({ val, idx }))
        .sort((a, b) => a.val - b.val);
    
    let maxEV = -Infinity;
    let bestStrategy = null;
    

    const availableSquares = Math.min(25 - skip, maxSquares);
    

    if (availableSquares <= 0) {
        return null;
    }
    

    let maxEVStrategy = null;
    for (let numSquares = 1; numSquares <= availableSquares; numSquares++) {

        const indices = sortedByValue.slice(skip, skip + numSquares).map(s => s.idx);
        const ev = calculateEV(deployed, indices, betPerSquare, motherlode);
        const totalBet = betPerSquare * numSquares;
        
        if (ev > maxEV) {
            maxEV = ev;
            maxEVStrategy = {
                numSquares,
                indices: [...indices],
                ev,
                betPerSquare,
                totalBet
            };
            bestStrategy = {
                numSquares,
                indices: [...indices],
                ev,
                betPerSquare,
                totalBet
            };
        }
    }
    

    let varianceReductionSquares = [];
    if (varianceReduction && bestStrategy && maxEV > 0 && maxEVStrategy) {
        const minEV = maxEV - (maxEV * 0.1);
        const maxEVIndices = new Set(maxEVStrategy.indices);
        

        for (let numSquares = bestStrategy.numSquares + 1; numSquares <= availableSquares; numSquares++) {
            const indices = sortedByValue.slice(skip, skip + numSquares).map(s => s.idx);
            const ev = calculateEV(deployed, indices, betPerSquare, motherlode);
            const totalBet = betPerSquare * numSquares;
            

            if (ev >= minEV) {
                bestStrategy = {
                    numSquares,
                    indices: [...indices],
                    ev,
                    betPerSquare,
                    totalBet
                };

                varianceReductionSquares = indices.filter(idx => !maxEVIndices.has(idx));
            } else {

                break;
            }
        }
    }
    

    if (varianceReductionSquares.length > 0) {
        bestStrategy.varianceReductionSquares = varianceReductionSquares;
    }
    
    return bestStrategy;
}

function addToHistory(round, bet, result, ev, won, boardState, betSquares, finalBoardState = null, finalEv = null, slotsBeforeEnd = null, motherlode = 0, varianceReductionSquares = [], skip = 0, endSlot = null, boardStateSlot = null) {
    betHistory.unshift({ 
        round, 
        bet, 
        result, 
        ev, 
        finalEv,
        won, 
        boardState: boardState || [], 
        betSquares: betSquares || [],
        finalBoardState: finalBoardState || null,
        slotsBeforeEnd: slotsBeforeEnd,
        motherlode: motherlode,
        varianceReductionSquares: varianceReductionSquares || [],
        skip: skip,
        endSlot: endSlot,
        boardStateSlot: boardStateSlot
    });
    

    if (betHistory.length > 10000) {
        betHistory.pop();
    }
    
    updateHistoryDisplay();
    updatePnlMetrics();
    updateStats();
    saveHistory();
}

function updateBetHistoryFinalState(roundId, finalBoardState, finalEv) {
    const betIndex = betHistory.findIndex(b => b.round === roundId);
    if (betIndex !== -1) {
        betHistory[betIndex].finalBoardState = finalBoardState;
        betHistory[betIndex].finalEv = finalEv;
        updateHistoryDisplay();
        saveHistory();
    }
}

function updateHistoryDisplay() {
    const container = document.getElementById('historyContainer');
    container.innerHTML = '';
    
    const hideSkipped = document.getElementById('hideSkippedFilter').checked;
    
    betHistory.forEach((bet, index) => {
        if (hideSkipped && (bet.result === 'Skipped' || bet.result.startsWith('Missed'))) {
            return;
        }
        const row = document.createElement('div');

        if (bet.result === 'Skipped') {
            row.className = 'history-row';
            row.style.borderLeftColor = '#f0883e';
            row.style.opacity = '0.7';
        } else if (bet.result.startsWith('Missed')) {
            row.className = 'history-row';
            row.style.borderLeftColor = '#da3633';
            row.style.opacity = '0.8';
        } else {
            row.className = `history-row ${bet.won ? 'win' : 'loss'}`;
        }
        
        const roundCell = document.createElement('div');
        roundCell.textContent = bet.round;
        
        const betCell = document.createElement('div');
        betCell.textContent = bet.bet.toFixed(3);
        
        const resultCell = document.createElement('div');
        let resultText = bet.result;

        if (resultText === 'Win') {
            resultText = 'W';
        } else if (resultText === 'Loss') {
            resultText = 'L';
        } else if (resultText.startsWith('Missed')) {
            resultText = resultText.replace('Missed', 'M');
        }

        if (bet.slotsBeforeEnd !== null && bet.slotsBeforeEnd !== undefined) {
            resultText += ` (${bet.slotsBeforeEnd})`;
        }
        resultCell.textContent = resultText;
        if (bet.result === 'Skipped') {
            resultCell.style.color = '#f0883e';
        } else if (bet.result.startsWith('Missed')) {
            resultCell.style.color = '#da3633';
        } else {
            resultCell.style.color = bet.won ? '#7ee787' : '#ff7b72';
        }
        

        const numSquares = bet.betSquares ? bet.betSquares.length : 2;
        const skip = bet.skip !== undefined ? bet.skip : 0;
        const availableSquares = 25 - skip;
        const expectedWinRate = (numSquares / availableSquares) * 100;
        
        const expectedWinRateCell = document.createElement('div');
        expectedWinRateCell.textContent = `${expectedWinRate.toFixed(1)}%`;
        expectedWinRateCell.style.color = '#8b949e';
        

        const totalBetCost = bet.bet * numSquares;
        const evPercent = (bet.ev / totalBetCost) * 100;
        
        const evCell = document.createElement('div');
        evCell.textContent = evPercent >= 0 ? `+${evPercent.toFixed(1)}%` : `${evPercent.toFixed(1)}%`;
        evCell.style.color = evPercent >= 0 ? '#7ee787' : '#ff7b72';
        

        const finalEvCell = document.createElement('div');
        if (bet.finalEv !== null && bet.finalEv !== undefined) {
            const finalEvPercent = (bet.finalEv / totalBetCost) * 100;
            finalEvCell.textContent = finalEvPercent >= 0 ? `+${finalEvPercent.toFixed(1)}%` : `${finalEvPercent.toFixed(1)}%`;
            finalEvCell.style.color = finalEvPercent >= 0 ? '#7ee787' : '#ff7b72';
        } else {
            finalEvCell.textContent = '-';
            finalEvCell.style.color = '#6e7681';
        }
        
        const boardCell = document.createElement('div');
        if (bet.boardState && bet.boardState.length > 0) {
            const viewBtn = document.createElement('button');
            viewBtn.className = 'view-board-btn';
            viewBtn.textContent = 'View';
            viewBtn.onclick = () => showBoardModal(index, false);
            boardCell.appendChild(viewBtn);
        } else {
            boardCell.textContent = '-';
            boardCell.style.color = '#6e7681';
        }
        
        const finalCell = document.createElement('div');
        if (bet.finalBoardState && bet.finalBoardState.length > 0) {
            const viewBtn = document.createElement('button');
            viewBtn.className = 'view-board-btn';
            viewBtn.textContent = 'View';
            viewBtn.onclick = () => showBoardModal(index, true);
            finalCell.appendChild(viewBtn);
        } else {
            finalCell.textContent = '-';
            finalCell.style.color = '#6e7681';
        }
        
        const editCell = document.createElement('div');
        const editBtn = document.createElement('button');
        editBtn.className = 'view-board-btn';
        editBtn.textContent = 'Edit';
        editBtn.onclick = () => showEditModal(index);
        editCell.appendChild(editBtn);
        
        row.appendChild(roundCell);
        row.appendChild(betCell);
        row.appendChild(resultCell);
        row.appendChild(expectedWinRateCell);
        row.appendChild(evCell);
        row.appendChild(finalEvCell);
        row.appendChild(boardCell);
        row.appendChild(finalCell);
        row.appendChild(editCell);
        
        container.appendChild(row);
    });
}

function updatePnlMetrics() {

}

async function placeBet(roundId, tileIndices, amount, receiveTime, deployed, currentSlot, fetchSlot, endSlot, motherlode = 0, varianceReductionSquares = []) {
    const boardAddress = boardPDA();
    const roundAddress = roundPDA(roundId);
    const minerAddress = minerPDA(wallet.publicKey);
    const automationAddress = automationPDA(wallet.publicKey);
    

    const ev = calculateEV(deployed, tileIndices, amount, motherlode);
    
    const instruction = createDeployInstruction(
        wallet.publicKey,
        automationAddress,
        boardAddress,
        minerAddress,
        roundAddress,
        amount,
        tileIndices
    );
    

    const computeBudgetIx = solanaWeb3.ComputeBudgetProgram.setComputeUnitLimit({
        units: 300000
    });
    
    const transaction = new solanaWeb3.Transaction()
        .add(computeBudgetIx)
        .add(instruction);
        
    transaction.feePayer = wallet.publicKey;
    

    const { blockhash } = await getFreshBlockhash(currentSlot);
    transaction.recentBlockhash = blockhash;
    

    transaction.sign(wallet);
    

    const sendTime = Date.now();
    const processingTime = sendTime - receiveTime;
    

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: true,
        maxRetries: 0
    });
    
    log(`✅ Bet sent! https://solscan.io/tx/${signature} (${processingTime}ms processing)`, 'success');
    stats.roundsPlayed++;
    stats.lastBetRound = roundId;
    updateStats();
    

    const boardStateArray = deployed.map(val => Number(val));
    const skip = parseInt(document.getElementById('lowestSquaresSkip').value) || 0;
    addToHistory(roundId, amount, 'Pending', ev, false, boardStateArray, tileIndices, null, null, null, motherlode, varianceReductionSquares, skip, Number(endSlot), fetchSlot);
    

    (async () => {
        try {

            await connection.confirmTransaction(signature, 'confirmed');
            
            const txInfo = await connection.getTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
            });
            
            if (txInfo && txInfo.slot) {
                const txSlot = txInfo.slot;
                const blocksFromEnd = Number(endSlot) - txSlot;
                const blocksFromFetch = txSlot - fetchSlot;
                

                if (blocksFromEnd <= 0) {
                    const blocksMissed = Math.abs(blocksFromEnd);
                    log(`❌ Bet missed! Processing: ${processingTime}ms (receive → send), Tx landed ${blocksMissed} blocks after round ended`, 'error');
                    
                    if (stats.roundsPlayed > 0) {
                        stats.roundsPlayed--;
                    }
                    updateStats();

                    const betIndex = betHistory.findIndex(b => b.round === roundId && b.result === 'Pending');
                    if (betIndex !== -1) {
                        betHistory[betIndex].result = `Missed (${blocksMissed})`;
                        betHistory[betIndex].won = false;
                        betHistory[betIndex].slotsBeforeEnd = blocksFromEnd;
                        

                        try {
                            const finalRoundData = await getRoundData(roundId);
                            const finalBoardStateArray = finalRoundData.deployed.map(val => Number(val));
                            betHistory[betIndex].finalBoardState = finalBoardStateArray;
                            

                            const bet = betHistory[betIndex];
                            if (bet.betSquares && bet.betSquares.length > 0) {
                                const betLamports = bet.bet * LAMPORTS_PER_SOL;
                                const finalBoardStateNumber = finalRoundData.deployed.map(val => Number(val));
                                const boardStateWithoutBet = finalBoardStateNumber.map((val, idx) => {
                                    return bet.betSquares.includes(idx) ? val - betLamports : val;
                                });
                                const finalEv = calculateEV(boardStateWithoutBet, bet.betSquares, bet.bet);
                                betHistory[betIndex].finalEv = finalEv;
                            }
                        } catch (error) {
                            log(`⚠️ Could not fetch final board state for missed bet: ${error.message}`, 'warning');
                        }
                        
                        updateHistoryDisplay();
                        saveHistory();
                    }
                } else {
                    log(`📊 Block Analysis: Processing: ${processingTime}ms (receive → send), Tx sending: Fetched at slot ${fetchSlot}, landed at slot ${txSlot} (+${blocksFromFetch} blocks), ${blocksFromEnd} blocks before round end`, 'info');
                    

                    const betIndex = betHistory.findIndex(b => b.round === roundId && b.result === 'Pending');
                    if (betIndex !== -1) {
                        betHistory[betIndex].slotsBeforeEnd = blocksFromEnd;
                        updateHistoryDisplay();
                        saveHistory();
                    }
                }
            }
        } catch (error) {
            log(`⚠️ Transaction confirmation failed: ${error.message}`, 'warning');
        }
    })();
    
    return { signature, ev };
}

async function claimSOL(currentSlot) {
    const minerAddress = minerPDA(wallet.publicKey);
    
    const instruction = createClaimSolInstruction(wallet.publicKey, minerAddress);
    
    const transaction = new solanaWeb3.Transaction().add(instruction);
    transaction.feePayer = wallet.publicKey;
    
    const { blockhash } = await getFreshBlockhash(currentSlot);
    transaction.recentBlockhash = blockhash;
    
    const signature = await solanaWeb3.sendAndConfirmTransaction(
        connection,
        transaction,
        [wallet],
        { 
            commitment: 'confirmed',
            maxRetries: 3
        }
    );
    
    log(`✅ SOL claimed! https://solscan.io/tx/${signature}`, 'success');
    
    return signature;
}

async function checkpoint(roundId, currentSlot) {
    const boardAddress = boardPDA();
    const minerAddress = minerPDA(wallet.publicKey);
    const roundAddress = roundPDA(roundId);
    const treasuryAddress = treasuryPDA();
    
    const instruction = createCheckpointInstruction(
        wallet.publicKey,
        boardAddress,
        minerAddress,
        roundAddress,
        treasuryAddress
    );
    
    const transaction = new solanaWeb3.Transaction().add(instruction);
    transaction.feePayer = wallet.publicKey;
    
    const { blockhash } = await getFreshBlockhash(currentSlot);
    transaction.recentBlockhash = blockhash;
    
    const signature = await solanaWeb3.sendAndConfirmTransaction(
        connection,
        transaction,
        [wallet],
        { 
            commitment: 'confirmed',
            maxRetries: 3
        }
    );
    
    return signature;
}

async function checkAndClaimSOL(currentSlot) {
    if (claimInProgress) return;
    
    try {
        const minerData = await getMinerData();
        if (!minerData) return;
        
        const rewardsSol = Number(minerData.rewards_sol) / LAMPORTS_PER_SOL;
        if (rewardsSol > 0) {
            claimInProgress = true;
            try {
                await claimSOL(currentSlot);
                stats.solClaimed += rewardsSol;
                updateStats();
            } finally {
                claimInProgress = false;
            }
        }
    } catch (error) {
        log(`❌ Error claiming SOL: ${error.message}`, 'error');
        claimInProgress = false;
    }
}

async function checkForWins(currentSlot, currentRoundId) {
    try {
        const minerData = await getMinerData();
        if (!minerData) return;
        

        const completedRound = stats.lastBetRound - 1;
        const skippedRound = stats.lastBetRound;
        if (completedRound < 0) return;
        const betIndex = betHistory.findIndex(b => b.round === completedRound && b.result === 'Pending');
        const skippedIndices = betHistory
            .map((b, idx) => ({ bet: b, idx }))
            .filter(({ bet }) => bet.result === 'Skipped' && currentRoundId !== null && bet.round < currentRoundId && (!bet.finalBoardState || bet.finalBoardState.length === 0))
            .map(({ idx }) => idx);
        const missedIndex = betHistory.findIndex(b => b.round === completedRound && b.result && b.result.startsWith('Missed'));
        

        const currentLifetimeRewardsSol = Number(minerData.lifetime_rewards_sol) / LAMPORTS_PER_SOL;
        const lifetimeRewardsIncreased = currentLifetimeRewardsSol > lastLifetimeRewardsSol;
        if (lifetimeRewardsIncreased) {
            lastLifetimeRewardsSol = currentLifetimeRewardsSol;
        }
        

        if (betIndex === -1 && skippedIndices.length === 0 && missedIndex === -1) {

            if (!processedRounds.has(completedRound)) {
                const rewardsSol = Number(minerData.rewards_sol) / LAMPORTS_PER_SOL;
                if (rewardsSol > 0) {
                    log(`🎉 Unclaimed rewards detected: ${rewardsSol.toFixed(4)} SOL`, 'success');
                    await checkAndClaimSOL(currentSlot);
                    processedRounds.add(completedRound);
                }
            }
            return;
        }
        

        if (betIndex !== -1 && betHistory[betIndex].result === 'Pending') {

            try {
                const finalRoundData = await getRoundData(completedRound);
                const finalBoardStateArray = finalRoundData.deployed.map(val => Number(val));
                betHistory[betIndex].finalBoardState = finalBoardStateArray;
                

                const bet = betHistory[betIndex];
                if (bet.betSquares && bet.betSquares.length > 0) {
                    const motherlodeAtBetTime = bet.motherlode !== undefined ? bet.motherlode : 0;
                    const betLamports = bet.bet * LAMPORTS_PER_SOL;
                    const finalBoardStateNumber = finalRoundData.deployed.map(val => Number(val));
                    const boardStateWithoutBet = finalBoardStateNumber.map((val, idx) => {
                        return bet.betSquares.includes(idx) ? val - betLamports : val;
                    });
                    
                    if (bet.boardState && bet.boardState.length > 0) {
                        const boardStatesMatch = bet.boardState.every((val, idx) => {
                            return Math.abs(val - boardStateWithoutBet[idx]) < 1;
                        });
                        
                        if (boardStatesMatch) {
                            const finalEv = calculateEV(bet.boardState, bet.betSquares, bet.bet, motherlodeAtBetTime);
                            betHistory[betIndex].finalEv = finalEv;
                        } else {
                            const finalEv = calculateEV(boardStateWithoutBet, bet.betSquares, bet.bet, motherlodeAtBetTime);
                            betHistory[betIndex].finalEv = finalEv;
                        }
                    } else {
                        const finalEv = calculateEV(boardStateWithoutBet, bet.betSquares, bet.bet, motherlodeAtBetTime);
                        betHistory[betIndex].finalEv = finalEv;
                    }
                }
            } catch (error) {
                log(`⚠️ Could not fetch final board state: ${error.message}`, 'warning');
            }
            

            const freshMinerData = await getMinerData();
            if (!freshMinerData) {
                log(`⚠️ Could not fetch miner data for win check`, 'warning');
                return;
            }
            

            const currentRewardsSol = Number(freshMinerData.rewards_sol) / LAMPORTS_PER_SOL;
            const currentLifetimeRewardsSol = Number(freshMinerData.lifetime_rewards_sol) / LAMPORTS_PER_SOL;
            const lifetimeRewardsIncreased = currentLifetimeRewardsSol > lastLifetimeRewardsSol;
            

            if (currentRewardsSol > 0 || lifetimeRewardsIncreased) {

                stats.totalWins++;
                stats.roundsWon++;
                if (lifetimeRewardsIncreased) {
                    lastLifetimeRewardsSol = currentLifetimeRewardsSol;
                }
                if (currentRewardsSol > 0) {
                    log(`🎉 Win detected! Rewards: ${currentRewardsSol.toFixed(4)} SOL`, 'success');
                } else {
                    log(`🎉 Win detected! (Rewards already claimed)`, 'success');
                }
                

                betHistory[betIndex].result = 'Win';
                betHistory[betIndex].won = true;
                updateHistoryDisplay();
                updatePnlMetrics();
                saveHistory();
                
                updateStats();
                

                if (currentRewardsSol > 0) {
                    await checkAndClaimSOL(currentSlot);
                }
                
                processedRounds.add(completedRound);
            } else {

                betHistory[betIndex].result = 'Loss';
                betHistory[betIndex].won = false;
                updateHistoryDisplay();
                updatePnlMetrics();
                saveHistory();
                processedRounds.add(completedRound);
            }
        }
        

        for (const skippedIndex of skippedIndices) {
            try {
                const bet = betHistory[skippedIndex];
                const skippedRoundId = bet.round;
                
                const finalRoundData = await getRoundData(skippedRoundId);
                const finalBoardStateArray = finalRoundData.deployed.map(val => Number(val));
                betHistory[skippedIndex].finalBoardState = finalBoardStateArray;
                

                if (bet.betSquares && bet.betSquares.length > 0) {
                    const motherlodeAtBetTime = bet.motherlode !== undefined ? bet.motherlode : 0;
                    const finalEv = calculateEV(finalRoundData.deployed, bet.betSquares, bet.bet, motherlodeAtBetTime);
                    betHistory[skippedIndex].finalEv = finalEv;
                }
                updateHistoryDisplay();
                saveHistory();
                processedRounds.add(skippedRoundId);
            } catch (error) {
                log(`⚠️ Could not calculate counterfactual: ${error.message}`, 'warning');
            }
        }
        

        if (missedIndex !== -1) {
            try {
                const bet = betHistory[missedIndex];

                if (!bet.finalBoardState || bet.finalBoardState.length === 0) {
                    const finalRoundData = await getRoundData(completedRound);
                    const finalBoardStateArray = finalRoundData.deployed.map(val => Number(val));
                    betHistory[missedIndex].finalBoardState = finalBoardStateArray;
                    

                    if (bet.betSquares && bet.betSquares.length > 0) {
                        const motherlodeAtBetTime = bet.motherlode !== undefined ? bet.motherlode : 0;
                        const betLamports = bet.bet * LAMPORTS_PER_SOL;
                        const finalBoardStateNumber = finalRoundData.deployed.map(val => Number(val));
                        const boardStateWithoutBet = finalBoardStateNumber.map((val, idx) => {
                            return bet.betSquares.includes(idx) ? val - betLamports : val;
                        });
                        const finalEv = calculateEV(boardStateWithoutBet, bet.betSquares, bet.bet, motherlodeAtBetTime);
                        betHistory[missedIndex].finalEv = finalEv;
                    }
                    
                    updateHistoryDisplay();
                    saveHistory();
                }
            } catch (error) {
                log(`⚠️ Could not fetch final board state for missed bet: ${error.message}`, 'warning');
            }
        }
    } catch (error) {
        log(`Error checking for wins: ${error.message}`, 'error');
    }
}

async function updateWalletBalance() {
    try {
        const balance = await connection.getBalance(wallet.publicKey);
        const balanceText = (balance / LAMPORTS_PER_SOL).toFixed(4);
        document.getElementById('walletBalance').textContent = balanceText;
    } catch (error) {
        console.error('Error updating balance:', error);
    }
}

async function updateUnclaimedOre() {
    try {
        const minerData = await getMinerData();
        if (!minerData) {
            document.getElementById('unclaimedOre').textContent = '-';
            return;
        }
        const rewardsOre = Number(minerData.rewards_ore);
        const refinedOre = Number(minerData.refined_ore);
        const totalUnclaimedOre = rewardsOre + refinedOre;
        const oreText = (totalUnclaimedOre / 100_000_000_000).toFixed(2);
        document.getElementById('unclaimedOre').textContent = oreText;
    } catch (error) {
        console.error('Error updating unclaimed ORE:', error);
        document.getElementById('unclaimedOre').textContent = '-';
    }
}

async function updateOrePrice() {
    try {

        const response = await fetch(`https://lite-api.jup.ag/price/v3?ids=${ORE_MINT_ADDRESS},So11111111111111111111111111111111111111112`);
        if (!response.ok) {
            throw new Error('Failed to fetch price');
        }
        const data = await response.json();
        const orePriceUsd = data[ORE_MINT_ADDRESS]?.usdPrice;
        const solPriceUsd = data['So11111111111111111111111111111111111111112']?.usdPrice;
        
        if (orePriceUsd && solPriceUsd) {
            const orePriceSol = orePriceUsd / solPriceUsd;
            const displayText = `${orePriceSol.toFixed(1)} ($${orePriceUsd.toFixed(1)})`;
            document.getElementById('orePriceDisplay').textContent = displayText;

            const priceInput = document.getElementById('orePrice');
            if (priceInput) {
                const multiplier = parseFloat(document.getElementById('orePriceMultiplier').value) || 0.85;
                const adjustedPrice = orePriceSol * multiplier;
                priceInput.value = adjustedPrice.toFixed(4);
                saveSettings();
            }
        } else {
            document.getElementById('orePriceDisplay').textContent = '-';
        }
    } catch (error) {
        console.error('Error updating ORE price:', error);
        document.getElementById('orePriceDisplay').textContent = '-';
    }
}

async function monitorRound() {
    if (!botRunning || transactionInProgress) {

        if (botRunning) {
            monitorTimeout = setTimeout(monitorRound, 1000);
        }
        return;
    }
    
    let slotsRemaining = null;
    try {

        const now = Date.now();
        if (!connection._lastRefresh) connection._lastRefresh = now;
        if (now - connection._lastRefresh > 5 * 60 * 1000) {
            await refreshConnection();
            connection._lastRefresh = now;
        }
        
        const boardData = await getBoardData();
        const currentSlot = await connection.getSlot();
        
        const newRoundId = Number(boardData.round_id);

        if (currentRoundId !== null && newRoundId !== currentRoundId) {
            motherlodeCache.lastRound = 0;
        }
        currentRoundId = newRoundId;
        document.getElementById('currentRound').textContent = currentRoundId;
        
        updateWalletBalance().catch(() => {});
        updateOrePrice().catch(() => {});
        updateUnclaimedOre().catch(() => {});
        

        let cachedRoundData = null;
        let cachedTreasuryData = null;
        try {
            cachedRoundData = await getRoundData(currentRoundId);
            updateDeployedGrid(cachedRoundData.deployed);
            

            try {
                cachedTreasuryData = await getTreasuryData();
                const motherlode = cachedTreasuryData.motherlode;
                

                const expectedOrePerRound = motherlode * (1 / 625);
                
                const motherlodeDisplay = document.getElementById('motherlodeDisplay');
                if (motherlodeDisplay) {

                    const motherlodeFormatted = motherlode.toFixed(2).replace(/\.?0+$/, '');

                    const orePerRoundFormatted = expectedOrePerRound.toFixed(2).replace(/\.?0+$/, '');
                    motherlodeDisplay.textContent = `${motherlodeFormatted} (+${orePerRoundFormatted})`;
                    motherlodeDisplay.style.color = '#58a6ff';
                }
            } catch (error) {

                const motherlodeDisplay = document.getElementById('motherlodeDisplay');
                if (motherlodeDisplay) {
                    motherlodeDisplay.textContent = '-';
                }
            }
        } catch (error) {

            console.log('Grid update failed:', error.message);
        }
        
        slotsRemaining = Number(boardData.end_slot) - currentSlot;
        const slotsPerSecond = 2.5;
        const secondsRemaining = Math.max(0, slotsRemaining / slotsPerSecond);
        

        const roundWeBetOnEnded = stats.lastBetRound > 1 && (
            currentRoundId !== stats.lastBetRound ||
            (currentRoundId === stats.lastBetRound && slotsRemaining <= 0)
        );
        
        if (roundWeBetOnEnded && !processedRounds.has(stats.lastBetRound - 1)) {
            checkForWins(currentSlot, currentRoundId).catch(err => {
                log(`⚠️ Error checking for wins: ${err.message}`, 'warning');
            });
        }
        

        if (slotsRemaining > 0 && slotsRemaining <= 25 && slotsRemaining > 15) {
            await getFreshBlockhash(currentSlot);
        }
        
        getMinerData().then(minerData => {
            if (minerData && slotsRemaining > 20 && slotsRemaining <= 140 && 
                minerData.round_id > 0 && minerData.checkpoint_id !== minerData.round_id && !transactionInProgress) {
                transactionInProgress = true;
                checkpoint(Number(minerData.round_id), currentSlot).then(() => {
                    transactionInProgress = false;
                }).catch(error => {
                    log(`❌ Checkpoint failed: ${error.message}`, 'error');
                    transactionInProgress = false;
                });
            }
        }).catch(() => {});
        
        const strategy = document.getElementById('strategySelect').value;
        const useLowestSquaresStrategy = strategy === 'xLowest';
        const slotsThreshold = parseInt(document.getElementById('lowestSquaresSlots').value);
        

        let shouldBet = slotsRemaining > 0 && slotsRemaining <= slotsThreshold && currentRoundId !== stats.lastBetRound;
        

        if (!shouldBet && slotsRemaining > slotsThreshold && slotsRemaining <= slotsThreshold + 8 && currentRoundId !== stats.lastBetRound) {
            try {
                const roundData = cachedRoundData || await getRoundData(currentRoundId);
                const treasuryData = cachedTreasuryData || await getTreasuryData();
                const motherlode = treasuryData.motherlode;
                const betAmount = parseFloat(document.getElementById('betAmount').value);
                const useOptimal = strategy === 'optimal';
                
                let quickEvPercentage = 0;
                
                if (useOptimal) {

                    const skip = parseInt(document.getElementById('lowestSquaresSkip').value) || 0;
                    const maxSquares = Math.min(25, slotsRemaining);
                    const varianceReductionEnabled = document.getElementById('varianceReduction').checked;

                    let quickOptimalStrategy = calculateOptimalEV(roundData.deployed, betAmount, skip, maxSquares, motherlode, varianceReductionEnabled);
                    if (quickOptimalStrategy && quickOptimalStrategy.ev > 0) {
                        const quickTotalBet = betAmount * quickOptimalStrategy.numSquares;
                        const quickOptimalEV = calculateEV(roundData.deployed, quickOptimalStrategy.indices, betAmount, motherlode);
                        quickEvPercentage = (quickOptimalEV / quickTotalBet) * 100;
                    }
                } else {

                    const count = parseInt(document.getElementById('lowestSquaresCount').value);
                    const skip = parseInt(document.getElementById('lowestSquaresSkip').value);
                    const quickCheckTiles = findXLowestTiles(roundData.deployed, Math.min(count, 25 - skip), skip);
                    const quickEv = calculateEV(roundData.deployed, quickCheckTiles, betAmount, motherlode);
                    const quickTotalBet = betAmount * quickCheckTiles.length;
                    quickEvPercentage = (quickEv / quickTotalBet) * 100;
                }
                

                if (quickEvPercentage > 10) {
                    shouldBet = true;
                }

            } catch (error) {

            }
        }
        

        if (!shouldBet && slotsRemaining > 0 && slotsRemaining <= slotsThreshold && currentRoundId !== stats.lastBetRound) {
            shouldBet = true;
        }
        
        if (shouldBet) {
            transactionInProgress = true;
            const betStartTime = Date.now();
            try {
                updateStatus('EVALUATING BET...', 'running');
                

                const roundData = cachedRoundData || await getRoundData(currentRoundId);
                const fetchSlot = roundData.slot;
                const receiveTime = Date.now();
                const betAmount = parseFloat(document.getElementById('betAmount').value);
                

                const treasuryData = cachedTreasuryData || await getTreasuryData();
                const motherlode = treasuryData.motherlode;
                

                const strategy = document.getElementById('strategySelect').value;
                const useOptimal = strategy === 'optimal';
                const evThreshold = parseFloat(document.getElementById('evThreshold').value);
                
                if (useOptimal) {
                    updateStatus('CALCULATING OPTIMAL STRATEGY...', 'running');
                    

                    const skip = parseInt(document.getElementById('lowestSquaresSkip').value) || 0;

                    const maxSquares = Math.min(25, slotsRemaining);
                    const varianceReductionEnabled = document.getElementById('varianceReduction').checked;
                    

                    let optimalStrategy = calculateOptimalEV(roundData.deployed, betAmount, skip, maxSquares, motherlode, varianceReductionEnabled);
                    let optimalEV = 0;
                    let optimalEvPercentage = 0;
                    let totalBet = 0;
                    
                    if (optimalStrategy) {
                        const betPerSquare = betAmount;
                        totalBet = betAmount * optimalStrategy.numSquares;
                        optimalEV = calculateEV(roundData.deployed, optimalStrategy.indices, betPerSquare, motherlode);
                        optimalEvPercentage = (optimalEV / totalBet) * 100;
                    }
                    
                    if (optimalStrategy && optimalStrategy.ev > 0 && optimalEvPercentage >= evThreshold) {
                        log(`🎯 Using optimal strategy - ${optimalStrategy.numSquares} squares, ${betAmount.toFixed(4)} SOL each (total: ${totalBet.toFixed(4)} SOL, ${optimalEvPercentage.toFixed(2)}% optimal EV)`, 'success');
                        
                        const varianceReductionSquares = optimalStrategy.varianceReductionSquares || [];
                        await placeBet(currentRoundId, optimalStrategy.indices, betAmount, receiveTime, roundData.deployed, currentSlot, fetchSlot, boardData.end_slot, motherlode, varianceReductionSquares);
                        updateStatus('WAITING FOR NEXT ROUND', 'waiting');
                    } else {
                        const secondaryBetAmount = parseFloat(document.getElementById('secondaryBetAmount').value);
                        let secondaryOptimalStrategy = calculateOptimalEV(roundData.deployed, secondaryBetAmount, skip, maxSquares, motherlode, varianceReductionEnabled);
                        let secondaryTotalBet = 0;
                        let secondaryOptimalEV = 0;
                        let secondaryOptimalEvPercentage = 0;
                        
                        if (secondaryOptimalStrategy) {
                            secondaryTotalBet = secondaryBetAmount * secondaryOptimalStrategy.numSquares;
                            secondaryOptimalEV = calculateEV(roundData.deployed, secondaryOptimalStrategy.indices, secondaryBetAmount, motherlode);
                            secondaryOptimalEvPercentage = (secondaryOptimalEV / secondaryTotalBet) * 100;
                        }
                        
                        if (secondaryOptimalStrategy && secondaryOptimalStrategy.ev > 0 && secondaryOptimalEvPercentage >= evThreshold) {
                            log(`🎯 Using secondary bet amount optimal strategy - ${secondaryOptimalStrategy.numSquares} squares, ${secondaryBetAmount.toFixed(4)} SOL each (total: ${secondaryTotalBet.toFixed(4)} SOL, ${secondaryOptimalEV.toFixed(6)} SOL EV, ${secondaryOptimalEvPercentage.toFixed(2)}% return)`, 'success');
                            
                            const secondaryVarianceReductionSquares = secondaryOptimalStrategy.varianceReductionSquares || [];
                            await placeBet(currentRoundId, secondaryOptimalStrategy.indices, secondaryBetAmount, receiveTime, roundData.deployed, currentSlot, fetchSlot, boardData.end_slot, motherlode, secondaryVarianceReductionSquares);
                            updateStatus('WAITING FOR NEXT ROUND', 'waiting');
                        } else {
                            const optimalEvDisplay = optimalStrategy && optimalStrategy.ev > 0 ? optimalEvPercentage.toFixed(2) : 'N/A';
                            const secondaryEvDisplay = secondaryOptimalStrategy && secondaryOptimalStrategy.ev > 0 ? secondaryOptimalEvPercentage.toFixed(2) : 'N/A';
                            
                            log(`⏭️ Skipping round ${currentRoundId}: Optimal strategy EV = ${optimalEvDisplay}% (below ${evThreshold}% threshold). Secondary bet amount EV = ${secondaryEvDisplay}% (also below ${evThreshold}% threshold).`, 'warning');
                            
                            const boardStateArray = roundData.deployed.map(val => Number(val));
                            const skippedIndices = optimalStrategy ? optimalStrategy.indices : [];
                            const skippedVarianceReductionSquares = optimalStrategy ? (optimalStrategy.varianceReductionSquares || []) : [];
                            addToHistory(currentRoundId, betAmount, 'Skipped', optimalEV, false, boardStateArray, skippedIndices, null, null, null, motherlode, skippedVarianceReductionSquares, skip, Number(boardData.end_slot), fetchSlot);
                            
                            stats.roundsSkipped++;
                            stats.lastBetRound = currentRoundId;
                            updateStats();
                            updateStatus('SKIPPED LOW EV ROUND', 'waiting');
                        }
                    }
                } else {

                    const count = parseInt(document.getElementById('lowestSquaresCount').value);
                    const skip = parseInt(document.getElementById('lowestSquaresSkip').value);
                    const lowestTiles = findXLowestTiles(roundData.deployed, count, skip);
                    const ev = calculateEV(roundData.deployed, lowestTiles, betAmount, motherlode);
                    const totalBet = betAmount * lowestTiles.length;
                    const evPercentage = (ev / totalBet) * 100;
                    

                    if (evPercentage >= evThreshold) {
                        const squareNumbers = lowestTiles.join(', #');
                        log(`🎯 Strategy: Betting on ${count} lowest squares (skipping ${skip}, Squares #${squareNumbers}) - Total bet: ${(betAmount * count).toFixed(3)} SOL`, 'info');
                        updateStatus('PLACING BET...', 'running');
                        log(`✓ EV check passed: ${ev.toFixed(6)} SOL (${evPercentage.toFixed(2)}% return)`, 'success');
                        await placeBet(currentRoundId, lowestTiles, betAmount, betStartTime, roundData.deployed, currentSlot, fetchSlot, boardData.end_slot, motherlode);
                        updateStatus('WAITING FOR NEXT ROUND', 'waiting');
                    } else {

                        const secondaryBetAmount = parseFloat(document.getElementById('secondaryBetAmount').value);
                        const secondaryEv = calculateEV(roundData.deployed, lowestTiles, secondaryBetAmount, motherlode);
                        const secondaryTotalBet = secondaryBetAmount * lowestTiles.length;
                        const secondaryEvPercentage = (secondaryEv / secondaryTotalBet) * 100;
                        
                        if (secondaryEv > 0 && secondaryEvPercentage >= evThreshold) {
                            const squareNumbers = lowestTiles.join(', #');
                            log(`🎯 Strategy: Betting on ${count} lowest squares (skipping ${skip}, Squares #${squareNumbers}) - Total bet: ${(secondaryBetAmount * count).toFixed(3)} SOL`, 'info');
                            updateStatus('PLACING BET...', 'running');
                            log(`✓ Main bet EV below threshold (${evPercentage.toFixed(2)}%), using secondary bet amount: ${secondaryEv.toFixed(6)} SOL EV (${secondaryEvPercentage.toFixed(2)}% return)`, 'success');
                            await placeBet(currentRoundId, lowestTiles, secondaryBetAmount, betStartTime, roundData.deployed, currentSlot, fetchSlot, boardData.end_slot, motherlode);
                            updateStatus('WAITING FOR NEXT ROUND', 'waiting');
                        } else {
                            log(`⏭️ Skipping round ${currentRoundId}: Regular strategy EV = ${ev.toFixed(6)} SOL (${evPercentage.toFixed(2)}% return, below ${evThreshold}% threshold). Secondary bet amount EV = ${secondaryEv.toFixed(6)} SOL (${secondaryEvPercentage.toFixed(2)}% return, also below ${evThreshold}% threshold).`, 'warning');
                            
                            const boardStateArray = roundData.deployed.map(val => Number(val));
                            addToHistory(currentRoundId, betAmount, 'Skipped', ev, false, boardStateArray, lowestTiles, null, null, null, motherlode, [], skip);
                            
                            stats.roundsSkipped++;
                            stats.lastBetRound = currentRoundId;
                            updateStats();
                            updateStatus('SKIPPED LOW EV ROUND', 'waiting');
                        }
                    }
                }
            } catch (error) {
                log(`❌ Bet failed: ${error.message}`, 'error');
            } finally {
                transactionInProgress = false;
            }
        } else if (currentRoundId === stats.lastBetRound) {
            updateStatus('WAITING FOR ROUND TO COMPLETE', 'waiting');
        } else {
            updateStatus(`MONITORING (${slotsRemaining} slots)`, 'running');
        }
        

        consecutiveErrors = 0;
        
    } catch (error) {
        log(`❌ Error: ${error.message}`, 'error');
        console.error(error);
        
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            log(`⚠️ ${consecutiveErrors} consecutive errors detected, refreshing connection...`, 'warning');
            await refreshConnection();
            consecutiveErrors = 0;
        }
    } finally {

        if (botRunning) {
            let pollInterval = 1000;
            

            if (slotsRemaining !== null) {
                if (slotsRemaining > 0 && slotsRemaining <= 30) {
                    pollInterval = 100;
                } else if (slotsRemaining > 30 && slotsRemaining <= 100) {
                    pollInterval = 400;
                } else if (slotsRemaining > 100 && slotsRemaining <= 200) {
                    pollInterval = 600;
                }

            }
            monitorTimeout = setTimeout(monitorRound, pollInterval);
        }
    }
}

document.getElementById('startBtn').addEventListener('click', async () => {
    const privateKeyStr = document.getElementById('privateKey').value.trim();
    const rpcUrl = getActualRpcUrl().trim();
    
    if (!privateKeyStr) {
        alert('Please enter your private key');
        return;
    }
    
    if (!rpcUrl) {
        alert('Please enter your RPC URL');
        return;
    }
    
    try {

        let secretKeyBytes;
        
        if (privateKeyStr.startsWith('[')) {

            secretKeyBytes = new Uint8Array(JSON.parse(privateKeyStr));
        } else if (privateKeyStr.includes(',')) {

            const bytes = privateKeyStr.split(',').map(s => parseInt(s.trim()));
            secretKeyBytes = new Uint8Array(bytes);
        } else {

            secretKeyBytes = decodeBase58(privateKeyStr);
        }
        
        wallet = solanaWeb3.Keypair.fromSecretKey(secretKeyBytes);
        
        connection = new solanaWeb3.Connection(rpcUrl, {
            commitment: 'confirmed',
            confirmTransactionInitialTimeout: 60000
        });
        connection._lastRefresh = Date.now();
        

        consecutiveErrors = 0;
        blockhashCache = { blockhash: null, lastFetchedSlot: null };
        processedRounds.clear();
        

        try {
            const minerData = await getMinerData();
            if (minerData) {
                lastLifetimeRewardsSol = Number(minerData.lifetime_rewards_sol) / LAMPORTS_PER_SOL;
            }
        } catch (error) {

            lastLifetimeRewardsSol = 0;
        }
        
        log(`🚀 Bot started: ${wallet.publicKey.toBase58()}`, 'success');
        
        botRunning = true;
        document.getElementById('startBtn').style.display = 'none';
        document.getElementById('stopBtn').style.display = 'block';
        document.getElementById('privateKey').disabled = true;
        document.getElementById('rpcUrl').disabled = true;
        
        updateStatus('INITIALIZING...', 'running');
        

        await monitorRound();
        
    } catch (error) {
        log(`❌ Failed to start bot: ${error.message}`, 'error');
        alert(`Error: ${error.message}`);
    }
});

document.getElementById('stopBtn').addEventListener('click', () => {
    botRunning = false;
    if (monitorTimeout) {
        clearTimeout(monitorTimeout);
        monitorTimeout = null;
    }
    
    document.getElementById('startBtn').style.display = 'block';
    document.getElementById('stopBtn').style.display = 'none';
    document.getElementById('privateKey').disabled = false;
    document.getElementById('rpcUrl').disabled = false;
    
    updateStatus('STOPPED', 'stopped');
    log('🛑 Bot stopped', 'warning');
});

document.getElementById('clearBtn').addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all saved data (settings, stats, and history)?')) {
        clearPersistedData();
        

        stats = {
            totalWins: 0,
            solClaimed: 0,
            lastBetRound: 0,
            roundsPlayed: 0,
            roundsWon: 0,
            roundsSkipped: 0
        };
        betHistory = [];
        

        updateStats();
        updateHistoryDisplay();
        updatePnlMetrics();
        
        alert('All data cleared successfully!');
    }
});

document.getElementById('rpcUrl').addEventListener('change', () => {

    setTimeout(maskRpcUrlInput, 100);
    saveSettings();
});
document.getElementById('rpcUrl').addEventListener('focus', unmaskRpcUrlInput);
document.getElementById('rpcUrl').addEventListener('blur', maskRpcUrlInput);
document.getElementById('betAmount').addEventListener('change', saveSettings);
document.getElementById('secondaryBetAmount').addEventListener('change', saveSettings);
document.getElementById('orePriceMultiplier').addEventListener('change', () => {
    saveSettings();
    updateOrePrice();
});
document.getElementById('evThreshold').addEventListener('change', saveSettings);
document.getElementById('strategySelect').addEventListener('change', saveSettings);
document.getElementById('lowestSquaresCount').addEventListener('change', saveSettings);
document.getElementById('lowestSquaresSkip').addEventListener('change', saveSettings);
document.getElementById('lowestSquaresSlots').addEventListener('change', saveSettings);
document.getElementById('varianceReduction').addEventListener('change', saveSettings);

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && botRunning && connection) {

        log('👁️ Tab visible, refreshing connection...', 'info');
        refreshConnection().catch(err => {
            log(`⚠️ Failed to refresh connection: ${err.message}`, 'warning');
        });
    }
});

window.addEventListener('DOMContentLoaded', () => {
    loadPersistedData();

    updateOrePrice();

    setInterval(updateOrePrice, 30000);
    
    const hideSkippedFilter = document.getElementById('hideSkippedFilter');
    if (hideSkippedFilter) {
        hideSkippedFilter.addEventListener('change', updateHistoryDisplay);
    }
});

async function showBoardModal(betIndex, showFinal = false) {
    const bet = betHistory[betIndex];
    
    const boardStateToShow = showFinal ? bet.finalBoardState : bet.boardState;
    
    if (!bet || !boardStateToShow || boardStateToShow.length === 0) {
        alert(`No ${showFinal ? 'final' : 'initial'} board state available for this bet`);
        return;
    }
    

    if (bet.slotsBeforeEnd === null || bet.slotsBeforeEnd === undefined) {
        if (bet.endSlot !== null && bet.endSlot !== undefined && bet.boardStateSlot !== null && bet.boardStateSlot !== undefined) {
            const slotsBeforeEnd = Number(bet.endSlot) - Number(bet.boardStateSlot);
            bet.slotsBeforeEnd = slotsBeforeEnd;
            updateHistoryDisplay();
            saveHistory();
        } else if (bet.endSlot === null || bet.endSlot === undefined) {

            try {
                const boardData = await getBoardData();
                if (boardData.round_id === bet.round) {
                    bet.endSlot = Number(boardData.end_slot);
                    if (bet.boardStateSlot !== null && bet.boardStateSlot !== undefined) {
                        const slotsBeforeEnd = Number(bet.endSlot) - Number(bet.boardStateSlot);
                        bet.slotsBeforeEnd = slotsBeforeEnd;
                    }
                    updateHistoryDisplay();
                    saveHistory();
                }
            } catch (error) {

            }
        }
    }
    
    const modal = document.getElementById('boardModal');
    const info = document.getElementById('modalBoardInfo');
    const container = document.getElementById('heatmapContainer');
    const header = modal.querySelector('.modal-header h2');
    

    header.textContent = showFinal ? 'Final Board State' : 'Board State at Bet Time';
    

    const numSquares = bet.betSquares ? bet.betSquares.length : 2;
    const totalBetCost = bet.bet * numSquares;
    const evToShow = showFinal ? bet.finalEv : bet.ev;
    const evPercent = evToShow !== null && evToShow !== undefined 
        ? (evToShow / totalBetCost) * 100 
        : null;
    

    const evDisplay = evPercent !== null 
        ? `${evPercent >= 0 ? '+' : ''}${evPercent.toFixed(2)}%` 
        : 'N/A';
    

    const deployedBigInts = boardStateToShow.map(val => BigInt(val));
    

    let motherlodeDisplay = '';
    if (showFinal && bet.motherlode !== undefined && bet.motherlode !== null) {
        const motherlodeFormatted = bet.motherlode.toFixed(2).replace(/\.?0+$/, '');
        motherlodeDisplay = ` | Motherlode: <span style="color: #58a6ff">${motherlodeFormatted} ORE</span>`;
    }
    
    info.innerHTML = `
        <strong>Round ${bet.round}</strong> | 
        Bet: ${bet.bet.toFixed(4)} SOL | 
        EV: <span style="color: ${evPercent >= 0 ? '#7ee787' : '#ff7b72'}">${evDisplay}</span> | 
        Result: <span style="color: ${bet.won ? '#7ee787' : '#ff7b72'}">${bet.result}</span>${motherlodeDisplay}
    `;
    

    const initialBoardState = showFinal ? bet.boardState : null;
    const varianceReductionSquares = bet.varianceReductionSquares || [];
    renderHeatmap(container, boardStateToShow, bet.betSquares || [], initialBoardState, varianceReductionSquares);
    

    modal.classList.add('active');
}

function closeBoardModal() {
    const modal = document.getElementById('boardModal');
    modal.classList.remove('active');
}

function showEditModal(betIndex) {
    const bet = betHistory[betIndex];
    if (!bet) return;
    
    const modal = document.getElementById('editModal');
    const content = document.getElementById('editModalContent');
    
    content.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div class="input-group">
                <label>Round:</label>
                <input type="number" id="editRound" value="${bet.round}" step="1">
            </div>
            <div class="input-group">
                <label>Bet Amount (SOL):</label>
                <input type="number" id="editBet" value="${bet.bet}" step="0.001">
            </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div class="input-group">
                <label>Result:</label>
                <input type="text" id="editResult" value="${bet.result || ''}">
            </div>
            <div class="input-group">
                <label>Won:</label>
                <input type="checkbox" id="editWon" ${bet.won ? 'checked' : ''}>
            </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div class="input-group">
                <label>EV (SOL):</label>
                <input type="number" id="editEv" value="${bet.ev || 0}" step="0.000001">
            </div>
            <div class="input-group">
                <label>Final EV (SOL):</label>
                <input type="number" id="editFinalEv" value="${bet.finalEv !== null && bet.finalEv !== undefined ? bet.finalEv : ''}" step="0.000001" placeholder="Leave empty if not set">
            </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div class="input-group">
                <label>Motherlode:</label>
                <input type="number" id="editMotherlode" value="${bet.motherlode || 0}" step="0.01">
            </div>
            <div class="input-group">
                <label>Skip:</label>
                <input type="number" id="editSkip" value="${bet.skip || 0}" step="1">
            </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div class="input-group">
                <label>Slots Before End:</label>
                <input type="number" id="editSlotsBeforeEnd" value="${bet.slotsBeforeEnd !== null && bet.slotsBeforeEnd !== undefined ? bet.slotsBeforeEnd : ''}" step="1" placeholder="Leave empty if not set">
            </div>
            <div class="input-group">
                <label>End Slot:</label>
                <input type="number" id="editEndSlot" value="${bet.endSlot !== null && bet.endSlot !== undefined ? bet.endSlot : ''}" step="1" placeholder="Leave empty if not set">
            </div>
        </div>
        <div class="input-group" style="margin-bottom: 15px;">
            <label>Bet Squares (comma-separated indices, 0-24):</label>
            <input type="text" id="editBetSquares" value="${bet.betSquares ? bet.betSquares.join(', ') : ''}" placeholder="e.g., 0, 1, 2">
        </div>
        <div class="input-group" style="margin-bottom: 15px;">
            <label>Variance Reduction Squares (comma-separated indices):</label>
            <input type="text" id="editVarianceReductionSquares" value="${bet.varianceReductionSquares ? bet.varianceReductionSquares.join(', ') : ''}" placeholder="e.g., 3, 4">
        </div>
        <div class="input-group" style="margin-bottom: 15px;">
            <label>Board State (comma-separated lamports, 25 values):</label>
            <textarea id="editBoardState" rows="3" placeholder="e.g., 1000000, 2000000, ..." style="width: 100%; font-family: monospace; font-size: 12px;">${bet.boardState ? bet.boardState.join(', ') : ''}</textarea>
        </div>
        <div class="input-group" style="margin-bottom: 15px;">
            <label>Final Board State (comma-separated lamports, 25 values):</label>
            <textarea id="editFinalBoardState" rows="3" placeholder="e.g., 1000000, 2000000, ... (leave empty if not set)" style="width: 100%; font-family: monospace; font-size: 12px;">${bet.finalBoardState ? bet.finalBoardState.join(', ') : ''}</textarea>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 20px;">
            <button onclick="saveBetEdit(${betIndex})" style="flex: 1;">Save</button>
            <button onclick="closeEditModal()" style="flex: 1; background: #6e7681;">Cancel</button>
        </div>
    `;
    
    modal.classList.add('active');
    
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeEditModal();
        }
    };
}

function closeEditModal() {
    const modal = document.getElementById('editModal');
    modal.classList.remove('active');
    modal.onclick = null;
}

function saveBetEdit(betIndex) {
    const bet = betHistory[betIndex];
    if (!bet) return;
    
    const round = parseInt(document.getElementById('editRound').value);
    const betAmount = parseFloat(document.getElementById('editBet').value);
    const result = document.getElementById('editResult').value;
    const won = document.getElementById('editWon').checked;
    const ev = parseFloat(document.getElementById('editEv').value) || 0;
    const finalEvStr = document.getElementById('editFinalEv').value.trim();
    const finalEv = finalEvStr === '' ? null : parseFloat(finalEvStr);
    const motherlode = parseFloat(document.getElementById('editMotherlode').value) || 0;
    const skip = parseInt(document.getElementById('editSkip').value) || 0;
    const slotsBeforeEndStr = document.getElementById('editSlotsBeforeEnd').value.trim();
    const slotsBeforeEnd = slotsBeforeEndStr === '' ? null : parseInt(slotsBeforeEndStr);
    const endSlotStr = document.getElementById('editEndSlot').value.trim();
    const endSlot = endSlotStr === '' ? null : parseInt(endSlotStr);
    
    const betSquaresStr = document.getElementById('editBetSquares').value.trim();
    const betSquares = betSquaresStr === '' ? [] : betSquaresStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    
    const varianceReductionStr = document.getElementById('editVarianceReductionSquares').value.trim();
    const varianceReductionSquares = varianceReductionStr === '' ? [] : varianceReductionStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    
    const boardStateStr = document.getElementById('editBoardState').value.trim();
    const boardState = boardStateStr === '' ? [] : boardStateStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    
    const finalBoardStateStr = document.getElementById('editFinalBoardState').value.trim();
    const finalBoardState = finalBoardStateStr === '' ? null : finalBoardStateStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    
    bet.round = round;
    bet.bet = betAmount;
    bet.result = result;
    bet.won = won;
    bet.ev = ev;
    bet.finalEv = finalEv;
    bet.motherlode = motherlode;
    bet.skip = skip;
    bet.slotsBeforeEnd = slotsBeforeEnd;
    bet.endSlot = endSlot;
    bet.betSquares = betSquares;
    bet.varianceReductionSquares = varianceReductionSquares;
    bet.boardState = boardState;
    bet.finalBoardState = finalBoardState;
    
    updateHistoryDisplay();
    saveHistory();
    closeEditModal();
}

function renderHeatmap(container, boardState, betSquares, initialBoardState = null, varianceReductionSquares = []) {
    container.innerHTML = '';
    

    const showIncreases = initialBoardState !== null && initialBoardState.length === boardState.length;
    

    const values = boardState.map(val => Number(val));
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;
    

    let increases = [];
    let minIncrease = 0, maxIncrease = 0, increaseRange = 1;
    if (showIncreases) {
        increases = boardState.map((val, i) => Number(val) - Number(initialBoardState[i]));
        minIncrease = Math.min(...increases);
        maxIncrease = Math.max(...increases);
        increaseRange = maxIncrease - minIncrease || 1;
    }
    

    for (let i = 0; i < 25; i++) {
        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';
        

        if (betSquares.includes(i)) {
            cell.classList.add('bet-on');

            if (varianceReductionSquares.includes(i)) {
                cell.classList.add('variance-reduction');
            }
        }
        

        const value = Number(boardState[i]);
        const normalized = (value - minVal) / range;
        const r = Math.floor(45 + normalized * 68);
        const g = Math.floor(53 + normalized * 75);
        const b = Math.floor(72 + normalized * 78);
        
        cell.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
        

        const indexDiv = document.createElement('div');
        indexDiv.className = 'cell-index';
        indexDiv.textContent = `#${i}`;
        
        const valueDiv = document.createElement('div');
        valueDiv.className = 'cell-value';
        const solValue = value / 1_000_000_000;
        valueDiv.textContent = solValue.toFixed(4);
        
        cell.appendChild(indexDiv);
        cell.appendChild(valueDiv);
        

        if (showIncreases) {
            const increaseDiv = document.createElement('div');
            increaseDiv.className = 'cell-increase';
            increaseDiv.style.fontSize = '10px';
            increaseDiv.style.marginTop = '2px';
            
            const increase = increases[i] / 1_000_000_000;
            increaseDiv.textContent = `+${increase.toFixed(4)}`;
            

            const increaseNormalized = (increases[i] - minIncrease) / increaseRange;

            let incR, incG;
            if (increaseNormalized < 0.5) {

                incR = Math.floor(126 + increaseNormalized * 2 * 129);
                incG = 231;
            } else {

                incR = 255;
                incG = Math.floor(231 - (increaseNormalized - 0.5) * 2 * 116);
            }
            increaseDiv.style.color = `rgb(${incR}, ${incG}, 115)`;
            increaseDiv.style.fontWeight = 'bold';
            
            cell.appendChild(increaseDiv);
        }
        
        container.appendChild(cell);
    }
}

document.getElementById('boardModal').addEventListener('click', (e) => {
    if (e.target.id === 'boardModal') {
        closeBoardModal();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeBoardModal();
    }
});
