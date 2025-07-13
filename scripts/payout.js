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
      if (err) {
        return reject(err);
      }

      const delegators = new Map();

      for (let i = history.length - 1; i >= 0; i--) {
        const op = history[i][1];
        if (op.op[0] === 'delegate_vesting_shares') {
          const { delegator, delegatee, vesting_shares } = op.op[1];
          if (delegatee === HIVE_USER && vesting_shares !== '0.000000 VESTS') {
            delegators.set(delegator, vesting_shares);
          }
        }
      }

      resolve(Array.from(delegators.entries()));
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

  const delegators = await getDelegatorsFromHistory();

  if (delegators.length === 0) {
    console.log('❌ No delegators found from history.');
    return;
  }

  console.log(`✅ Found ${delegators.length} recent delegators.`);

  for (const [delegator, shares] of delegators) {
    console.log(`🔍 @${delegator} delegated ${shares}`);
    await sendThankYou(delegator);
  }

  console.log('🏁 All thank-you payments sent. ✅');
}

thankDelegators().catch(console.error);
