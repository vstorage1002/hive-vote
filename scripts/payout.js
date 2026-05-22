// distribute_rewards.js
const hive = require('@hiveio/hive-js');
const fs = require('fs');
const https = require('https');
const path = require('path');
require('dotenv').config();

const HIVE_USER = (process.env.HIVE_USER || '').trim();
const ACTIVE_KEY = (process.env.ACTIVE_KEY || '').trim();
const DELEGATION_WEBHOOK_URL = process.env.DELEGATION_WEBHOOK_URL;

if (!HIVE_USER) {
  console.error('❌ HIVE_USER env var is missing or empty.');
  process.exit(1);
}
if (!ACTIVE_KEY) {
  console.error('❌ ACTIVE_KEY env var is missing or empty.');
  process.exit(1);
}
if (!/^5[HJK][1-9A-HJ-NP-Za-km-z]{49}$/.test(ACTIVE_KEY)) {
  console.error('❌ ACTIVE_KEY does not look like a valid Hive WIF private key (should start with 5 and be 51 chars). Check your GitHub secret for extra spaces, quotes, or newlines.');
  process.exit(1);
}

const REWARD_CACHE_FILE = path.join(__dirname, '../ui/reward_cache.json');
const PAYOUT_LOG_FILE = path.join(__dirname, '../ui/payout.log');
const DELEGATION_HISTORY_FILE = path.join(__dirname, 'delegation_history.json');
const FAILED_PAYOUTS_FILE = path.join(__dirname, '../ui/failed_payouts.json');
const PAYOUT_LEDGER_FILE = path.join(__dirname, '../ui/payout_ledger.json');

const MIN_PAYOUT = 0.001;
// Allow override from env; keep your default false if not set
const IS_DRY_RUN = (typeof process.env.IS_DRY_RUN !== 'undefined') ? (process.env.IS_DRY_RUN === 'true') : false;

let MAX_RETRIES = 5;
if (process.env.MAX_RETRIES) MAX_RETRIES = parseInt(process.env.MAX_RETRIES, 10);
const RETRY_DELAY_MS = 2000;
const API_TIMEOUT_MS = 45000;

const API_NODES = [
  'https://api.deathwing.me',
  'https://api.openhive.network',
  'https://api.hive.blog',
  'https://anyx.io',
  'https://hive.roelandp.nl',
  'https://rpc.ausbit.dev',
  'https://hived.emre.sh',
  'https://hive-api.arcange.eu',
  'https://api.c0ff33a.uk',
  'https://rpc.ecency.com',
  'https://techcoderx.com',
  'https://api.hive.blue',
  'https://rpc.mahdiyari.info',
  'https://herpc.dtools.dev',
];

let CURRENT_NODE = null;

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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Enhanced withRetry: retries on transient network errors and HTTP 5xx returned by node libraries.
 * Considers messages containing '500', '502', '503', '504', 'Internal Server Error', ECONNRESET, ETIMEDOUT, timeout, ENOTFOUND as retriable.
 */
async function withRetry(fn, operation, maxRetries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const msg = (error && error.message) ? error.message : String(error);

      // Consider these retriable
      const retriablePatterns = [
        '504', '502', '503', '500',
        'Internal Server Error',
        'timeout', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND'
      ];

      const isRetriable = retriablePatterns.some(p => msg.includes(p));

      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt || !isRetriable) {
        // Don't retry non-transient errors or if out of attempts
        throw error;
      }

      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`⚠️ ${operation} failed (attempt ${attempt}/${maxRetries}): ${msg}`);
      console.log(`🔄 Retrying in ${delay}ms...`);
      await sleep(delay);

      // rotate node on retriable errors to avoid a bad RPC node
      rotateNode();
    }
  }
}

/** Set hive.api to the next node in API_NODES and record it */
function setHiveNode(url) {
  hive.api.setOptions({
    url,
    timeout: API_TIMEOUT_MS
  });
  CURRENT_NODE = url;
  console.log(`🔁 Set Hive node to: ${url}`);
}

/** Rotate to the next node in list (used on retries) */
function rotateNode() {
  if (!CURRENT_NODE) {
    setHiveNode(API_NODES[0]);
    return;
  }
  const i = API_NODES.indexOf(CURRENT_NODE);
  const next = API_NODES[(i + 1) % API_NODES.length];
  setHiveNode(next);
}

