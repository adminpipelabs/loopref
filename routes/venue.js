const express = require('express');
const multer = require('multer');
const path = require('path');
const { getDb } = require('../database/db');
const { generateInitialPins, regeneratePin } = require('../agents/pinContent');
const { importVenueFromGoogle } = require('../scripts/import-from-google');

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

const router = express.Router();

// Photo upload: store in /uploads, served statically
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads'),
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    cb(null, /image\/(jpeg|jpg|png|webp)/.test(file.mimetype));
  }
});

// ─── Restaurant registration ─────────────────────────────────────────────────
// POST /api/restaurants
router.post('/restaurants', (req, res) => {
  const {
    venue_name, cuisine_type, city, country, google_maps_url,
    first_name, contact_email, phone, min_spend, discount_pct,
    min_verified_referrals, instagram_handle, tiktok_handle, website, rep_code
  } = req.body;

  if (!venue_name || !contact_email) {
    return res.status(400).json({ error: 'venue_name and contact_email required' });
  }

  const slug = slugify(`${venue_name}-${city || 'venue'}`);
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO restaurants
      (name, slug, cuisine, city, country, google_maps_url, contact_name, contact_email,
       phone, min_spend, discount_pct, min_verified_referrals, instagram_handle, tiktok_handle,
       website, rep_code, source, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'signup', 'active')
  `).run(
    venue_name, slug, cuisine_type || null, city || null, country || 'US',
    google_maps_url || null, first_name || null, contact_email,
    phone || null, parseInt(min_spend) || 50, parseInt(discount_pct) || 20,
    parseInt(min_verified_referrals) || 5,
    instagram_handle || null, tiktok_handle || null, website || null, rep_code || null
  );

  res.json({ ok: true, restaurantId: result.lastInsertRowid, slug });
});

// ─── Get restaurant data ──────────────────────────────────────────────────────
router.get('/restaurants/:id', (req, res) => {
  const r = getDb().prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

// ─── Photo upload ─────────────────────────────────────────────────────────────
// POST /api/photos/:restaurantId
router.post('/photos/:restaurantId', upload.array('photos', 20), (req, res) => {
  const { restaurantId } = req.params;
  const db = getDb();
  const BASE_URL = process.env.BASE_URL || 'https://loopref.com';

  const inserted = [];
  for (const file of req.files) {
    const url = `${BASE_URL}/uploads/${file.filename}`;
    const result = db.prepare(`
      INSERT INTO restaurant_photos (restaurant_id, photo_url, dish_name, source)
      VALUES (?, ?, ?, 'upload')
    `).run(restaurantId, url, req.body.dish_name || null);
    inserted.push({ id: result.lastInsertRowid, url });
  }

  res.json({ ok: true, photos: inserted });
});

// ─── Get photos ───────────────────────────────────────────────────────────────
router.get('/photos/:restaurantId', (req, res) => {
  const photos = getDb().prepare(
    'SELECT * FROM restaurant_photos WHERE restaurant_id = ? ORDER BY uploaded_at DESC'
  ).all(req.params.restaurantId);
  res.json(photos);
});

// ─── Trigger pin generation ───────────────────────────────────────────────────
// POST /api/generate-pins/:restaurantId
router.post('/generate-pins/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;
  try {
    const pins = await generateInitialPins(parseInt(restaurantId));
    res.json({ ok: true, count: pins.length, pins });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Regenerate a single pin ──────────────────────────────────────────────────
router.post('/regenerate-pin/:pinId', async (req, res) => {
  try {
    const content = await regeneratePin(parseInt(req.params.pinId));
    res.json({ ok: true, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Public places directory ──────────────────────────────────────────────────
// GET /api/places — list all active/imported venues (public directory)
router.get('/places', (req, res) => {
  const { city, cuisine, q } = req.query;
  const db = getDb();

  let sql = `
    SELECT id, name, slug, cuisine, city, state, address, phone, tagline,
           website, min_spend, discount_pct, discount_enabled, min_verified_referrals,
           instagram_handle, tiktok_handle, source, status
    FROM restaurants
    WHERE status IN ('active', 'imported')
  `;
  const params = [];

  if (city) { sql += ` AND lower(city) = lower(?)`; params.push(city); }
  if (cuisine) { sql += ` AND lower(cuisine) LIKE lower(?)`; params.push(`%${cuisine}%`); }
  if (q) { sql += ` AND (lower(name) LIKE lower(?) OR lower(tagline) LIKE lower(?))`; params.push(`%${q}%`, `%${q}%`); }

  sql += ` ORDER BY name ASC`;
  res.json(db.prepare(sql).all(...params));
});

// GET /api/places/:slug — single venue by slug (public)
router.get('/places/:slug', (req, res) => {
  const venue = getDb().prepare(`
    SELECT id, name, slug, cuisine, city, state, address, phone, tagline,
           website, min_spend, discount_pct, discount_enabled, min_verified_referrals,
           instagram_handle, tiktok_handle, source, status, google_maps_url
    FROM restaurants WHERE slug = ? AND status IN ('active', 'imported')
  `).get(req.params.slug);

  if (!venue) return res.status(404).json({ error: 'Venue not found' });

  // Attach photos
  const photos = getDb().prepare(
    `SELECT photo_url, dish_name, description FROM restaurant_photos
     WHERE restaurant_id = ? ORDER BY uploaded_at DESC LIMIT 12`
  ).all(venue.id);

  res.json({ ...venue, photos });
});

// POST /api/places/import — import venue by Google Places query or manual data
// Body option A: { google_query: "Bebe Zito Minneapolis" }
// Body option B: { name, city, cuisine, ... } (manual)
// Body option C: { check_env: true } — returns which Google env vars are present
router.post('/places/import', async (req, res) => {
  if (req.body.check_env) {
    return res.json({
      GOOGLE_PLACES_API_KEY: !!process.env.GOOGLE_PLACES_API_KEY,
      GOOGLE_MAPS_API_KEY:   !!process.env.GOOGLE_MAPS_API_KEY,
      GOOGLE_API_KEY:        !!process.env.GOOGLE_API_KEY,
      all_keys: Object.keys(process.env).filter(k => k.startsWith('GOOGLE')),
      node_version: process.version
    });
  }

  // Google Places auto-import
  if (req.body.google_query) {
    try {
      const result = await importVenueFromGoogle(req.body.google_query);
      return res.json({ ok: true, ...result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const {
    name, cuisine, city, state, address, phone, tagline,
    website, min_spend, discount_pct, instagram_handle, tiktok_handle,
    google_maps_url, imported_from, photos = []
  } = req.body;

  if (!name || !city) return res.status(400).json({ error: 'name and city required' });

  const slug = slugify(`${name}-${city}`);
  const db = getDb();

  // Upsert by slug so re-importing is idempotent
  const existing = db.prepare('SELECT id FROM restaurants WHERE slug = ?').get(slug);

  let restaurantId;
  if (existing) {
    db.prepare(`UPDATE restaurants SET name=?, cuisine=?, city=?, state=?, address=?, phone=?,
      tagline=?, website=?, min_spend=?, discount_pct=?, instagram_handle=?, tiktok_handle=?,
      google_maps_url=?, imported_from=?, source='imported', status='imported' WHERE slug=?`
    ).run(name, cuisine||null, city, state||null, address||null, phone||null,
      tagline||null, website||null, parseInt(min_spend)||12, parseInt(discount_pct)||20,
      instagram_handle||null, tiktok_handle||null, google_maps_url||null, imported_from||null, slug);
    restaurantId = existing.id;
  } else {
    const r = db.prepare(`INSERT INTO restaurants
      (name, slug, cuisine, city, state, address, phone, tagline, website,
       min_spend, discount_pct, instagram_handle, tiktok_handle, google_maps_url,
       imported_from, source, status, contact_email)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'imported','imported',?)`
    ).run(name, slug, cuisine||null, city, state||null, address||null, phone||null,
      tagline||null, website||null, parseInt(min_spend)||12, parseInt(discount_pct)||20,
      instagram_handle||null, tiktok_handle||null, google_maps_url||null,
      imported_from||null, `imported+${slug}@loopref.com`);
    restaurantId = r.lastInsertRowid;
  }

  // Attach any photos passed in
  if (photos.length) {
    const insertPhoto = db.prepare(
      `INSERT OR IGNORE INTO restaurant_photos (restaurant_id, photo_url, dish_name, source)
       VALUES (?, ?, ?, 'import')`
    );
    for (const p of photos) {
      insertPhoto.run(restaurantId, p.url, p.dish_name || null);
    }
  }

  res.json({ ok: true, restaurantId, slug });
});

// ─── Admin: configure venue without registration ──────────────────────────────
// POST /api/admin/venue-setup
router.post('/admin/venue-setup', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { slug, discount_pct, min_verified_referrals, min_spend, contact_email } = req.body;
  if (!slug) return res.status(400).json({ error: 'slug required' });

  const db = getDb();
  const venue = db.prepare('SELECT * FROM restaurants WHERE slug = ?').get(slug);
  if (!venue) return res.status(404).json({ error: 'Venue not found' });

  db.prepare(`
    UPDATE restaurants SET
      discount_pct = COALESCE(?, discount_pct),
      min_verified_referrals = COALESCE(?, min_verified_referrals),
      min_spend = COALESCE(?, min_spend),
      contact_email = COALESCE(?, contact_email),
      status = CASE WHEN status = 'imported' THEN 'active' ELSE status END
    WHERE slug = ?
  `).run(
    discount_pct != null ? parseInt(discount_pct) : null,
    min_verified_referrals != null ? parseInt(min_verified_referrals) : null,
    min_spend != null ? parseInt(min_spend) : null,
    contact_email || null,
    slug
  );

  const updated = db.prepare(
    'SELECT id, name, slug, status, discount_pct, min_verified_referrals FROM restaurants WHERE slug = ?'
  ).get(slug);

  res.json({ ok: true, venue: updated });
});

// ─── Dashboard report ─────────────────────────────────────────────────────────
// GET /api/dashboard/:restaurantId
router.get('/dashboard/:restaurantId', (req, res) => {
  const db = getDb();
  const restaurantId = req.params.restaurantId;

  const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(restaurantId);
  const pinterest = db.prepare('SELECT * FROM restaurant_pinterest WHERE restaurant_id = ?').get(restaurantId);

  const pins = db.prepare(`
    SELECT *, (impressions + clicks * 10 + saves * 5) as score
    FROM pinterest_pins
    WHERE restaurant_id = ? AND status = 'posted'
    ORDER BY score DESC
  `).all(restaurantId);

  const drafts = db.prepare(
    `SELECT * FROM pinterest_pins WHERE restaurant_id = ? AND status = 'draft' ORDER BY created_at DESC`
  ).all(restaurantId);

  const attribution = db.prepare(`
    SELECT COALESCE(SUM(landing_page_visits),0) as visits,
           COALESCE(SUM(qr_scans),0) as scans,
           COALESCE(SUM(referrals_generated),0) as referrals
    FROM pinterest_attribution WHERE restaurant_id = ?
  `).get(restaurantId);

  const totalImpressions = pins.reduce((s, p) => s + p.impressions, 0);
  const totalClicks = pins.reduce((s, p) => s + p.clicks, 0);
  const totalSaves = pins.reduce((s, p) => s + p.saves, 0);

  res.json({
    restaurant,
    pinterestConnected: !!pinterest?.board_id,
    boardName: pinterest?.board_name,
    stats: { totalImpressions, totalClicks, totalSaves, ...attribution },
    topPins: pins.slice(0, 10),
    drafts
  });
});

module.exports = router;
