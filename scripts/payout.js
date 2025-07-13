const hive = require('@hiveio/hive-js');
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
const ACTIVE_KEY = process.env.ACTIVE_KEY;

const API_NODES = [
  'https://api.hive.blog',
  'https://api.openhive.network',
  'https://anyx.io',
  'https://hived.privex.io',
  'https://rpc.ausbit.dev',
  'https://api.deathwing.me'
];

// Try each node until one works
async function pickWorkingNode() {
  for (const url of API_NODES) {
    hive.api.setOptions({ url });
    console.log(`🌐 Trying Hive API node: ${url}`);

    const test = await new Promise((resolve) => {
      hive.api.getVestingDelegations(HIVE_USER, '', 1, (err, res) => {
        if (err || !res) return resolve(null);
        resolve(res);
      });
    });

    if (test && test.length >= 0) {
      console.log(`✅ Using working Hive node: ${url}`);
      return;
    }
  }

  throw new Error('❌ No working Hive API node found.');
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

async function getDelegators() {
  return new Promise((resolve, reject) => {
    let all = [];
    let last = '';

    function fetchNextBatch() {
      hive.api.getVestingDelegations(HIVE_USER, last, 1000, (err, result) => {
        if (err) {
          console.error('❌ Error fetching delegators:', err.message);
          return reject(err);
        }

        if (!result || result.length === 0) {
          return resolve(all);
        }

        all = all.concat(result);
        last = result[result.length - 1].delegator;

        if (result.length === 1000) {
          fetchNextBatch();
        } else {
          resolve(all);
        }
      });
    }

    fetchNextBatch();
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

  await pickWorkingNode();

  const props = await getDynamicProps();
  const totalVestingShares = parseFloat(props.total_vesting_shares);
  const totalVestingFundHive = parseFloat(props.total_vesting_fund_steem);

  const delegators = await getDelegators();
  console.log(`ℹ️ Found ${delegators.length} delegators.`);
  console.log('🧾 Raw delegator list:');
  console.dir(delegators, { depth: null });

  for (const d of delegators) {
    const account = d.delegator;
    const hp = vestsToHP(d.vesting_shares, totalVestingFundHive, totalVestingShares);
    console.log(`🔍 Delegator @${account} has ~${hp.toFixed(3)} HP`);
    await sendThankYou(account);
  }

  console.log('🏁 All thank-you payments sent. ✅');
}

thankDelegators().catch(console.error);
