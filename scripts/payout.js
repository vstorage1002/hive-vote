const fs = require('fs');
const path = require('path');
const hive = require('@hiveio/hive-js');
require('dotenv').config();

const {
  convertVestsToHive,
  getCurationRewards,
  getCurrentDelegations,
  getDelegationPeriods,
  getDelegatorShares,
  getTotalDelegatedHP,
} = require('./utils');

const DB_PATH = './scripts/database.sqlite';
const REWARD_CACHE_PATH = './ui/reward_cache.json';
const PAYOUT_LOG_PATH = './ui/payout.log';
const CURATION_LOG_PATH = './ui/curation_breakdown.log';

const HIVE_USER = process.env.HIVE_USER;

async function distributeRewards() {
  const rewards = await getCurationRewards(HIVE_USER);
  const totalRewards = convertVestsToHive(rewards.totalVests);
  const rewardDate = rewards.rewardDate;

  const startTime = new Date();
  const dateStr = rewardDate.toISOString().split('T')[0];

  const periods = await getDelegationPeriods(DB_PATH);
  const delegations = await getCurrentDelegations(HIVE_USER);
  const eligibleShares = getDelegatorShares(periods, delegations, rewardDate);
  const totalEligibleHP = getTotalDelegatedHP(eligibleShares);

  const distribution = {};
  const breakdownLines = [];

  for (const [delegator, hp] of Object.entries(eligibleShares)) {
    const share = hp / totalEligibleHP;
    const payout = totalRewards * 0.95 * share;
    distribution[delegator] = payout;

    breakdownLines.push(
      `${dateStr} | ${delegator.padEnd(20)} | HP: ${hp.toFixed(3).padStart(8)} | Share: ${(share * 100).toFixed(2)}% | Reward: ${payout.toFixed(6)} HIVE`
    );
  }

  // Log breakdown
  fs.appendFileSync(CURATION_LOG_PATH, breakdownLines.join('\n') + '\n');

  // Save reward cache
  fs.writeFileSync(REWARD_CACHE_PATH, JSON.stringify({
    rewardDate: rewardDate.toISOString(),
    totalRewards,
    distributed: distribution
  }, null, 2));

  // Simulate payouts (no real HIVE sent)
  const payoutLines = [];
  for (const [delegator, payout] of Object.entries(distribution)) {
    const line = `🚫 Simulated payment: ${payout.toFixed(6)} HIVE to ${delegator}`;
    console.log(line);
    payoutLines.push(`${dateStr} ${line}`);
  }

  // Save simulated payout log
  fs.appendFileSync(PAYOUT_LOG_PATH, payoutLines.join('\n') + '\n');

  const endTime = new Date();
  console.log(`✅ Payout simulation complete in ${((endTime - startTime) / 1000).toFixed(2)} seconds.`);
}

distributeRewards().catch(console.error);
