require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

const HIVE_USER = process.env.HIVE_USER;
const HIVE_API = process.env.HIVE_API || 'https://api.hive.blog';

const CANDIDATES_FILE = 'delegator_candidates.json';
const HISTORY_FILE = 'delegation_history.json';

// Get vesting delegations for a given account
async function getVestingDelegations(account) {
  const res = await axios.post(HIVE_API, {
    jsonrpc: '2.0',
    method: 'condenser_api.get_vesting_delegations',
    params: [account, '', 100],
    id: 1,
  });

  return res.data.result;
}

async function main() {
  console.log(`🔍 Checking delegations TO @${HIVE_USER}...`);

  // Load delegator candidates
  const candidates = JSON.parse(fs.readFileSync(CANDIDATES_FILE));
  const now = Date.now();

  // Load or initialize history
  let history = {};
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE));
    } catch (e) {
      console.warn('⚠️ Invalid JSON format in delegation_history.json. Resetting.');
      history = {};
    }
  }

  let newCount = 0;

  for (const delegator of candidates) {
    try {
      const delegations = await getVestingDelegations(delegator);
      const match = delegations.find(d => d.delegatee === HIVE_USER && parseFloat(d.vesting_shares) > 0);

      if (match) {
        if (!history[delegator]) {
          history[delegator] = [{ start_timestamp: now }];
          console.log(`✅ New delegation from @${delegator}`);
          newCount++;
        } else {
          console.log(`➡️ @${delegator} already in delegation history.`);
        }
      }
    } catch (err) {
      console.warn(`❌ Failed to check @${delegator}: ${err.message}`);
    }
  }

  if (newCount > 0 || Object.keys(history).length === 0) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    console.log(`✅ Updated delegation_history.json with ${newCount} new entries.`);
  } else {
    console.log('🟡 No new delegators found. File untouched.');
  }
}

// 🟢 Start script
main().catch(console.error);
