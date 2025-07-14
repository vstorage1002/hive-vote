const hive = require('@hiveio/hive-js');
const fs = require('fs');
const https = require('https');
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
const ACTIVE_KEY = process.env.ACTIVE_KEY;
const DELEGATION_WEBHOOK_URL = process.env.DELEGATION_WEBHOOK_URL;

const REWARD_CACHE_FILE = 'ui/reward_cache.json';
const DELEGATION_SNAPSHOT_FILE = 'delegation_snapshot.json';
const PAYOUT_LOG_FILE = 'ui/payout.log';
const MIN_PAYOUT = 0.001;

const API_NODES = [
  'https://api.hive.blog',
  'https://api.openhive.network',
  'https://anyx.io',
  'https://rpc.ausbit.dev',
  'https://hived.privex.io',
];

// 🔔 Webhook utility
function sendWebhookMessage(content, url) {
  if (!url) return;

  const data = JSON.stringify({ content });
  const parsed = new URL(url);

  const options = {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
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

async function fetchFullDelegationHistory() {
  let start = -1;
  const delegations = [];
  const limit = 1000;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  while (true) {
    const history = await new Promise((resolve, reject) => {
      hive.api.getAccountHistory(HIVE_USER, start, limit, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });

    if (!history || history.length === 0) break;

    for (const [index, op] of history) {
      if (op.op[0] === 'delegate_vesting_shares') {
        const { delegator, delegatee, vesting_shares } = op.op[1];
        const timestamp = new Date(op.timestamp + 'Z').getTime();

        if (
          delegatee === HIVE_USER &&
          vesting_shares !== '0.000000 VESTS' &&
          timestamp <= sevenDaysAgo
        ) {
          delegations.push({ delegator, vests: parseFloat(vesting_shares) });
        }
      }
    }

    start = history[0][0] - 1;
    if (history.length < limit) break;
  }

  const combined = new Map();
  for (const d of delegations) {
    if (!combined.has(d.delegator)) combined.set(d.delegator, 0);
    combined.set(d.delegator, combined.get(d.delegator) + d.vests);
  }

  // Compare with previous snapshot
  const previous = loadDelegationSnapshot();
  const current = Object.fromEntries(combined);

  for (const [user, newVests] of Object.entries(current)) {
    const oldVests = previous[user] || 0;
    if (newVests !== oldVests) {
      const diff = newVests - oldVests;
      const type = diff > 0 ? 'delegated' : 'undelegated';
      sendWebhookMessage(
        `🔔 @${user} has **${type}** ${Math.abs(diff).toFixed(6)} VESTS to @${HIVE_USER}`,
        DELEGATION_WEBHOOK_URL
      );
    }
  }

  for (const user of Object.keys(previous)) {
    if (!current[user]) {
      sendWebhookMessage(
        `🔔 @${user} has **undelegated all** from @${HIVE_USER}`,
        DELEGATION_WEBHOOK_URL
      );
    }
  }

  saveDelegationSnapshot(current);
  return combined;
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

async function getDynamicProps() {
  return new Promise((resolve, reject) => {
    hive.api.getDynamicGlobalProperties((err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
  });
}

function vestsToHP(vests, totalVestingFundHive, totalVestingShares) {
  return (vests * totalVestingFundHive) / totalVestingShares;
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
    hive.broadcast.transfer(
      ACTIVE_KEY,
      HIVE_USER,
      to,
      `${amount.toFixed(3)} HIVE`,
      memo,
      (err, result) => {
        if (err) return reject(err);
        console.log(`✅ Sent ${amount.toFixed(3)} HIVE to @${to}`);
        resolve(result);
      }
    );
  });
}

function loadRewardCache() {
  if (!fs.existsSync(REWARD_CACHE_FILE)) fs.writeFileSync(REWARD_CACHE_FILE, '{}');
  return JSON.parse(fs.readFileSync(REWARD_CACHE_FILE));
}

function saveRewardCache(cache) {
  fs.writeFileSync(REWARD_CACHE_FILE, JSON.stringify(cache, null, 2));
}

function loadDelegationSnapshot() {
  if (!fs.existsSync(DELEGATION_SNAPSHOT_FILE)) return {};
  return JSON.parse(fs.readFileSync(DELEGATION_SNAPSHOT_FILE));
}

function saveDelegationSnapshot(snapshot) {
  fs.writeFileSync(DELEGATION_SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
}

function logPayout(dateStr, totalHive) {
  const line = `${dateStr} - ✅ Payout done: ${totalHive.toFixed(6)} HIVE\n`;
  fs.appendFileSync(PAYOUT_LOG_FILE, line);
}

async function distributeRewards() {
  console.log(`🚀 Calculating rewards for @${HIVE_USER}...`);
  await pickWorkingNode();

  const [props, delegators, totalVests] = await Promise.all([
    getDynamicProps(),
    fetchFullDelegationHistory(),
    getCurationRewards()
  ]);

  const totalVestingShares = parseFloat(props.total_vesting_shares);
  const totalVestingFundHive = parseFloat(props.total_vesting_fund_hive);

  const totalCurationHive = vestsToHP(
    totalVests,
    totalVestingFundHive,
    totalVestingShares
  );

  console.log(`📊 Total curation rewards in last 24h: ~${totalCurationHive.toFixed(6)} HIVE`);

  if (totalCurationHive < 0.000001 || delegators.size === 0) {
    console.log('⚠️ Nothing to distribute.');
    return;
  }

  const retained = totalCurationHive * 0.05;
  const distributable = totalCurationHive * 0.95;

  let totalDelegated = 0;
  for (const v of delegators.values()) totalDelegated += v;

  const rewardCache = loadRewardCache();

  for (const [delegator, vests] of delegators.entries()) {
    const share = vests / totalDelegated;
    const payout = distributable * share;
    rewardCache[delegator] = (rewardCache[delegator] || 0) + payout;

    if (rewardCache[delegator] >= MIN_PAYOUT) {
      await sendPayout(delegator, rewardCache[delegator]);
      rewardCache[delegator] = 0;
    } else {
      console.log(`📦 Stored for @${delegator}: ${rewardCache[delegator].toFixed(6)} HIVE`);
    }
  }

  saveRewardCache(rewardCache);

  logPayout(new Date().toISOString(), totalCurationHive);

  console.log(`🏁 Done. 95% distributed, 5% retained (~${retained.toFixed(6)} HIVE).`);
}

distributeRewards().catch(console.error);
