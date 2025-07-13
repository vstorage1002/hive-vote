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

async function getCurationRewardsToday() {
  return new Promise((resolve, reject) => {
    hive.api.getAccountHistory(HIVE_USER, -1, 1000, (err, history) => {
      if (err) return reject(err);

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const totalVests = history
        .map(op => op[1])
        .filter(op => op.op[0] === 'curation_reward')
        .filter(op => new Date(op.timestamp).getTime() >= today.getTime())
        .reduce((sum, op) => sum + parseFloat(op.op[1].reward), 0);

      resolve(totalVests);
    });
  });
}

async function getDelegators() {
  return new Promise((resolve, reject) => {
    hive.api.getVestingDelegations(HIVE_USER, '', 1000, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

async function sendPayout(to, amount, memo = 'Daily curation payout') {
  return new Promise((resolve, reject) => {
    hive.broadcast.transfer(
      ACTIVE_KEY,
      HIVE_USER,
      to,
      `${amount.toFixed(3)} HIVE`,
      memo,
      (err, result) => {
        if (err) {
          console.error(`❌ Failed to send ${amount.toFixed(3)} HIVE to ${to}:`, err.message);
          return reject(err);
        }
        console.log(`✅ Sent ${amount.toFixed(3)} HIVE to ${to}`);
        resolve(result);
      }
    );
  });
}

async function distributeRewards() {
  console.log('🚀 Starting curation reward distribution...');

  const [props, totalVests, delegators] = await Promise.all([
    getDynamicProps(),
    getCurationRewardsToday(),
    getDelegators()
  ]);

  const totalVestingShares = parseFloat(props.total_vesting_shares);
  const totalVestingFundHive = parseFloat(props.total_vesting_fund_steem);

  const totalHiveRewards = vestsToHP(totalVests, totalVestingFundHive, totalVestingShares);
  const reward95 = totalHiveRewards * 0.95;

  if (totalHiveRewards === 0) {
    console.log('⚠️ No curation rewards today.');
    return;
  }

  console.log(`📊 Total earned: ${totalHiveRewards.toFixed(3)} HIVE`);
  console.log(`📤 Distributing 95% = ${reward95.toFixed(3)} HIVE`);

  const delegatorHPs = delegators.map(d => ({
    account: d.delegatee,
    hp: vestsToHP(d.vesting_shares, totalVestingFundHive, totalVestingShares)
  }));

  const totalDelegatedHP = delegatorHPs.reduce((sum, d) => sum + d.hp, 0);

  for (const delegator of delegatorHPs) {
    const share = delegator.hp / totalDelegatedHP;
    const payout = reward95 * share;

    if (payout < 0.001) {
      console.log(`⏩ Skipped ${delegator.account} (below threshold)`);
      continue;
    }

    await sendPayout(delegator.account, payout);
  }

  console.log('🏁 Distribution complete. ✅');
}

distributeRewards().catch(console.error);
