const express = require('express');
const bodyParser = require('body-parser');
const hive = require('@hiveio/hive-js');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());
app.use(express.static('.'));

// Get environment vars
const HIVE_USER = process.env.HIVE_USER;
const POSTING_KEY = process.env.POSTING_KEY;

// Log helper
const logVote = (req, author, permlink, weight) => {
  const timestamp = new Date().toISOString();
  const userAgent = req.headers['user-agent'] || 'unknown';
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  
  console.log(`[${timestamp}] ${HIVE_USER} voted on @${author}/${permlink} with ${(weight / 100).toFixed(0)}% power`);
  console.log(`↳ IP: ${ip} | User-Agent: ${userAgent}`);
};

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
    if (err) {
      console.log(`❌ Vote failed for @${author}/${permlink}: ${err.message}`);
      return res.send(`❌ Failed to vote: ${err.message}`);
    }

    // Log the vote
    logVote(req, author, permlink, voteWeight);

    res.send(`✅ Voted @${author}/${permlink} with ${(voteWeight / 100).toFixed(0)}% power.`);
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server running on port ${port}`));
