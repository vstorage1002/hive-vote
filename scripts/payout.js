require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Constants based on your code
const REWARD_CACHE_FILE = 'ui/reward_cache.json';
const DELEGATION_FILE = 'delegations.json';
const PAYOUT_LOG_FILE = 'ui/payout.log';
const CURATION_LOG_FILE = 'ui/curation_breakdown.log';
const PAID_OUT_FILE = 'paid_out.json';
const MIN_PAYOUT = 0.001;

// Read JSON data
const rewards = JSON.parse(fs.readFileSync(REWARD_CACHE_FILE));
const delegations = JSON.parse(fs.readFileSync(DELEGATION_FILE));
const paidOut = fs.existsSync(PAID_OUT_FILE) ? JSON.parse(fs.readFileSync(PAID_OUT_FILE)) : {};

const now = new Date();
const nowTime = now.toLocaleString();

// Logger functions
function log(message) {
  console.log(message);
  fs.appendFileSync(PAYOUT_LOG_FILE, `[${nowTime}] ${message}\n`);
}

function logCurationBreakdown(message) {
  fs.appendFileSync(CURATION_LOG_FILE, `[${nowTime}] ${message}\n`);
}

// Simulated payout (no actual Hive transfer)
function simulateTransfer(to, amount, memo) {
  console.log(`🚫 Simulated payment to @${to}: ${amount.toFixed(6)} HIVE | Memo: "${memo}"`);
  log(`Simulated payout of ${amount.toFixed(6)} HIVE to @${to}`);
}

// Helper
function daysSince(dateString) {
  const then = new Date(dateString);
  return Math.floor((Date.now() - then.getTime()) / (1000 * 60 * 60 * 24));
}

function payoutDelegators() {
  const totalReward = parseFloat(rewards.total_curation_reward || 0);
  const distributable = totalReward * 0.95;
  const keepAmount = totalReward * 0.05;

  log(`Total reward: ${totalReward} HIVE | To distribute: ${distributable.toFixed(6)} HIVE | Retained: ${keepAmount.toFixed(6)} HIVE`);

  let totalDelegation = 0;
  for (const [user, delegs] of Object.entries(delegations)) {
    for (const d of delegs) {
      if (daysSince(d.since) >= 7) {
        totalDelegation += d.amount;
      }
    }
  }

  log(`Total matured delegation: ${totalDelegation} HP`);

  for (const [user, delegs] of Object.entries(delegations)) {
    let userMaturedHP = 0;
    for (const d of delegs) {
      if (daysSince(d.since) >= 7) {
        userMaturedHP += d.amount;
      }
    }

    if (userMaturedHP === 0) continue;

    const payout = (userMaturedHP / totalDelegation) * distributable;

    if (payout >= MIN_PAYOUT) {
      const memo = `Curation reward for ${now.toISOString().split('T')[0]} based on ${userMaturedHP} HP`;
      simulateTransfer(user, payout, memo);
      if (!paidOut[user]) paidOut[user] = 0;
      paidOut[user] += payout;
      logCurationBreakdown(`@${user} — Delegated: ${userMaturedHP} HP — Payout: ${payout.toFixed(6)} HIVE`);
    }
  }

  fs.writeFileSync(PAID_OUT_FILE, JSON.stringify(paidOut, null, 2));
}

payoutDelegators();
