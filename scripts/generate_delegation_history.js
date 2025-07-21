require('dotenv').config();
const fs = require('fs');
const hive = require('@hiveio/hive-js');

const OUTPUT_FILE = 'scripts/delegation_history.json';
const TARGET_ACCOUNT = process.env.HIVE_USER;

async function getDynamicProps() {
  const props = await hive.api.getDynamicGlobalPropertiesAsync();
  const totalVestingFundHive = parseFloat(props.total_vesting_fund_hive);
  const totalVestingShares = parseFloat(props.total_vesting_shares);
  return (vests) => parseFloat(vests) * totalVestingFundHive / totalVestingShares;
}

async function getFollowers(account) {
  let start = '';
  let followers = [];
  let done = false;

  while (!done) {
    const chunk = await hive.api.getFollowersAsync(account, start, 'blog', 100);
    if (chunk.length === 0) break;

    followers.push(...chunk.map(f => f.follower));
    start = chunk[chunk.length - 1].follower;
    if (chunk.length < 100) done = true;
  }

  return [...new Set(followers)];
}

async function main() {
  if (!TARGET_ACCOUNT) {
    console.error('❌ HIVE_USER not defined in .env');
    process.exit(1);
  }

  const vestsToHP = await getDynamicProps();

  // 1. Load previous delegators if file exists
  let existingDelegators = [];
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const prevData = JSON.parse(fs.readFileSync(OUTPUT_FILE));
      existingDelegators = Object.keys(prevData);
    } catch (e) {
      console.warn('⚠️ Failed to load previous delegation_history.json');
    }
  }

  // 2. Load followers
  const followers = await getFollowers(TARGET_ACCOUNT);

  // 3. Combine and deduplicate
  const candidates = [...new Set([...existingDelegators, ...followers])];

  console.log(`🔍 Checking delegations to @${TARGET_ACCOUNT} from ${candidates.length} possible accounts...`);

  const history = {};

  for (const delegator of candidates) {
    try {
      const delegations = await hive.api.getVestingDelegationsAsync(delegator, '', 100);
      for (const delegation of delegations) {
        if (delegation.delegatee !== TARGET_ACCOUNT) continue;

        const hp = parseFloat(vestsToHP(delegation.vesting_shares).toFixed(3));
        if (!history[delegator]) history[delegator] = [];

        history[delegator].push({
          amount: hp,
          timestamp: new Date().toISOString()
        });
      }
    } catch (err) {
      console.warn(`⚠️ Error fetching delegations from @${delegator}: ${err.message}`);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(history, null, 2));
  console.log(`✅ ${OUTPUT_FILE} generated/updated.`);
}

main().catch(console.error);
