/**
 * looprefPins.js
 *
 * Post pins to LoopRef's *own* Pinterest page for any venue.
 * Uses either:
 *   1. Env vars:  LOOPREF_PINTEREST_ACCESS_TOKEN + LOOPREF_PINTEREST_BOARD_ID
 *   2. DB record: system_config table (set via /auth/loopref-pinterest OAuth flow)
 *
 * Pin content is auto-generated from venue data.
 * Images fall back through: venue's own upload → cuisine-based Unsplash → default food photo.
 */

const fetch = require('node-fetch');
const { getDb } = require('../database/db');

const PINTEREST_CLIENT_ID     = process.env.PINTEREST_CLIENT_ID;
const PINTEREST_CLIENT_SECRET = process.env.PINTEREST_CLIENT_SECRET;
const BASE_URL                = process.env.BASE_URL || 'https://loopref.com';

// ─── Cuisine → image map (curated Unsplash IDs) ───────────────────────────────

const CUISINE_IMAGES = {
  'Italian':      'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1200&q=85',
  'Japanese':     'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=1200&q=85',
  'American':     'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=1200&q=85',
  'Mexican':      'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=1200&q=85',
  'Chinese':      'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=1200&q=85',
  'French':       'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=85',
  'Mediterranean':'https://images.unsplash.com/photo-1544025162-d76538b2ed4b?w=1200&q=85',
  'Indian':       'https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=1200&q=85',
  'Thai':         'https://images.unsplash.com/photo-1562802378-063ec186a863?w=1200&q=85',
  'Vietnamese':   'https://images.unsplash.com/photo-1582878826629-29b7ad1cdc43?w=1200&q=85',
  'Greek':        'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=1200&q=85',
  'Steakhouse':   'https://images.unsplash.com/photo-1558030006-450675393462?w=1200&q=85',
  'Seafood':      'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200&q=85',
  'Fitness':      'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1200&q=85',
  'Gym':          'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1200&q=85',
  'Yoga':         'https://images.unsplash.com/photo-1599901860904-17e6ed7083a0?w=1200&q=85',
  'Retail':       'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=1200&q=85',
  'Coffee':       'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&q=85',
  'Bakery':       'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=1200&q=85',
  'Bar':          'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=1200&q=85',
  'default':      'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=85',
};

function getImageForVenue(venue) {
  // 1. Use venue's first uploaded photo if available
  try {
    const db = getDb();
    const photo = db.prepare(
      `SELECT photo_url FROM restaurant_photos WHERE restaurant_id = ? LIMIT 1`
    ).get(venue.id);
    if (photo?.photo_url) return photo.photo_url;
  } catch { /* no photo table or no photo */ }

  // 2. Match by cuisine keyword
  const cuisine = venue.cuisine || '';
  for (const [key, url] of Object.entries(CUISINE_IMAGES)) {
    if (key === 'default') continue;
    if (cuisine.toLowerCase().includes(key.toLowerCase())) return url;
  }

  // 3. Default food photo
  return CUISINE_IMAGES.default;
}

// ─── Pin content generation ───────────────────────────────────────────────────

function buildPinContent(venue) {
  const city     = venue.city  || 'your city';
  const discount = venue.discount_pct || 20;
  const friends  = venue.min_verified_referrals || 5;
  const cuisine  = venue.cuisine ? `${venue.cuisine} ` : '';
  const tagline  = venue.tagline || `one of ${city}'s best ${cuisine}venues`;

  const title = `${discount}% off at ${venue.name} — LoopRef`.substring(0, 100);

  const hashtags = [
    '#LoopRef',
    '#discount',
    '#' + city.toLowerCase().replace(/[\s,]+/g, ''),
    '#' + (venue.cuisine || 'venues').toLowerCase().replace(/[\s/]+/g, ''),
    '#localfood',
    '#savemoney',
  ].join(' ');

  const description = [
    `📍 ${venue.name} in ${city} is on LoopRef!`,
    '',
    venue.tagline ? venue.tagline : `Discover ${tagline}.`,
    '',
    `🎁 Share your visit with ${friends}+ friends and unlock ${discount}% off your bill. No app. No loyalty card.`,
    '',
    `Find it at loopref.com ↓`,
    '',
    hashtags,
  ].join('\n').substring(0, 500);

  const link = `${BASE_URL}/places/venue/?slug=${venue.slug}`;

  return { title, description, link };
}

// ─── Token management ─────────────────────────────────────────────────────────

function getSystemConfig(key) {
  try {
    const db = getDb();
    const row = db.prepare(`SELECT value FROM system_config WHERE key = ?`).get(key);
    return row?.value;
  } catch { return null; }
}

