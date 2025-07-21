// scripts/generate_delegation_history.js
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

  const followers = await getFollowers(ACCOUNT);
  const candidates = [...new Set([...Object.keys(oldData), ...followers])];

  console.log(`🔍 Checking delegations to @${ACCOUNT} from ${candidates.length} possible accounts...`);

  let changed = false;

  for (const user of candidates) {
    try {
      const delegations = await hive.api.getVestingDelegationsAsync(user, '', 100);
      const entry = delegations.find(d => d.delegatee === ACCOUNT);

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
