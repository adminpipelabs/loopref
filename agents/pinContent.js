const Anthropic = require('@anthropic-ai/sdk');
const { getDb } = require('../database/db');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// claude-3-5-sonnet is the production model; swap to claude-3-5-haiku for lower cost/faster
const MODEL = process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022';

class PinterestContentAgent {

  // ─── Generate content for one photo ──────────────────────────────────────

  static async generatePinContent(restaurant, photo) {
    const prompt = `You are a Pinterest marketing expert specializing in restaurant and food content.

RESTAURANT DETAILS:
Name: ${restaurant.name}
Cuisine: ${restaurant.cuisine || restaurant.cuisine_type || 'restaurant'}
Location: ${restaurant.city}${restaurant.state ? ', ' + restaurant.state : ''}
${restaurant.description ? 'Description: ' + restaurant.description : ''}

PHOTO DETAILS:
${photo.dish_name ? 'Dish: ' + photo.dish_name : 'Restaurant photo'}
${photo.description ? 'Description: ' + photo.description : ''}

TASK:
Create a Pinterest pin that will:
1. Attract local food lovers searching for restaurants in ${restaurant.city}
2. Highlight the LoopRef discount offer (${restaurant.discount_pct || 20}% off)
3. Include location-based keywords for Pinterest SEO
4. Make people crave this food and want to visit

OUTPUT FORMAT (JSON only, no other text):
{
  "title": "Catchy 60-100 character title including location",
  "description": "Engaging 300-500 character description that mentions the discount",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}

REQUIREMENTS:
- Title MUST include the city name
- Description MUST mention "Get ${restaurant.discount_pct || 20}% off" and reference LoopRef
- Use 5 highly searchable keywords for local restaurant discovery
- Use 3 popular food/location hashtags
- Make it sound exciting, visual, and crave-worthy
- Focus on the experience, not just the food

Now generate content for the restaurant and photo above. Return ONLY the JSON, no other text.`;

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;
    // Robust extraction — handles both clean JSON and markdown-fenced responses
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Failed to parse JSON from Claude response');

    const content = JSON.parse(jsonMatch[0]);
    if (!content.title || !content.description || !content.keywords || !content.hashtags) {
      throw new Error('Missing required fields in generated content');
    }

    return content;
  }

  // ─── Generate 20 pins for a newly onboarded restaurant ───────────────────

  static async generateBulkPins(restaurantId, count = 20) {
    const db = getDb();

    const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId);
    if (!restaurant) throw new Error('Restaurant not found');

    const photos = db.prepare(`
      SELECT * FROM restaurant_photos
      WHERE restaurant_id = ?
      ORDER BY used_in_pins ASC
      LIMIT ?
    `).all(restaurantId, count);

    if (!photos.length) throw new Error('No photos available for this restaurant');

    const pinterestRow = db.prepare('SELECT board_id FROM restaurant_pinterest WHERE restaurant_id = ?').get(restaurantId);
    const BASE_URL = process.env.BASE_URL || 'https://loopref.com';

    const insertPin = db.prepare(`
      INSERT INTO pinterest_pins
        (restaurant_id, title, description, image_url, link, board_id, keywords, hashtags, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `);
    const insertAttribution = db.prepare(
      'INSERT INTO pinterest_attribution (restaurant_id, tracking_code) VALUES (?, ?)'
    );

    const pins = [];

