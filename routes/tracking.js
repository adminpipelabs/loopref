const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../database/db');

const router = express.Router();

// ─── Landing page: Pinterest pin → venue page with tracking ──────────────────
// GET /api/visit/:restaurantId?ref=TRACKING_CODE
// (Also served by the static /venue/ page for human-readable URLs)
router.get('/visit/:restaurantId', (req, res) => {
  const { restaurantId } = req.params;
  const { ref } = req.query;
  const db = getDb();

  // Log the visit
  if (ref) {
    db.prepare(`UPDATE pinterest_attribution
      SET landing_page_visits = landing_page_visits + 1
      WHERE tracking_code = ?`
    ).run(ref);
  }

  // Get restaurant data to build the venue page URL
  const r = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId);
  if (!r) return res.status(404).sendFile(require('path').join(__dirname, '../index.html'));

  // Redirect to the static venue page with params + tracking code preserved
  const params = new URLSearchParams({
    n: r.name,
    city: r.city || '',
    min: r.min_spend || 50,
    off: r.discount_pct || 20,
    ...(r.instagram_handle ? { tag: r.instagram_handle } : {}),
    ...(ref ? { src: ref } : {})
  });

  res.redirect(`/venue/?${params.toString()}`);
});

// ─── QR scan event ────────────────────────────────────────────────────────────
// POST /api/qr-scan
router.post('/qr-scan', (req, res) => {
  const { restaurantId, trackingCode, platform, postUrl } = req.body;
  const db = getDb();

  // Log the scan
  db.prepare(`INSERT INTO qr_scans (restaurant_id, tracking_code, platform, post_url)
    VALUES (?, ?, ?, ?)`
  ).run(restaurantId, trackingCode || null, platform || null, postUrl || null);

  // Credit the attribution source
  if (trackingCode) {
    db.prepare(`UPDATE pinterest_attribution
      SET qr_scans = qr_scans + 1
      WHERE tracking_code = ?`
    ).run(trackingCode);
  }

  res.json({ ok: true });
});

// ─── Referral scan (friend who was referred) ─────────────────────────────────
// POST /api/referral-scan
router.post('/referral-scan', (req, res) => {
  const { originalTrackingCode } = req.body;
  if (originalTrackingCode) {
    getDb().prepare(`UPDATE pinterest_attribution
      SET referrals_generated = referrals_generated + 1
      WHERE tracking_code = ?`
    ).run(originalTrackingCode);
  }
  res.json({ ok: true });
});

// ─── Attribution report for a restaurant ─────────────────────────────────────
// GET /api/attribution/:restaurantId
router.get('/attribution/:restaurantId', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      pa.*,
      pp.title as pin_title,
      pp.impressions,
      pp.clicks,
      pp.saves,
      pp.posted_at
    FROM pinterest_attribution pa
    LEFT JOIN pinterest_pins pp ON pp.pin_id = pa.pin_id
      AND pp.restaurant_id = pa.restaurant_id
    WHERE pa.restaurant_id = ?
    ORDER BY pa.created_at DESC
  `).all(req.params.restaurantId);

  const totals = db.prepare(`
    SELECT
      SUM(landing_page_visits) as total_visits,
      SUM(qr_scans) as total_scans,
      SUM(referrals_generated) as total_referrals
    FROM pinterest_attribution WHERE restaurant_id = ?
  `).get(req.params.restaurantId);

  res.json({ rows, totals });
});

// ─── Generate a share link ───────────────────────────────────────────────────
// POST /api/share
router.post('/share', (req, res) => {
  const { restaurantId, sharerName, channel } = req.body;
  if (!restaurantId) return res.status(400).json({ error: 'restaurantId required' });

  const db = getDb();
  const r = db.prepare('SELECT id, slug FROM restaurants WHERE id = ?').get(restaurantId);
  if (!r) return res.status(404).json({ error: 'Restaurant not found' });

  const shareCode = crypto.randomBytes(4).toString('hex'); // 8 hex chars
  db.prepare(`INSERT INTO customer_shares (restaurant_id, share_code, sharer_name, channel)
    VALUES (?, ?, ?, ?)`
  ).run(restaurantId, shareCode, sharerName || null, channel || null);

  const BASE = process.env.BASE_URL || 'https://loopref.com';
  res.json({ ok: true, shareCode, shareUrl: `${BASE}/r/${shareCode}` });
});

// ─── Share stats for a restaurant (used by monthly report) ──────────────────
// GET /api/share-stats/:restaurantId
router.get('/share-stats/:restaurantId', (req, res) => {
  const db = getDb();
  const rid = req.params.restaurantId;

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total_shares,
      COALESCE(SUM(clicks), 0) as total_clicks
    FROM customer_shares WHERE restaurant_id = ?
  `).get(rid);

  const last30 = db.prepare(`
    SELECT
      COUNT(*) as shares,
      COALESCE(SUM(clicks), 0) as clicks
    FROM customer_shares
    WHERE restaurant_id = ? AND created_at >= datetime('now', '-30 days')
  `).get(rid);

  const topSharers = db.prepare(`
    SELECT sharer_name, share_code, clicks, created_at
    FROM customer_shares
    WHERE restaurant_id = ? AND clicks > 0
    ORDER BY clicks DESC LIMIT 5
  `).all(rid);

  res.json({ totals, last30, topSharers });
});

module.exports = router;
