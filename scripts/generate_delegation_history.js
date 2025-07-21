// scripts/generate_delegation_history.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const hive = require('@hiveio/hive-js');

const ACCOUNT = 'bayanihive';
const OUTPUT_FILE = path.join(__dirname, 'delegation_history.json');

async function getDynamicProps() {
  const props = await hive.api.getDynamicGlobalPropertiesAsync();
  const totalVestingFundHive = parseFloat(props.total_vesting_fund_hive);
  const totalVestingShares = parseFloat(props.total_vesting_shares);
  return (vests) => parseFloat(vests) * totalVestingFundHive / totalVestingShares;
}

(async () => {
  const vestsToHP = await getDynamicProps();

  let oldData = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      oldData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    } catch (e) {
      console.warn('⚠️ Failed to parse existing delegation_history.json. Treating as empty.');
    }
  }

  // Step 1: Get current delegators (live)
  let currentDelegators = new Set();
  let start = '';
  let done = false;

  console.log(`🔍 Scanning all delegations TO @${ACCOUNT}...`);

  while (!done) {
    try {
      const delegations = await hive.api.getVestingDelegationsAsync(ACCOUNT, start, 100);
      if (delegations.length === 0) break;

      for (const delegation of delegations) {
        if (delegation.delegatee === ACCOUNT) {
          currentDelegators.add(delegation.delegator);
        }
      }

      start = delegations[delegations.length - 1].delegator;
      if (delegations.length < 100) done = true;
    } catch (err) {
      console.error('❌ Failed to fetch delegations:', err.message);
      process.exit(1);
    }
  }

  // Step 2: Union of historical and current delegators
  const allDelegators = [...new Set([
    ...Object.keys(oldData),
    ...currentDelegators
  ])];

  let changed = false;

  for (const user of allDelegators) {
    try {
      const userDelegations = await hive.api.getVestingDelegationsAsync(user, '', 100);
      const entry = userDelegations.find(d => d.delegatee === ACCOUNT);
      const hp = entry ? parseFloat(vestsToHP(entry.vesting_shares).toFixed(3)) : 0;

      const previous = oldData[user] || [];
      const latest = previous[previous.length - 1];

      if (!latest || latest.amount !== hp) {
        const timestamp = new Date().toISOString();
        if (!oldData[user]) oldData[user] = [];
        oldData[user].push({ amount: hp, timestamp });
        changed = true;
        console.log(`🔁 Updated delegation from @${user}: ${hp} HP`);
      }
    } catch (err) {
      console.warn(`⚠️ Error checking delegation from @${user}: ${err.message}`);
    }
  }

  if (changed) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(oldData, null, 2));
    console.log(`✅ ${OUTPUT_FILE} updated with changes.`);
  } else {
    console.log('🟡 No changes in delegations. File left untouched.');
  }
})();
