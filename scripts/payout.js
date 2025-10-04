const hive = require('@hiveio/hive-js');
const fs = require('fs');
const https = require('https');
const path = require('path');
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
const ACTIVE_KEY = process.env.ACTIVE_KEY;
const DELEGATION_WEBHOOK_URL = process.env.DELEGATION_WEBHOOK_URL;


const REWARD_CACHE_FILE = path.join(__dirname, '../ui/reward_cache.json');
const PAYOUT_LOG_FILE = path.join(__dirname, '../ui/payout.log');
const DELEGATION_HISTORY_FILE = path.join(__dirname, 'delegation_history.json');
const FAILED_PAYOUTS_FILE = path.join(__dirname, '../ui/failed_payouts.json');
const MIN_PAYOUT = 0.001;
const IS_DRY_RUN = false;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const API_TIMEOUT_MS = 30000;

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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, operation, maxRetries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      const isTimeoutError = error.message && (
        error.message.includes('504') || 
        error.message.includes('timeout') || 
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT')
      );
      
      if (isLastAttempt || !isTimeoutError) {
        throw error;
      }
      
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`⚠️ ${operation} failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
      console.log(`🔄 Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
}

async function pickWorkingNode() {
  for (const url of API_NODES) {
    hive.api.setOptions({ 
      url,
      timeout: API_TIMEOUT_MS
    });
    console.log(`🌐 Trying Hive API node: ${url}`);
    
    try {
      const test = await withRetry(
        () => new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('API timeout'));
          }, API_TIMEOUT_MS);
          
          hive.api.getAccounts([HIVE_USER], (err, res) => {
            clearTimeout(timeout);
            if (err) reject(err);
            else if (!res) reject(new Error('No response'));
            else resolve(res);
          });
        }),
        `Testing API node ${url}`
      );
      
      if (test) {
        console.log(`✅ Using Hive API: ${url}`);
        return;
      }
    } catch (error) {
      console.warn(`❌ API node ${url} failed: ${error.message}`);
      continue;
    }
  }
  throw new Error('❌ No working Hive API found.');
}

