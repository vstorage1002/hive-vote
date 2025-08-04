const hive = require('@hiveio/hive-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
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

async function fetchDelegationHistory() {
  console.log(`🚀 Fetching delegation history for @${HIVE_USER}...`);
  await pickWorkingNode();

  // Get the latest index first
  let latestIndex = await new Promise((resolve, reject) => {
    hive.api.getAccountHistory(HIVE_USER, -1, 1, (err, res) => {
      if (err) return reject(err);
      resolve(res[0][0]);
    });
  });

  console.log(`📊 Latest operation index: ${latestIndex}`);

  const { totalVestingFundHive, totalVestingShares } = await fetchGlobalProps();
  
  const rawHistory = [];
  
  // If account has fewer than 1000 operations, get them all at once
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
    // Account has 1000+ operations, use pagination with proper start/limit validation
    console.log(`📦 Account has ${latestIndex + 1} operations, using pagination...`);
    let limit = 1000;
    let start = latestIndex;
    let fetchedCount = 0;

    while (true) {
      // Ensure start >= limit-1 as required by Hive API
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
      
      // Calculate next start position
      const nextStart = history[0][0] - 1;
      if (nextStart < 0 || nextStart < limit - 1) {
        // If we can't maintain start >= limit-1, get remaining entries with smaller limit
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

  // Process delegation operations - FIXED LOGIC
  const delegationEvents = [];
  
  for (const [, op] of rawHistory) {
    if (op.op[0] === 'delegate_vesting_shares') {
      const { delegator, delegatee, vesting_shares } = op.op[1];
      const timestamp = new Date(op.timestamp + 'Z').getTime();
      const totalVests = parseFloat(vesting_shares); // This is the TOTAL delegation amount after this operation

      if (delegatee === HIVE_USER) {
        const hp = vestsToHP(totalVests, totalVestingFundHive, totalVestingShares);
        
        delegationEvents.push({
          delegator,
          totalVests, // Store total delegation amount
          hp: parseFloat(hp.toFixed(3)),
          timestamp,
          date: new Date(timestamp).toISOString().split('T')[0]
        });
      }
    }
  }

  // Sort all events by timestamp
  delegationEvents.sort((a, b) => a.timestamp - b.timestamp);

  // Group by delegator and calculate changes
  const delegationHistory = {};
  
  for (const event of delegationEvents) {
    const { delegator, totalVests, hp, timestamp, date } = event;
    
    if (!delegationHistory[delegator]) {
      delegationHistory[delegator] = [];
    }
    
    // Get the previous delegation amount for this delegator
    const previousEvents = delegationHistory[delegator];
    const previousTotal = previousEvents.length > 0 
      ? previousEvents[previousEvents.length - 1].totalVests 
      : 0;
    
    // Calculate the change (delta)
    const deltaVests = totalVests - previousTotal;
    
    // Only add if there's actually a change
    if (Math.abs(deltaVests) > 0.000001) { // Use small threshold to avoid floating point issues
      delegationHistory[delegator].push({
        vests: deltaVests, // Store the CHANGE amount
        totalVests, // Also store total for reference
        hp: parseFloat(hp.toFixed(3)),
        timestamp,
        date
      });
      
      console.log(`📝 ${delegator}: ${deltaVests > 0 ? '+' : ''}${deltaVests.toFixed(6)} VESTS (Total: ${totalVests.toFixed(6)} VESTS, ${hp} HP) on ${date}`);
    }
  }

  // Save the updated history
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(delegationHistory, null, 2));
  
  console.log(`✅ delegation_history.json updated!`);
  console.log(`👥 Total delegators: ${Object.keys(delegationHistory).length}`);
  
  // Show summary
  console.log(`\n📊 Summary by delegator:`);
  for (const [delegator, events] of Object.entries(delegationHistory)) {
    let runningTotal = 0;
    console.log(`\n  ${delegator}:`);
    for (const event of events) {
      runningTotal += event.vests;
      const hp = vestsToHP(runningTotal, totalVestingFundHive, totalVestingShares);
      console.log(`    ${event.date}: ${event.vests > 0 ? '+' : ''}${event.vests.toFixed(6)} VESTS (Running total: ${runningTotal.toFixed(6)} VESTS, ${hp.toFixed(3)} HP)`);
    }
  }
}

fetchDelegationHistory().catch(console.error);
