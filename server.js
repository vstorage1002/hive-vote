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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
