const express = require('express');
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

module.exports = router;
