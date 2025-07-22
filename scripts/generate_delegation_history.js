const hive = require('@hiveio/hive-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
const OUTPUT_FILE = path.join(__dirname, 'delegation_history.json');

// Convert VESTS to HP
function vestsToHP(vests, totalVestingFundHive, totalVestingShares) {
  return (vests * totalVestingFundHive) / totalVestingShares;
}

async function fetchGlobalProps() {
  return new Promise((resolve, reject) => {
    hive.api.getDynamicGlobalProperties((err, props) => {
      if (err) return reject(err);
      const totalVestingFundHive = parseFloat(props.total_vesting_fund_hive.split(' ')[0]);
      const totalVestingShares = parseFloat(props.total_vesting_shares.split(' ')[0]);
      resolve({ totalVestingFundHive, totalVestingShares });
    });
  });
}

async function fetchDelegationHistory() {
  let start = -1;
  const limit = 1000;
  const history = [];

  const { totalVestingFundHive, totalVestingShares } = await fetchGlobalProps();

  while (true) {
    const chunk = await new Promise((resolve, reject) => {
      hive.api.getAccountHistory(HIVE_USER, start, limit, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });

    if (!chunk || chunk.length === 0) break;

    history.push(...chunk);
    start = chunk[0][0] - 1;
    if (chunk.length < limit) break;
  }

  const delegations = {};

  for (const [, op] of history) {
    if (op.op[0] === 'delegate_vesting_shares') {
      const { delegator, delegatee, vesting_shares } = op.op[1];
      const timestamp = new Date(op.timestamp + 'Z').getTime();
      const vests = parseFloat(vesting_shares);

      if (delegatee === HIVE_USER) {
        const hp = vestsToHP(vests, totalVestingFundHive, totalVestingShares);
        if (!delegations[delegator]) delegations[delegator] = [];
        delegations[delegator].push({
          vests,
          hp: parseFloat(hp.toFixed(3)),
          timestamp
        });
      }
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(delegations, null, 2));
  console.log(`✅ delegation_history.json written with ${Object.keys(delegations).length} delegators.`);
}

fetchDelegationHistory().catch(console.error);
