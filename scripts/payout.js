const hive = require('@hiveio/hive-js');
const https = require('https');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
const ACTIVE_KEY = process.env.ACTIVE_KEY;
const WEBHOOK_URL = process.env.DELEGATION_WEBHOOK_URL;
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
  if (!url || !content?.trim()) return;
  if (content.length > 2000) content = content.substring(0, 1997) + '...';
  const data = JSON.stringify({ content });
  const { hostname, pathname, search } = new URL(url);
  const options = {
    hostname,
    path: pathname + search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };
  const req = https.request(options, res => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      console.warn(`⚠️ Webhook failed: ${res.statusCode}`);
    }
  });
  req.on('error', err => console.error('Webhook error:', err));
  req.write(data);
  req.end();
}

async function pickWorkingNode() {
  for (const url of API_NODES) {
    hive.api.setOptions({ url });
    const ok = await new Promise(resolve => {
      hive.api.getAccounts([HIVE_USER], (err, res) => {
        resolve(err || !res ? false : true);
      });
    });
    if (ok) {
      console.log(`✅ Using Hive API: ${url}`);
      return;
    }
  }
  throw new Error('❌ No working Hive API found.');
}

async function getDynamicProps() {
  return new Promise((resolve, reject) => {
    hive.api.getDynamicGlobalProperties((err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

function vestsToHP(vests, fundHive, totalShares) {
  return (vests * fundHive) / totalShares;
}

async function getCurationRewards() {
  const now = new Date();
  const today = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  today.setHours(8, 0, 0, 0);
  const fromTime = today.getTime() - 24 * 60 * 60 * 1000;

  const history = await new Promise((resolve, reject) => {
    hive.api.getAccountHistory(HIVE_USER, -1, 1000, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });

  let totalVests = 0;
  for (const [, op] of history) {
    if (op.op[0] === 'curation_reward') {
      const opTime = new Date(op.timestamp + 'Z').getTime();
      if (opTime >= fromTime && opTime < today.getTime()) {
        totalVests += parseFloat(op.op[1].reward);
      }
    }
  }
  return totalVests;
}

function getYesterdayDateStr() {
  const ph = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  ph.setHours(8, 0, 0, 0);
  const yesterday = new Date(ph.getTime() - 86400000);
  return yesterday.toISOString().slice(0, 10);
}

// ✅ FIXED + DEBUG LOGGING
function getEligibleDelegationVests(callback) {
  const today = new Date();
  today.setHours(8, 0, 0, 0);
  const cutoff = new Date(today.getTime() - 7 * 86400000);
  const rewardDate = new Date(today.getTime() - 86400000); // yesterday

  const cutoffStr = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD
  const rewardStr = rewardDate.toISOString().slice(0, 10);

  // DEBUG: Print all delegation records
  db.all(`SELECT * FROM delegation_periods`, [], (err, rows) => {
    if (err) {
      console.error('🚨 Failed to read delegation_periods:', err);
    } else {
      console.log('📋 delegation_periods content:');
      console.table(rows);
    }
  });

  // Actual query to get eligible delegators
  db.all(`
    SELECT delegator, SUM(CAST(REPLACE(vesting_shares, ' VESTS', '') AS REAL)) AS total_vests
    FROM delegation_periods
    WHERE date(start_time) <= date(?) AND (end_time IS NULL OR date(end_time) >= date(?))
    GROUP BY delegator
  `, [cutoffStr, rewardStr], (err, rows) => {
    if (err) return callback(err);
    const result = {};
    rows.forEach(r => result[r.delegator] = r.total_vests);
    callback(null, rewardStr, result);
  });
}

async function sendPayout(to, amount) {
  const phDate = new Date().toLocaleDateString('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  const memo = `Thanks for delegating to @${HIVE_USER} — ${phDate}`;
  return new Promise((resolve, reject) => {
    hive.broadcast.transfer(ACTIVE_KEY, HIVE_USER, to, `${amount.toFixed(3)} HIVE`, memo, (err, res) => {
      if (err) reject(err);
      else {
        console.log(`✅ Paid ${amount.toFixed(3)} HIVE to @${to}`);
        resolve(res);
      }
    });
  });
}

function logPayout(dateStr, total) {
  const line = `${dateStr} - ✅ Payout done: ${total.toFixed(6)} HIVE\n`;
  require('fs').appendFileSync(PAYOUT_LOG_FILE, line);
}

async function distributeRewards() {
  console.log(`🚀 Starting reward distribution for @${HIVE_USER}...`);
  await pickWorkingNode();

  const props = await getDynamicProps();
  const totalVests = await getCurationRewards();
  const totalCurationHive = vestsToHP(totalVests, parseFloat(props.total_vesting_fund_hive), parseFloat(props.total_vesting_shares));

  console.log(`📊 Total curation: ${totalCurationHive.toFixed(6)} HIVE`);
  if (totalCurationHive < 0.000001) return console.log('⚠️ Nothing to distribute.');

  const retained = totalCurationHive * 0.05;
  const distributable = totalCurationHive * 0.95;

  getEligibleDelegationVests(async (err, rewardDate, delegators) => {
    if (err) return console.error(err);
    const totalVests = Object.values(delegators).reduce((a, b) => a + b, 0);

    console.log(`📦 Found ${Object.keys(delegators).length} eligible delegators.`);

    if (totalVests <= 0) return console.log('⚠️ No eligible delegators.');

    for (const [delegator, vests] of Object.entries(delegators)) {
      const share = vests / totalVests;
      const amount = distributable * share;

      db.get(`SELECT 1 FROM rewarded_days WHERE delegator = ? AND reward_date = ?`, [delegator, rewardDate], async (err, row) => {
        if (!row) {
          if (amount >= MIN_PAYOUT) {
            await sendPayout(delegator, amount);
            db.run(`INSERT INTO rewarded_days (delegator, reward_date) VALUES (?, ?)`, [delegator, rewardDate]);
          } else {
            console.log(`📦 Skipping @${delegator}: ${amount.toFixed(6)} HIVE (below threshold)`);
          }
        }
      });
    }

    logPayout(rewardDate, totalCurationHive);
    console.log(`🏁 Done. 95% distributed, 5% retained (~${retained.toFixed(6)} HIVE).`);
  });
}

distributeRewards().catch(console.error);
