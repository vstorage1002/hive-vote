const fs = require("fs");
const dhive = require("@hiveio/hive-js");
require("dotenv").config();

const ACCOUNT = process.env.HIVE_USER || "youraccount";
const HISTORY_FILE = "scripts/delegation_history.json";
const CANDIDATES_FILE = "scripts/delegator_candidates.json";
const now = new Date().toISOString();

async function vestsToHP(vests) {
  const globals = await dhive.api.getDynamicGlobalPropertiesAsync();
  const totalVestingShares = parseFloat(globals.total_vesting_shares);
  const totalVestingFundHive = parseFloat(globals.total_vesting_fund_hive);
  return vests * totalVestingFundHive / totalVestingShares;
}

(async () => {
  try {
    console.log(`🔍 Checking delegations from known candidates TO @${ACCOUNT}...`);

    const candidates = JSON.parse(fs.readFileSync(CANDIDATES_FILE));
    const delegators = {};

    for (const delegator of candidates) {
      try {
        const delegations = await dhive.api.getVestingDelegationsAsync(delegator, 0, 100);
        for (const d of delegations) {
          if (d.delegatee === ACCOUNT) {
            const amount = parseFloat(d.vesting_shares.split(" ")[0]);
            const hp = await vestsToHP(amount);
            if (!delegators[delegator]) delegators[delegator] = [];
            delegators[delegator].push({
              amount: parseFloat(hp.toFixed(3)),
              timestamp: now
            });
          }
        }
      } catch (e) {
        console.warn(`⚠️ Skipped invalid account @${delegator}: ${e.message}`);
      }
    }

    let existing = {};
    if (fs.existsSync(HISTORY_FILE)) {
      existing = JSON.parse(fs.readFileSync(HISTORY_FILE));
    }

    let updated = false;
    for (const [name, records] of Object.entries(delegators)) {
      if (!existing[name]) {
        existing[name] = records;
        updated = true;
      } else {
        for (const record of records) {
          const duplicate = existing[name].some(r => Math.abs(r.amount - record.amount) < 0.001);
          if (!duplicate) {
            existing[name].push(record);
            updated = true;
          }
        }
      }
    }

    if (updated) {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(existing, null, 2));
      console.log("✅ delegation_history.json updated.");
    } else {
      console.log("🟡 No new delegations found. File untouched.");
    }

  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
})();
