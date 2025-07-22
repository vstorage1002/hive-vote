require('dotenv').config();
const fs = require('fs');
const dhive = require('@hiveio/dhive');

const HISTORY_FILE = 'delegation_history.json';
const DELEGATOR_CANDIDATES_FILE = 'delegator_candidates.json';
const client = new dhive.Client(process.env.HIVE_API || 'https://api.hive.blog');

const account = process.env.HIVE_USER;

async function main() {
  console.log(`🔍 Checking delegations TO @${account}...`);

  // Load existing history or initialize empty
  let existing = {};
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(HISTORY_FILE));
    } catch (e) {
      console.warn("⚠️ Failed to read delegation_history.json, initializing empty.");
      existing = {};
    }
  }

  const candidates = JSON.parse(fs.readFileSync(DELEGATOR_CANDIDATES_FILE));
  const now = Date.now();
  let updated = false;
  let count = 0;

  for (const delegator of candidates) {
    try {
      const [vestingDelegations] = await client.call('database_api', 'find_vesting_delegations', {
        account: delegator,
        start: account,
        limit: 1
      });

      const delegation = vestingDelegations.delegations?.[0];
      const isDelegatingToUs = delegation && delegation.delegatee === account;

      if (isDelegatingToUs) {
        if (!existing[delegator]) {
          existing[delegator] = [
            { start_timestamp: now }
          ];
          updated = true;
          console.log(`✅ New delegation from @${delegator} recorded.`);
        } else {
          // Already tracked
          // You can optionally check if amount changed and record new entry
        }
        count++;
      }
    } catch (err) {
      console.warn(`⚠️ Error checking @${delegator}: ${err.message}`);
    }
  }

  // Write even if nothing changed but file was empty
  if (updated || Object.keys(existing).length === 0) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(existing, null, 2));
    console.log(`✅ delegation_history.json written/updated with ${count} delegators.`);
  } else {
    console.log("🟡 No new delegations found. File untouched.");
  }
}

main().catch(console.error);
