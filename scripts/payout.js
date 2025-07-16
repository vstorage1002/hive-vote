// payout.js - Full Adjusted with SQLite Integration (Real Payout)
const hive = require('@hiveio/hive-js');
const https = require('https');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
const ACTIVE_KEY = process.env.ACTIVE_KEY;
const DELEGATION_WEBHOOK_URL = process.env.DELEGATION_WEBHOOK_URL;
const PAYOUT_LOG_FILE = 'ui/payout.log';
const MIN_PAYOUT = 0.001;
const DB_FILE = 'delegations.db';

const API_NODES = [
  'https://api.hive.blog',
  'https://api.openhive.network',
  'https://anyx.io',
  'https://rpc.ausbit.dev',
  'https://hived.privex.io'
];

const db = new sqlite3.Database(DB_FILE);

function sendWebhookMessage(content, url) {
  if (!url || typeof content !== 'string' || content.trim() === '') return;
  if (content.length > 2000) content = content.substring(0, 1997) + '...';
  const data = JSON.stringify({ content });
  const parsed = new URL(url);
  const options = {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };
  const req = https.request(options, res => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      console.warn(`⚠️ Webhook failed with status ${res.statusCode}`);
    }
  });
  req.on('error', error => console.error('Webhook error:', error));
  req.write(data);
  req.end();
}

async function pickWorkingNode() {
  for (const url of API_NODES) {
    hive.api.setOptions({ url });
    console.log(`🌐 Trying Hive API node: ${url}`);
    const test = await new Promise(resolve => {
      hive.api.getAccounts([HIVE_USER], (err, res) => {
        resolve(err || !res ? null : res);
      });
    });
    if (test) {
      console.log(`✅ Using Hive API: ${url}`);
      return;
    }
  }
  throw new Error('❌ No working Hive API found.');
}

async function storeDelegationHistory() {
  let start = -1;
  const limit = 1000;
  while (true) {
    const history = await new Promise((resolve, reject) => {
      hive.api.getAccountHistory(HIVE_USER, start, limit, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
    if (!history || history.length === 0) break;
    for (const [, op] of history) {
      if (op.op[0] === 'delegate_vesting_shares') {
        const { delegator, delegatee, vesting_shares } = op.op[1];
        const ts = op.timestamp + 'Z';
        if (delegatee === HIVE_USER) {
          if (vesting_shares !== '0.000000 VESTS') {
            db.run(`INSERT INTO delegation_periods (delegator, start_time) VALUES (?, ?)`, [delegator, ts]);
          } else {
            db.run(`UPDATE delegation_periods SET end_time = ? WHERE delegator = ? AND end_time IS NULL ORDER BY start_time DESC LIMIT 1`, [ts, delegator]);
          }
        }
      }
    }
    start = history[0][0] - 1;
    if (history.length < limit) break;
  }
}

async function getDynamicProps() {
  return new Promise((resolve, reject) => {
    hive.api.getDynamicGlobalProperties((err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
  });
}

async function getCurationRewards() {
  const now = new Date();
  const phTz = 'Asia/Manila';
  const today8AM = new Date(now.toLocaleString('en-US', { timeZone: phTz }));
  today8AM.setHours(8, 0, 0, 0);
  const fromTime = today8AM.getTime() - 24 * 60 * 60 * 1000;

  const history = await new Promise((resolve, reject) => {
    hive.api.getAccountHistory(HIVE_USER, -1, 1000, (err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
  });

  let totalVests = 0;
  for (const [, op] of history) {
    if (op.op[0] === 'curation_reward') {
      const opTime = new Date(op.timestamp + 'Z').getTime();
      if (opTime >= fromTime && opTime < today8AM.getTime()) {
        totalVests += parseFloat(op.op[1].reward);
      }
    }
  }
  return totalVests;
}

function vestsToHP(vests, fundHive, shares) {
  return (vests * fundHive) / shares;
}

async function sendPayout(to, amount) {
  const phDate = new Date().toLocaleDateString('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const memo = `Thank you for your delegation to @${HIVE_USER} — ${phDate}`;
  return new Promise((resolve, reject) => {
    hive.broadcast.transfer(ACTIVE_KEY, HIVE_USER, to, `${amount.toFixed(3)} HIVE`, memo, (err, result) => {
      if (err) return reject(err);
      console.log(`✅ Sent ${amount.toFixed(3)} HIVE to @${to}`);
      resolve(result);
    });
  });
}

function logPayout(dateStr, totalHive) {
  const line = `${dateStr} - ✅ Payout done: ${totalHive.toFixed(6)} HIVE\n`;
  require('fs').appendFileSync(PAYOUT_LOG_FILE, line);
}

function getEligibleDelegationDays(callback) {
  const today = new Date();
  today.setHours(8, 0, 0, 0);
  const cutoff = new Date(today.getTime() - 7 * 86400000);
  const yesterday = new Date(today.getTime() - 86400000);
  const cutoffStr = cutoff.toISOString();
  const targetStr = yesterday.toISOString().substring(0, 10);

  db.all(`SELECT delegator, start_time, end_time FROM delegation_periods WHERE datetime(start_time) <= ?`, [cutoffStr], (err, rows) => {
    if (err) return callback(err);
    const result = {};
    rows.forEach(({ delegator, start_time, end_time }) => {
      const start = new Date(start_time);
      const end = end_time ? new Date(end_time) : yesterday;
      if (start <= cutoff && end >= yesterday) {
        if (!result[delegator]) result[delegator] = 0;
        result[delegator] += 1;
      }
    });
    callback(null, targetStr, result);
  });
}

async function distributeRewards() {
  console.log(`🚀 Calculating rewards for @${HIVE_USER}...`);
  await pickWorkingNode();
  await storeDelegationHistory();

  const props = await getDynamicProps();
  const totalVests = await getCurationRewards();
  const totalCurationHive = vestsToHP(totalVests, parseFloat(props.total_vesting_fund_hive), parseFloat(props.total_vesting_shares));

  console.log(`📊 Total curation rewards in last 24h: ~${totalCurationHive.toFixed(6)} HIVE`);
  if (totalCurationHive < 0.000001) return console.log('⚠️ Nothing to distribute.');

  const retained = totalCurationHive * 0.05;
  const distributable = totalCurationHive * 0.95;

  getEligibleDelegationDays(async (err, dateStr, eligibleMap) => {
    if (err) return console.error(err);
    const delegators = Object.entries(eligibleMap);
    const totalDays = delegators.reduce((sum, [, days]) => sum + days, 0);
    if (totalDays === 0) return console.log('⚠️ No eligible delegators.');

    for (const [delegator, days] of delegators) {
      const share = days / totalDays;
      const amount = distributable * share;

      db.get(`SELECT 1 FROM rewarded_days WHERE delegator = ? AND reward_date = ?`, [delegator, dateStr], async (err, row) => {
        if (!row) {
          if (amount >= MIN_PAYOUT) {
            await sendPayout(delegator, amount);
            db.run(`INSERT INTO rewarded_days (delegator, reward_date) VALUES (?, ?)`, [delegator, dateStr]);
          } else {
            console.log(`📦 Skipping @${delegator}: amount too low (${amount.toFixed(6)} HIVE)`);
          }
        }
      });
    }

    logPayout(dateStr, totalCurationHive);
    console.log(`🏁 Done. 95% distributed, 5% retained (~${retained.toFixed(6)} HIVE).`);
  });
}

distributeRewards().catch(console.error);
