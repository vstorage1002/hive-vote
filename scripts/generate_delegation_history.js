const hive = require('@hiveio/hive-js');
const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
const WEBHOOK_URL = process.env.DELEGATION_WEBHOOK_URL;

const OUTPUT_FILE = path.join(__dirname, 'delegation_history.json');

const API_NODES = [
  'https://api.hive.blog',
  'https://api.openhive.network',
  'https://anyx.io',
  'https://rpc.ausbit.dev',
  'https://hived.privex.io',
];

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

function vestsToHP(vests, totalVestingFundHive, totalVestingShares) {
  return (vests * totalVestingFundHive) / totalVestingShares;
}

async function fetchGlobalProps() {
  return new Promise((resolve, reject) => {
    hive.api.getDynamicGlobalProperties((err, props) => {
      if (err) return reject(err);
      const totalVestingFundHive = parseFloat(props.total_vesting_fund_hive.split(' ')[0]);
      const totalVestingShares = parseFloat(props.total_vesting_shares.split(' ')[0]);
      resolve({ totalVestingFundHive, totalVestingShares });
    });
  });
}

function sendToWebhook(message) {
  if (!WEBHOOK_URL) return console.warn('⚠️ No Discord webhook URL configured.');

  const data = JSON.stringify({ content: message });
  const webhookUrl = new URL(WEBHOOK_URL);

  const options = {
    hostname: webhookUrl.hostname,
    path: webhookUrl.pathname + webhookUrl.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  };

  const req = https.request(options, res => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log('📤 Sent to Discord webhook!');
    } else {
      console.error(`❌ Failed to send webhook: ${res.statusCode}`);
    }
  });

  req.on('error', error => {
    console.error(`❌ Webhook error: ${error.message}`);
  });

  req.write(data);
  req.end();
}

async function fetchDelegationHistory() {
  console.log(`🚀 Fetching delegation history for @${HIVE_USER}...`);
  await pickWorkingNode();

  let latestIndex = await new Promise((resolve, reject) => {
    hive.api.getAccountHistory(HIVE_USER, -1, 1, (err, res) => {
      if (err) return reject(err);
      resolve(res[0][0]);
    });
  });

  console.log(`📊 Latest operation index: ${latestIndex}`);

  const { totalVestingFundHive, totalVestingShares } = await fetchGlobalProps();

  const rawHistory = [];

  if (latestIndex < 999) {
    console.log(`📦 Account has ${latestIndex + 1} operations, fetching all at once...`);
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
    console.log(`📦 Account has ${latestIndex + 1} operations, using pagination...`);
    let limit = 1000;
    let start = latestIndex;
    let fetchedCount = 0;

    while (true) {
      const adjustedStart = Math.max(start, limit - 1);

      console.log(`🔄 Fetching operations from index ${adjustedStart} (limit: ${limit})`);

      const history = await new Promise((resolve, reject) => {
        hive.api.getAccountHistory(HIVE_USER, adjustedStart, limit, (err, res) => {
          if (err) return reject(err);
          resolve(res);
        });
      });

      if (!history || history.length === 0) {
        console.log(`✅ No more operations found`);
        break;
      }

      rawHistory.push(...history);
      fetchedCount += history.length;
      console.log(`📈 Fetched ${history.length} operations (total: ${fetchedCount})`);

      const nextStart = history[0][0] - 1;
      if (nextStart < 0 || nextStart < limit - 1) {
        if (nextStart >= 0) {
          const remainingLimit = nextStart + 1;
          console.log(`🔄 Fetching remaining ${remainingLimit} operations...`);
          const remainingHistory = await new Promise((resolve, reject) => {
            hive.api.getAccountHistory(HIVE_USER, nextStart, remainingLimit, (err, res) => {
              if (err) return reject(err);
              resolve(res);
            });
          });
          if (remainingHistory && remainingHistory.length > 0) {
            rawHistory.push(...remainingHistory);
            fetchedCount += remainingHistory.length;
            console.log(`📈 Fetched ${remainingHistory.length} remaining operations (total: ${fetchedCount})`);
          }
        }
        break;
      }

      start = nextStart;
      if (history.length < limit) {
        console.log(`✅ Reached end of history (got ${history.length} < ${limit})`);
        break;
      }
    }
  }

  console.log(`🔍 Processing ${rawHistory.length} operations for delegation events...`);

  const delegationEvents = [];

  for (const [, op] of rawHistory) {
    if (op.op[0] === 'delegate_vesting_shares') {
      const { delegator, delegatee, vesting_shares } = op.op[1];
      const timestamp = new Date(op.timestamp + 'Z').getTime();
      const totalVests = parseFloat(vesting_shares);

      if (delegatee === HIVE_USER) {
        const hp = vestsToHP(totalVests, totalVestingFundHive, totalVestingShares);

        delegationEvents.push({
          delegator,
          totalVests,
          hp: parseFloat(hp.toFixed(3)),
          timestamp,
          date: new Date(timestamp).toISOString().split('T')[0],
        });
      }
    }
  }

  delegationEvents.sort((a, b) => a.timestamp - b.timestamp);

  const delegationHistory = {};

  for (const event of delegationEvents) {
    const { delegator, totalVests, hp, timestamp, date } = event;

    if (!delegationHistory[delegator]) {
      delegationHistory[delegator] = [];
    }

    const previousEvents = delegationHistory[delegator];
    const previousTotal = previousEvents.length > 0
      ? previousEvents[previousEvents.length - 1].totalVests
      : 0;

    const deltaVests = totalVests - previousTotal;

    if (Math.abs(deltaVests) > 0.000001) {
      delegationHistory[delegator].push({
        vests: deltaVests,
        totalVests,
        hp: parseFloat(hp.toFixed(3)),
        timestamp,
        date,
      });

      console.log(`📝 ${delegator}: ${deltaVests > 0 ? '+' : ''}${deltaVests.toFixed(6)} VESTS (Total: ${totalVests.toFixed(6)} VESTS, ${hp} HP) on ${date}`);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(delegationHistory, null, 2));
  console.log(`✅ delegation_history.json updated!`);
  console.log(`👥 Total delegators: ${Object.keys(delegationHistory).length}`);

  console.log(`\n📊 Summary by delegator:`);
  let summary = `📢 Delegation Update for @${HIVE_USER}:\n`;
  summary += `👥 Total delegators: ${Object.keys(delegationHistory).length}\n`;

  for (const [delegator, events] of Object.entries(delegationHistory)) {
    let runningTotal = 0;
    console.log(`\n  ${delegator}:`);
    for (const event of events) {
      runningTotal += event.vests;
      const hp = vestsToHP(runningTotal, totalVestingFundHive, totalVestingShares);
      console.log(`    ${event.date}: ${event.vests > 0 ? '+' : ''}${event.vests.toFixed(6)} VESTS (Running total: ${runningTotal.toFixed(6)} VESTS, ${hp.toFixed(3)} HP)`);
    }

    const latest = events[events.length - 1];
    summary += `• ${delegator}: ${latest.hp} HP (as of ${latest.date})\n`;
  }

  if (summary.length > 1900) {
    summary = summary.slice(0, 1900) + '\n...truncated';
  }

  sendToWebhook(summary);
}

fetchDelegationHistory().catch(console.error);