/** Pick a working node by testing getDynamicGlobalProperties (doesn't require HIVE_USER) */
async function pickWorkingNode() {
  for (const url of API_NODES) {
    try {
      setHiveNode(url);
      console.log(`🌐 Testing Hive API node: ${url}`);

      await withRetry(() => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('API timeout')), API_TIMEOUT_MS);
        hive.api.getDynamicGlobalProperties((err, res) => {
          clearTimeout(timeout);
          if (err) return reject(err);
          if (!res) return reject(new Error('No response from node'));
          resolve(res);
        });
      }), `Testing API node ${url}`, 2);

      console.log(`✅ Using Hive API node: ${CURRENT_NODE}`);
      return;
    } catch (err) {
      console.warn(`❌ Node ${url} failed health check: ${err.message}`);
      // try next node
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

  // curation window: 8:00 AM yesterday to 7:59:59.999 AM today (Manila time, UTC+8)
  const now = new Date();
  
  // Get current Manila time hour (0-23)
  const manilaHour = (now.getUTCHours() + 8) % 24;
  
  // Set end boundary to 8 AM Manila time today
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);  // Start of today UTC midnight
  
  // 8 AM Manila = 00:00 UTC on the same calendar day in Manila
  // If current Manila time is before 8 AM, use yesterday's boundary
  if (manilaHour < 8) {
    end.setUTCDate(end.getUTCDate() - 1);
  }
  
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 1);

  const fromTime = start.getTime();
  const toTime = end.getTime();

  // Log the 24-hour window details
  console.log(`\n📅 24-Hour Curation Window (Asia/Manila timezone):`);
  console.log(`   Start: ${start.toLocaleString('en-US', { timeZone: phTz })} (${fromTime})`);
  console.log(`   End:   ${end.toLocaleString('en-US', { timeZone: phTz })} (${toTime})`);
  console.log(`   UTC:   ${start.toISOString()} to ${end.toISOString()}`);

  // Get latest index
  let latestIndex = await withRetry(
    () => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('API timeout')), API_TIMEOUT_MS);
      // request last operation
      hive.api.getAccountHistory(HIVE_USER, -1, 1, (err, res) => {
        clearTimeout(timeout);
        if (err) return reject(err);
        if (!res || res.length === 0) return reject(new Error('Empty history response'));
        // res[0] is [index, op]
        resolve(res[0][0]);
      });
    }),
    'Getting latest account history index'
  );

  let totalVests = 0;
  let curationCount = 0;

  // If latestIndex < 1000 we can fetch all at once; else paginate
  if (latestIndex < 1000) {
    const history = await withRetry(
      () => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('API timeout')), API_TIMEOUT_MS);
        hive.api.getAccountHistory(HIVE_USER, -1, latestIndex + 1, (err, res) => {
          clearTimeout(timeout);
          if (err) return reject(err);
          resolve(res || []);
        });
      }),
      'Getting account history (small)'
    );

    for (const [, op] of history) {
      const { timestamp, op: [type, data] } = op;
      const opTime = new Date(timestamp + 'Z').getTime();
      if (type === 'curation_reward' && opTime >= fromTime && opTime < toTime) {
        totalVests += parseFloat(data.reward);
        curationCount++;
      }
    }
  } else {
    // Pagination: iterate from latest backwards until older than start
    let startIndex = latestIndex;
    const limit = 1000;
    let done = false;
    let batchesFetched = 0;
    let operationsChecked = 0;

    console.log(`📚 Fetching account history: ${latestIndex + 1} total operations, paginating by ${limit}...`);

    while (!done && startIndex >= 0) {
      const fetchStart = Math.max(0, startIndex - (limit - 1));
      const fetchLimit = startIndex - fetchStart + 1;

      const historyBlock = await withRetry(
        () => new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('API timeout')), API_TIMEOUT_MS);
          hive.api.getAccountHistory(HIVE_USER, startIndex, fetchLimit, (err, res) => {
            clearTimeout(timeout);
            if (err) return reject(err);
            resolve(res || []);
          });
        }),
        `Getting account history batch starting ${startIndex}`
      );

      if (!historyBlock.length) break;

      // process from newest to oldest (reverse to iterate backwards)
      batchesFetched++;
      for (const [index, op] of historyBlock.reverse()) {
        operationsChecked++;
        const { timestamp, op: [type, data] } = op;
        const opTime = new Date(timestamp + 'Z').getTime();

        if (type === 'curation_reward' && opTime >= fromTime && opTime < toTime) {
          const rewardVests = parseFloat(data.reward);
          totalVests += rewardVests;

          // Log individual curation reward
          curationCount++;
          const rewardTime = new Date(opTime);
          const timeStr = rewardTime.toLocaleString('en-US', { timeZone: phTz });
          console.log(`   ⭐ [${curationCount}] Curation reward @ ${timeStr}: +${rewardVests.toFixed(6)} VESTS (from @${data.author})`);
        }

        if (opTime < fromTime) {
          done = true;
          break;
        }
      }

      // Progress logging every 10 batches
      if (batchesFetched % 10 === 0) {
        console.log(`  📖 Processed ${batchesFetched} batches (${operationsChecked} operations), current total: ${totalVests.toFixed(6)} VESTS`);
      }

      // Calculate next startIndex for pagination
      // fetchStart is the lowest index we just processed (already declared above)
      if (fetchStart === 0) {
        done = true; // Reached the beginning of history
      } else {
        startIndex = fetchStart - 1; // Next batch starts just before this one
      }

      if (historyBlock.length < limit) break;
    }

    console.log(`  ✅ History fetch complete: ${batchesFetched} batches, ${operationsChecked} operations checked`);
  }

  console.log(`\n💰 Curation Rewards Summary (24h window):`);
  console.log(`   Individual curation rewards found: ${curationCount}`);
  console.log(`   Total VESTS found: ${totalVests.toFixed(6)} VESTS`);

  return totalVests;
}

