const hive = require('@hiveio/hive-js');

hive.api.setOptions({ url: 'https://api.hive.blog' }); // test node

const account = 'bayanihive'; // your Hive username

hive.api.getVestingDelegations(account, '', 1000, (err, result) => {
  if (err) {
    console.error('❌ Error:', err.message);
  } else {
    console.log(`✅ Found ${result.length} delegators`);
    result.forEach(d => {
      console.log(`👤 Delegator: ${d.delegator}, Vesting Shares: ${d.vesting_shares}`);
    });
  }
});
