const hive = require('@hiveio/hive-js');
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
const ACTIVE_KEY = process.env.ACTIVE_KEY;

async function getDynamicProps() {
  return new Promise((resolve, reject) => {
    hive.api.getDynamicGlobalProperties((err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
  });
}

function vestsToHP(vests, totalVestingFundHive, totalVestingShares) {
  return (parseFloat(vests) * parseFloat(totalVestingFundHive)) / parseFloat(totalVestingShares);
}

async function getDelegators() {
  return new Promise((resolve, reject) => {
    hive.api.getVestingDelegations(HIVE_USER, '', 1000, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

async function sendThankYou(to) {
  const amount = 0.001;
  const memo = `🙏 Thank you @${to} for delegating to @${HIVE_USER}! Here's a small token of appreciation.`;

  return new Promise((resolve, reject) => {
    hive.broadcast.transfer(
      ACTIVE_KEY,
      HIVE_USER,
      to,
      `${amount.toFixed(3)} HIVE`,
      memo,
      (err, result) => {
        if (err) {
          console.error(`❌ Failed to send to ${to}:`, err.message);
          return reject(err);
        }
        console.log(`✅ Sent 0.001 HIVE to @${to}`);
        resolve(result);
      }
    );
  });
}

async function thankDelegators() {
  console.log('🚀 Sending thank-you messages to delegators...');
  console.log(`ℹ️ Running payout as @${HIVE_USER}`);

  const props = await getDynamicProps();
  const totalVestingShares = parseFloat(props.total_vesting_shares);
  const totalVestingFundHive = parseFloat(props.total_vesting_fund_steem);

  const delegators = await getDelegators();
  console.log(`ℹ️ Found ${delegators.length} delegators.`);

  for (const d of delegators) {
    const account = d.delegator;
    const hp = vestsToHP(d.vesting_shares, totalVestingFundHive, totalVestingShares);
    console.log(`🔍 Delegator @${account} has ~${hp.toFixed(3)} HP`);

    // 🔧 Disabled HP check for testing
    // if (hp < 1) {
    //   console.log(`⏩ Skipping @${account} (less than 1 HP delegated)`);
    //   continue;
    // }

    console.log(`➡️ Sending 0.001 HIVE to @${account}`);
    await sendThankYou(account);
  }

  console.log('🏁 All thank-you payments sent. ✅');
}

thankDelegators().catch(console.error);
