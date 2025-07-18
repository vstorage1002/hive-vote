// scripts/init_db.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('delegations.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS delegation_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delegator TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    vesting_shares TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS rewarded_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delegator TEXT NOT NULL,
    reward_date TEXT NOT NULL,
    UNIQUE(delegator, reward_date)
  )`);
});

db.close();
