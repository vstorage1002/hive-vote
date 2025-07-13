const hive = require('@hiveio/hive-js');
const https = require('https');
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
const ACTIVE_KEY = process.env.ACTIVE_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

hive.api.setOptions({ url: 'https://api.hive.blog' });

function sendDiscordAlert(message) {
  if (!DISCORD_WEBHOOK_URL) return;

  const data = JSON.stringify({ content: message });
  const url = new URL(DISCORD_WEBHOOK_URL);

  const options = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length,
    },
  };

  const req = https.request(options, (res) => {
    res.on('data', () => {});
  });

  req.on('error', (error) => {
    console.error('❌ Failed to send Discord alert:', error);
  });

  req.write(data);
  req.end();
}

async function claimRewards() {
  console.log(`🚀 Checking rewards for @${HIVE_USER}...`);

  hive.api.getAccounts([HIVE_USER], (err, res) => {
    if (err || !res || res.length === 0) {
      const failMsg = '❌ Failed to load account data.';
      console.error(failMsg);
      sendDiscordAlert(failMsg);
      return;
    }

    const acct = res[0];
    const hiveReward = acct.reward_hive_balance;
    const hbdReward = acct.reward_hbd_balance;
    const vestingReward = acct.reward_vesting_balance;

    const hasReward =
      hiveReward !== '0.000 HIVE' ||
      hbdReward !== '0.000 HBD' ||
      vestingReward !== '0.000000 VESTS';

    if (!hasReward) {
      const msg = '📭 No rewards to claim at this time.';
      console.log(msg);
      // Optional: sendDiscordAlert(msg);
      return;
    }

    hive.broadcast.claimRewardBalance(
      ACTIVE_KEY,
      HIVE_USER,
      hiveReward,
      hbdReward,
      vestingReward,
      (err, result) => {
        if (err) {
          const errorMsg = `❌ Failed to claim rewards: ${err.message}`;
          console.error(errorMsg);
          sendDiscordAlert(errorMsg);
        } else {
          const successMsg = `✅ @${HIVE_USER} claimed: ${hiveReward}, ${hbdReward}, ${vestingReward}`;
          console.log(successMsg);
          sendDiscordAlert(successMsg);
        }
      }
    );
  });
}

claimRewards();
