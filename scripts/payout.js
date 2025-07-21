// payout.js (adjusted for safe testing)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('@hiveio/dhive');
const sqlite3 = require('sqlite3').verbose();

const client = new Client(['https://api.hive.blog']);
const ACCOUNT = process.env.HIVE_ACCOUNT;
const REWARD_PERCENT = 0.95;

const db = new sqlite3.Database('payouts.db');
const CURATION_LOG_PATH = path.join(__dirname, '../ui/curation_breakdown.log');
const PAYOUT_LOG_PATH = path.join(__dirname, '../ui/payout.log');

function convertVestsToHive(vests, totalVestingShares, totalVestingFundHive) {
  return (parseFloat(totalVestingFundHive) * parseFloat(vests)) / parseFloat(totalVestingShares);
}

async function getCurationRewards() {
  const now = new Date();
  const endTime = new Date(now);
  endTime.setHours(8, 0, 0, 0);
  if (now < endTime) endTime.setDate(endTime.getDate() - 1);
  const startTime = new Date(endTime);
  startTime.setDate(startTime.getDate() - 1);

  const history = await client.database.call('get_account_history', [ACCOUNT, -1, 1000]);
  const vestingInfo = await client.database.getDynamicGlobalProperties();

  let totalCuration = 0;
  for (const [, op] of history.reverse()) {
    const [type, data] = op.op;
    if (type === 'curation_reward') {
      const timestamp = new Date(op.timestamp + 'Z');
      if (timestamp >= startTime && timestamp < endTime) {
        const hive = convertVestsToHive(data.reward, vestingInfo.total_vesting_shares, vestingInfo.total_vesting_fund_hive);
        totalCuration += hive;
      }
    }
  }
  return { amount: totalCuration, startTime, endTime };
}

function getDelegationPeriods(dateStr) {
  return new Promise((resolve, reject) => {
    db.all('SELECT delegator, amount FROM delegation_periods WHERE start_date <= ? AND (end_date IS NULL OR end_date >= ?)', [dateStr, dateStr], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function getTotalDelegatedHP(periods) {
  return periods.reduce((sum, d) => sum + d.amount, 0);
}

function getDelegatorShares(periods, totalDelegated) {
  const shares = {};
  for (const { delegator, amount } of periods) {
    shares[delegator] = (amount / totalDelegated);
  }
  return shares;
}

function logPayout(delegator, amount, dateStr) {
  const logLine = `${new Date().toISOString()} Paid ${amount.toFixed(6)} HIVE to @${delegator} for ${dateStr}\n`;
  fs.appendFileSync(PAYOUT_LOG_PATH, logLine);
}

function logCurationBreakdown(dateStr, totalCuration, rewards) {
  const lines = [`# Curation Breakdown for ${dateStr}`, `Total 1-day curation: ${totalCuration.toFixed(6)} HIVE`, `Total 95%: ${(totalCuration * REWARD_PERCENT).toFixed(6)} HIVE`, ''];
  for (const { delegator, payout } of rewards) {
    lines.push(`@${delegator}: ${payout.toFixed(6)} HIVE`);
  }
  lines.push('');
  fs.appendFileSync(CURATION_LOG_PATH, lines.join('\n') + '\n');
}

async function distributeRewards() {
  const { amount: totalCuration, startTime, endTime } = await getCurationRewards();
  const rewardAmount = totalCuration * REWARD_PERCENT;
  const dateStr = startTime.toISOString().slice(0, 10);

  const periods = await getDelegationPeriods(dateStr);
  const totalDelegated = getTotalDelegatedHP(periods);
  const shares = getDelegatorShares(periods, totalDelegated);

  const rewards = [];
  for (const delegator in shares) {
    const payout = shares[delegator] * rewardAmount;
    if (payout >= 0.001) {
      console.log(`🚫 Simulated payment to @${delegator}: ${payout.toFixed(6)} HIVE`);
      logPayout(delegator, payout, dateStr);
      rewards.push({ delegator, payout });
    }
  }

  logCurationBreakdown(dateStr, totalCuration, rewards);
}

distributeRewards().catch(console.error);