    for (const photo of photos) {
      try {
        const content = await this.generatePinContent(restaurant, photo);

        const trackingCode = `${restaurantId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const trackingUrl = `${BASE_URL}/visit/${restaurantId}?ref=${trackingCode}`;

        insertAttribution.run(restaurantId, trackingCode);

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

        db.prepare('UPDATE restaurant_photos SET used_in_pins = used_in_pins + 1 WHERE id = ?').run(photo.id);

        pins.push({ id: result.lastInsertRowid, ...content, imageUrl: photo.photo_url, trackingUrl });

        await sleep(800);
      } catch (err) {
        console.error(`Failed to generate pin for photo ${photo.id}:`, err.message);
      }
    }

    console.log(`[PinterestContentAgent] Generated ${pins.length} draft pins for restaurant ${restaurantId}`);
    return pins;
  }

  // ─── Generate a variation of an existing pin (A/B testing) ───────────────

  static async generatePinVariation(originalPinId) {
    const db = getDb();

    const pin = db.prepare(`
      SELECT p.*, r.name, r.cuisine, r.city, r.state, r.description, r.discount_pct,
             ph.dish_name, ph.description as photo_description
      FROM pinterest_pins p
      JOIN restaurants r ON p.restaurant_id = r.id
      LEFT JOIN restaurant_photos ph ON p.image_url = ph.photo_url
      WHERE p.id = ?
    `).get(originalPinId);

    if (!pin) throw new Error('Pin not found');

    const content = await this.generatePinContent(
      { name: pin.name, cuisine: pin.cuisine, city: pin.city, state: pin.state, description: pin.description, discount_pct: pin.discount_pct },
      { dish_name: pin.dish_name, description: pin.photo_description }
    );

    return content;
  }

  // ─── Optimise an underperforming pin using its analytics ─────────────────

  static async optimizePin(pinId) {
    const db = getDb();

    const pin = db.prepare(`
      SELECT p.*, r.name, r.cuisine, r.city, r.state
      FROM pinterest_pins p
      JOIN restaurants r ON p.restaurant_id = r.id
      WHERE p.id = ?
    `).get(pinId);

    if (!pin) throw new Error('Pin not found');

    const ctr = pin.impressions > 0
      ? (pin.clicks / pin.impressions * 100).toFixed(2)
      : 0;

    const diagnosis = pin.clicks < 10 && pin.impressions > 100
      ? 'This pin has LOW clicks despite decent impressions. Make the title MORE clickable, urgent, and curiosity-driving.'
      : pin.saves < 5
      ? 'This pin has LOW saves. Make it MORE aspirational and save-worthy — people save pins they want to revisit.'
      : 'This pin is performing reasonably. Create a stronger variation that amplifies what\'s already working.';

    const prompt = `You are optimizing an underperforming Pinterest pin based on real analytics.

CURRENT PIN:
Title: ${pin.title}
Description: ${pin.description}

PERFORMANCE DATA:
Impressions: ${pin.impressions}
Clicks: ${pin.clicks}
Saves: ${pin.saves}
Click-through rate: ${ctr}%

RESTAURANT:
${pin.name} — ${pin.cuisine || 'Restaurant'} in ${pin.city}${pin.state ? ', ' + pin.state : ''}

DIAGNOSIS:
${diagnosis}

Return ONLY a JSON object with the improved title and description:
{
  "title": "Improved 60-100 char title",
  "description": "Improved 300-500 char description"
}`;

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    });

    const jsonMatch = message.content[0].text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Failed to parse optimisation response');

    const improved = JSON.parse(jsonMatch[0]);

    // Write the improved version back as a new draft
    const result = db.prepare(`
      INSERT INTO pinterest_pins
        (restaurant_id, title, description, image_url, link, board_id, keywords, hashtags, status)
      SELECT restaurant_id, ?, ?, image_url, link, board_id, keywords, hashtags, 'draft'
      FROM pinterest_pins WHERE id = ?
    `).run(improved.title, improved.description, pinId);

    console.log(`[PinterestContentAgent] Optimised pin ${pinId} → new draft ${result.lastInsertRowid}`);
    return { ...improved, newPinId: result.lastInsertRowid };
  }

  // ─── Regenerate a single pin (e.g. venue asked for a rewrite) ────────────

  static async regeneratePin(pinId) {
    const db = getDb();
    const pin = db.prepare('SELECT * FROM pinterest_pins WHERE id = ?').get(pinId);
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(pin.restaurant_id);
    const photo = db.prepare('SELECT * FROM restaurant_photos WHERE photo_url = ?').get(pin.image_url) || {};

    const content = await this.generatePinContent(restaurant, photo);

    db.prepare(`UPDATE pinterest_pins SET title=?, description=?, keywords=?, hashtags=?, status='draft' WHERE id=?`)
      .run(content.title, content.description, JSON.stringify(content.keywords), JSON.stringify(content.hashtags), pinId);

    return content;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Legacy function exports so routes don't need changes
const generatePinContent = PinterestContentAgent.generatePinContent.bind(PinterestContentAgent);
const generateInitialPins = (id) => PinterestContentAgent.generateBulkPins(id);
const regeneratePin = (id) => PinterestContentAgent.regeneratePin(id);

module.exports = PinterestContentAgent;
module.exports.generatePinContent = generatePinContent;
module.exports.generateInitialPins = generateInitialPins;
module.exports.regeneratePin = regeneratePin;
