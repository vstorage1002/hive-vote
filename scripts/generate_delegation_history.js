require('dotenv').config();
const fs = require('fs');
const hive = require('@hiveio/hive-js');

const OUTPUT_FILE = 'scripts/delegation_history.json';
const TARGET_ACCOUNT = process.env.HIVE_USER;

if (!TARGET_ACCOUNT) {
  console.error('❌ Missing HIVE_USER environment variable. Please set it in GitHub Secrets or .env file.');
  process.exit(1);
}

async function main() {
  console.log(`🔍 Fetching delegations to @${TARGET_ACCOUNT}...`);

  const dynamicProps = await hive.api.getDynamicGlobalPropertiesAsync();
  const totalVestingFundHive = parseFloat(dynamicProps.total_vesting_fund_hive);
  const totalVestingShares = parseFloat(dynamicProps.total_vesting_shares);
  const vestsToHP = (vests) =>
    parseFloat(vests) * totalVestingFundHive / totalVestingShares;

  // Load existing history if it exists
  let history = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(OUTPUT_FILE));
    } catch (e) {
      console.warn('⚠️ Failed to parse existing history. Starting fresh.');
      history = {};
    }
  }

  const delegations = await hive.api.getVestingDelegationsAsync(TARGET_ACCOUNT, '', 1000);
  const now = new Date().toISOString();

  for (const delegation of delegations) {
    const from = delegation.delegator;
    const hp = vestsToHP(delegation.vesting_shares).toFixed(3);
    if (!history[from]) history[from] = [];

    const alreadyLogged = history[from].some(entry => parseFloat(entry.amount) === parseFloat(hp));
    if (!alreadyLogged) {
      history[from].push({
        amount: parseFloat(hp),
        timestamp: now
      });
      console.log(`➕ Logged delegation from ${from}: ${hp} HP`);
    } else {
      console.log(`✅ Already logged delegation from ${from}: ${hp} HP`);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(history, null, 2));
  console.log(`✅ delegation_history.json generated/updated.`);
}

main().catch(console.error);