async function getDynamicProps() {
  return withRetry(
    () => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('API timeout')), API_TIMEOUT_MS);
      hive.api.getDynamicGlobalProperties((err, res) => {
        clearTimeout(timeout);
        if (err) return reject(err);
        resolve(res);
      });
    }),
    'Getting dynamic global properties'
  );
}

function vestsToHP(vests, totalVestingFundHive, totalVestingShares) {
  return (vests * totalVestingFundHive) / totalVestingShares;
}

async function validateActiveKeyMatchesAccount() {
  let activePublicKey;
  try {
    activePublicKey = hive.auth.wifToPublic(ACTIVE_KEY);
  } catch (error) {
    throw new Error(`ACTIVE_KEY could not be converted to a Hive public key: ${error.message || error}`);
  }

  const account = await withRetry(
    () => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('API timeout')), API_TIMEOUT_MS);
      hive.api.getAccounts([HIVE_USER], (err, res) => {
        clearTimeout(timeout);
        if (err) return reject(err);
        if (!res || !res[0]) return reject(new Error(`Hive account @${HIVE_USER} was not found`));
        resolve(res[0]);
      });
    }),
    `Validating ACTIVE_KEY for @${HIVE_USER}`
  );

  const activeKeys = ((account.active && account.active.key_auths) || []).map(([key]) => key);
  if (!activeKeys.includes(activePublicKey)) {
    throw new Error(`ACTIVE_KEY does not match @${HIVE_USER}'s active authority. Derived public key ${activePublicKey}, but active keys are: ${activeKeys.join(', ') || 'none'}. Update GitHub secret ACTIVE_KEY with the private ACTIVE key for @${HIVE_USER}.`);
  }

  console.log(`🔐 ACTIVE_KEY verified for @${HIVE_USER}`);
}

/**
 * sendPayout: wraps hive.broadcast.transfer with retry via withRetry.
 * We consider transfer errors with 5xx / transient network errors retriable.
 */
