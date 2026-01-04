# Pick - ORE Mining Bot

Automated betting bot for the ORE mining game on Solana. Monitors rounds, calculates expected value, and places bets automatically based on configurable strategies.

## Features

- **Automated Betting**: Monitors rounds and places bets automatically when conditions are met
- **Strategy Selection**: Choose between "X Lowest Squares" or "Optimal" EV-based strategies
- **EV Calculation**: Real-time expected value calculation with configurable thresholds
- **Variance Reduction**: Optional mode that sacrifices 10% EV for lower variance
- **Bet History**: Complete history of all bets with board state visualization
- **Win Detection**: Automatically detects wins and claims SOL rewards
- **Statistics Tracking**: Tracks win rates, rounds played, and performance metrics
- **Board Visualization**: Heatmap view of board state at bet time and final state
- **Settings Persistence**: All settings saved to browser localStorage

## Usage

### Setup

1. Open `bot.html` in a web browser
2. Enter your private key in one of these formats:
   - Base58 string
   - JSON array: `[1,2,3,...]`
   - Comma-separated: `1,2,3,...`
3. Enter your RPC URL (default provided)
4. Configure betting parameters (see Settings below)
5. Click "Start Bot"

### Operation

The bot continuously monitors the current round and:
- Evaluates betting opportunities based on your strategy
- Places bets when EV threshold is met
- Skips rounds with insufficient EV
- Detects wins and claims SOL automatically
- Updates statistics and history in real-time

### Stopping

Click "Stop Bot" to halt monitoring. Settings are preserved.

## Settings

### Betting Parameters

**Bet Amount (SOL)**
- Primary bet amount per square
- Default: 0.01 SOL

**Secondary Bet Amount (SOL)**
- Fallback bet amount used when primary bet EV is below threshold
- Default: 0.005 SOL

**ORE Price (SOL)**
- Current ORE price (read-only, auto-updated from Jupiter API)
- Used for EV calculations

**ORE Price Multiplier**
- Multiplier applied to fetched ORE price for conservative EV estimates
- Range: 0.01 - 1.0
- Default: 0.85

### Strategy Settings

**Strategy**
- `X Lowest Squares`: Bet on N lowest-value squares
- `Optimal`: Calculate optimal number of squares for maximum EV

**# Lowest Squares**
- Number of lowest squares to bet on (X Lowest Squares strategy)
- Range: 1-25
- Default: 3

**Skip Lowest Squares**
- Number of lowest squares to skip before selecting
- Range: 0-24
- Default: 0

**Slots Remaining**
- Maximum slots remaining before placing bet
- Range: 1-150
- Default: 30

**Min EV Threshold**
- Minimum expected value percentage required to place bet
- Default: 5%

**Variance Reduction**
- When enabled, sacrifices up to 10% EV to bet on more squares for lower variance
- Reduces win/loss volatility at the cost of expected returns

## Statistics

The sidebar displays real-time statistics:

- **Current Round**: Active round ID
- **Wallet Balance**: Current SOL balance
- **Total Bets Placed**: Count of all bets
- **Actual Win Rate**: Percentage of bets that won
- **Expected Win Rate**: Average probability of winning based on squares bet
- **Rounds Played**: Total rounds with bets placed
- **Rounds Won**: Total rounds won
- **Rounds Skipped**: Total rounds skipped due to low EV
- **Current Motherlode**: Current motherlode pool size
- **ORE Price**: Current ORE price in SOL

## Bet History

The history panel shows all bets with:
- Round number
- Bet amount
- Result (Win/Loss/Skipped/Missed)
- Expected win rate
- EV percentage at bet time
- Final EV percentage (calculated after round end)
- Board state visualization (initial and final)

### History Features

- **View Board**: Click "View" to see board state heatmap
- **Edit Bet**: Click "Edit" to manually correct bet data
- **Hide Skipped**: Toggle to filter out skipped rounds
- **Board Modal**: Shows heatmap with your bets highlighted

## How It Works

### Round Monitoring

The bot polls the blockchain every 1 second (faster near round end) to:
1. Check current round ID and slots remaining
2. Fetch board state (SOL deployed per square)
3. Calculate EV for potential bets
4. Place bet if conditions are met

### Betting Logic

**X Lowest Squares Strategy:**
1. Identifies N lowest-value squares (after skipping M)
2. Calculates EV for betting on those squares
3. Places bet if EV percentage >= threshold
4. Falls back to secondary bet amount if primary EV is too low

**Optimal Strategy:**
1. Tests all possible combinations of squares (1 to available)
2. Selects combination with highest EV
3. Places bet if optimal EV percentage >= threshold
4. Falls back to secondary bet amount if primary EV is too low

### Win Detection

After each round ends, the bot:
1. Checks miner account for reward increases
2. Updates bet history with win/loss status
3. Automatically claims SOL if rewards are available
4. Calculates final EV based on actual board state

### Checkpointing

The bot automatically checkpoints your miner account when:
- Between 20-140 slots remaining in a round
- Checkpoint is needed to prevent reward loss

## Technical Details

- Built with vanilla JavaScript and Solana Web3.js
- Uses localStorage for settings and history persistence
- Connects to Solana RPC for blockchain data
- Fetches ORE price from Jupiter API
- Supports Base58, JSON array, and comma-separated private key formats

## Safety

- Private keys are never stored or sent to servers
- RPC URLs and keys are masked in the UI for security
- All settings persist locally in your browser
- Use "Clear History" to remove all stored data
