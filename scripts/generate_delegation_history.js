// scripts/generate_delegation_history.js

const fs = require('fs');
const path = require('path');
const hive = require('@hiveio/hive-js');
require('dotenv').config();

const ACCOUNT = process.env.HIVE_USER;
const HISTORY_PATH = path.join(__dirname, 'delegation_history.json');

async function fetchLiveDelegators(account) {
  return new Promise((resolve, reject) => {
    hive.api.getVestingDelegations(account, 0, 1000, (err, result) => {
      if (err) return reject(err);
      const delegators = {};
      result.forEach(entry => {
        const from = entry.delegator;
        const amount = parseFloat(entry.vesting_shares.split(' ')[0]);
        delegators[from] = amount;
      });
      resolve(delegators);
    });
  });
}

async function main() {
  console.log(`🔍 Scanning all delegations TO @${ACCOUNT}...`);

  let history = {};
  try {
    const data = fs.readFileSync(HISTORY_PATH, 'utf8');
    history = JSON.parse(data);
  } catch (err) {
    console.warn('⚠️ delegation_history.json not found or invalid, starting fresh.');
  }

  const liveDelegators = await fetchLiveDelegators(ACCOUNT);
  let updated = false;

  for (const [delegator, amount] of Object.entries(liveDelegators)) {
    const rounded = Math.round(amount * 1000) / 1000;

    if (!history[delegator]) {
      history[delegator] = [{
        amount: rounded,
        timestamp: new Date().toISOString()
      }];
      console.log(`➕ New delegator: @${delegator} with ${rounded} HP`);
      updated = true;
    } else {
      const last = history[delegator][history[delegator].length - 1];
      if (last.amount !== rounded) {
        history[delegator].push({
          amount: rounded,
          timestamp: new Date().toISOString()
        });
        console.log(`🔁 Updated delegation from @${delegator}: ${rounded} HP`);
        updated = true;
      }
    }
  }

  if (updated) {
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
    console.log(`✅ ${HISTORY_PATH} updated with changes.`);
  } else {
    console.log('✅ No changes in delegation — file not updated.');
  }
}

main().catch(err => {
  console.error('❌ Error:', err.message || err);
  process.exit(1);
});
