const hive = require('@hiveio/hive-js');
const fs = require('fs');
const https = require('https');
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
const ACTIVE_KEY = process.env.ACTIVE_KEY;
const DELEGATION_WEBHOOK_URL = process.env.DELEGATION_WEBHOOK_URL;

const REWARD_CACHE_FILE = 'ui/reward_cache.json';
const PAYOUT_LOG_FILE = 'ui/payout.log';
const DELEGATION_HISTORY_FILE = 'delegation_history.json';
const MIN_PAYOUT = 0.001;
const IS_DRY_RUN = true;

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
  let latestIndex = await new Promise((resolve, reject) => {
    hive.api.getAccountHistory(HIVE_USER, -1, 1, (err, res) => {
      if (err) return reject(err);
      resolve(res[0][0]);
    });
  });
  
  const rawHistory = [];
  
  // If account has fewer than 1000 operations, get them all at once
  if (latestIndex < 999) {
    const history = await new Promise((resolve, reject) => {
      hive.api.getAccountHistory(HIVE_USER, -1, latestIndex + 1, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
    if (history && history.length > 0) {
      rawHistory.push(...history);
    }
  } else {
    // Account has 1000+ operations, use pagination with proper start/limit validation
    let limit = 1000;
    let start = latestIndex;

    while (true) {
      // Ensure start >= limit-1 as required by Hive API
      const adjustedStart = Math.max(start, limit - 1);
      
      const history = await new Promise((resolve, reject) => {
        hive.api.getAccountHistory(HIVE_USER, adjustedStart, limit, (err, res) => {
          if (err) return reject(err);
          resolve(res);
        });
      });

      if (!history || history.length === 0) break;
      rawHistory.push(...history);
      
      // Calculate next start position
      const nextStart = history[0][0] - 1;
      if (nextStart < 0 || nextStart < limit - 1) {
        // If we can't maintain start >= limit-1, get remaining entries with smaller limit
        if (nextStart >= 0) {
          const remainingLimit = nextStart + 1;
          const remainingHistory = await new Promise((resolve, reject) => {
            hive.api.getAccountHistory(HIVE_USER, nextStart, remainingLimit, (err, res) => {
              if (err) return reject(err);
              resolve(res);
            });
          });
          if (remainingHistory && remainingHistory.length > 0) {
            rawHistory.push(...remainingHistory);
          }
        }
        break;
      }
      
      start = nextStart;
      if (history.length < limit) break;
    }
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

async function getCurationRewards() {
  const phTz = 'Asia/Manila';
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: phTz }));

  const end = new Date(now);
  end.setHours(8, 0, 0, 0);

  const start = new Date(end);
  start.setDate(start.getDate() - 1);

  const fromTime = start.getTime();
  const toTime = end.getTime();

  let latestIndex = await new Promise((resolve, reject) => {
    hive.api.getAccountHistory(HIVE_USER, -1, 1, (err, res) => {
      if (err) return reject(err);
      resolve(res[0][0]);
    });
  });

  let totalVests = 0;
  
  // If account has fewer than 1000 operations, get them all at once
  if (latestIndex < 999) {
    const history = await new Promise((resolve, reject) => {
      hive.api.getAccountHistory(HIVE_USER, -1, latestIndex + 1, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
    
    if (history && history.length > 0) {
      for (const [index, op] of history) {
        const { timestamp, op: [type, data] } = op;
        const opTime = new Date(timestamp + 'Z').getTime();

        if (type === 'curation_reward' && opTime >= fromTime && opTime < toTime) {
          totalVests += parseFloat(data.reward);
        }
      }
    }
  } else {
    // Account has 1000+ operations, use pagination with proper start/limit validation
    let limit = 1000;
    let startIndex = latestIndex;
    let done = false;

    while (!done) {
      // Ensure startIndex >= limit-1 as required by Hive API
      const adjustedStart = Math.max(startIndex, limit - 1);
      
      const history = await new Promise((resolve, reject) => {
        hive.api.getAccountHistory(HIVE_USER, adjustedStart, limit, (err, res) => {
          if (err) return reject(err);
          resolve(res);
        });
      });

      if (!history || history.length === 0) break;

      for (const [index, op] of history.reverse()) {
        const { timestamp, op: [type, data] } = op;
        const opTime = new Date(timestamp + 'Z').getTime();

        if (type === 'curation_reward' && opTime >= fromTime && opTime < toTime) {
          totalVests += parseFloat(data.reward);
        }

        if (opTime < fromTime) {
          done = true;
          break;
        }

        const nextIndex = index - 1;
        if (nextIndex < 0 || nextIndex < limit - 1) {
          // If we can't maintain start >= limit-1, get remaining entries with smaller limit
          if (nextIndex >= 0) {
            const remainingLimit = nextIndex + 1;
            const remainingHistory = await new Promise((resolve, reject) => {
              hive.api.getAccountHistory(HIVE_USER, nextIndex, remainingLimit, (err, res) => {
                if (err) return reject(err);
                resolve(res);
              });
            });
            if (remainingHistory && remainingHistory.length > 0) {
              for (const [rIndex, rOp] of remainingHistory.reverse()) {
                const { timestamp: rTimestamp, op: [rType, rData] } = rOp;
                const rOpTime = new Date(rTimestamp + 'Z').getTime();

                if (rType === 'curation_reward' && rOpTime >= fromTime && rOpTime < toTime) {
                  totalVests += parseFloat(rData.reward);
                }

                if (rOpTime < fromTime) {
                  done = true;
                  break;
                }
              }
            }
          }
          done = true;
          break;
        }
        
        startIndex = nextIndex;
      }

      if (history.length < limit) break;
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

  if (IS_DRY_RUN) {
    console.log(`🧪 DRY-RUN: Would send ${amount.toFixed(3)} HIVE to @${to} — ${memo}`);
    return Promise.resolve();
  }

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

function logPayout(dateStr, totalHive) {
  const line = `${dateStr} - ✅ Payout done: ${totalHive.toFixed(6)} HIVE\n`;
  fs.appendFileSync(PAYOUT_LOG_FILE, line);
}

// FIXED FUNCTION: Calculate eligible delegation amounts properly
function calculateEligibleDelegation(delegationHistory, cutoffTime) {
  const eligibleDelegators = {};
  
  for (const [delegator, chunks] of Object.entries(delegationHistory)) {
    // Sort chunks by timestamp to process them chronologically
    const sortedChunks = [...chunks].sort((a, b) => a.timestamp - b.timestamp);
    
    let eligibleVests = 0;
    let runningBalance = 0;
    
    console.log(`\n🔍 Processing ${delegator}:`);
    
    // Process each delegation chunk chronologically
    for (let i = 0; i < sortedChunks.length; i++) {
      const chunk = sortedChunks[i];
      const prevBalance = runningBalance;
      runningBalance += chunk.vests;
      
      const chunkDate = new Date(chunk.timestamp).toISOString().split('T')[0];
      const isEligible = chunk.timestamp <= cutoffTime;
      
      console.log(`  📅 ${chunkDate}: ${chunk.vests > 0 ? '+' : ''}${chunk.vests.toFixed(6)} VESTS (Balance: ${runningBalance.toFixed(6)}) ${isEligible ? '✅ Eligible' : '❌ Too recent'}`);
      
      if (isEligible) {
        // This delegation change is eligible (happened 6+ days ago)
        // The eligible amount is the delegation balance after this operation
        eligibleVests = Math.max(0, runningBalance);
      }
      // If not eligible, we don't update eligibleVests but continue tracking runningBalance
    }
    
    // Ensure eligible amount doesn't exceed current delegation
    const currentDelegation = Math.max(0, runningBalance);
    eligibleVests = Math.min(eligibleVests, currentDelegation);
    
    if (eligibleVests > 0) {
      eligibleDelegators[delegator] = eligibleVests;
      console.log(`  ✅ Final eligible: ${eligibleVests.toFixed(6)} VESTS (Current: ${currentDelegation.toFixed(6)} VESTS)`);
    } else {
      console.log(`  ❌ No eligible delegation (either too recent or fully withdrawn)`);
    }
  }
  
  return eligibleDelegators;
}

async function distributeRewards() {
  console.log(`🚀 Calculating rewards for @${HIVE_USER}...`);
  await pickWorkingNode();

  const [props, delegationChunks, totalVests] = await Promise.all([
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

  if (totalCurationHive < 0.000001 || Object.keys(delegationChunks).length === 0) {
    console.log('⚠️ Nothing to distribute.');
    return;
  }

  const retained = totalCurationHive * 0.05;
  const distributable = totalCurationHive * 0.95;

  const phTz = 'Asia/Manila';
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: phTz }));
  now.setHours(0, 0, 0, 0);
  const cutoff = now.getTime() - 6 * 24 * 60 * 60 * 1000;

  console.log(`⏰ Cutoff time: ${new Date(cutoff).toISOString()}`);
  console.log(`⏰ Current time: ${new Date().toISOString()}`);

  // Use the fixed calculation function
  const eligibleDelegators = calculateEligibleDelegation(delegationChunks, cutoff);

  let eligibleTotal = 0;
  for (const vests of Object.values(eligibleDelegators)) {
    eligibleTotal += vests;
  }

  console.log(`\n📈 Total eligible delegation: ${vestsToHP(eligibleTotal, totalVestingFundHive, totalVestingShares).toFixed(3)} HP`);

  if (eligibleTotal === 0) {
    console.log('⚠️ No eligible delegations found (all delegations are less than 6 days old).');
    return;
  }

  const rewardCache = loadRewardCache();

  console.log(`\n💰 Reward Distribution:`);
  for (const [delegator, eligibleVests] of Object.entries(eligibleDelegators)) {
    const share = eligibleVests / eligibleTotal;
    const todayReward = distributable * share;

    const previousUnpaid = rewardCache[delegator] || 0;
    const totalReward = parseFloat((previousUnpaid + todayReward).toFixed(10));

    if (totalReward >= MIN_PAYOUT) {
      const amountToSend = Math.floor(totalReward * 1000) / 1000;
      const remainder = parseFloat((totalReward - amountToSend).toFixed(10));

      await sendPayout(delegator, amountToSend);
      rewardCache[delegator] = remainder;

      console.log(`📟 Sent ${amountToSend.toFixed(3)} HIVE to @${delegator}, remainder kept: ${remainder.toFixed(10)} HIVE`);
    } else {
      rewardCache[delegator] = totalReward;
      console.log(`📦 Stored for @${delegator}: ${totalReward.toFixed(10)} HIVE`);
    }
  }

  const roundedCache = {};
  for (const [k, v] of Object.entries(rewardCache)) {
    roundedCache[k] = parseFloat(v.toFixed(10));
  }

  saveRewardCache(roundedCache);
  logPayout(new Date().toISOString(), totalCurationHive);
  console.log(`🌟 Done. 95% distributed, 5% retained (~${retained.toFixed(6)} HIVE).`);
}

distributeRewards().catch(console.error);
