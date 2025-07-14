const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const app = express();
const PORT = process.env.PORT || 3000;

// === Paths ===
const UI_PATH = path.join(__dirname, '../ui');
const LOGS_PATH = path.join(__dirname, '../logs');
const REWARD_CACHE_PATH = path.join(LOGS_PATH, 'reward_cache.json');
const PAYOUT_LOG_PATH = path.join(LOGS_PATH, 'payout.log');
const PAYOUT_SCRIPT = path.join(__dirname, '../scripts/payout.js');

// === Ensure logs/ folder and required files exist ===
if (!fs.existsSync(LOGS_PATH)) {
  fs.mkdirSync(LOGS_PATH);
  console.log('📁 Created logs/ folder');
}

if (!fs.existsSync(REWARD_CACHE_PATH)) {
  fs.writeFileSync(REWARD_CACHE_PATH, '{}');
  console.log('🆕 Created reward_cache.json');
}

if (!fs.existsSync(PAYOUT_LOG_PATH)) {
  fs.writeFileSync(PAYOUT_LOG_PATH, '');
  console.log('🆕 Created payout.log');
}

// === Serve UI ===
app.use(express.static(UI_PATH));
app.use('/logs', express.static(LOGS_PATH));

// ✅ Force index.html on root
app.get('/', (req, res) => {
  res.sendFile(path.join(UI_PATH, 'index.html'));
});

// === Routes ===
app.get('/last-payout', (req, res) => {
  try {
    const lines = fs.readFileSync(PAYOUT_LOG_PATH, 'utf-8').trim().split('\n');
    const last = lines.length ? lines[lines.length - 1].split(' - ')[0] : null;
    res.json({ last });
  } catch (e) {
    res.json({ last: null });
  }
});

app.get('/reward-cache', (req, res) => {
  try {
    const data = fs.readFileSync(REWARD_CACHE_PATH);
    res.json(JSON.parse(data));
  } catch (e) {
    res.json({});
  }
});

app.post('/run-payout', (req, res) => {
  exec(`node "${PAYOUT_SCRIPT}"`, (err, stdout, stderr) => {
    if (err) {
      console.error(stderr);
      return res.status(500).send('❌ Error running payout.js');
    }
    res.send('✅ Payout completed manually.');
  });
});

// === Start Server ===
app.listen(PORT, () => {
  console.log(`🖥️ Dashboard running at http://localhost:${PORT}`);
});
