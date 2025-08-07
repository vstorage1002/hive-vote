const hive = require('@hiveio/hive-js');
const fetch = require('node-fetch');
require('dotenv').config();

const TAG_TO_TRACK = 'travel'; // ← Change this to the tag you want
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK;

let lastPermlink = null;

async function fetchNewPosts() {
  hive.api.getDiscussionsByCreated({ tag: TAG_TO_TRACK, limit: 5 }, async (err, result) => {
    if (err) return console.error('❌ Hive API error:', err);
    if (!result || result.length === 0) return;

    const [latestPost] = result;
    if (latestPost.permlink === lastPermlink) return;

    lastPermlink = latestPost.permlink;

    const title = latestPost.title;
    const author = latestPost.author;
    const link = `https://peakd.com/${latestPost.category}/@${author}/${latestPost.permlink}`;
    const summary = latestPost.body.slice(0, 150).replace(/\n/g, ' ') + '...';

    const imageUrl = extractFirstImage(latestPost.json_metadata);

    const embed = {
      title: title,
      url: link,
      description: summary,
      author: { name: `@${author}` },
    };

    if (imageUrl) embed.image = { url: imageUrl };

    const payload = {
      content: `New post! ${link}`,
      embeds: [embed],
    };

    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) throw new Error('HTTP error ' + res.status);
      console.log('✅ Sent to Discord:', title);
    } catch (err) {
      console.error('❌ Discord webhook failed:', err.message);
    }
  });
}

function extractFirstImage(metadata) {
  try {
    const parsed = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    return parsed.image && parsed.image.length > 0 ? parsed.image[0] : null;
  } catch {
    return null;
  }
}

setInterval(fetchNewPosts, 2 * 60 * 1000);
fetchNewPosts();
