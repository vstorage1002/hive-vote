const hive = require('@hiveio/hive-js');
const fetch = require('node-fetch');
const fs = require('fs');
require('dotenv').config();

const TAG_TO_TRACK = 'photography'; // ← change to your target tag
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK;
const CACHE_FILE = 'latest_post.json';

function loadLastPermlink() {
  if (fs.existsSync(CACHE_FILE)) {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE));
    return data.permlink || null;
  }
  return null;
}

function saveLastPermlink(permlink) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ permlink }, null, 2));
}

function extractFirstImage(jsonMetadata) {
  try {
    const parsed = typeof jsonMetadata === 'string' ? JSON.parse(jsonMetadata) : jsonMetadata;
    return parsed.image && parsed.image.length > 0 ? parsed.image[0] : null;
  } catch {
    return null;
  }
}

async function fetchAndPostNew() {
  hive.api.getDiscussionsByCreated({ tag: TAG_TO_TRACK, limit: 1 }, async (err, result) => {
    if (err || !result || result.length === 0) return console.error('❌ Hive API error or no result');
    
    const post = result[0];
    const lastPermlink = loadLastPermlink();

    if (post.permlink === lastPermlink) return; // already posted

    saveLastPermlink(post.permlink); // mark as posted

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

    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log(`✅ Posted to Discord: ${title}`);
    } catch (e) {
      console.error('❌ Failed to post to Discord:', e.message);
    }
  });
}

fetchAndPostNew();
