const hive = require('@hiveio/hive-js');
const https = require('https');
require('dotenv').config();

const HIVE_USER = process.env.HIVE_USER;
const POSTING_KEY = process.env.POSTING_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Multiple fallback nodes (ordered by reliability)
const NODES = [
  'https://api.hive.blog',
  'https://api.openhive.network',
  'https://herpc.dtools.dev',
  'https://anyx.io',
  'https://rpc.ausbit.dev',
  'https://hived.privex.io',
  'https://rpc.ecency.com',
];

let currentNodeIndex = 0;
let nodeHealthStatus = {}; // Track which nodes are working

// Initialize health status
NODES.forEach(node => {
  nodeHealthStatus[node] = true;
});

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
  for (let i = 0; i < NODES.length; i++) {
    const node = NODES[i];
    if (nodeHealthStatus[node]) {
      setNode(NODES.indexOf(node));
      return true;
    }
  }
  // If no healthy nodes, reset and try all again
  console.log('⚠️ No healthy nodes found, resetting health status...');
  NODES.forEach(node => {
    nodeHealthStatus[node] = true;
  });
  setNode(0);
  return true;
}

function markNodeUnhealthy(node) {
  nodeHealthStatus[node] = false;
  console.log(`❌ Marked node as unhealthy: ${node}`);
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

async function attemptClaim(attemptNum) {
  try {
    console.log(`\n� Claim Attempt ${attemptNum}/3 - Using: ${NODES[currentNodeIndex]}`);
    
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
    
    console.error(`❌ Attempt ${attemptNum} failed: ${errorMsg}`);

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

    if (isTemporaryError) {
      markNodeUnhealthy(currentNode);
      console.log('� Temporary error - trying next node...');
      
      if (attemptNum < 3) {
        findHealthyNode();
        await new Promise(resolve => setTimeout(resolve, 5000 + attemptNum * 2000)); // Exponential backoff
        return attemptClaim(attemptNum + 1);
      }
    } else if (isPermanentError) {
      console.log('⚠️ Permanent error - node may be misconfigured');
      markNodeUnhealthy(currentNode);
      
      if (attemptNum < 3) {
        findHealthyNode();
        await new Promise(resolve => setTimeout(resolve, 3000));
        return attemptClaim(attemptNum + 1);
      }
    }

    // All attempts failed
    const finalMsg = `❌ FAILED after 3 attempts. Last error: ${errorMsg}`;
    console.error(finalMsg);
    sendDiscordAlert(finalMsg);
    process.exit(1);
  }
}

// Start claiming
setNode(0);
attemptClaim(1);
