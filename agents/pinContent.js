const Anthropic = require('@anthropic-ai/sdk');
const { getDb } = require('../database/db');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Generate pin content for one photo ──────────────────────────────────────

async function generatePinContent(restaurant, photo) {
  const prompt = `You are a Pinterest marketing expert specialising in local restaurants and food discovery.

RESTAURANT:
Name: ${restaurant.name}
Cuisine: ${restaurant.cuisine || 'Restaurant'}
City: ${restaurant.city}${restaurant.state ? ', ' + restaurant.state : ''}
Minimum spend to earn discount: $${restaurant.min_spend || 50}
Discount offered: ${restaurant.discount_pct || 20}%
${restaurant.instagram_handle ? 'Instagram: @' + restaurant.instagram_handle : ''}
${photo.dish_name ? 'Dish in photo: ' + photo.dish_name : ''}
${photo.description ? 'Photo context: ' + photo.description : ''}

TASK:
Create a Pinterest pin that attracts local food lovers searching for places to eat in ${restaurant.city}.
The pin should drive them to visit the restaurant and use the LoopRef referral program.

REQUIREMENTS:
- Title: 60–100 characters, include the city name, make it crave-worthy
- Description: 300–500 characters, mention the discount offer naturally, end with a call to action
- Keywords: 8–12 SEO keywords people search on Pinterest for local restaurants
- Hashtags: 5–8 hashtags (mix of cuisine, location, food-general)

RETURN VALID JSON ONLY (no markdown, no extra text):
{
  "title": "...",
  "description": "...",
  "keywords": ["..."],
  "hashtags": ["..."]
}`;

  const message = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }]
  });

  const raw = message.content[0].text.trim();

  // Strip any accidental markdown fences
  const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/```\s*$/i, '').trim();

  return JSON.parse(jsonStr);
}

// ─── Generate 20 pins for a newly onboarded restaurant ───────────────────────

async function generateInitialPins(restaurantId) {
  const db = getDb();
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId);
  const pinterestRow = db.prepare('SELECT board_id FROM restaurant_pinterest WHERE restaurant_id = ?').get(restaurantId);
  const photos = db.prepare(
    'SELECT * FROM restaurant_photos WHERE restaurant_id = ? ORDER BY used_in_pins ASC LIMIT 20'
  ).all(restaurantId);

  if (!photos.length) {
    console.warn(`No photos for restaurant ${restaurantId}`);
    return [];
  }

  const trackingBase = `${process.env.BASE_URL || 'https://loopref.com'}/visit/${restaurantId}`;
  const insertPin = db.prepare(`
    INSERT INTO pinterest_pins (restaurant_id, title, description, image_url, link, board_id, keywords, hashtags, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')
  `);

  const insertAttribution = db.prepare(`
    INSERT INTO pinterest_attribution (restaurant_id, tracking_code)
    VALUES (?, ?)
  `);

  const generated = [];

  for (const photo of photos) {
    try {
      const content = await generatePinContent(restaurant, photo);

      // Build a unique tracking code per pin
      const trackingCode = `${restaurantId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const trackingUrl = `${trackingBase}?ref=${trackingCode}`;

      const result = insertPin.run(
        restaurantId,
        content.title,
        content.description,
        photo.photo_url,
        trackingUrl,
        pinterestRow?.board_id || null,
        JSON.stringify(content.keywords),
        JSON.stringify(content.hashtags)
      );

      insertAttribution.run(restaurantId, trackingCode);

      // Mark photo as used
      db.prepare('UPDATE restaurant_photos SET used_in_pins = used_in_pins + 1 WHERE id = ?').run(photo.id);

      generated.push({ dbId: result.lastInsertRowid, ...content, trackingUrl });

      // Space out Claude calls slightly (avoid burst)
      await sleep(300);
    } catch (err) {
      console.error(`Pin generation failed for photo ${photo.id}:`, err.message);
    }
  }

  console.log(`Generated ${generated.length} draft pins for restaurant ${restaurantId}`);
  return generated;
}

// ─── Regenerate a single pin (e.g. after venue edits) ────────────────────────

async function regeneratePin(pinId) {
  const db = getDb();
  const pin = db.prepare('SELECT * FROM pinterest_pins WHERE id = ?').get(pinId);
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(pin.restaurant_id);
  const photo = db.prepare('SELECT * FROM restaurant_photos WHERE photo_url = ?').get(pin.image_url);

  const content = await generatePinContent(restaurant, photo || { dish_name: null, description: null });

  db.prepare(`UPDATE pinterest_pins SET title=?, description=?, keywords=?, hashtags=?, status='draft' WHERE id=?`)
    .run(content.title, content.description, JSON.stringify(content.keywords), JSON.stringify(content.hashtags), pinId);

  return content;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { generatePinContent, generateInitialPins, regeneratePin };
