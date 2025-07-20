const fs = require("fs");
const path = require("path");
const { Client } = require("@hiveio/dhive");

require("dotenv").config();
const client = new Client("https://api.hive.blog");

const HIVE_USER = process.env.HIVE_USER;
const OUT_FILE = path.join(__dirname, "../delegation_history.json");

async function generateDelegationHistory() {
  console.log(`🔍 Fetching current delegations to @${HIVE_USER}...`);

  const delegations = await client.database.call("get_vesting_delegations", [
    HIVE_USER,
    "", // start from
    100, // limit
  ]);

  if (!delegations.length) {
    console.log("❌ No active delegations found.");
    return;
  }

  const history = {};
  const today = new Date().toISOString().split("T")[0];

  delegations.forEach((d) => {
    const delegator = d.delegator;
    const vestingShares = parseFloat(d.vesting_shares.split(" ")[0]);

    if (!history[delegator]) {
      history[delegator] = [];
    }

    history[delegator].push({
      amount: vestingShares,
      start_date: today,
    });
  });

  fs.writeFileSync(OUT_FILE, JSON.stringify(history, null, 2));
  console.log(`✅ delegation_history.json created with ${delegations.length} delegator(s).`);
}

generateDelegationHistory().catch(console.error);
