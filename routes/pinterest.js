const express = require('express');
const fetch = require('node-fetch');
const { getDb } = require('../database/db');
const { pinVenue, pinAllVenues, buildPinContent, setSystemConfig } = require('../jobs/looprefPins');

const router = express.Router();

const PINTEREST_CLIENT_ID = process.env.PINTEREST_CLIENT_ID;
const PINTEREST_CLIENT_SECRET = process.env.PINTEREST_CLIENT_SECRET;
const BASE_URL = process.env.BASE_URL || 'https://loopref.com';
const REDIRECT_URI = `${BASE_URL}/auth/pinterest/callback`;
const LOOPREF_REDIRECT_URI = `${BASE_URL}/auth/loopref-pinterest/callback`;

// ─── Admin key guard ─────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  const key = process.env.ADMIN_KEY;
  if (!key) return res.status(503).json({ error: 'ADMIN_KEY not configured' });
  if (req.headers['x-admin-key'] !== key) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── LoopRef system Pinterest OAuth ──────────────────────────────────────────

// Step 1: Initiate OAuth for LoopRef's own Pinterest account (admin only)
router.get('/loopref-pinterest', requireAdmin, (req, res) => {
  const url = new URL('https://www.pinterest.com/oauth/');
  url.searchParams.set('client_id', PINTEREST_CLIENT_ID);
  url.searchParams.set('redirect_uri', LOOPREF_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'boards:read,boards:write,pins:read,pins:write');
  url.searchParams.set('state', 'loopref-system');
  res.redirect(url.toString());
});

