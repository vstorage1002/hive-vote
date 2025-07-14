app.get('/status', async (req, res) => {
  try {
    const hive = require('@hiveio/hive-js');
    await new Promise((resolve) => hive.api.setOptions({ url: 'https://api.hive.blog' }));

    const HIVE_USER = process.env.HIVE_USER;

    const props = await new Promise((resolve, reject) => {
      hive.api.getDynamicGlobalProperties((err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });

    const totalVestingShares = parseFloat(props.total_vesting_shares);
    const totalVestingFundHive = parseFloat(props.total_vesting_fund_hive);

    const vestsToHP = (vests) => (vests * totalVestingFundHive) / totalVestingShares;

    // Get recent curation rewards
    const history = await new Promise((resolve, reject) => {
      hive.api.getAccountHistory(HIVE_USER, -1, 1000, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });

    const now = new Date();
    const today8AM = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    today8AM.setHours(8, 0, 0, 0);
    const fromTime = today8AM.getTime() - 24 * 3600 * 1000;

    let totalCurationVests = 0;
    for (const [, op] of history) {
      if (op.op[0] === 'curation_reward') {
        const ts = new Date(op.timestamp + 'Z').getTime();
        if (ts >= fromTime && ts < today8AM.getTime()) {
          totalCurationVests += parseFloat(op.op[1].reward);
        }
      }
    }

    // Delegators (simulate snapshot)
    const delegationSnapshot = require(path.join(LOGS_PATH, 'delegation_snapshot.json'));
    const delegators = {};
    for (const [user, vests] of Object.entries(delegationSnapshot)) {
      delegators[user] = vestsToHP(vests);
    }

    res.json({
      curation_total: (totalCurationVests * totalVestingFundHive) / totalVestingShares,
      delegators
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch status.' });
  }
});
