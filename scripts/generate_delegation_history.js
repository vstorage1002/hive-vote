// scripts/generate_full_delegation_history.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const hive = require('@hiveio/hive-js');

const ACCOUNT = process.env.HIVE_USER;
const OUTPUT_FILE = path.join(__dirname, 'delegation_history.json');

async function getDynamicProps() {
  const props = await hive.api.getDynamicGlobalPropertiesAsync();
  const totalVestingFundHive = parseFloat(props.total_vesting_fund_hive);
  const totalVestingShares = parseFloat(props.total_vesting_shares);
  return (vests) => parseFloat(vests) * totalVestingFundHive / totalVestingShares;
}

(async () => {
  const vestsToHP = await getDynamicProps();
  const delegators = new Set();
  let start = '';
  let done = false;

  console.log(`🔍 Scanning all delegations TO @${ACCOUNT}...`);

  while (!done) {
    try {
      const delegations = await hive.api.getVestingDelegationsAsync(start, 100);
      if (delegations.length === 0) break;

      for (const delegation of delegations) {
        if (delegation.delegatee === ACCOUNT) {
          delegators.add(delegation.delegator);
        }
        start = delegation.delegator;
      }

      if (delegations.length < 100) done = true;
    } catch (err) {
      console.error('❌ Failed to fetch delegations:', err.message);
      process.exit(1);
    }
  }

  const result = {};
  const timestamp = new Date().toISOString();

  for (const user of delegators) {
    try {
      const entries = await hive.api.getVestingDelegationsAsync(user, '', 100);
      const entry = entries.find(d => d.delegatee === ACCOUNT);
      const hp = entry ? parseFloat(vestsToHP(entry.vesting_shares).toFixed(3)) : 0;

      if (hp > 0) {
        result[user] = [{ amount: hp, timestamp }];
        console.log(`✅ ${user} → ${hp} HP`);
      }
    } catch (err) {
      console.warn(`⚠️ Skipping ${user}: ${err.message}`);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  console.log(`✅ delegation_history.json created with ${Object.keys(result).length} entries.`);
})();
