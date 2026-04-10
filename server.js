require('dotenv').config();
const express = require('express');
const path = require('path');
const { initDb } = require('./database/db');
const pinterestRoutes = require('./routes/pinterest');
const trackingRoutes = require('./routes/tracking');
const venueRoutes = require('./routes/venue');
const { startScheduler } = require('./jobs/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes (before static files so /api/* is never file-served)
app.use('/auth', pinterestRoutes);
app.use('/api', trackingRoutes);
app.use('/api', venueRoutes);

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

// Init DB then start
initDb();
startScheduler();

app.listen(PORT, () => {
  console.log(`LoopRef running on port ${PORT}`);
});
