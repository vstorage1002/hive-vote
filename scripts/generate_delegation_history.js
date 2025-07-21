// scripts/generate_delegation_history.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const hive = require('@hiveio/hive-js');

const ACCOUNT = process.env.HIVE_USER;
const OUTPUT_FILE = path.join(__dirname, 'delegation_history.json');

const CANDIDATES = [
  'gretelarmfeg', 'anlizapasaje1234', 'honeyjean24', 'jeanieviv84',
  'diosarich', 'vinzie1', 'antonette', 'celestyne15',
  'desyah07', 'katiekate86', 'wanderelle'
];

async function getDelegationFrom(delegator) {
  return new Promise((resolve) => {
    hive.api.getVestingDelegations(delegator, ACCOUNT, 100, (err, result) => {
      if (err || !Array.isArray(result)) {
        resolve(null);
      } else {
        const entry = result.find(d => d.delegatee === ACCOUNT);
        resolve(entry ? parseFloat(entry.vesting_shares) / 1e6 : 0); // approx. HP
      }
    });
  });
}

(async () => {
  console.log(`🔍 Checking delegations to @${ACCOUNT} from ${CANDIDATES.length} possible accounts...`);

  let oldData = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      oldData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    } catch (e) {
      console.warn('⚠️ Failed to parse existing delegation_history.json. Treating as empty.');
    }
  }

  const newData = {};

  for (const user of CANDIDATES) {
    const amount = await getDelegationFrom(user);
    if (amount > 0) {
      const roundedAmount = parseFloat(amount.toFixed(3));
      const previous = oldData[user]?.[0];

      // Preserve old timestamp if amount hasn't changed
      const timestamp = (previous && previous.amount === roundedAmount)
        ? previous.timestamp
        : new Date().toISOString();

      newData[user] = [{
        amount: roundedAmount,
        timestamp: timestamp
      }];
    }
  }

  const changed = JSON.stringify(oldData) !== JSON.stringify(newData);
  if (changed) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(newData, null, 2));
    console.log('✅ delegation_history.json updated.');
  } else {
    console.log('🟡 No changes to delegation_history.json. File left untouched.');
  }
})();
