const express = require('express');
const fs = require('fs');
const { exec } = require('child_process');
const app = express();
const PORT = 3000;

app.use(express.static('../ui')); // serve HTML
app.use('/logs', express.static('./logs'));

app.get('/last-payout', (req, res) => {
  const path = './logs/payout.log';
  if (!fs.existsSync(path)) return res.json({ last: null });

  const lines = fs.readFileSync(path, 'utf-8').trim().split('\n');
  const last = lines[lines.length - 1]?.split(' - ')[0];
  res.json({ last });
});

app.get('/reward-cache', (req, res) => {
  const path = './logs/reward_cache.json';
  if (!fs.existsSync(path)) return res.json({});
  res.json(JSON.parse(fs.readFileSync(path)));
});

app.post('/run-payout', (req, res) => {
  exec('node ../scripts/payout.js', (err, stdout, stderr) => {
    if (err) return res.status(500).send('❌ Error running payout.js');
    res.send('✅ Payout completed manually.');
  });
});

app.listen(PORT, () => {
  console.log(`🖥️ Dashboard running at http://localhost:${PORT}`);
});
