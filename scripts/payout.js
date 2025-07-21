// payout.js (Adjusted for testing only)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const hive = require('hive-js');

const REWARD_CACHE_FILE = 'ui/reward_cache.json';
const PAYOUT_LOG_FILE = 'ui/payout.log';
const CURATION_LOG_FILE = 'ui/curation_breakdown.log';
const DELEGATION_HISTORY_FILE = 'delegation_history.json';
const MIN_PAYOUT = 0.001;
const now = new Date();

function logToFile(file, content) {
  fs.appendFileSync(file, `${content}\n`, 'utf8');
}

function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath));
  } catch {
    return {};
  }
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadRewardCache() {
  return loadJSON(REWARD_CACHE_FILE);
}

function loadDelegationHistory() {
  return loadJSON(DELEGATION_HISTORY_FILE);
}

function getTodayKey() {
  const today = new Date(now.getTime() - (8 * 60 * 60 * 1000)); // offset for 8:00 AM
  today.setUTCHours(8, 0, 0, 0);
  return today.toISOString().split('T')[0];
}

function simulateSendPayout(username, amount, memo) {
  console.log(`[TEST] Would send ${amount.toFixed(6)} HIVE to @${username} | Memo: ${memo}`);
  logToFile(PAYOUT_LOG_FILE, `[${now.toISOString()}] TEST payout: ${amount.toFixed(6)} HIVE to @${username}`);
}

function calculateCurationPortion(totalReward, delegatorHP, totalHP) {
  return totalReward * (delegatorHP / totalHP);
}

function isMature(delegationDate) {
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return now - new Date(delegationDate) >= sevenDays;
}

function getEligibleDelegationAmount(history) {
  let eligible = 0;
  for (const h of history) {
    if (isMature(h.timestamp)) eligible += h.amount;
  }
  return eligible;
}

function main() {
  const rewards = loadRewardCache();
  const history = loadDelegationHistory();
  const todayKey = getTodayKey();

  const todayReward = rewards[todayKey]?.curation_reward || 0;
  const totalReward = todayReward * 0.95;
  const breakdown = [];

  console.log(`Total curation reward to distribute (95%): ${totalReward.toFixed(6)} HIVE`);

  const delegatorEligibleHP = {};
  let totalEligibleHP = 0;

  for (const [delegator, entries] of Object.entries(history)) {
    const eligibleHP = getEligibleDelegationAmount(entries);
    if (eligibleHP > 0) {
      delegatorEligibleHP[delegator] = eligibleHP;
      totalEligibleHP += eligibleHP;
    }
  }

  for (const [delegator, hp] of Object.entries(delegatorEligibleHP)) {
    const payout = calculateCurationPortion(totalReward, hp, totalEligibleHP);
    if (payout >= MIN_PAYOUT) {
      simulateSendPayout(delegator, payout, `Curation reward for ${todayKey}`);
      breakdown.push(`${delegator}: ${payout.toFixed(6)} HIVE for ${hp} HP`);
    } else {
      console.log(`[SKIP] ${delegator} payout ${payout.toFixed(6)} < ${MIN_PAYOUT}`);
    }
  }

  if (breakdown.length > 0) {
    logToFile(CURATION_LOG_FILE, `[${todayKey}]\n` + breakdown.join('\n'));
  }
}

main();
