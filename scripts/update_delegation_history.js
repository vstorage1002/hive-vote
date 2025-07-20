const fs = require("fs");
const path = require("path");
const dhive = require("@hiveio/dhive");
require("dotenv").config();

const client = new dhive.Client(["https://api.hive.blog"]);
const HIVE_USER = process.env.HIVE_USER;
const FILE_PATH = path.join(__dirname, "script/delegation_history.json");

async function fetchDelegations(account) {
  let delegations = [];
  let start = "";
  do {
    const result = await client.database.call("get_vesting_delegations", [account, start, 100]);
    delegations = delegations.concat(result);
    if (result.length > 0) {
      start = result[result.length - 1].delegatee;
    } else {
      break;
    }
  } while (true);
  return delegations;
}

(async () => {
  let history = {};
  if (fs.existsSync(FILE_PATH)) {
    history = JSON.parse(fs.readFileSync(FILE_PATH, "utf8"));
  }

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
  console.log("✅ delegation_history.json updated.");
})();
