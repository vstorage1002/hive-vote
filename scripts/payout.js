const hive = require('@hiveio/hive-js');
hive.api.setOptions({ url: 'https://api.hive.blog' }); // ✅ Force node

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
    let all = [];
    let last = '';

    function fetchNextBatch() {
      hive.api.getVestingDelegations(HIVE_USER, last, 1000, (err, result) => {
        if (err) {
          console.error('❌ Error fetching delegators:', err.message);
          return reject(err);
        }

        if (!result || result.length === 0) {
          return resolve(all); // no more delegators
        }

        all = all.concat(result);
        last = result[result.length - 1].delegator;

        if (result.length === 1000) {
          fetchNextBatch(); // fetch next batch
        } else {
          resolve(all); // done
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

    // Optional: skip small delegations
    // if (hp < 1) continue;

    console.log(`➡️ Sending 0.001 HIVE to @${account}`);
    await sendThankYou(account);
  }

  console.log('🏁 All thank-you payments sent. ✅');
}

thankDelegators().catch(console.error);
