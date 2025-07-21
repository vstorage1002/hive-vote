require('dotenv').config();
const fs = require('fs');
const hive = require('@hiveio/hive-js');

const OUTPUT_FILE = 'scripts/delegation_history.json';
const TARGET_ACCOUNT = process.env.HIVE_USER;
const TEST_TIMESTAMP = '2025-07-05T00:00:00Z';

if (!TARGET_ACCOUNT) {
  console.error('❌ HIVE_USER not defined in .env');
  process.exit(1);
}

async function main() {
  console.log(`🔍 Fetching all incoming delegations to @${TARGET_ACCOUNT}...`);

  const dynamicProps = await hive.api.getDynamicGlobalPropertiesAsync();
  const totalVestingFundHive = parseFloat(dynamicProps.total_vesting_fund_hive);
  const totalVestingShares = parseFloat(dynamicProps.total_vesting_shares);
  const vestsToHP = (vests) =>
    parseFloat(vests) * totalVestingFundHive / totalVestingShares;

  const history = {};
  let start = null;

  while (true) {
    const delegations = await hive.api.getVestingDelegationsAsync(TARGET_ACCOUNT, start || '', 100);
    if (delegations.length === 0) break;

    for (const delegation of delegations) {
      const from = delegation.delegator;
      const hp = vestsToHP(delegation.vesting_shares).toFixed(3);

      if (!history[from]) history[from] = [];
      history[from].push({
        amount: parseFloat(hp),
        timestamp: TEST_TIMESTAMP
      });
    }

    const last = delegations[delegations.length - 1];
    if (!last || last.delegator === start) break;
    start = last.delegator;
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(history, null, 2));
  console.log(`✅ delegation_history.json generated/updated.`);
}

main().catch((err) => {
  console.error('❌ Error occurred while fetching delegations:', err);
});
