const express = require('express');
const fetch = require('node-fetch');
const { getDb } = require('../database/db');

const router = express.Router();

const PINTEREST_CLIENT_ID = process.env.PINTEREST_CLIENT_ID;
const PINTEREST_CLIENT_SECRET = process.env.PINTEREST_CLIENT_SECRET;
const BASE_URL = process.env.BASE_URL || 'https://loopref.com';
const REDIRECT_URI = `${BASE_URL}/auth/pinterest/callback`;

// ─── OAuth ───────────────────────────────────────────────────────────────────

// Step 1: Redirect restaurant to Pinterest OAuth
router.get('/pinterest', (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ error: 'restaurantId required' });

  const state = Buffer.from(JSON.stringify({ restaurantId })).toString('base64');

  const url = new URL('https://www.pinterest.com/oauth/');
  url.searchParams.set('client_id', PINTEREST_CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'boards:read,boards:write,pins:read,pins:write');
  url.searchParams.set('state', state);

  res.redirect(url.toString());
});

// Step 2: Handle OAuth callback
router.get('/pinterest/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.redirect('/dashboard?error=pinterest_denied');

  let restaurantId;
  try {
    restaurantId = JSON.parse(Buffer.from(state, 'base64').toString()).restaurantId;
  } catch {
    return res.status(400).send('Invalid state');
  }

  try {
    // Exchange code for tokens
    const credentials = Buffer.from(`${PINTEREST_CLIENT_ID}:${PINTEREST_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://api.pinterest.com/v5/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
      })
    });

    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error('No access token received');

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Get Pinterest profile
    const profileRes = await fetch('https://api.pinterest.com/v5/user_account', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` }
    });
    const profile = await profileRes.json();

    // Create a LoopRef board for this restaurant
    const restaurant = getDb().prepare('SELECT name, city FROM restaurants WHERE id = ?').get(restaurantId);
    const boardName = `${restaurant?.name || 'LoopRef'} — ${restaurant?.city || 'Restaurants'}`;

    const boardRes = await fetch('https://api.pinterest.com/v5/boards', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: boardName,
        description: `Discover amazing food and earn discounts with LoopRef`,
        privacy: 'PUBLIC'
      })
    });
    const board = await boardRes.json();

    // Upsert into DB
    const db = getDb();
    const existing = db.prepare('SELECT id FROM restaurant_pinterest WHERE restaurant_id = ?').get(restaurantId);
    if (existing) {
      db.prepare(`UPDATE restaurant_pinterest
        SET pinterest_access_token=?, pinterest_refresh_token=?, pinterest_profile_id=?,
            board_id=?, board_name=?, token_expires_at=?
        WHERE restaurant_id=?`
      ).run(tokens.access_token, tokens.refresh_token, profile.username,
        board.id, boardName, expiresAt, restaurantId);
    } else {
      db.prepare(`INSERT INTO restaurant_pinterest
        (restaurant_id, pinterest_access_token, pinterest_refresh_token, pinterest_profile_id, board_id, board_name, token_expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(restaurantId, tokens.access_token, tokens.refresh_token, profile.username,
        board.id, boardName, expiresAt);
    }

    res.redirect(`/dashboard?restaurantId=${restaurantId}&pinterest=connected`);
  } catch (err) {
    console.error('Pinterest OAuth error:', err);
    res.redirect(`/dashboard?error=pinterest_failed`);
  }
});

// ─── Token refresh ────────────────────────────────────────────────────────────

async function refreshAccessToken(restaurantId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM restaurant_pinterest WHERE restaurant_id = ?').get(restaurantId);
  if (!row?.pinterest_refresh_token) throw new Error('No refresh token');

  const credentials = Buffer.from(`${PINTEREST_CLIENT_ID}:${PINTEREST_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.pinterest_refresh_token
    })
  });

  const tokens = await res.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  db.prepare(`UPDATE restaurant_pinterest
    SET pinterest_access_token=?, token_expires_at=? WHERE restaurant_id=?`
  ).run(tokens.access_token, expiresAt, restaurantId);

  return tokens.access_token;
}

// ─── Pin creation ─────────────────────────────────────────────────────────────

