require('dotenv').config();
const fs = require('fs');
const path = require('path');
const hive = require('@hiveio/hive-js');

const ACCOUNT = process.env.HIVE_USER;
const OUTPUT_FILE = path.join(__dirname, 'delegation_history.json');

// Get Hive Power converter
async function getHPConverter() {
  const props = await hive.api.getDynamicGlobalPropertiesAsync();
  const totalVestingFundHive = parseFloat(props.total_vesting_fund_hive);
  const totalVestingShares = parseFloat(props.total_vesting_shares);
  return (vests) => parseFloat(vests) * totalVestingFundHive / totalVestingShares;
}

// Get all delegators to the account
async function getAllDelegators(delegatee) {
  let start = '';
  let delegators = [];
  let done = false;

  while (!done) {
    const chunk = await hive.api.getVestingDelegationsAsync(start, 100);
    if (!chunk || chunk.length === 0) break;

    for (const entry of chunk) {
      if (entry.delegatee === delegatee) {
        delegators.push(entry.delegator);
      }
    }

    if (chunk.length < 100) break;
    start = chunk[chunk.length - 1].delegator;
  }

  return [...new Set(delegators)];
}

(async () => {
  const vestsToHP = await getHPConverter();

  let oldData = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      oldData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    } catch (e) {
      console.warn('⚠️ Failed to parse existing delegation_history.json. Treating as empty.');
    }
  }

  const delegators = await getAllDelegators(ACCOUNT);
  console.log(`🔍 Found ${delegators.length} delegators to @${ACCOUNT}`);

  let changed = false;

  for (const user of delegators) {
    try {
      const delegations = await hive.api.getVestingDelegationsAsync(user, ACCOUNT, 100);
      const entry = delegations.find(d => d.delegatee === ACCOUNT);

      const hp = entry ? parseFloat(vestsToHP(entry.vesting_shares).toFixed(3)) : 0;

      const previous = oldData[user] || [];
      const latest = previous[previous.length - 1];

      if (!latest || latest.amount !== hp) {
        const timestamp = new Date().toISOString();
        if (!oldData[user]) oldData[user] = [];
        oldData[user].push({ amount: hp, timestamp });
        changed = true;
        console.log(`🔁 Delegation updated for @${user}: ${hp} HP`);
      }
    } catch (err) {
      console.warn(`⚠️ Error fetching delegation for @${user}: ${err.message}`);
    }
  }

  if (changed) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(oldData, null, 2));
    console.log(`✅ ${OUTPUT_FILE} updated with changes.`);
  } else {
    console.log('🟡 No changes in delegations. File left untouched.');
  }
})();
