const fs = require("fs");
const dhive = require("@hiveio/hive-js");
require("dotenv").config();

const ACCOUNT = process.env.HIVE_USER || "bayanihive";
const HISTORY_FILE = "scripts/delegation_history.json";
const now = new Date().toISOString();

async function getDelegators(account) {
  let followers = [];
  let start = "";
  let limit = 100;
  let done = false;

  console.log(`📡 Fetching followers of @${account}...`);

  while (!done) {
    const result = await dhive.api.getFollowersAsync(account, start, "blog", limit);
    if (result.length < limit) done = true;
    if (result.length > 0) {
      start = result[result.length - 1].follower;
      followers = followers.concat(result.map(r => r.follower));
    }
  }

  return followers;
}

(async () => {
  try {
    const followers = await getDelegators(ACCOUNT);
    const chunks = [];

    // Split into chunks of 100 accounts (API limit)
    while (followers.length) {
      chunks.push(followers.splice(0, 100));
    }

    const accounts = [];
    for (const chunk of chunks) {
      const accs = await dhive.api.getAccountsAsync(chunk);
      accounts.push(...accs);
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

    for (const acc of accounts) {
      const delegatedToMe = acc.vesting_delegations?.some(d => d.delegatee === ACCOUNT);
      const vests = acc.delegated_vesting_shares;

      if (vests && parseFloat(vests.split(" ")[0]) > 0) {
        const hp = await vestsToHP(parseFloat(vests.split(" ")[0]));

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
