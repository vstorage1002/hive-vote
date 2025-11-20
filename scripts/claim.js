const hive = require('@hiveio/hive-js');
const https = require('https');
require('dotenv').config();

// Use clear variable names
const HIVE_USER = process.env.HIVE_USER;
const POSTING_KEY = process.env.POSTING_KEY; // Posting key for claiming VESTS
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Multiple fallback nodes
const NODES = [
  'https://api.hive.blog',
  'https://anyx.io',
  'https://api.openhive.network',
  'https://rpc.ecency.com',
];
let currentNode = 0;

// Switch to next node on error
function setNextNode() {
  currentNode = (currentNode + 1) % NODES.length;
  hive.api.setOptions({ url: NODES[currentNode] });
  console.log(`🔁 Switched to backup node: ${NODES[currentNode]}`);
}

// Initialize first node
hive.api.setOptions({ url: NODES[currentNode] });

// Send Discord alert
function sendDiscordAlert(message) {
  if (!DISCORD_WEBHOOK_URL) return;

  const data = JSON.stringify({ content: String(message) });
  const url = new URL(DISCORD_WEBHOOK_URL);

  const options = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  };

  const req = https.request(options, (res) => {
    console.log(`📡 Discord webhook responded: ${res.statusCode}`);
  });

  req.on('error', (error) => {
    console.error('❌ Discord alert error:', error);
  });

  req.write(data);
  req.end();
}

// Main claim function
async function claimRewards() {
  console.log(`🚀 Checking rewards for @${HIVE_USER}...`);

  hive.api.getAccounts([HIVE_USER], async (err, res) => {
    if (err || !res || res.length === 0) {
      const msg = '❌ Failed to load account data.';
      console.error(msg, err);
      sendDiscordAlert(msg);
      setNextNode();
      return;
    }

    const acct = res[0];
    const hiveReward = acct.reward_hive_balance || '0.000 HIVE';
    const hbdReward = acct.reward_hbd_balance || '0.000 HBD';
    const vestingReward = acct.reward_vesting_balance || '0.000000 VESTS';

    const hasReward =
      hiveReward !== '0.000 HIVE' ||
      hbdReward !== '0.000 HBD' ||
      vestingReward !== '0.000000 VESTS';

    if (!hasReward) {
      const msg = '📭 No rewards to claim.';
      console.log(msg);
      sendDiscordAlert(msg);
      return;
    }

    console.log(`💰 Attempting to claim: ${hiveReward}, ${hbdReward}, ${vestingReward}`);

    // Claim using posting key for VESTS
    hive.broadcast.claimRewardBalance(
      POSTING_KEY,
      HIVE_USER,
      hiveReward,
      hbdReward,
      vestingReward,
      (err, result) => {
        if (err) {
          const msg = `❌ Claim failed: ${err.message || err}`;
          console.error(msg);
          sendDiscordAlert(msg);

          // Retry on node error
          if (
            err.message &&
            (err.message.includes('Internal Server Error') || err.message.includes('500'))
          ) {
            setNextNode();
            console.log('🔁 Retrying claim on next node...');
            setTimeout(claimRewards, 3000);
          }
        } else {
          const msg = `✅ @${HIVE_USER} claimed: ${hiveReward}, ${hbdReward}, ${vestingReward}`;
          console.log(msg);
          sendDiscordAlert(msg);
        }
      }
    );
  });
}

// Start the process
claimRewards();
