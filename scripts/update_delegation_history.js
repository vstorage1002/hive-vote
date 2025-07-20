const hive = require('@hiveio/hive-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
const FILE_PATH = path.join(__dirname, 'delegation_history.json');

async function fetchDelegations(account) {
  return new Promise((resolve, reject) => {
    let allDelegations = [];
    let start = '';
    const fetchNext = () => {
      hive.api.getVestingDelegations(account, start, 100, (err, result) => {
        if (err) return reject(err);
        if (!result || result.length === 0) return resolve(allDelegations);

        allDelegations = allDelegations.concat(result);
        if (result.length < 100) return resolve(allDelegations);
        start = result[result.length - 1].delegatee;
        fetchNext();
      });
    };
    fetchNext();
  });
}

(async () => {
  let history = {};
  if (fs.existsSync(FILE_PATH)) {
    history = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
  }

  try {
    const liveDelegations = await fetchDelegations(HIVE_USER);
    const now = new Date().toISOString();

    for (const d of liveDelegations) {
      const delegator = d.delegatee;
      const vesting_shares = d.vesting_shares;

      if (!history[delegator]) {
        history[delegator] = [];
      }

      const alreadyLogged = history[delegator].some(
        (entry) => entry.vesting_shares === vesting_shares
      );

      if (!alreadyLogged) {
        history[delegator].push({
          vesting_shares,
          timestamp: now,
        });
      }
    }

    fs.writeFileSync(FILE_PATH, JSON.stringify(history, null, 2));
    console.log('✅ delegation_history.json updated.');
  } catch (e) {
    console.error('❌ Error updating delegation history:', e);
  }
})();
