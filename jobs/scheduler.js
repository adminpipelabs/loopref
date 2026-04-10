const cron = require('node-cron');
const { getDb } = require('../database/db');
const { createPin, syncPinAnalytics } = require('../routes/pinterest');

// ─── Post scheduled pins (runs every hour) ───────────────────────────────────
async function postScheduledPins() {
  const db = getDb();
  const pins = db.prepare(`
    SELECT * FROM pinterest_pins
    WHERE status = 'scheduled'
    ORDER BY created_at ASC
    LIMIT 5
  `).all();

  if (!pins.length) return;
  console.log(`[scheduler] Posting ${pins.length} scheduled pin(s)...`);

  for (const pin of pins) {
    try {
      await createPin(pin.restaurant_id, {
        dbId: pin.id,
        boardId: pin.board_id,
        title: pin.title,
        description: pin.description,
        imageUrl: pin.image_url,
        trackingUrl: pin.link
      });
      console.log(`[scheduler] Posted pin ${pin.id} for restaurant ${pin.restaurant_id}`);
      // Space out to respect rate limits
      await sleep(3000);
    } catch (err) {
      console.error(`[scheduler] Failed to post pin ${pin.id}:`, err.message);
    }
  }
}

// ─── Daily pin scheduler: queue new pins for active restaurants (6am) ─────────
async function dailyPinScheduler() {
  const db = getDb();

  // Find restaurants with Pinterest connected and approved for posting
  const restaurants = db.prepare(`
    SELECT DISTINCT r.id
    FROM restaurants r
    INNER JOIN restaurant_pinterest rp ON rp.restaurant_id = r.id
    WHERE r.status = 'active' AND rp.board_id IS NOT NULL
  `).all();

  console.log(`[scheduler] Daily run: ${restaurants.length} active restaurant(s)`);

  for (const { id } of restaurants) {
    // Check how many pins are already scheduled
    const pending = db.prepare(`
      SELECT COUNT(*) as cnt FROM pinterest_pins
      WHERE restaurant_id = ? AND status IN ('scheduled', 'draft')
    `).get(id).cnt;

    if (pending >= 8) {
      console.log(`[scheduler] Restaurant ${id} already has ${pending} queued, skipping`);
      continue;
    }

    // Get unused photos
    const photos = db.prepare(`
      SELECT * FROM restaurant_photos
      WHERE restaurant_id = ?
      ORDER BY used_in_pins ASC, uploaded_at DESC
      LIMIT 4
    `).all(id);

    if (!photos.length) continue;

    const { generatePinContent } = require('../agents/pinContent');
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(id);
    const pinterestRow = db.prepare('SELECT board_id FROM restaurant_pinterest WHERE restaurant_id = ?').get(id);
    const BASE_URL = process.env.BASE_URL || 'https://loopref.com';

    for (const photo of photos) {
      try {
        const content = await generatePinContent(restaurant, photo);
        const trackingCode = `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const trackingUrl = `${BASE_URL}/visit/${id}?ref=${trackingCode}`;

        const result = db.prepare(`
          INSERT INTO pinterest_pins
            (restaurant_id, title, description, image_url, link, board_id, keywords, hashtags, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
        `).run(
          id, content.title, content.description, photo.photo_url,
          trackingUrl, pinterestRow?.board_id,
          JSON.stringify(content.keywords), JSON.stringify(content.hashtags)
        );

        db.prepare(`INSERT INTO pinterest_attribution (restaurant_id, tracking_code) VALUES (?, ?)`)
          .run(id, trackingCode);

        db.prepare('UPDATE restaurant_photos SET used_in_pins = used_in_pins + 1 WHERE id = ?').run(photo.id);

        console.log(`[scheduler] Queued pin ${result.lastInsertRowid} for restaurant ${id}`);
        await sleep(500);
      } catch (err) {
        console.error(`[scheduler] Content gen failed for photo ${photo.id}:`, err.message);
      }
    }
  }
}

// ─── Sync analytics from Pinterest (3am daily) ───────────────────────────────
async function syncAnalytics() {
  const db = getDb();
  const pins = db.prepare(`
    SELECT pp.*, rp.pinterest_access_token
    FROM pinterest_pins pp
    INNER JOIN restaurant_pinterest rp ON rp.restaurant_id = pp.restaurant_id
    WHERE pp.status = 'posted' AND pp.pin_id IS NOT NULL
    ORDER BY pp.posted_at DESC
    LIMIT 100
  `).all();

  console.log(`[scheduler] Syncing analytics for ${pins.length} pins...`);

  for (const pin of pins) {
    await syncPinAnalytics(pin);
    await sleep(500);
  }
}

// ─── Start all cron jobs ──────────────────────────────────────────────────────
function startScheduler() {
  // Post scheduled pins every hour
  cron.schedule('0 * * * *', () => {
    postScheduledPins().catch(err => console.error('[scheduler] postScheduledPins error:', err));
  });

  // Generate new daily pins at 6am
  cron.schedule('0 6 * * *', () => {
    dailyPinScheduler().catch(err => console.error('[scheduler] dailyPinScheduler error:', err));
  });

  // Sync Pinterest analytics at 3am
  cron.schedule('0 3 * * *', () => {
    syncAnalytics().catch(err => console.error('[scheduler] syncAnalytics error:', err));
  });

  console.log('[scheduler] Cron jobs started (hourly poster, 6am generator, 3am analytics)');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { startScheduler, postScheduledPins, dailyPinScheduler, syncAnalytics };