// Step 2: Handle OAuth callback — store tokens in system_config
router.get('/loopref-pinterest/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.send('Pinterest access denied.');

  try {
    const credentials = Buffer.from(`${PINTEREST_CLIENT_ID}:${PINTEREST_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://api.pinterest.com/v5/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${credentials}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: LOOPREF_REDIRECT_URI }),
    });

    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error(JSON.stringify(tokens));

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    setSystemConfig('loopref_pinterest_access_token', tokens.access_token);
    setSystemConfig('loopref_pinterest_refresh_token', tokens.refresh_token || '');
    setSystemConfig('loopref_pinterest_token_expires_at', expiresAt);

    // Get user profile to confirm identity
    const profileRes = await fetch('https://api.pinterest.com/v5/user_account', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();

    res.send(`
      <html><body style="font-family:sans-serif;padding:40px;max-width:500px;margin:0 auto;">
        <h2>✅ LoopRef Pinterest connected!</h2>
        <p>Connected as: <strong>@${profile.username || 'unknown'}</strong></p>
        <p>Token expires: ${expiresAt}</p>
        <p>Next step: set <code>LOOPREF_PINTEREST_BOARD_ID</code> to your board's ID, then use<br>
           <code>POST /auth/admin/pin-all-venues</code> to create pins.</p>
        <p><a href="https://www.pinterest.com/${profile.username}/boards/" target="_blank">View your Pinterest boards →</a></p>
      </body></html>
    `);
  } catch (err) {
    console.error('LoopRef Pinterest OAuth error:', err);
    res.status(500).send(`OAuth failed: ${err.message}`);
  }
});

// ─── Admin: pin management using LoopRef's account ───────────────────────────

// POST /auth/admin/pin-venue — pin a single venue by slug
router.post('/admin/pin-venue', requireAdmin, async (req, res) => {
  const { slug, imageUrl } = req.body;
  if (!slug) return res.status(400).json({ error: 'slug required' });

  const venue = getDb().prepare('SELECT * FROM restaurants WHERE slug = ?').get(slug);
  if (!venue) return res.status(404).json({ error: 'Venue not found' });

  try {
    const result = await pinVenue(venue, imageUrl || null);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/admin/pin-all-venues — bulk-pin all venues without a pin
// Body: { limit: 50, dryRun: false }
router.post('/admin/pin-all-venues', requireAdmin, async (req, res) => {
  const { limit = 50, dryRun = false } = req.body;
  try {
    const results = await pinAllVenues({ limit, dryRun });
    res.json({ ok: true, count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /auth/admin/pin-preview/:slug — preview what a pin would look like (no API call)
router.get('/admin/pin-preview/:slug', requireAdmin, (req, res) => {
  const venue = getDb().prepare('SELECT * FROM restaurants WHERE slug = ?').get(req.params.slug);
  if (!venue) return res.status(404).json({ error: 'Venue not found' });
  const { title, description, link } = buildPinContent(venue);
  res.json({ title, description, link, venue: venue.name });
});

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

// GET /auth/pins/:restaurantId — list all pins (optionally filter by ?status=draft|scheduled|posted)
router.get('/pins/:restaurantId', (req, res) => {
  const db = getDb();
  const { status } = req.query;
  const pins = status
    ? db.prepare('SELECT * FROM pinterest_pins WHERE restaurant_id = ? AND status = ? ORDER BY created_at DESC').all(req.params.restaurantId, status)
    : db.prepare('SELECT * FROM pinterest_pins WHERE restaurant_id = ? ORDER BY created_at DESC').all(req.params.restaurantId);
  res.json(pins);
});

// GET /auth/pins/:restaurantId/draft — draft pins only (convenience alias)
router.get('/pins/:restaurantId/draft', (req, res) => {
  const pins = getDb().prepare(
    `SELECT * FROM pinterest_pins WHERE restaurant_id = ? AND status = 'draft' ORDER BY created_at DESC`
  ).all(req.params.restaurantId);
  res.json({ pins });
});

// PUT /auth/pins/:pinId — edit a draft pin's title and description
router.put('/pins/:pinId', (req, res) => {
  const { title, description } = req.body;
  if (!title || !description) return res.status(400).json({ error: 'title and description required' });
  getDb().prepare(`UPDATE pinterest_pins SET title=?, description=? WHERE id=? AND status='draft'`)
    .run(title, description, req.params.pinId);
  res.json({ ok: true });
});

// POST /auth/pins/approve — approve a single draft
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

// POST /auth/pins/schedule/:restaurantId — schedule selected pins staggered over 30 days
// Body: { pinIds: [1, 2, 3, ...] }
router.post('/pins/schedule/:restaurantId', (req, res) => {
  const { pinIds } = req.body;
  if (!Array.isArray(pinIds) || !pinIds.length) return res.status(400).json({ error: 'pinIds array required' });

  const db = getDb();
  const stmt = db.prepare(`UPDATE pinterest_pins SET status='scheduled', posted_at=? WHERE id=?`);

  // 4 pins per week, staggered, posting at 10:00 AM
  const PINS_PER_WEEK = 4;
  const daysBetween = 7 / PINS_PER_WEEK;

  const scheduleAll = db.transaction(() => {
    pinIds.forEach((pinId, i) => {
      const d = new Date();
      d.setDate(d.getDate() + Math.floor(i * daysBetween));
      d.setHours(10, 0, 0, 0);
      stmt.run(d.toISOString(), pinId);
    });
  });
  scheduleAll();

  res.json({ ok: true, scheduled: pinIds.length });
});

// POST /auth/pins/post-now/:restaurantId — immediately post selected pins to Pinterest
// Body: { pinIds: [1, 2, 3] }
router.post('/pins/post-now/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;
  const { pinIds } = req.body;
  if (!Array.isArray(pinIds) || !pinIds.length) return res.status(400).json({ error: 'pinIds array required' });

  const db = getDb();
  const results = [];

  for (const pinId of pinIds) {
    const pin = db.prepare('SELECT * FROM pinterest_pins WHERE id = ?').get(pinId);
    if (!pin) { results.push({ pinId, success: false, error: 'Not found' }); continue; }

    try {
      const posted = await createPin(restaurantId, {
        title: pin.title,
        description: pin.description,
        imageUrl: pin.image_url,
        trackingUrl: pin.link,
        dbId: pin.id
      });
      results.push({ pinId, success: true, pinterestId: posted.id });
    } catch (err) {
      console.error(`Failed to post pin ${pinId}:`, err.message);
      results.push({ pinId, success: false, error: err.message });
    }

    await sleep(1500); // avoid Pinterest rate limits between posts
  }

  res.json({ results });
});

// GET /auth/analytics/:restaurantId — engagement + attribution summary
router.get('/analytics/:restaurantId', (req, res) => {
  const db = getDb();
  const { restaurantId } = req.params;

  const pins = db.prepare(`
    SELECT id, title, posted_at, impressions, clicks, saves,
           (impressions + clicks * 10 + saves * 5) as engagement_score
    FROM pinterest_pins
    WHERE restaurant_id = ? AND status = 'posted'
    ORDER BY engagement_score DESC
  `).all(restaurantId);

  const attribution = db.prepare(`
    SELECT COALESCE(SUM(landing_page_visits), 0) as total_visits,
           COALESCE(SUM(qr_scans), 0)            as total_scans,
           COALESCE(SUM(referrals_generated), 0) as total_referrals
    FROM pinterest_attribution WHERE restaurant_id = ?
  `).get(restaurantId);

  const totalImpressions = pins.reduce((s, p) => s + (p.impressions || 0), 0);
  const totalClicks      = pins.reduce((s, p) => s + (p.clicks || 0), 0);
  const totalSaves       = pins.reduce((s, p) => s + (p.saves || 0), 0);
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100).toFixed(2) : 0;
  const conversionRate = totalClicks > 0
    ? (attribution.total_scans / totalClicks * 100).toFixed(2) : 0;

  res.json({
    pins,
    summary: {
      totalPins: pins.length,
      totalImpressions,
      totalClicks,
      totalSaves,
      ctr: parseFloat(ctr),
      landingPageVisits: attribution.total_visits,
      qrScans: attribution.total_scans,
      referrals: attribution.total_referrals,
      conversionRate: parseFloat(conversionRate)
    }
  });
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = router;
module.exports.createPin = createPin;
module.exports.syncPinAnalytics = syncPinAnalytics;
module.exports.getPinterestToken = getPinterestToken;
