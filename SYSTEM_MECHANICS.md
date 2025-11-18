# ORE System Mechanics & Fee Structure

## Overview
ORE is a Solana-native digital store of value with a fair-launch model. Maximum supply: **5,000,000 ORE**. No team allocations or insider holdings.

---

## Mining Mechanics

### Round Structure
- **Duration**: 1 minute per round
- **Grid**: 5×5 block grid (25 blocks total)
- **Process**: Miners deploy SOL on blocks to prospect for rewards

### Reward Distribution

#### 1. SOL Rewards (Losing Blocks)
- At round end, one winning block is selected via on-chain RNG
- **All SOL from the 24 losing blocks** is distributed proportionally to miners on the winning block
- Distribution is based on each miner's claimed space on the winning block

#### 2. ORE Mining Rewards
- **Base reward**: +1 ORE per round
- **Distribution method** (varies by round):
  - **2 out of 3 rounds** (~66.67%): One miner selected by weighted chance receives full +1 ORE
  - **1 out of 3 rounds** (~33.33%): ORE split proportionally among all winning miners
- Selection is weighted by claimed space on winning block

### Motherlode

- **Accumulation**: +0.2 ORE minted and added to motherlode pool each round
- **Trigger probability**: 1 in 625 chance (0.16%) per round
- **Distribution when hit**: Pool split proportionally among winning miners based on claimed space
- **If not hit**: Pool continues accumulating for future rounds
- **Expected motherlode value**: Accumulates to ~125 ORE on average before being hit (625 rounds × 0.2 ORE)

---

## Fee Structure

### 1. Protocol Revenue Fee
- **Rate**: 10% of all SOL mining rewards
- **Collection**: Automatic from SOL won from losing blocks
- **Usage**: Funds the buyback program

### 2. Admin Fee
- **Rate**: 1% of all SOL deployed by miners
- **Purpose**: Development, operations, and maintenance
- **Collection**: Taken from miner deposits during mining

### 3. Refining Fee (ORE Mining Rewards)
- **Rate**: 10% of all ORE mining rewards when claimed
- **Distribution**: Redistributed to other miners proportionally to their **unclaimed** ORE rewards
- **Effect**: Incentivizes holding unclaimed rewards longer (longer holders receive more from this redistribution)
- **Net impact**: Wealth transfer from short-term to long-term miners

### 4. Account Deposits
- **Miner account deposit**: 0.00001 SOL
- **Purpose**: Checkpoint reserve in case account needs checkpointing to prevent reward loss
- **Collection**: One-time when opening new miner account

### 5. Automation Fees
- **Rate**: 0.000005 SOL per automated transaction
- **Purpose**: Offset baseline Solana transaction costs
- **Applies to**: Autominer scheduled transactions

---

## Staking & Buyback Program

### Buyback Mechanism
- **Source**: 10% of SOL mining rewards (protocol revenue fee)
- **Process**: Protocol automatically buys ORE from open market
- **Split of purchased ORE**:
  - **90%**: Buried (burned, but can be reminted if supply < max supply)
  - **10%**: Distributed to stakers as yield

### Staker Benefits
- Earn yield from 10% of buyback ORE
- Benefit from price appreciation due to 90% being buried
- "Double-dip" on protocol revenue

---

## EV Calculation Framework

### Per-Round Miner EV Components

#### Positive Expected Value:
1. **SOL from losing blocks**: `(Your claimed space / Total winning block space) × Total SOL from 24 losing blocks × 0.90 × 0.99`
   - 0.90 factor: After 10% protocol fee
   - 0.99 factor: After 1% admin fee

2. **ORE mining reward**: 
   - If winner-take-all round (66.67% probability): `(Your claimed space / Total winning block space) × 1 ORE × P(win)`
   - If split round (33.33% probability): `(Your claimed space / Total winning block space) × 1 ORE × P(win)`
   - Where P(win) = probability your block is the winning block = 1/25 = 4%

3. **Motherlode**: `(Your claimed space / Total winning block space) × Motherlode pool size × 0.0016 × P(win)`
   - 0.0016 = 1/625 probability

4. **Refining fee redistribution**: `(Your unclaimed ORE / Total unclaimed ORE) × 0.10 × Total ORE claimed this period`

#### Negative Expected Value:
1. **SOL deployed**: Amount staked on your chosen block
2. **Admin fee**: `Your SOL deployed × 0.01`
3. **Refining fee (when claiming)**: `Your claimed ORE × 0.10`
4. **Account deposit**: 0.00001 SOL (one-time)
5. **Automation fees**: 0.000005 SOL per automated transaction

### Net EV Formula:
```
Net EV = [SOL from losing blocks] + [ORE value] + [Motherlode] + [Refining redistribution] 
         - [SOL deployed] - [Admin fee] - [Refining fee when claiming] - [Automation fees]
```

### Key Variables Needed:
- Your claimed space on chosen block
- Total space on winning block (if your block wins)
- Current ORE price
- Total SOL deployed across all blocks
- Distribution of SOL across blocks
- Your unclaimed ORE balance
- Total unclaimed ORE across all miners
- Current motherlode pool size

---

## Key Insights for Strategy

1. **Winning probability**: 1/25 = 4% per round (if randomly choosing blocks)
2. **SOL redistribution**: Majority of miner income comes from losing block SOL (24/25 blocks lose)
3. **Block selection matters**: Less crowded winning blocks = higher proportional share
4. **Claiming timing**: Delaying claims increases refining fee redistribution received
5. **Motherlode accumulation**: Average hit every 625 rounds (~10.4 hours at 1 min/round)
6. **Fee burden**: Combined 11% on SOL deployed (10% protocol + 1% admin) if you lose
7. **ORE fee burden**: 10% on ORE when claimed (but redistributed to other miners)

---

## Tokenomics Summary

- **Minting rate**: ~1 ORE/minute + 0.2 ORE/minute (motherlode) = ~1.2 ORE/minute theoretical max
- **Burn rate**: Variable based on protocol revenue and market conditions
- **Net inflation**: Positive when minting exceeds buyback burial
- **Supply cap**: 5,000,000 ORE (hard limit)
- **Fair launch**: Zero insider allocations

---

## Notes for EV Calculations

- ORE rewards subject to 10% refining fee on claim (but you also receive from others' refining fees)
- Must track unclaimed ORE balance for accurate refining redistribution calculations
- Block selection strategy can significantly impact EV (crowded vs. empty blocks)
- Automation fees add up over time (0.000005 SOL × transactions/day)
- Consider opportunity cost of SOL locked during mining rounds

