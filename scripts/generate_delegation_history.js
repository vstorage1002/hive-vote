const fs = require("fs");
const dhive = require("@hiveio/hive-js");
require("dotenv").config();

const ACCOUNT = process.env.HIVE_USER || "bayanihive";
const HISTORY_FILE = "scripts/delegation_history.json";
const now = new Date().toISOString();

(async () => {
  try {
    console.log(`🔍 Scanning all delegations TO @${ACCOUNT}...`);

    const result = await dhive.api.callAsync("condenser_api.get_vesting_delegations", [ACCOUNT, "", 1000]);

    if (!result || result.length === 0) {
      console.log("⚠️ No active delegations found.");
      return;
    }

    // Load existing history file or create a blank one
    let history = {};
    if (fs.existsSync(HISTORY_FILE)) {
      try {
        history = JSON.parse(fs.readFileSync(HISTORY_FILE));
      } catch (err) {
        console.error("❌ Error reading delegation_history.json:", err.message);
      }
    }

    let changed = false;

    for (const delegation of result) {
      const from = delegation.delegator;
      const amountVests = parseFloat(delegation.vesting_shares.split(" ")[0]);
      const hp = await vestsToHP(amountVests);

      if (!history[from]) {
        history[from] = [];
      }

      const existing = history[from];
      const alreadyRecorded = existing.some(entry => Math.abs(entry.amount - hp) < 0.0001);

      if (!alreadyRecorded) {
        history[from].push({ amount: parseFloat(hp.toFixed(3)), timestamp: now });
        console.log(`➕ New delegation from @${from}: ${hp.toFixed(3)} HP`);
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
      console.log(`✅ ${HISTORY_FILE} updated with ${Object.keys(history).length} delegators.`);
    } else {
      console.log("🟡 No changes in delegations. File left untouched.");
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
