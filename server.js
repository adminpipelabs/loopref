require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { initDb } = require('./database/db');
const pinterestRoutes = require('./routes/pinterest');
const trackingRoutes = require('./routes/tracking');
const venueRoutes = require('./routes/venue');
const { startScheduler } = require('./jobs/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Referral redirect: /r/:shareCode → track click → redirect to venue page
app.get('/r/:shareCode', (req, res) => {
  const { getDb } = require('./database/db');
  const db = getDb();
  const share = db.prepare(`
    SELECT cs.id, cs.restaurant_id, r.slug
    FROM customer_shares cs
    JOIN restaurants r ON r.id = cs.restaurant_id
    WHERE cs.share_code = ?
  `).get(req.params.shareCode);

  if (!share) return res.redirect('/places');

  // Log raw click (not verified yet)
  db.prepare('UPDATE customer_shares SET clicks = clicks + 1 WHERE id = ?').run(share.id);
  const click = db.prepare('INSERT INTO referral_clicks (share_id, restaurant_id) VALUES (?, ?)').run(share.id, share.restaurant_id);

  res.redirect(`/places/venue/?slug=${share.slug}&ref=${req.params.shareCode}&cid=${click.lastInsertRowid}`);
});

// API routes (before static files so /api/* is never file-served)
app.use('/auth', pinterestRoutes);
app.use('/api', trackingRoutes);
app.use('/api', venueRoutes);

// Claim code pages: /claim/ANYCODE serves the claim page (JS reads code from URL)
app.get('/claim/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'claim', 'index.html'));
});

// Serve static site from root
app.use(express.static(path.join(__dirname)));

// SPA-style fallback for clean URLs (/about, /earn, etc.)
app.get('*', (req, res, next) => {
  // Only handle non-file requests
  if (req.path.includes('.')) return next();
  const htmlPath = path.join(__dirname, req.path, 'index.html');
  res.sendFile(htmlPath, (err) => {
    if (err) res.sendFile(path.join(__dirname, 'index.html'));
  });
});

// Init DB, auto-seed if empty, then start
try {
  initDb();
  const { getDb } = require('./database/db');
  const count = getDb().prepare('SELECT COUNT(*) as n FROM restaurants').get().n;
  if (count === 0) {
    console.log('Empty database detected — seeding venues...');
    const { seedAll } = require('./scripts/seed-venues');
    seedAll(getDb());
  }
  startScheduler();
} catch (err) {
  console.error('Startup error:', err);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`LoopRef running on port ${PORT}`);
});
