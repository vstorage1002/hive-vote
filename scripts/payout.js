const fs = require("fs");
const path = require("path");
const { Client } = require("dhive");
require("dotenv").config();

const client = new Client("https://api.hive.blog");

const HIVE_USER = process.env.HIVE_USER;
const ACTIVE_KEY = process.env.ACTIVE_KEY;

const delegationHistoryFile = path.join(__dirname, "../delegation_history.json");
const delegationHistory = fs.existsSync(delegationHistoryFile)
  ? JSON.parse(fs.readFileSync(delegationHistoryFile))
  : {};

console.log("🧾 Current Delegation History:");
console.log(JSON.stringify(delegationHistory, null, 2));

console.log("‼️ Skipping payouts for this test run.");
process.exit(0);
