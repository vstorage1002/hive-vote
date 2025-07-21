const fs = require("fs");
const dhive = require("@hiveio/hive-js");
require("dotenv").config();

const ACCOUNT = process.env.HIVE_USER || "bayanihive";
const HISTORY_FILE = "scripts/delegation_history.json";
const now = new Date().toISOString();

(async () => {
  try {
    console.log(`🔍 Scanning all delegations TO @${ACCOUNT}...`);

    // Get list of all accounts (or optimize with a known list)
    let accountsList = await dhive.api.lookupAccountsAsync("", 1000);
    let allDelegators = [];

    for (let i = 0; i < accountsList.length; i += 100) {
      const chunk = accountsList.slice(i, i + 100);
      const accounts = await dhive.api.getAccountsAsync(chunk);

      for (const acc of accounts) {
        const vesting = acc.delegated_vesting_shares;
        const hasDelegated = acc.vesting_delegations?.some(d => d.delegatee === ACCOUNT);

        if (vesting && parseFloat(vesting.split(" ")[0]) > 0 && hasDelegated) {
          allDelegators.push(acc);
        }
      }
    }

    let history = {};
    if (fs.existsSync(HISTORY_FILE)) {
      try {
        history = JSON.parse(fs.readFileSync(HISTORY_FILE));
      } catch (err) {
        console.error("❌ Error reading existing file:", err.message);
      }
    }

    let changed = false;

    for (const acc of allDelegators) {
      const vests = parseFloat(acc.delegated_vesting_shares.split(" ")[0]);
      const hp = await vestsToHP(vests);

      if (!history[acc.name]) {
        history[acc.name] = [];
      }

      const alreadyRecorded = history[acc.name].some(entry => Math.abs(entry.amount - hp) < 0.001);

      if (!alreadyRecorded) {
        history[acc.name].push({ amount: parseFloat(hp.toFixed(3)), timestamp: now });
        console.log(`➕ Delegation from @${acc.name}: ${hp.toFixed(3)} HP`);
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
