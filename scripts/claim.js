const hive = require('@hiveio/hive-js');
const https = require('https');
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
const POSTING_KEY = process.env.POSTING_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Multiple fallback nodes (all available nodes)
const NODES = [
  'https://api.deathwing.me',
  'https://api.openhive.network',
  'https://api.hive.blog',
  'https://anyx.io',
  'https://hive.roelandp.nl',
  'https://rpc.ausbit.dev',
  'https://hived.emre.sh',
  'https://hive-api.arcange.eu',
  'https://api.c0ff33a.uk',
  'https://rpc.ecency.com',
  'https://techcoderx.com',
  'https://api.hive.blue',
  'https://herpc.dtools.dev',
  'https://rpc.mahdiyari.info',
];

let currentNodeIndex = 0;
let retryCount = 0;
const MAX_RETRIES = 13; // Try all 13 nodes before giving up

function setNode(index) {
  currentNodeIndex = index % NODES.length;
  hive.api.setOptions({ 
    url: NODES[currentNodeIndex],
    timeout: 45000 // 45 second timeout
  });
  console.log(`� Using node: ${NODES[currentNodeIndex]}`);
}

// Find a healthy node
function findHealthyNode() {
  retryCount++;
  currentNodeIndex = (currentNodeIndex + 1) % NODES.length;
  setNode(currentNodeIndex);
  return true;
}

function sendDiscordAlert(message) {
  if (!DISCORD_WEBHOOK_URL) return;

  const data = JSON.stringify({ content: String(message) });
  const url = new URL(DISCORD_WEBHOOK_URL);

  const options = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
  };

  const req = https.request(options, (res) => {
    console.log(`📡 Discord webhook responded: ${res.statusCode}`);
  });

  req.on('error', (error) => {
    console.error('❌ Discord alert error:', error);
  });

  req.write(data);
  req.end();
}

// Promisified API calls
function getAccounts(username) {
  return new Promise((resolve, reject) => {
    hive.api.getAccounts([username], (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function claimRewardBalance(key, user, hive_payout, hbd_payout, vests_payout) {
  return new Promise((resolve, reject) => {
    hive.broadcast.claimRewardBalance(
      key,
      user,
      hive_payout,
      hbd_payout,
      vests_payout,
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      }
    );
  });
}

async function attemptClaim() {
  try {
    console.log(`\n🚀 Claim Attempt ${retryCount + 1}/${MAX_RETRIES} - Using: ${NODES[currentNodeIndex]}`);
    
    // Get account data
    const accounts = await getAccounts(HIVE_USER);
    if (!accounts || accounts.length === 0) {
      throw new Error('Account not found');
    }

    const acct = accounts[0];
    const hiveReward = acct.reward_hive_balance || '0.000 HIVE';
    const hbdReward = acct.reward_hbd_balance || '0.000 HBD';
    const vestingReward = acct.reward_vesting_balance || '0.000000 VESTS';

    const hasReward =
      hiveReward !== '0.000 HIVE' ||
      hbdReward !== '0.000 HBD' ||
      vestingReward !== '0.000000 VESTS';

    if (!hasReward) {
      const msg = '📭 No rewards to claim.';
      console.log(msg);
      sendDiscordAlert(msg);
      process.exit(0);
    }

    console.log(`💰 Rewards found: ${hiveReward}, ${hbdReward}, ${vestingReward}`);
    console.log('⏳ Submitting claim transaction...');

    // Attempt claim
    const result = await claimRewardBalance(
      POSTING_KEY,
      HIVE_USER,
      hiveReward,
      hbdReward,
      vestingReward
    );

    const msg = `✅ SUCCESS! @${HIVE_USER} claimed: ${hiveReward}, ${hbdReward}, ${vestingReward}`;
    console.log(msg);
    sendDiscordAlert(msg);
    process.exit(0);

  } catch (err) {
    const currentNode = NODES[currentNodeIndex];
    const errorMsg = err.message || String(err);
    
    console.error(`❌ Attempt ${retryCount + 1} failed: ${errorMsg}`);

    // Classify error
    const isTemporaryError = 
      errorMsg.includes('504') ||
      errorMsg.includes('500') ||
      errorMsg.includes('Gateway') ||
      errorMsg.includes('timeout') ||
      errorMsg.includes('ECONNREFUSED') ||
      errorMsg.includes('ETIMEDOUT');

    const isPermanentError = 
      errorMsg.includes('Method not found') ||
      errorMsg.includes('RPCError') ||
      errorMsg.includes('Account not found');

    if (retryCount < MAX_RETRIES - 1) {
      console.log(`🔄 Trying next node (${retryCount + 1}/${MAX_RETRIES})...`);
      findHealthyNode();
      
      // Exponential backoff
      const waitTime = 3000 + retryCount * 2000;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return attemptClaim();
    }

    // All attempts failed
    const finalMsg = `❌ FAILED after ${MAX_RETRIES} attempts. Last error: ${errorMsg}`;
    console.error(finalMsg);
    sendDiscordAlert(finalMsg);
    process.exit(1);
  }
}

// Start claiming
setNode(0);
attemptClaim();
