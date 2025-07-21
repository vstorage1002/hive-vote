// payout.js (Testing version — no real payouts)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('hive-js');
const sqlite3 = require('sqlite3').verbose();

const client = new Client(process.env.HIVE_API || 'https://api.hive.blog');

const DB_PATH = './data/hive_rewards.db';
const breakdownLogPath = path.join(__dirname, '../ui/curation_breakdown.log');
const payoutLogPath = path.join(__dirname, '../ui/payout.log');

function getStartOfDayTimestamp() {
  const now = new Date();
  if (now.getHours() < 8) {
    now.setDate(now.getDate() - 1);
  }
  now.setHours(8, 0, 0, 0);
  return Math.floor(now.getTime() / 1000);
}

function vestsToHP(vests, totalVestingShares, totalVestingFundHive) {
  return parseFloat(vests) * totalVestingFundHive / totalVestingShares;
}

function getGlobalProps() {
  return new Promise((resolve, reject) => {
    client.database.getDynamicGlobalProperties().then(data => {
      resolve({
        totalVestingShares: parseFloat(data.total_vesting_shares),
        totalVestingFundHive: parseFloat(data.total_vesting_fund_hive),
      });
    }).catch(reject);
  });
}

function getCurationRewards(account, startTime) {
  return new Promise((resolve, reject) => {
    const rewards = [];
    const fetchOps = async (start = -1) => {
      try {
        const history = await client.call('account_history_api', 'get_account_history', {
          account,
          start,
          limit: 1000,
          include_reversible: false,
          operation_filter_low: 0,
          operation_filter_high: 1000,
        });
        const entries = history.history;

        for (let [_, op] of entries.reverse()) {
          if (op.op[0] === 'curation_reward') {
            const timestamp = new Date(op.timestamp + 'Z').getTime() / 1000;
            if (timestamp >= startTime) {
              rewards.push(op.op[1]);
            }
          }
        }
        resolve(rewards);
      } catch (e) {
        reject(e);
      }
    };
    fetchOps();
  });
}

function getDelegations(db, timestamp) {
  return new Promise((resolve, reject) => {
    const delegations = {};
    db.each(
      `SELECT delegator, amount FROM delegation_periods WHERE start_time <= ?`,
      [timestamp],
      (err, row) => {
        if (err) reject(err);
        else {
          if (!delegations[row.delegator]) {
            delegations[row.delegator] = 0;
          }
          delegations[row.delegator] += row.amount;
        }
      },
      (err, count) => {
        if (err) reject(err);
        else resolve(delegations);
      }
    );
  });
}

function logBreakdown(content) {
  fs.appendFileSync(breakdownLogPath, content + '\n');
}

function logPayout(content) {
  fs.appendFileSync(payoutLogPath, content + '\n');
}

function recordRewardedDay(db, dateKey) {
  db.run(`INSERT OR IGNORE INTO rewarded_days(date_key) VALUES (?)`, [dateKey]);
}

(async () => {
  const startTime = getStartOfDayTimestamp();
  const todayKey = new Date(startTime * 1000).toISOString().substring(0, 10);

  const db = new sqlite3.Database(DB_PATH);

  db.get(`SELECT 1 FROM rewarded_days WHERE date_key = ?`, [todayKey], async (err, row) => {
    if (row) {
      console.log('⏭️ Rewards already distributed for today.');
      db.close();
      return;
    }

    const delegations = await getDelegations(db, startTime);
    const totalDelegatedHP = Object.values(delegations).reduce((a, b) => a + b, 0);
    if (totalDelegatedHP === 0) {
      console.log('🚫 No eligible delegations.');
      db.close();
      return;
    }

    const { totalVestingShares, totalVestingFundHive } = await getGlobalProps();

    const rewards = await getCurationRewards(process.env.REWARDS_ACCOUNT, startTime);
    const totalRewardVests = rewards.reduce((sum, r) => sum + parseFloat(r.reward), 0);
    const totalHP = vestsToHP(totalRewardVests, totalVestingShares, totalVestingFundHive);
    const distributable = totalHP * 0.95;

    logBreakdown(`=== ${todayKey} ===`);
    logBreakdown(`Total HP: ${totalHP.toFixed(6)}, 95% Distributed: ${distributable.toFixed(6)}`);

    for (let delegator in delegations) {
      const share = delegations[delegator] / totalDelegatedHP;
      const payout = distributable * share;
      console.log(`🚫 Simulated payment to @${delegator}: ${payout.toFixed(6)} HIVE`);
      logPayout(`${todayKey}: Simulated ${payout.toFixed(6)} HIVE to @${delegator}`);
    }

    recordRewardedDay(db, todayKey);
    db.close();
  });
})();