function loadDelegationHistory() {
  if (!fs.existsSync(DELEGATION_HISTORY_FILE)) {
    console.error(`❌ ${DELEGATION_HISTORY_FILE} not found. Please run generate_delegation_history.js first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(DELEGATION_HISTORY_FILE));
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

  let latestIndex = await withRetry(
    () => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('API timeout'));
      }, API_TIMEOUT_MS);
      
      hive.api.getAccountHistory(HIVE_USER, -1, 1, (err, res) => {
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve(res[0][0]);
      });
    }),
    'Getting latest account history index'
  );

  let totalVests = 0;
  
  // If account has fewer than 1000 operations, get them all at once
  if (latestIndex < 999) {
    const history = await withRetry(
      () => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('API timeout'));
        }, API_TIMEOUT_MS);
        
        hive.api.getAccountHistory(HIVE_USER, -1, latestIndex + 1, (err, res) => {
          clearTimeout(timeout);
          if (err) reject(err);
          else resolve(res);
        });
      }),
      'Getting account history (small account)'
    );
    
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
      
      const history = await withRetry(
        () => new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('API timeout'));
          }, API_TIMEOUT_MS);
          
          hive.api.getAccountHistory(HIVE_USER, adjustedStart, limit, (err, res) => {
            clearTimeout(timeout);
            if (err) reject(err);
            else resolve(res);
          });
        }),
        'Getting account history (pagination)'
      );

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
            const remainingHistory = await withRetry(
              () => new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                  reject(new Error('API timeout'));
                }, API_TIMEOUT_MS);
                
                hive.api.getAccountHistory(HIVE_USER, nextIndex, remainingLimit, (err, res) => {
                  clearTimeout(timeout);
                  if (err) reject(err);
                  else resolve(res);
                });
              }),
              'Getting remaining account history'
            );
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
  return withRetry(
    () => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('API timeout'));
      }, API_TIMEOUT_MS);
      
      hive.api.getDynamicGlobalProperties((err, res) => {
        clearTimeout(timeout);
        if (err) reject(err);
        else resolve(res);
      });
    }),
    'Getting dynamic global properties'
  );
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

  return withRetry(
    () => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Transfer timeout'));
      }, API_TIMEOUT_MS);
      
      hive.broadcast.transfer(
        ACTIVE_KEY,
        HIVE_USER,
        to,
        `${amount.toFixed(3)} HIVE`,
        memo,
        (err, result) => {
          clearTimeout(timeout);
          if (err) {
            reject(err);
          } else {
            console.log(`✅ Sent ${amount.toFixed(3)} HIVE to @${to}`);
            resolve(result);
          }
        }
      );
    }),
    `Transfer to @${to}`
  );
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

function loadFailedPayouts() {
  if (!fs.existsSync(FAILED_PAYOUTS_FILE)) {
    fs.writeFileSync(FAILED_PAYOUTS_FILE, '{}');
    return {};
  }
  return JSON.parse(fs.readFileSync(FAILED_PAYOUTS_FILE));
}

function saveFailedPayouts(failedPayouts) {
  fs.writeFileSync(FAILED_PAYOUTS_FILE, JSON.stringify(failedPayouts, null, 2));
}

function logFailedPayout(delegator, amount, error) {
  const failedPayouts = loadFailedPayouts();
  const timestamp = new Date().toISOString();
  
  if (!failedPayouts[delegator]) {
    failedPayouts[delegator] = [];
  }
  
  failedPayouts[delegator].push({
    timestamp,
    amount: parseFloat(amount.toFixed(10)),
    error: error.message,
    retryCount: 0
  });
  
  saveFailedPayouts(failedPayouts);
  console.log(`📝 Logged failed payout for @${delegator}: ${amount.toFixed(10)} HIVE`);
}

async function retryFailedPayouts() {
  const failedPayouts = loadFailedPayouts();
  const updatedFailedPayouts = {};
  let totalRetried = 0;
  let totalSuccessful = 0;
  let totalFailed = 0;

  console.log(`\n🔄 Retrying failed payouts...`);

  for (const [delegator, failures] of Object.entries(failedPayouts)) {
    const remainingFailures = [];

    for (const failure of failures) {
      totalRetried++;
      const { amount, timestamp } = failure;
      const retryCount = (failure.retryCount || 0) + 1;

      console.log(`🔄 Retrying failed payout to @${delegator}: ${amount.toFixed(10)} HIVE (attempt ${retryCount})`);

      try {
        await sendPayout(delegator, amount);
        totalSuccessful++;
        console.log(`✅ Successfully retried payout to @${delegator}: ${amount.toFixed(10)} HIVE`);
        
        // Log successful retry
        const logLine = `${new Date().toISOString()} - 🔄 Retry successful: ${amount.toFixed(10)} HIVE to @${delegator} (original failure: ${timestamp})\n`;
        fs.appendFileSync(PAYOUT_LOG_FILE, logLine);
      } catch (error) {
        totalFailed++;
        console.error(`❌ Retry failed for @${delegator}: ${error.message}`);
        
        if (retryCount < MAX_RETRIES) {
          // Keep for next retry
          remainingFailures.push({
            ...failure,
            retryCount,
            lastRetry: new Date().toISOString()
          });
        } else {
          // Max retries reached, give up
          console.log(`🚫 Max retries reached for @${delegator}, giving up`);
          const logLine = `${new Date().toISOString()} - 🚫 Max retries reached: ${amount.toFixed(10)} HIVE to @${delegator} (original failure: ${timestamp})\n`;
          fs.appendFileSync(PAYOUT_LOG_FILE, logLine);
        }
      }
    }

    if (remainingFailures.length > 0) {
      updatedFailedPayouts[delegator] = remainingFailures;
    }
  }

  saveFailedPayouts(updatedFailedPayouts);

  if (totalRetried > 0) {
    console.log(`\n📊 Failed payout retry summary:`);
    console.log(`   Total retried: ${totalRetried}`);
    console.log(`   Successful: ${totalSuccessful}`);
    console.log(`   Still failed: ${totalFailed}`);
    console.log(`   Remaining in queue: ${Object.keys(updatedFailedPayouts).length} delegators`);
  } else {
    console.log(`✅ No failed payouts to retry`);
  }

  return {
    totalRetried,
    totalSuccessful,
    totalFailed,
    remainingCount: Object.keys(updatedFailedPayouts).length
  };
}

// CORRECTED FUNCTION: Calculate eligible delegation amounts properly
function calculateEligibleDelegation(delegationHistory, cutoffTime, totalVestingFundHive, totalVestingShares) {
  const eligibleDelegators = {};
  
  for (const [delegator, events] of Object.entries(delegationHistory)) {
    // Sort events by timestamp to process them chronologically
    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
    
    let eligibleVests = 0;
    let runningBalance = 0;
    
    console.log(`\n🔍 Processing ${delegator}:`);
    
    // Process each delegation event chronologically
    for (const event of sortedEvents) {
      const prevBalance = runningBalance;
      runningBalance += event.vests; // event.vests is the change amount
      
      const eventDate = new Date(event.timestamp).toISOString().split('T')[0];
      const isEligible = event.timestamp <= cutoffTime;
      const hp = vestsToHP(Math.abs(event.vests), totalVestingFundHive, totalVestingShares);
      
      console.log(`  📅 ${eventDate}: ${event.vests > 0 ? '+' : ''}${event.vests.toFixed(6)} VESTS (~${hp.toFixed(3)} HP) (Balance: ${runningBalance.toFixed(6)}) ${isEligible ? '✅ Eligible' : '❌ Too recent'}`);
      
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
      const eligibleHP = vestsToHP(eligibleVests, totalVestingFundHive, totalVestingShares);
      console.log(`  ✅ Final eligible: ${eligibleVests.toFixed(6)} VESTS (~${eligibleHP.toFixed(3)} HP) out of current ${currentDelegation.toFixed(6)} VESTS`);
    } else {
      console.log(`  ❌ No eligible delegation (either too recent or fully withdrawn)`);
    }
  }
  
  return eligibleDelegators;
}

async function distributeRewards() {
  console.log(`🚀 Calculating rewards for @${HIVE_USER}...`);
  await pickWorkingNode();

  // First, retry any failed payouts from previous runs
  await retryFailedPayouts();

  const [props, delegationHistory, totalVests] = await Promise.all([
    getDynamicProps(),
    Promise.resolve(loadDelegationHistory()),
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

  if (totalCurationHive < 0.000001 || Object.keys(delegationHistory).length === 0) {
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

  // Use the corrected calculation function
  const eligibleDelegators = calculateEligibleDelegation(delegationHistory, cutoff, totalVestingFundHive, totalVestingShares);

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

      try {
        await sendPayout(delegator, amountToSend);
        rewardCache[delegator] = remainder;
        console.log(`📟 Sent ${amountToSend.toFixed(3)} HIVE to @${delegator}, remainder kept: ${remainder.toFixed(10)} HIVE`);
      } catch (error) {
        console.error(`❌ Failed to send payout to @${delegator}: ${error.message}`);
        // Log the failed payout for retry later
        logFailedPayout(delegator, amountToSend, error);
        // Keep the reward in cache for next time
        rewardCache[delegator] = totalReward;
        console.log(`📦 Kept ${totalReward.toFixed(10)} HIVE in cache for @${delegator} due to failure`);
      }
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
