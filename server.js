const express = require('express');
const bodyParser = require('body-parser');
const hive = require('@hiveio/hive-js');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());
app.use(express.static('.'));

const HIVE_USER = process.env.HIVE_USER;
const POSTING_KEY = process.env.POSTING_KEY;

// Voting endpoint
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

// Account info endpoint
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


const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
