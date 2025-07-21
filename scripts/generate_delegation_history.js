require('dotenv').config();
const fs = require('fs');
const hive = require('@hiveio/hive-js');

const OUTPUT_FILE = 'scripts/delegation_history.json';
const TARGET_ACCOUNT = process.env.HIVE_USER;

async function main() {
  console.log(`🔍 Fetching all incoming delegations to @${TARGET_ACCOUNT}...`);

  const dynamicProps = await hive.api.getDynamicGlobalPropertiesAsync();
  const totalVestingFundHive = parseFloat(dynamicProps.total_vesting_fund_hive);
  const totalVestingShares = parseFloat(dynamicProps.total_vesting_shares);

  const vestsToHP = (vests) =>
    parseFloat(vests) * totalVestingFundHive / totalVestingShares;

  // Load existing history
  let history = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    history = JSON.parse(fs.readFileSync(OUTPUT_FILE));
  }

  const newHistory = { ...history };
  let start = '';
  const seen = new Set();

  while (true) {
    const delegations = await hive.api.getVestingDelegationsAsync(start, '', 100);
    if (delegations.length === 0) break;

    for (const delegation of delegations) {
      if (delegation.delegatee !== TARGET_ACCOUNT) continue;

      const from = delegation.delegator;
      if (seen.has(from)) continue; // Avoid duplicates in case of overlap
      seen.add(from);

      const hp = parseFloat(vestsToHP(delegation.vesting_shares).toFixed(3));
      const now = new Date().toISOString();

      if (!newHistory[from]) {
        newHistory[from] = [{ amount: hp, timestamp: now }];
        console.log(`➕ New delegator: ${from} → ${hp} HP`);
      } else {
        const lastAmount = newHistory[from][newHistory[from].length - 1].amount;
        if (hp > lastAmount) {
          newHistory[from].push({ amount: hp, timestamp: now });
          console.log(`🔼 Updated delegation: ${from} → ${hp} HP (was ${lastAmount})`);
        }
      }
    }

    // Prepare for next batch
    const last = delegations[delegations.length - 1];
    start = last.delegator;
    if (delegations.length < 100) break; // End if no more
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(newHistory, null, 2));
  console.log(`✅ delegation_history.json generated/updated with ${Object.keys(newHistory).length} delegators.`);
}

main().catch(console.error);
