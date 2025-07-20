const fs = require("fs");
const path = require("path");
require("dotenv").config();

const HIVE_USER = process.env.HIVE_USER;
const delegationHistoryFile = path.join(__dirname, "delegation_history.json");

let delegationHistory = {};
if (fs.existsSync(delegationHistoryFile)) {
  delegationHistory = JSON.parse(fs.readFileSync(delegationHistoryFile, "utf-8"));
} else {
  console.warn("⚠️ No delegation_history.json found.");
}

console.log(`👤 Testing as @${HIVE_USER}`);
console.log("🧾 Current Delegation History:");
console.log(JSON.stringify(delegationHistory, null, 2));

console.log("‼️ Skipping payouts for this test run.");
process.exit(0);
