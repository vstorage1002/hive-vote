const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const hive = require('@hiveio/hive-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const UI_PATH = path.join(__dirname, '../ui');
const LOGS_PATH = path.join(__dirname, '../logs');
const REWARD_CACHE_PATH = path.join(LOGS_PATH, 'reward_cache.json');
const PAYOUT_LOG_PATH = path.join(LOGS_PATH, 'payout.log');
const DELEGATION_SNAPSHOT_PATH = path.join(LOGS_PATH, 'delegation_snapshot.json');
const PAYOUT_SCRIPT = path.join(__dirname, '../scripts/payout.js');

// Ensure logs folder and files exist
if (!fs.existsSync(LOGS_PATH)) fs.mkdirSync(LOGS_PATH);
if (!fs.existsSync(REWARD_CACHE_PATH)) fs.writeFileSync(REWARD_CACHE_PATH, '{}');
if (!fs.existsSync(PAYOUT_LOG_PATH)) fs.writeFileSync(PAYOUT_LOG_PATH, '');

// Serve UI
app.use(express.static(UI_PATH));

// Serve JSON logs
app.get('/last-payout', (req, res) => {
  const lines = fs.readFileSync(PAYOUT_LOG_PATH, 'utf-8').trim().split('\n');
  const last = lines.length ? lines[lines.length - 1].split(' - ')[0] : null;
  res.json({ last });
});

app.get('/reward-cache', (req, res) => {
  res.json(JSON.parse(fs.readFileSync(REWARD_CACHE_PATH)));
});

// Trigger payout
app.post('/run-payout', (req, res) => {
  exec(`node "${PAYOUT_SCRIPT}"`, (err, stdout, stderr) => {
    if (err) {
      console.error(stderr);
      return res.status(500).send('❌ Error running payout.js');
    }
    res.send('✅ Payout completed manually.');
  });
});

// 👉 NEW /status route
app.get('/status', async (req, res) => {
  try {
    hive.api.setOptions({ url: 'https://api.hive.blog' });

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

    const delegationSnapshot = JSON.parse(fs.readFileSync(DELEGATION_SNAPSHOT_PATH));
    const delegators = {};
    for (const [user, vests] of Object.entries(delegationSnapshot)) {
      delegators[user] = parseFloat(vestsToHP(vests).toFixed(3));
    }

    res.json({
      curation_total: parseFloat(((totalCurationVests * totalVestingFundHive) / totalVestingShares).toFixed(3)),
      delegators
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch status.' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🖥️ Dashboard running at http://localhost:${PORT}`);
});
