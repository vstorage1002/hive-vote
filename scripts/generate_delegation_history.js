const hive = require('@hiveio/hive-js');
const fs = require('fs');
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
const OUTPUT_FILE = 'delegation_history.json';

function saveDelegationHistory(data) {
  const path = require('path');
const fs = require('fs');

const OUTPUT_FILE = path.join(__dirname, 'delegation_history.json');
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(history, null, 2));
}

async function fetchDelegationHistory() {
  let start = -1;
  const limit = 1000;
  const history = [];

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

      if (delegatee === HIVE_USER && parseFloat(vesting_shares) > 0) {
        if (!delegations[delegator]) delegations[delegator] = [];
        delegations[delegator].push({
          vests: parseFloat(vesting_shares),
          timestamp
        });
      }
    }
  }

  saveDelegationHistory(delegations);
}

fetchDelegationHistory().catch(console.error);
