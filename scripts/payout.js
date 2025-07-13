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

async function pickWorkingNode() {
  for (const url of API_NODES) {
    hive.api.setOptions({ url });
    console.log(`🌐 Trying Hive API node: ${url}`);
    const test = await new Promise((resolve) => {
      hive.api.getAccounts([HIVE_USER], (err, res) => {
        if (err || !res) return resolve(null);
        resolve(res);
      });
    });
    if (test) {
      console.log(`✅ Using Hive API: ${url}`);
      return;
    }
  }
  throw new Error('❌ No working Hive API found.');
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

async function getDelegatorsToAccount() {
  return new Promise((resolve, reject) => {
    hive.api.call('rc_api.list_vesting_delegations', {
      start: [null, HIVE_USER],
      limit: 1000,
      order: 'by_delegatee'
    }, (err, result) => {
      if (err) {
        console.error('❌ Failed to fetch incoming delegations:', err.message);
        return reject(err);
      }
      resolve(result.delegations);
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
  console.log('🚀 Looking for delegators to @' + HIVE_USER);

  await pickWorkingNode();

  const props = await getDynamicProps();
  const totalVestingShares = parseFloat(props.total_vesting_shares);
  const totalVestingFundHive = parseFloat(props.total_vesting_fund_steem);

  const delegations = await getDelegatorsToAccount();

  if (!delegations || delegations.length === 0) {
    console.log('❌ No incoming delegators found.');
    return;
  }

  console.log(`✅ Found ${delegations.length} incoming delegators.`);

  for (const d of delegations) {
    const from = d.delegator;
    const hp = vestsToHP(d.vesting_shares.amount, totalVestingFundHive, totalVestingShares);
    console.log(`🔍 Delegator @${from} has delegated ~${hp.toFixed(3)} HP`);
    await sendThankYou(from);
  }

  console.log('🏁 All thank-you payments sent. ✅');
}

thankDelegators().catch(console.error);
