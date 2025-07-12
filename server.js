const express = require('express');
const bodyParser = require('body-parser');
const hive = require('@hiveio/hive-js');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());
app.use(express.static(__dirname)); // serve from current folder

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const HIVE_USER = process.env.HIVE_USER;
const POSTING_KEY = process.env.POSTING_KEY;

// Vote endpoint
app.post('/vote', (req, res) => {
  const { link, weight } = req.body;
  const match = link.match(/@([^\/]+)\/([^\/\s]+)/);
  if (!match) return res.send('Invalid Hive link.');

  const author = match[1];
  const permlink = match[2];
  const voteWeight = parseInt(weight) || 10000;

  const voteOp = ['vote', {
    voter: HIVE_USER,
    author,
    permlink,
    weight: voteWeight
  }];

  hive.broadcast.send({ operations: [voteOp], extensions: [] }, { posting: POSTING_KEY }, (err, result) => {
    if (err) return res.send(`❌ Failed to vote: ${err.message}`);
    res.send(`✅ Voted @${author}/${permlink} with ${(voteWeight / 100).toFixed(0)}% power.`);
  });
});

// Account info (voting power)
app.get('/account', (req, res) => {
  hive.api.getAccounts([HIVE_USER], (err, result) => {
    if (err || !result || result.length === 0) {
      return res.status(500).json({ error: 'Failed to fetch account.' });
    }

    const acct = result[0];
    const votingPowerPct = acct.voting_power / 100;

    res.json({
      username: HIVE_USER,
      voting_power: votingPowerPct.toFixed(2) + '%'
    });
  });
});

// 3-day vote logs
app.get('/logs', (req, res) => {
  const now = Date.now();
  const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;

  hive.api.getAccountHistory(HIVE_USER, -1, 1000, (err, history) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch logs.' });

    const logs = history
      .map(entry => entry[1])
      .filter(op => op.op[0] === 'vote' && op.op[1].voter === HIVE_USER)
      .filter(op => new Date(op.timestamp).getTime() >= threeDaysAgo)
      .map(op => ({
        author: op.op[1].author,
        permlink: op.op[1].permlink,
        weight: op.op[1].weight / 100,
        timestamp: op.timestamp,
      }));

    res.json(logs);
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server running on port ${port}`));