function setSystemConfig(key, value) {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)`).run(key, value);
}

async function getLoopRefToken() {
  // Priority 1: env var (for Railway / production secrets)
  if (process.env.LOOPREF_PINTEREST_ACCESS_TOKEN) {
    return process.env.LOOPREF_PINTEREST_ACCESS_TOKEN;
  }
  // Priority 2: DB system config (set via OAuth flow)
  const token     = getSystemConfig('loopref_pinterest_access_token');
  const expiresAt = getSystemConfig('loopref_pinterest_token_expires_at');

  if (!token) throw new Error('LoopRef Pinterest token not configured. Set LOOPREF_PINTEREST_ACCESS_TOKEN env var or connect via /auth/loopref-pinterest');

  // Refresh if expiring within 5 minutes
  if (expiresAt && new Date(expiresAt) < new Date(Date.now() + 5 * 60 * 1000)) {
    return await refreshLoopRefToken();
  }

  return token;
}

async function refreshLoopRefToken() {
  const refreshToken = getSystemConfig('loopref_pinterest_refresh_token');
  if (!refreshToken) throw new Error('No refresh token stored — re-authenticate via /auth/loopref-pinterest');

  const credentials = Buffer.from(`${PINTEREST_CLIENT_ID}:${PINTEREST_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });

  const tokens = await res.json();
  if (!tokens.access_token) throw new Error('Token refresh failed');

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  setSystemConfig('loopref_pinterest_access_token', tokens.access_token);
  setSystemConfig('loopref_pinterest_token_expires_at', expiresAt);

  return tokens.access_token;
}

function getLoopRefBoardId() {
  return process.env.LOOPREF_PINTEREST_BOARD_ID || getSystemConfig('loopref_pinterest_board_id');
}

// ─── Core pin creation ────────────────────────────────────────────────────────

/**
 * Create a pin on LoopRef's Pinterest page for a given venue.
 * @param {Object} venue  - DB row from restaurants table (must have slug)
 * @param {string} [imageUrl] - Override the auto-selected image
 * @returns {Object} { ok, pinId, pinUrl }
 */
async function pinVenue(venue, imageUrl = null) {
  const token   = await getLoopRefToken();
  const boardId = getLoopRefBoardId();
  if (!boardId) throw new Error('LOOPREF_PINTEREST_BOARD_ID not set');

  const { title, description, link } = buildPinContent(venue);
  const image = imageUrl || getImageForVenue(venue);

  const body = {
    board_id:    boardId,
    title,
    description,
    link,
    media_source: { source_type: 'image_url', url: image },
  };

  const res = await fetch('https://api.pinterest.com/v5/pins', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (res.status === 429) throw new Error('Pinterest rate limit — try again in a minute');

  const pin = await res.json();
  if (!pin.id) throw new Error(`Pinterest API error: ${JSON.stringify(pin)}`);

  // Store the pin record in DB (linked to restaurant but posted by LoopRef)
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO pinterest_pins
        (restaurant_id, pin_id, title, description, image_url, link, board_id, status, posted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', datetime('now'))
    `).run(venue.id, pin.id, title, description, image, link, boardId);
  } catch (err) {
    console.error('[looprefPins] Could not save pin record:', err.message);
  }

  return {
    ok:     true,
    pinId:  pin.id,
    pinUrl: `https://pinterest.com/pin/${pin.id}/`,
  };
}

/**
 * Pin all active venues that don't yet have a LoopRef-posted pin.
 * Staggered with 1.5s delay to respect rate limits.
 * @returns {Array} results per venue
 */
async function pinAllVenues(options = {}) {
  const { limit = 50, dryRun = false } = options;
  const db = getDb();

  // Venues that don't have any posted pin yet (or were never pinned by LoopRef)
  const venues = db.prepare(`
    SELECT r.*
    FROM restaurants r
    WHERE r.status = 'active'
      AND r.slug IS NOT NULL
      AND r.id NOT IN (
        SELECT DISTINCT restaurant_id FROM pinterest_pins WHERE status = 'posted'
      )
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(limit);

  console.log(`[looprefPins] ${dryRun ? 'DRY RUN — ' : ''}Pinning ${venues.length} venues`);

  const results = [];
  for (const venue of venues) {
    if (dryRun) {
      const { title, description, link } = buildPinContent(venue);
      results.push({ venue: venue.name, dryRun: true, title, link });
      continue;
    }

    try {
      const result = await pinVenue(venue);
      results.push({ venue: venue.name, slug: venue.slug, ...result });
      console.log(`[looprefPins] ✓ Pinned: ${venue.name}`);
    } catch (err) {
      results.push({ venue: venue.name, slug: venue.slug, ok: false, error: err.message });
      console.error(`[looprefPins] ✗ Failed: ${venue.name} — ${err.message}`);
    }

    // Rate limit: ~40 pins/min is safe; 1.5s gap = ~40/min
    await new Promise(r => setTimeout(r, 1500));
  }

  return results;
}

module.exports = { pinVenue, pinAllVenues, buildPinContent, getLoopRefToken, setSystemConfig, getSystemConfig };
