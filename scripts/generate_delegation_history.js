// scripts/generate_full_delegation_history.js
require('dotenv').config();
const fs = require('fs');
const hive = require('@hiveio/hive-js');

const ACCOUNT = process.env.HIVE_USER;
const CANDIDATORS_FILE = 'scripts/delegator_candidates.json';
const OUTPUT_FILE = 'scripts/delegation_history.json';

async function getConverter() {
  const props = await hive.api.getDynamicGlobalPropertiesAsync();
  const totalVestingFundHive = parseFloat(props.total_vesting_fund_hive);
  const totalVestingShares = parseFloat(props.total_vesting_shares);
  return v => parseFloat(v) * totalVestingFundHive / totalVestingShares;
}

(async () => {
  const vestsToHP = await getConverter();
  const candidates = JSON.parse(fs.readFileSync(CANDIDATORS_FILE));
  const result = {};
  const now = new Date().toISOString();

  for (const user of candidates) {
    try {
      const delegs = await hive.api.getVestingDelegationsAsync(user, '', 100);
      const entry = delegs.find(d => d.delegatee === ACCOUNT);
      if (entry) {
        result[user] = [{ amount: parseFloat(vestsToHP(entry.vesting_shares).toFixed(3)), timestamp: now }];
        console.log(`✅ @${user} → ${result[user][0].amount} HP`);
      }
    } catch (e) {
      console.warn(`⚠️ Could not fetch @${user}: ${e.message}`);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
  console.log(`✅ delegation_history.json now contains ${Object.keys(result).length} delegators.`);
})();
