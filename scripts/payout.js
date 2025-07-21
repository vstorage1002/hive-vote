const hive = require('@hiveio/hive-js');
const fs = require('fs');
const https = require('https');
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
const ACTIVE_KEY = process.env.ACTIVE_KEY;
const DELEGATION_WEBHOOK_URL = process.env.DELEGATION_WEBHOOK_URL;

const REWARD_CACHE_FILE = 'ui/reward_cache.json';
const PAYOUT_LOG_FILE = 'ui/payout.log';
const CURATION_LOG_FILE = 'ui/curation_breakdown.log';  // 🔹 New
const DELEGATION_HISTORY_FILE = 'delegation_history.json';
const MIN_PAYOUT = 0.001;

const API_NODES = [
  'https://api.hive.blog',
  'https://api.openhive.network',
  'https://anyx.io',
  'https://rpc.ausbit.dev',
  'https://hived.privex.io',
];

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

function loadDelegationHistory() {
  if (!fs.existsSync(DELEGATION_HISTORY_FILE)) fs.writeFileSync(DELEGATION_HISTORY_FILE, '[]');
  return JSON.parse(fs.readFileSync(DELEGATION_HISTORY_FILE));
}

function saveDelegationHistory(data) {
  fs.writeFileSync(DELEGATION_HISTORY_FILE, JSON.stringify(data, null, 2));
}

async function fetchFullDelegationHistory() {
  let start = -1;
  const limit = 1000;
  const rawHistory = [];

  while (true) {
    const history = await new Promise((resolve, reject) => {
      hive.api.getAccountHistory(HIVE_USER, start, limit, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });

    if (!history || history.length === 0) break;
    rawHistory.push(...history);
    start = history[0][0] - 1;
    if (history.length < limit) break;
  }

  const delegations = [];
  for (const [, op] of rawHistory) {
    if (op.op[0] === 'delegate_vesting_shares') {
      const { delegator, delegatee, vesting_shares } = op.op[1];
      const timestamp = new Date(op.timestamp + 'Z').getTime();

      if (delegatee === HIVE_USER) {
        delegations.push({
          delegator,
          vests: parseFloat(vesting_shares),
          timestamp
        });
      }
    }
  }

  const result = {};
  for (const d of delegations) {
    if (!result[d.delegator]) result[d.delegator] = [];
    result[d.delegator].push({ vests: d.vests, timestamp: d.timestamp });
  }

  for (const user in result) {
    const chunks = result[user];
    const filtered = [];
    for (let i = 0; i < chunks.length; i++) {
      const prev = i === 0 ? 0 : chunks[i - 1].vests;
      const diff = chunks[i].vests - prev;
      if (diff !== 0) {
        filtered.push({ vests: diff, timestamp: chunks[i].timestamp });
      }
    }
    result[user] = filtered;
  }

  saveDelegationHistory(result);
  return result;
}

// 🔹 Updated to return detailed rewards
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

  const rewards = [];
  for (const [, op] of history) {
    if (op.op[0] === 'curation_reward') {
      const { reward, comment_author, comment_permlink } = op.op[1];
      const opTime = new Date(op.timestamp + 'Z').getTime();
      if (opTime >= fromTime && opTime < today8AM.getTime()) {
        rewards.push({
          vests: parseFloat(reward),
          author: comment_author,
          permlink: comment_permlink,
          timestamp: op.timestamp
        });
      }
    }
  }
  return rewards;
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

// ✅ We keep your payout log as-is
function logPayout(dateStr, totalHive) {
  const line = `${dateStr} - ✅ Payout done: ${totalHive.toFixed(6)} HIVE\n`;
  fs.appendFileSync(PAYOUT_LOG_FILE, line);
}

// 🔹 Updated distributeRewards to include breakup logging
async function distributeRewards() {
  console.log(`🚀 Calculating rewards for @${HIVE_USER}...`);
  await pickWorkingNode();

  const [props, delegationChunks, rewardDetails] = await Promise.all([
    getDynamicProps(),
    fetchFullDelegationHistory(),
    getCurationRewards()
  ]);

  const totalVests = rewardDetails.reduce((sum, r) => sum + r.vests, 0);
  const totalCurationHive = vestsToHP(
    totalVests,
    parseFloat(props.total_vesting_fund_hive),
    parseFloat(props.total_vesting_shares)
  );

  console.log(`📊 Total curation rewards in last 24h: ~${totalCurationHive.toFixed(6)} HIVE`);

  // 📝 Log breakdown
  let lines = [`\n🧮 ${new Date().toISOString()} — Total curation: ${totalCurationHive.toFixed(6)} HIVE`];
  for (const r of rewardDetails) {
    const earnedHive = vestsToHP(
      r.vests,
      parseFloat(props.total_vesting_fund_hive),
      parseFloat(props.total_vesting_shares)
    );
    const msg = ` - ${r.timestamp} | @${r.author}/${r.permlink} => ${earnedHive.toFixed(6)} HIVE`;
    console.log(msg);
    lines.push(msg);
  }
  fs.appendFileSync(CURATION_LOG_FILE, lines.join('\n') + '\n');

  if (totalCurationHive < 0.000001 || Object.keys(delegationChunks).length === 0) {
    console.log('⚠️ Nothing to distribute.');
    return;
  }

  const retained = totalCurationHive * 0.05;
  const distributable = totalCurationHive * 0.95;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  let eligibleTotal = 0;
  const eligibleDelegators = {};

  for (const [delegator, chunks] of Object.entries(delegationChunks)) {
    let eligibleVests = 0;
    for (const chunk of chunks) {
      if (chunk.timestamp <= cutoff && chunk.vests > 0) {
        eligibleVests += chunk.vests;
      }
    }
    if (eligibleVests > 0) {
      eligibleDelegators[delegator] = eligibleVests;
      eligibleTotal += eligibleVests;
    }
  }

  const rewardCache = loadRewardCache();

  for (const [delegator, eligibleVests] of Object.entries(eligibleDelegators)) {
    const share = eligibleVests / eligibleTotal;
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
  console.log(`🏁 Done. 95% distributed, 5% retained (~${(totalCurationHive*0.05).toFixed(6)} HIVE).`);
}

distributeRewards().catch(console.error);
