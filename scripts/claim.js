const hive = require('@hiveio/hive-js');
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
const ACTIVE_KEY = process.env.ACTIVE_KEY;

hive.api.setOptions({ url: 'https://api.hive.blog' });

async function claimRewards() {
  hive.api.getAccounts([HIVE_USER], (err, res) => {
    if (err || !res || res.length === 0) {
      console.error('❌ Failed to load account data');
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
      console.log('📭 No rewards to claim right now.');
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
          console.error('❌ Failed to claim rewards:', err.message);
        } else {
          console.log(`✅ Claimed rewards: ${hiveReward}, ${hbdReward}, ${vestingReward}`);
        }
      }
    );
  });
}

claimRewards();