async function sendPayout(to, amount) {
  const phDate = new Date().toLocaleDateString('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const memo = `Thank you for your delegation to @${HIVE_USER} - ${phDate}`;

  if (IS_DRY_RUN) {
    console.log(`🧪 DRY-RUN: Would send ${amount.toFixed(3)} HIVE to @${to} - ${memo}`);
    return Promise.resolve();
  }

  // perform transfer with retry logic
  return withRetry(
    () => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Transfer timeout')), API_TIMEOUT_MS);

      hive.broadcast.transfer(
        ACTIVE_KEY,
        HIVE_USER,
        to,
        `${amount.toFixed(3)} HIVE`,
        memo,
        (err, result) => {
          clearTimeout(timeout);
          if (err) {
            // normalize error message; include stack if available
            const errMsg = (err && err.message) ? err.message : JSON.stringify(err);
            // attach original err for debugging
            const e = new Error(errMsg);
            e.original = err;
            return reject(e);
          }
          console.log(`✅ Sent ${amount.toFixed(3)} HIVE to @${to}`);
          resolve(result);
        }
      );
    }),
    `Transfer to @${to}`,
    5 // higher max retries for transfers
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
    error: (error && error.message) ? error.message : String(error),
    retryCount: 0
  });

  saveFailedPayouts(failedPayouts);
  console.log(`📝 Logged failed payout for @${delegator}: ${amount.toFixed(10)} HIVE`);
  sendWebhookMessage(`Failed payout logged for @${delegator}: ${amount.toFixed(10)} HIVE - ${error.message || error}`, DELEGATION_WEBHOOK_URL);
}

function loadPayoutLedger() {
  if (!fs.existsSync(PAYOUT_LEDGER_FILE)) {
    return { payouts: [], metadata: { version: '1.0', createdAt: new Date().toISOString() } };
  }
  try {
    return JSON.parse(fs.readFileSync(PAYOUT_LEDGER_FILE));
  } catch (error) {
    console.warn('⚠️ Could not parse payout ledger, starting fresh:', error.message);
    return { payouts: [], metadata: { version: '1.0', createdAt: new Date().toISOString() } };
  }
}

function savePayoutLedger(ledger) {
  // Atomic write: write to temp file then rename
  const tempFile = PAYOUT_LEDGER_FILE + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(ledger, null, 2));
  fs.renameSync(tempFile, PAYOUT_LEDGER_FILE);
}

function createPayoutLedgerEntry(delegator, amount, memo) {
  return {
    id: `${delegator}-${Date.now()}`,
    delegator,
    amount: parseFloat(amount.toFixed(10)),
    memo,
    status: 'pending',
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastAttempt: null,
    error: null,
    txId: null
  };
}

function updatePayoutLedgerStatus(ledger, entryId, status, txId = null, error = null) {
  const entry = ledger.payouts.find(p => p.id === entryId);
  if (entry) {
    entry.status = status;
    entry.lastAttempt = new Date().toISOString();
    entry.attempts += 1;
    if (txId) entry.txId = txId;
    if (error) entry.error = error;
  }
  return entry;
}

