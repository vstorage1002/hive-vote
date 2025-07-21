const fs = require("fs");
const dhive = require("@hiveio/hive-js");
require("dotenv").config();

const ACCOUNT = process.env.HIVE_USER || "bayanihive";
const HISTORY_FILE = "scripts/delegation_history.json";
const now = new Date().toISOString();

(async () => {
  try {
    const delegations = await dhive.api.getVestingDelegationsAsync(ACCOUNT, "", 1000);
    let history = {};

    if (fs.existsSync(HISTORY_FILE)) {
      try {
        history = JSON.parse(fs.readFileSync(HISTORY_FILE));
      } catch (err) {
        console.error("❌ Error reading existing file:", err.message);
      }
    }

    let changed = false;

    for (const d of delegations) {
      const delegator = d.delegator;
      const vests = parseFloat(d.vesting_shares.split(" ")[0]);
      const hp = await vestsToHP(vests);

      if (!history[delegator]) {
        history[delegator] = [];
      }

      const alreadyRecorded = history[delegator].some(entry => Math.abs(entry.amount - hp) < 0.001);

      if (!alreadyRecorded) {
        history[delegator].push({ amount: parseFloat(hp.toFixed(3)), timestamp: now });
        console.log(`➕ Delegation from @${delegator}: ${hp.toFixed(3)} HP`);
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
      console.log(`✅ delegation_history.json updated.`);
    } else {
      console.log("🟡 No new delegations found. File untouched.");
    }

  } catch (err) {
    console.error("❌ Error:", err.message || err);
    process.exit(1);
  }
})();

async function vestsToHP(vests) {
  const globals = await dhive.api.getDynamicGlobalPropertiesAsync();
  const totalVestingShares = parseFloat(globals.total_vesting_shares.split(" ")[0]);
  const totalVestingFundHive = parseFloat(globals.total_vesting_fund_hive.split(" ")[0]);
  return vests * totalVestingFundHive / totalVestingShares;
}
