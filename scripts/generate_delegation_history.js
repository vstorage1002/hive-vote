require('dotenv').config();
const fs = require('fs');
const hive = require('@hiveio/hive-js');

const OUTPUT_FILE = 'scripts/delegation_history.json';
const TARGET_ACCOUNT = process.env.HIVE_USER;
const TEST_TIMESTAMP = '2025-07-05T00:00:00Z';

async function main() {
  console.log(`🔍 Fetching delegations to @${TARGET_ACCOUNT}...`);

  const dynamicProps = await hive.api.getDynamicGlobalPropertiesAsync();
  const totalVestingFundHive = parseFloat(dynamicProps.total_vesting_fund_hive);
  const totalVestingShares = parseFloat(dynamicProps.total_vesting_shares);
  const vestsToHP = (vests) =>
    parseFloat(vests) * totalVestingFundHive / totalVestingShares;

  const delegations = await hive.api.getVestingDelegationsAsync(TARGET_ACCOUNT, '', 1000);
  const history = {};

  for (const delegation of delegations) {
    const from = delegation.delegator;
    const hp = vestsToHP(delegation.vesting_shares).toFixed(3);
    if (!history[from]) history[from] = [];
    history[from].push({
      amount: parseFloat(hp),
      timestamp: TEST_TIMESTAMP
    });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(history, null, 2));
  console.log(`✅ delegation_history.json generated.`);
}

main().catch(console.error);
