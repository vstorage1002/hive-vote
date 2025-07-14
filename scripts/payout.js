const hive = require('@hiveio/hive-js');
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
const ACTIVE_KEY = process.env.ACTIVE_KEY;

const API_NODES = [
  'https://api.hive.blog',
  'https://api.openhive.network',
  'https://anyx.io',
  'https://rpc.ausbit.dev',
  'https://hived.privex.io',
];

async function pickWorkingNode() {
  for (const url of API_NODES) {
    hive.api.setOptions({ url });
    console.log(`🌐 Trying Hive API node: ${url}`);
    const test = await new Promise((resolve) => {
      hive.api.getAccounts([HIVE_USER], (err, res) => {
        resolve(err || !res ? null : res);
      });
    });
    if (test) {
      console.log(`✅ Using Hive API: ${url}`);
      return;
    }
  }
  throw new Error('❌ No working Hive API found.');
}

async function getDelegatorsFromHistory() {
  return new Promise((resolve, reject) => {
    hive.api.getAccountHistory(HIVE_USER, -1, 1000, (err, history) => {
      if (err) return reject(err);

      const delegators = new Map();

      for (let i = history.length - 1; i >= 0; i--) {
        const op = history[i][1];
        if (op.op[0] === 'delegate_vesting_shares') {
          const { delegator, delegatee, vesting_shares } = op.op[1];
          if (delegatee === HIVE_USER && vesting_shares !== '0.000000 VESTS') {
            delegators.set(delegator, parseFloat(vesting_shares));
          }
        }
      }

      resolve(delegators);
    });
  });
}

async function getCurationRewards() {
  const now = new Date();
  const phTz = 'Asia/Manila';

  const today8AM = new Date(now.toLocaleString('en-US', { timeZone: phTz }));
  today8AM.setHours(8, 0, 0, 0);
  const fromTime = today8AM.getTime() - 24 * 60 * 60 * 1000; // previous day 8AM

  return new Promise((resolve, reject) => {
    hive.api.getAccountHistory(HIVE_USER, -1, 1000, (err, history) => {
      if (err) return reject(err);

      let totalHive = 0;

      for (const [, op] of history) {
        if (op.op[0] === 'curation_reward') {
          const opTime = new Date(op.timestamp + 'Z').getTime();
          if (opTime >= fromTime && opTime < today8AM.getTime()) {
            const rewardVests = parseFloat(op.op[1].reward);
            totalHive += rewardVests;
          }
        }
      }

      resolve(totalHive); // in VESTS
    });
  });
}

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

async function sendPayout(to, amount) {
  const phDate = new Date().toLocaleDateString('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const memo = `Thank you for your delegation to @${HIVE_USER} — ${phDate}`;

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
        console.log(`✅ Sent ${amount.toFixed(3)} HIVE to @${to}`);
        resolve(result);
      }
    );
  });
}

async function distributeRewards() {
  console.log(`🚀 Calculating rewards for @${HIVE_USER}...`);
  await pickWorkingNode();

  const [props, delegators, totalVests] = await Promise.all([
    getDynamicProps(),
    getDelegatorsFromHistory(),
    getCurationRewards()
  ]);

  const totalVestingShares = parseFloat(props.total_vesting_shares);
  const totalVestingFundHive = parseFloat(props.total_vesting_fund_steem);

  const totalCurationHive = vestsToHP(
    totalVests,
    totalVestingFundHive,
    totalVestingShares
  );

  console.log(`📊 Total curation rewards in last 24h: ~${totalCurationHive.toFixed(3)} HIVE`);

  if (totalCurationHive < 0.000001 || delegators.size === 0) {
    console.log('⚠️ Nothing to distribute (either 0 rewards or no delegators).');
    return;
  }

  const retained = totalCurationHive * 0.05;
  const distributable = totalCurationHive * 0.95;

  let totalDelegated = 0;
  for (const v of delegators.values()) totalDelegated += v;

  for (const [delegator, vests] of delegators.entries()) {
    const share = vests / totalDelegated;
    const payout = distributable * share;

    if (payout >= 0.000001) {
      await sendPayout(delegator, payout);
    } else {
      console.log(`⚠️ Skipping @${delegator} — reward too small (${payout.toFixed(6)} HIVE)`);
    }
  }

  console.log(`🏁 Done. 95% distributed, 5% retained (~${retained.toFixed(6)} HIVE).`);
}

distributeRewards().catch(console.error);