async function retryFailedPayouts() {
  const failedPayouts = loadFailedPayouts();
  const updatedFailedPayouts = {};
  const rewardCache = loadRewardCache();
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

        // Subtract from reward cache to avoid double payment in main loop
        if (rewardCache[delegator]) {
          rewardCache[delegator] = Math.max(0, parseFloat((rewardCache[delegator] - amount).toFixed(10)));
          if (rewardCache[delegator] < MIN_PAYOUT) {
            delete rewardCache[delegator];
          }
          saveRewardCache(rewardCache);
          console.log(`📦 Reduced cache for @${delegator} by ${amount.toFixed(10)} HIVE`);
        }

        const logLine = `${new Date().toISOString()} - 🔄 Retry successful: ${amount.toFixed(10)} HIVE to @${delegator} (original failure: ${timestamp})\n`;
        fs.appendFileSync(PAYOUT_LOG_FILE, logLine);
        sendWebhookMessage(`✅ Retry successful: ${amount.toFixed(10)} HIVE to @${delegator}`, DELEGATION_WEBHOOK_URL);
      } catch (error) {
        totalFailed++;
        console.error(`❌ Retry failed for @${delegator}: ${error.message}`);
        if (retryCount < MAX_RETRIES) {
          remainingFailures.push({
            ...failure,
            retryCount,
            lastRetry: new Date().toISOString()
          });
        } else {
          console.log(`🚫 Max retries reached for @${delegator}, giving up`);
          const logLine = `${new Date().toISOString()} - 🚫 Max retries reached: ${amount.toFixed(10)} HIVE to @${delegator} (original failure: ${timestamp})\n`;
          fs.appendFileSync(PAYOUT_LOG_FILE, logLine);
          sendWebhookMessage(`Max retries reached for @${delegator}: ${amount.toFixed(10)} HIVE - giving up`, DELEGATION_WEBHOOK_URL);
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

/**
 * calculateEligibleDelegation: same idea as your corrected function, ensures chronological processing.
 * cutoffTime is in ms since epoch. events are expected to have .timestamp (ms) and .vests (change)
 */
function calculateEligibleDelegation(delegationHistory, cutoffTime, totalVestingFundHive, totalVestingShares) {
  const eligibleDelegators = {};

  for (const [delegator, events] of Object.entries(delegationHistory)) {
    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

    let runningBalance = 0;
    let eligibleVests = 0;

    console.log(`\n🔍 Processing ${delegator}:`);

    for (const event of sortedEvents) {
      // event.vests is change (positive for delegation, negative for undelegation)
      const eventTime = event.timestamp;
      const beforeBalance = runningBalance;
      runningBalance += event.vests;

      const isEventEligible = eventTime <= cutoffTime;
      const eventHp = vestsToHP(Math.abs(event.vests), totalVestingFundHive, totalVestingShares);

      const eventDate = new Date(event.timestamp).toISOString().split('T')[0];
      console.log(`  📅 ${eventDate}: ${event.vests > 0 ? '+' : ''}${event.vests.toFixed(6)} VESTS (~${eventHp.toFixed(3)} HP) (Balance after: ${runningBalance.toFixed(6)}) ${isEventEligible ? '✅' : '❌'}`);

      // If this change occurred before cutoff, then the resulting balance after this change is eligible
      if (isEventEligible) {
        eligibleVests = Math.max(0, runningBalance);
      }
      // If event is after cutoff, do not include its impact in eligibleVests, but keep runningBalance updated
    }

    // currentDelegation is runningBalance after all events
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

async function recoverPendingPayouts() {
  const ledger = loadPayoutLedger();
  const pendingPayouts = ledger.payouts.filter(p => p.status === 'pending');
  
  if (pendingPayouts.length === 0) {
    return;
  }
  
  console.log(`\n🔍 Found ${pendingPayouts.length} pending payouts from previous run. Recovering...`);
  
  for (const entry of pendingPayouts) {
    console.log(`📋 Recovering: ${entry.amount.toFixed(3)} HIVE to @${entry.delegator} (created: ${entry.createdAt})`);
    
    try {
      await sendPayout(entry.delegator, entry.amount);
      updatePayoutLedgerStatus(ledger, entry.id, 'sent', null, null);
      console.log(`✅ Recovered payout to @${entry.delegator}: ${entry.amount.toFixed(3)} HIVE`);
      sendWebhookMessage(`✅ Recovered payout: ${entry.amount.toFixed(3)} HIVE to @${entry.delegator}`, DELEGATION_WEBHOOK_URL);
    } catch (error) {
      console.error(`❌ Failed to recover payout to @${entry.delegator}: ${error.message}`);
      logFailedPayout(entry.delegator, entry.amount, error);
      updatePayoutLedgerStatus(ledger, entry.id, 'failed', null, error.message);
    }
  }
  
  savePayoutLedger(ledger);
  console.log(`📊 Recovery complete. Updated ledger with results.`);
}

async function distributeRewards() {
  console.log(`🚀 Calculating rewards for @${HIVE_USER}...`);

  // Ensure we have a working node
  await pickWorkingNode();
  await validateActiveKeyMatchesAccount();

  // First, recover any pending payouts from previous run
  await recoverPendingPayouts();
  
  // Then retry any failed payouts
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
  now.setHours(8, 0, 0, 0); // 8 AM Manila — matches getCurationRewards window boundary
  const cutoff = now.getTime() - 6 * 24 * 60 * 60 * 1000; // 6 days cutoff as per your logic

  console.log(`⏰ Cutoff time (ms): ${cutoff} -> ${new Date(cutoff).toISOString()}`);
  console.log(`⏰ Current time: ${new Date().toISOString()}`);

  const eligibleDelegators = calculateEligibleDelegation(delegationHistory, cutoff, totalVestingFundHive, totalVestingShares);

  let eligibleTotalVests = 0;
  for (const v of Object.values(eligibleDelegators)) eligibleTotalVests += v;

  console.log(`\n📈 Total eligible delegation (VESTS): ${eligibleTotalVests.toFixed(6)}`);
  console.log(`📈 Total eligible delegation (HP): ${vestsToHP(eligibleTotalVests, totalVestingFundHive, totalVestingShares).toFixed(3)} HP`);

  if (eligibleTotalVests === 0) {
    console.log('⚠️ No eligible delegations found (all delegations are too recent or zero).');
    return;
  }

  const rewardCache = loadRewardCache();
  const ledger = loadPayoutLedger();
  const pendingPayouts = [];
  
  // First, calculate all payouts and save to ledger
  console.log(`\n💰 Calculating Rewards and Creating Ledger:`);
  for (const [delegator, eligibleVests] of Object.entries(eligibleDelegators)) {
    const share = eligibleVests / eligibleTotalVests;
    const todayReward = distributable * share;

    const previousUnpaid = rewardCache[delegator] || 0;
    const totalReward = parseFloat((previousUnpaid + todayReward).toFixed(10));

    if (totalReward >= MIN_PAYOUT) {
      const amountToSend = Math.floor(totalReward * 1000) / 1000; // round down to 3 decimals
      const remainder = parseFloat((totalReward - amountToSend).toFixed(10));
      
      const memo = `Curation rewards for @${delegator} - ${new Date().toLocaleDateString('en-US', { timeZone: phTz })}`;
      const entry = createPayoutLedgerEntry(delegator, amountToSend, memo);
      pendingPayouts.push({ entry, remainder, totalReward });
      
      console.log(`📝 Ledger entry for @${delegator}: ${amountToSend.toFixed(3)} HIVE (remainder: ${remainder.toFixed(10)})`);
    } else {
      rewardCache[delegator] = totalReward;
      console.log(`📦 Stored for @${delegator}: ${totalReward.toFixed(10)} HIVE`);
    }
  }
  
  // Save ledger with all pending payouts BEFORE attempting any transfers
  if (pendingPayouts.length > 0) {
    ledger.payouts.push(...pendingPayouts.map(p => p.entry));
    ledger.metadata.lastCalculatedAt = new Date().toISOString();
    savePayoutLedger(ledger);
    console.log(`\n� Saved ${pendingPayouts.length} payout entries to ledger`);
  }
  
  // Now attempt to send all payouts
  console.log(`\n💰 Executing Payouts:`);
  for (const { entry, remainder, totalReward } of pendingPayouts) {
    try {
      await sendPayout(entry.delegator, entry.amount);
      rewardCache[entry.delegator] = remainder;
      updatePayoutLedgerStatus(ledger, entry.id, 'sent', null, null);
      console.log(`📟 Sent ${entry.amount.toFixed(3)} HIVE to @${entry.delegator}, remainder kept: ${remainder.toFixed(10)} HIVE`);
      sendWebhookMessage(`✅ Sent ${entry.amount.toFixed(3)} HIVE to @${entry.delegator}`, DELEGATION_WEBHOOK_URL);
    } catch (error) {
      console.error(`❌ Failed to send payout to @${entry.delegator}: ${error.message}`);
      logFailedPayout(entry.delegator, entry.amount, error);
      updatePayoutLedgerStatus(ledger, entry.id, 'failed', null, error.message);
      // keep whole totalReward in cache to avoid losing amounts
      rewardCache[entry.delegator] = totalReward;
      console.log(`📦 Kept ${totalReward.toFixed(10)} HIVE in cache for @${entry.delegator} due to failure`);
    }
  }
  
  // Save final ledger state
  if (pendingPayouts.length > 0) {
    savePayoutLedger(ledger);
    console.log(`\n� Updated ledger with payout results`);
  }

  // Normalize cache values
  const roundedCache = {};
  for (const [k, v] of Object.entries(rewardCache)) {
    roundedCache[k] = parseFloat(v.toFixed(10));
  }

  saveRewardCache(roundedCache);
  logPayout(new Date().toISOString(), totalCurationHive);
  console.log(`🌟 Done. 95% distributed, 5% retained (~${retained.toFixed(6)} HIVE).`);
}

distributeRewards().catch(err => {
  console.error('Unhandled error in distribution:', err);
  sendWebhookMessage(`🚨 Distribution script error: ${err.message || String(err)}`, DELEGATION_WEBHOOK_URL);
  process.exit(1);
});
