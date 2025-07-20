const fs = require("fs");
const path = require("path");
const hive = require("@hiveio/hive-js");
require("dotenv").config();

const HIVE_USER = process.env.HIVE_USER;
const FILE_PATH = path.join(__dirname, "delegation_history.json");

function fetchIncomingDelegations(account) {
  return new Promise((resolve, reject) => {
    hive.api.getVestingDelegations(account, '', 100, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

(async () => {
  let history = {};
  if (fs.existsSync(FILE_PATH)) {
    history = JSON.parse(fs.readFileSync(FILE_PATH, "utf8"));
  }

  const delegations = await fetchIncomingDelegations(HIVE_USER);
  const now = new Date().toISOString();

  for (const d of delegations) {
    const delegator = d.delegator;
    const vesting_shares = d.vesting_shares;

    if (!history[delegator]) {
      history[delegator] = [];
    }

    const alreadyExists = history[delegator].some(
      (entry) => entry.vesting_shares === vesting_shares
    );

    if (!alreadyExists) {
      history[delegator].push({
        vesting_shares,
        timestamp: now,
      });
    }
  }

  fs.writeFileSync(FILE_PATH, JSON.stringify(history, null, 2));
  console.log("✅ delegation_history.json updated.");
})();