async function getPinterestToken(restaurantId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM restaurant_pinterest WHERE restaurant_id = ?').get(restaurantId);
  if (!row) throw new Error('Restaurant not connected to Pinterest');

  // Refresh if token expires within 5 minutes
  if (row.token_expires_at && new Date(row.token_expires_at) < new Date(Date.now() + 5 * 60 * 1000)) {
    return await refreshAccessToken(restaurantId);
  }
  return row.pinterest_access_token;
}

async function createPin(restaurantId, pinData, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const token = await getPinterestToken(restaurantId);
      const db = getDb();
      const pinterestRow = db.prepare('SELECT board_id FROM restaurant_pinterest WHERE restaurant_id = ?').get(restaurantId);

      const res = await fetch('https://api.pinterest.com/v5/pins', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          board_id: pinData.boardId || pinterestRow?.board_id,
          title: pinData.title.substring(0, 100),
          description: pinData.description.substring(0, 500),
          link: pinData.trackingUrl,
          media_source: { source_type: 'image_url', url: pinData.imageUrl }
        })
      });

      if (res.status === 429) {
        console.log('Rate limited, waiting 60s...');
        await sleep(60000);
        continue;
      }

      const pin = await res.json();
      if (!pin.id) throw new Error(`Pinterest API error: ${JSON.stringify(pin)}`);

      // Update DB record
      db.prepare(`UPDATE pinterest_pins
        SET pin_id=?, status='posted', posted_at=datetime('now') WHERE id=?`
      ).run(pin.id, pinData.dbId);

      return pin;
    } catch (err) {
      if (err.message?.includes('401') && i < retries - 1) {
        await refreshAccessToken(restaurantId);
        continue;
      }
      if (i === retries - 1) {
        getDb().prepare(`UPDATE pinterest_pins SET status='failed' WHERE id=?`).run(pinData.dbId);
        throw err;
      }
    }
  }
}

// ─── Analytics sync ───────────────────────────────────────────────────────────

async function syncPinAnalytics(pin) {
  try {
    const token = await getPinterestToken(pin.restaurant_id);
    const today = new Date().toISOString().split('T')[0];
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

    const res = await fetch(
      `https://api.pinterest.com/v5/pins/${pin.pin_id}/analytics?` +
      `start_date=${monthAgo}&end_date=${today}&metric_types=IMPRESSION,OUTBOUND_CLICK,SAVE`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    const data = await res.json();
    const summary = data?.all?.summary_metrics || {};

    getDb().prepare(`UPDATE pinterest_pins
      SET impressions=?, clicks=?, saves=? WHERE id=?`
    ).run(
      summary.IMPRESSION || pin.impressions,
      summary.OUTBOUND_CLICK || pin.clicks,
      summary.SAVE || pin.saves,
      pin.id
    );
  } catch (err) {
    console.error(`Analytics sync failed for pin ${pin.pin_id}:`, err.message);
  }
}

// ─── REST API endpoints ───────────────────────────────────────────────────────

// GET /auth/pins/:restaurantId — list pins
router.get('/pins/:restaurantId', (req, res) => {
  const pins = getDb().prepare(
    'SELECT * FROM pinterest_pins WHERE restaurant_id = ? ORDER BY created_at DESC'
  ).all(req.params.restaurantId);
  res.json(pins);
});

// POST /auth/pins/approve — approve a draft pin for posting
router.post('/pins/approve', (req, res) => {
  const { pinId } = req.body;
  getDb().prepare(`UPDATE pinterest_pins SET status='scheduled' WHERE id=?`).run(pinId);
  res.json({ ok: true });
});

// POST /auth/pins/approve-all — approve all drafts for a restaurant
router.post('/pins/approve-all', (req, res) => {
  const { restaurantId } = req.body;
  getDb().prepare(`UPDATE pinterest_pins SET status='scheduled' WHERE restaurant_id=? AND status='draft'`).run(restaurantId);
  res.json({ ok: true });
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = router;
module.exports.createPin = createPin;
module.exports.syncPinAnalytics = syncPinAnalytics;
module.exports.getPinterestToken = getPinterestToken;
