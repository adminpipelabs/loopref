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

// ─── Verify a referral click (friend submits name/email) ─────────────────────
// POST /api/verify-referral
router.post('/verify-referral', async (req, res) => {
  const { clickId, visitorName, visitorEmail } = req.body;
  if (!clickId || !visitorName) {
    return res.status(400).json({ error: 'clickId and visitorName required' });
  }

  const db = getDb();
  const click = db.prepare('SELECT id, share_id, verified FROM referral_clicks WHERE id = ?').get(clickId);
  if (!click) return res.status(404).json({ error: 'Click not found' });
  if (click.verified) return res.json({ ok: true, already: true });

  // Mark click as verified
  db.prepare(`UPDATE referral_clicks SET verified = 1, visitor_name = ?, visitor_email = ?, verified_at = datetime('now') WHERE id = ?`)
    .run(visitorName, visitorEmail || null, clickId);

  // Increment verified counter on share
  db.prepare('UPDATE customer_shares SET verified_clicks = verified_clicks + 1 WHERE id = ?')
    .run(click.share_id);

  // Check if this share just hit the threshold → generate claim code
  const share = db.prepare(`
    SELECT cs.id, cs.verified_clicks, cs.sharer_name, cs.sharer_email, cs.restaurant_id,
           r.name as restaurant_name, r.slug, r.min_verified_referrals, r.discount_pct, r.min_spend
    FROM customer_shares cs
    JOIN restaurants r ON r.id = cs.restaurant_id
    WHERE cs.id = ?
  `).get(click.share_id);

  const threshold = share.min_verified_referrals || 5;
  const existing = db.prepare('SELECT id FROM claim_codes WHERE share_id = ?').get(click.share_id);

  if (!existing && share.verified_clicks >= threshold) {
    // Generate claim code: e.g. RAOS-A3F9
    const prefix = share.restaurant_name.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase();
    const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const claimCode = `${prefix}-${suffix}`;

    db.prepare(`INSERT INTO claim_codes (code, share_id, restaurant_id) VALUES (?, ?, ?)`)
      .run(claimCode, click.share_id, share.restaurant_id);

    // Send email to the sharer if we have their email
    if (share.sharer_email) {
      try {
        const { sendClaimCodeEmail } = require('../jobs/claimCodeEmail');
        await sendClaimCodeEmail({
          to: share.sharer_email,
          sharerName: share.sharer_name,
          restaurantName: share.restaurant_name,
          discountPct: share.discount_pct,
          minSpend: share.min_spend,
          claimCode,
          claimUrl: `${process.env.BASE_URL || 'https://loopref.com'}/claim/${claimCode}`
        });
      } catch (err) {
        console.error('[verify-referral] failed to send claim email:', err.message);
      }
    }

    return res.json({ ok: true, unlocked: true, claimCode });
  }

  res.json({ ok: true, verified: share.verified_clicks, needed: threshold });
});

// ─── Get claim code status (used by /claim/:code page) ───────────────────────
// GET /api/claim/:code
router.get('/claim/:code', (req, res) => {
  const db = getDb();
  const claim = db.prepare(`
    SELECT cc.code, cc.status, cc.created_at, cc.redeemed_at,
           r.id as restaurant_id, r.name as restaurant_name, r.slug,
           r.discount_pct, r.min_spend,
           cs.sharer_name
    FROM claim_codes cc
    JOIN restaurants r ON r.id = cc.restaurant_id
    JOIN customer_shares cs ON cs.id = cc.share_id
    WHERE cc.code = ?
  `).get(req.params.code.toUpperCase());

  if (!claim) return res.status(404).json({ error: 'Claim code not found' });
  res.json(claim);
});

// ─── Mark claim code as redeemed (staff taps button) ─────────────────────────
// POST /api/claim/:code/redeem
router.post('/claim/:code/redeem', (req, res) => {
  const db = getDb();
  const code = req.params.code.toUpperCase();
  const existing = db.prepare('SELECT status FROM claim_codes WHERE code = ?').get(code);

  if (!existing) return res.status(404).json({ error: 'Claim code not found' });
  if (existing.status === 'redeemed') return res.json({ ok: true, already: true });

  db.prepare(`UPDATE claim_codes SET status = 'redeemed', redeemed_at = datetime('now') WHERE code = ?`).run(code);
  res.json({ ok: true });
});

// ─── Generate a share link ───────────────────────────────────────────────────
// POST /api/share
router.post('/share', (req, res) => {
  const { restaurantId, sharerName, sharerEmail, sharerPhone, channel } = req.body;
  if (!restaurantId) return res.status(400).json({ error: 'restaurantId required' });

  const db = getDb();
  const r = db.prepare('SELECT id, slug FROM restaurants WHERE id = ?').get(restaurantId);
  if (!r) return res.status(404).json({ error: 'Restaurant not found' });

  const shareCode = crypto.randomBytes(4).toString('hex'); // 8 hex chars
  const result = db.prepare(`INSERT INTO customer_shares (restaurant_id, share_code, sharer_name, sharer_email, sharer_phone, channel)
    VALUES (?, ?, ?, ?, ?, ?)`
  ).run(restaurantId, shareCode, sharerName || null, sharerEmail || null, sharerPhone || null, channel || null);

  const BASE = process.env.BASE_URL || 'https://loopref.com';
  res.json({ ok: true, shareId: result.lastInsertRowid, shareCode, shareUrl: `${BASE}/r/${shareCode}` });
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
      COALESCE(SUM(clicks), 0) as clicks,
      COALESCE(SUM(verified_clicks), 0) as verified_clicks
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
