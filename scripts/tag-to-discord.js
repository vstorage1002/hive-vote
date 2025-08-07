const hive = require('@hiveio/hive-js');
const fetch = require('node-fetch');
const fs = require('fs');
require('dotenv').config();

const TAG_TO_TRACK = 'photography';
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK;
const CACHE_FILE = 'latest_post.json';
const POST_LIMIT = 10;
const DELAY_MS = 10000;

function loadLastPermlink() {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE));
      return data.permlink || null;
    } catch {
      console.warn('⚠️ Invalid cache JSON');
    }
  }
  return null;
}

function saveLastPermlink(permlink) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ permlink }, null, 2));
  console.log(`💾 Saved last permlink: ${permlink}`);
}

function extractFirstImage(jsonMetadata) {
  try {
    const parsed = typeof jsonMetadata === 'string' ? JSON.parse(jsonMetadata) : jsonMetadata;
    return parsed.image && parsed.image.length > 0 ? parsed.image[0] : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postToDiscord(post) {
  const author = post.author;
  const title = post.title;
  const link = `https://peakd.com/${post.category}/@${author}/${post.permlink}`;
  const summary = post.body.slice(0, 140).replace(/\n/g, ' ') + '...';
  const image = extractFirstImage(post.json_metadata);

  const payload = {
    content: `📝 New blog post with #${TAG_TO_TRACK}: ${link}`,
    embeds: [
      {
        title: title,
        url: link,
        description: summary,
        author: { name: `@${author}` },
        image: image ? { url: image } : undefined
      }
    ]
  };

  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  console.log(`✅ Posted: ${title}`);
}

async function fetchAndPostNew() {
  const lastPermlink = loadLastPermlink();

  hive.api.getDiscussionsByCreated({ tag: TAG_TO_TRACK, limit: POST_LIMIT }, async (err, result) => {
    if (err || !result || result.length === 0) {
      console.error('❌ Hive API error or empty result');
      return;
    }

    const newPosts = [];

    for (const post of result) {
      if (post.permlink === lastPermlink) break;
      newPosts.push(post);
    }

    if (newPosts.length === 0) {
      console.log('ℹ️ No new posts to send.');
      return;
    }

    // Reverse so we send from oldest to newest
    newPosts.reverse();

    for (const post of newPosts) {
      try {
        await postToDiscord(post);
        await sleep(DELAY_MS);
      } catch (e) {
        console.error(`❌ Failed to post: ${post.title}`, e.message);
      }
    }

    // ✅ Save the newest one we just posted
    saveLastPermlink(newPosts[newPosts.length - 1].permlink);
  });
}

fetchAndPostNew();
