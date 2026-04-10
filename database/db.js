const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'loopref.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDb() {
  const db = getDb();

  db.exec(`
    -- Registered venues / restaurants
    CREATE TABLE IF NOT EXISTS restaurants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cuisine TEXT,
      city TEXT,
      state TEXT,
      country TEXT DEFAULT 'US',
      address TEXT,
      google_maps_url TEXT,
      min_spend INTEGER DEFAULT 50,
      discount_pct INTEGER DEFAULT 20,
      instagram_handle TEXT,
      tiktok_handle TEXT,
      website TEXT,
      contact_name TEXT,
      contact_email TEXT NOT NULL,
      rep_code TEXT,
      formspree_submission_id TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Pinterest account per restaurant
    CREATE TABLE IF NOT EXISTS restaurant_pinterest (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL,
      pinterest_access_token TEXT,
      pinterest_refresh_token TEXT,
      pinterest_profile_id TEXT,
      board_id TEXT,
      board_name TEXT,
      token_expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
    );

    -- Pins (draft, scheduled, posted, failed)
    CREATE TABLE IF NOT EXISTS pinterest_pins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL,
      pin_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      link TEXT,
      board_id TEXT,
      keywords TEXT,
      hashtags TEXT,
      posted_at DATETIME,
      impressions INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      saves INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
    );

    -- Attribution: track each pin → landing page visit → QR scan → referral
    CREATE TABLE IF NOT EXISTS pinterest_attribution (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL,
      pin_id TEXT,
      tracking_code TEXT UNIQUE NOT NULL,
      landing_page_visits INTEGER DEFAULT 0,
      qr_scans INTEGER DEFAULT 0,
      referrals_generated INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
    );

    -- Photos uploaded by restaurants (or pulled from Google Maps)
    CREATE TABLE IF NOT EXISTS restaurant_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL,
      photo_url TEXT NOT NULL,
      dish_name TEXT,
      description TEXT,
      source TEXT DEFAULT 'upload',
      used_in_pins INTEGER DEFAULT 0,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
    );

    -- QR scan events
    CREATE TABLE IF NOT EXISTS qr_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL,
      tracking_code TEXT,
      platform TEXT,
      post_url TEXT,
      verified INTEGER DEFAULT 0,
      scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
    );
  `);

  console.log('Database initialised at', DB_PATH);
}

module.exports = { getDb, initDb };
