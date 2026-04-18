const Database = require('better-sqlite3');
const path = require('path');

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

// ─── Schema ───────────────────────────────────────────────────────────────────

function initDb() {
  const db = getDb();

  db.exec(`
    -- Registered venues / restaurants
    CREATE TABLE IF NOT EXISTS restaurants (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      slug            TEXT UNIQUE,
      cuisine         TEXT,
      city            TEXT,
      state           TEXT,
      country         TEXT DEFAULT 'US',
      address         TEXT,
      google_maps_url TEXT,
      phone           TEXT,
      tagline         TEXT,
      min_spend       INTEGER DEFAULT 50,
      discount_pct    INTEGER DEFAULT 20,
      min_verified_referrals INTEGER DEFAULT 5,
      instagram_handle TEXT,
      tiktok_handle   TEXT,
      website         TEXT,
      contact_name    TEXT,
      contact_email   TEXT,
      rep_code        TEXT,
      formspree_submission_id TEXT,
      source          TEXT DEFAULT 'signup',
      imported_from   TEXT,
      status          TEXT DEFAULT 'pending',
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Pinterest account per restaurant
    CREATE TABLE IF NOT EXISTS restaurant_pinterest (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id           INTEGER NOT NULL UNIQUE,
      pinterest_access_token  TEXT,
      pinterest_refresh_token TEXT,
      pinterest_profile_id    TEXT,
      pinterest_user_id       TEXT,
      board_id                TEXT,
      board_name              TEXT,
      token_expires_at        DATETIME,
      last_token_refresh      DATETIME,
      connected_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
      status                  TEXT DEFAULT 'active',
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_restaurant_pinterest_restaurant
      ON restaurant_pinterest(restaurant_id);

    -- Pins (draft → scheduled → posted | failed)
    CREATE TABLE IF NOT EXISTS pinterest_pins (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id         INTEGER NOT NULL,
      pin_id                TEXT,
      title                 TEXT NOT NULL,
      description           TEXT,
      image_url             TEXT,
      link                  TEXT,
      board_id              TEXT,
      keywords              TEXT,
      hashtags              TEXT,
      posted_at             DATETIME,
      last_analytics_update DATETIME,
      impressions           INTEGER DEFAULT 0,
      clicks                INTEGER DEFAULT 0,
      saves                 INTEGER DEFAULT 0,
      status                TEXT DEFAULT 'draft',
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pinterest_pins_restaurant
      ON pinterest_pins(restaurant_id);
    CREATE INDEX IF NOT EXISTS idx_pinterest_pins_status
      ON pinterest_pins(status);
    CREATE INDEX IF NOT EXISTS idx_pinterest_pins_posted_at
      ON pinterest_pins(posted_at);

    -- Attribution: each tracking code links a pin → landing visit → QR scan → referral
    CREATE TABLE IF NOT EXISTS pinterest_attribution (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id       INTEGER NOT NULL,
      pin_id              TEXT,
      tracking_code       TEXT UNIQUE NOT NULL,
      landing_page_visits INTEGER DEFAULT 0,
      qr_scans            INTEGER DEFAULT 0,
      referrals_generated INTEGER DEFAULT 0,
      first_visit_at      DATETIME,
      last_visit_at       DATETIME,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pinterest_attribution_restaurant
      ON pinterest_attribution(restaurant_id);
    CREATE INDEX IF NOT EXISTS idx_pinterest_attribution_tracking
      ON pinterest_attribution(tracking_code);

    -- Photos uploaded by restaurants
    CREATE TABLE IF NOT EXISTS restaurant_photos (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL,
      photo_url     TEXT NOT NULL,
      thumbnail_url TEXT,
      dish_name     TEXT,
      description   TEXT,
      source        TEXT DEFAULT 'upload',
      used_in_pins  INTEGER DEFAULT 0,
      file_size     INTEGER,
      width         INTEGER,
      height        INTEGER,
      uploaded_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_restaurant_photos_restaurant
      ON restaurant_photos(restaurant_id);
    CREATE INDEX IF NOT EXISTS idx_restaurant_photos_used
      ON restaurant_photos(used_in_pins);

    -- QR scan events (individual scans, not aggregates)
    CREATE TABLE IF NOT EXISTS qr_scans (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL,
      tracking_code TEXT,
      platform      TEXT,
      post_url      TEXT,
      verified      INTEGER DEFAULT 0,
      scanned_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
    );

    -- Daily performance snapshots (for trend charts)
    CREATE TABLE IF NOT EXISTS pinterest_daily_analytics (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id       INTEGER NOT NULL,
      date                DATE NOT NULL,
      total_impressions   INTEGER DEFAULT 0,
      total_clicks        INTEGER DEFAULT 0,
      total_saves         INTEGER DEFAULT 0,
      new_pins_posted     INTEGER DEFAULT 0,
      landing_page_visits INTEGER DEFAULT 0,
      qr_scans            INTEGER DEFAULT 0,
      referrals_generated INTEGER DEFAULT 0,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(restaurant_id, date),
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pinterest_daily_analytics_restaurant_date
      ON pinterest_daily_analytics(restaurant_id, date);

    -- Customer share links (one per share action)
    CREATE TABLE IF NOT EXISTS customer_shares (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL,
      share_code    TEXT UNIQUE NOT NULL,
      sharer_name   TEXT,
      sharer_email  TEXT,
      sharer_phone  TEXT,
      channel       TEXT,
      clicks        INTEGER DEFAULT 0,
      verified_clicks INTEGER DEFAULT 0,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_customer_shares_code
      ON customer_shares(share_code);
    CREATE INDEX IF NOT EXISTS idx_customer_shares_restaurant
      ON customer_shares(restaurant_id);

    -- Referral clicks (one per friend click on a share link)
    CREATE TABLE IF NOT EXISTS referral_clicks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      share_id      INTEGER NOT NULL,
      restaurant_id INTEGER NOT NULL,
      visitor_name  TEXT,
      visitor_email TEXT,
      verified      INTEGER DEFAULT 0,
      clicked_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      verified_at   DATETIME,
      FOREIGN KEY (share_id) REFERENCES customer_shares(id) ON DELETE CASCADE,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_referral_clicks_share
      ON referral_clicks(share_id);
    CREATE INDEX IF NOT EXISTS idx_referral_clicks_restaurant
      ON referral_clicks(restaurant_id);

    -- Claim codes (generated when verified_clicks threshold hit)
    CREATE TABLE IF NOT EXISTS claim_codes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      code          TEXT UNIQUE NOT NULL,
      share_id      INTEGER NOT NULL,
      restaurant_id INTEGER NOT NULL,
      status        TEXT DEFAULT 'unclaimed',
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      redeemed_at   DATETIME,
      FOREIGN KEY (share_id) REFERENCES customer_shares(id) ON DELETE CASCADE,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_claim_codes_code ON claim_codes(code);
    CREATE INDEX IF NOT EXISTS idx_claim_codes_restaurant ON claim_codes(restaurant_id);

    -- View: per-restaurant Pinterest summary (used by admin and weekly reports)
    CREATE VIEW IF NOT EXISTS v_restaurant_pinterest_summary AS
    SELECT
      r.id                                                           AS restaurant_id,
      r.name                                                         AS restaurant_name,
      r.contact_email,
      COALESCE(rp.status, 'not_connected')                          AS pinterest_status,
      rp.connected_at,
      rp.board_name,
      COUNT(DISTINCT pp.id)                                          AS total_pins,
      COUNT(DISTINCT CASE WHEN pp.status = 'posted' THEN pp.id END) AS posted_pins,
      COUNT(DISTINCT CASE WHEN pp.status IN ('draft','scheduled') THEN pp.id END) AS queued_pins,
      COALESCE(SUM(CASE WHEN pp.status = 'posted' THEN pp.impressions ELSE 0 END), 0) AS total_impressions,
      COALESCE(SUM(CASE WHEN pp.status = 'posted' THEN pp.clicks     ELSE 0 END), 0) AS total_clicks,
      COALESCE(SUM(CASE WHEN pp.status = 'posted' THEN pp.saves      ELSE 0 END), 0) AS total_saves,
      (SELECT COALESCE(SUM(qr_scans), 0)            FROM pinterest_attribution WHERE restaurant_id = r.id) AS total_qr_scans,
      (SELECT COALESCE(SUM(referrals_generated), 0) FROM pinterest_attribution WHERE restaurant_id = r.id) AS total_referrals,
      COUNT(DISTINCT rph.id)                                         AS total_photos
    FROM restaurants r
    LEFT JOIN restaurant_pinterest  rp  ON r.id = rp.restaurant_id
    LEFT JOIN pinterest_pins        pp  ON r.id = pp.restaurant_id
    LEFT JOIN restaurant_photos     rph ON r.id = rph.restaurant_id
    GROUP BY r.id;

    -- View: top performing pins across all restaurants
    CREATE VIEW IF NOT EXISTS v_top_pinterest_pins AS
    SELECT
      pp.id,
      pp.restaurant_id,
      r.name                                                           AS restaurant_name,
      pp.title,
      pp.posted_at,
      pp.impressions,
      pp.clicks,
      pp.saves,
      (pp.impressions + pp.clicks * 10 + pp.saves * 5)               AS engagement_score,
      CASE WHEN pp.impressions > 0
        THEN ROUND(pp.clicks * 100.0 / pp.impressions, 2)
        ELSE 0
      END                                                              AS ctr_percentage,
      (SELECT COUNT(*) FROM pinterest_attribution pa
       WHERE pa.pin_id = pp.pin_id AND pa.qr_scans > 0)              AS conversions
    FROM pinterest_pins pp
    JOIN restaurants r ON pp.restaurant_id = r.id
    WHERE pp.status = 'posted'
    ORDER BY engagement_score DESC;
  `);

  // Apply any migrations needed for databases created before this schema version
  runMigrations(db);

  console.log('Database initialised at', DB_PATH);
}

// ─── Migrations ───────────────────────────────────────────────────────────────
// SQLite ALTER TABLE has no IF NOT EXISTS — wrap each in try/catch.
// New columns are always added; nothing is dropped (safe for existing data).

function runMigrations(db) {
  const add = (table, column, def) => {
    try {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`).run();
      console.log(`[db] migration: added ${table}.${column}`);
    } catch {
      // Column already exists — this is the expected path on subsequent starts
    }
  };

  // restaurants
  add('restaurants', 'slug',          'TEXT');
  add('restaurants', 'phone',         'TEXT');
  add('restaurants', 'tagline',       'TEXT');
  add('restaurants', 'source',        "TEXT DEFAULT 'signup'");
  add('restaurants', 'imported_from', 'TEXT');

  // restaurant_pinterest
  add('restaurant_pinterest', 'pinterest_user_id',   'TEXT');
  add('restaurant_pinterest', 'last_token_refresh',  'DATETIME');
  add('restaurant_pinterest', 'status',              "TEXT DEFAULT 'active'");
  // connected_at duplicates created_at; keep created_at for backwards compat
  add('restaurant_pinterest', 'connected_at',        'DATETIME');

  // pinterest_pins
  add('pinterest_pins', 'last_analytics_update', 'DATETIME');
  add('pinterest_pins', 'keywords',              'TEXT');
  add('pinterest_pins', 'hashtags',              'TEXT');

  // pinterest_attribution
  add('pinterest_attribution', 'first_visit_at', 'DATETIME');
  add('pinterest_attribution', 'last_visit_at',  'DATETIME');

  // restaurant_photos
  add('restaurant_photos', 'thumbnail_url', 'TEXT');
  add('restaurant_photos', 'file_size',     'INTEGER');
  add('restaurant_photos', 'width',         'INTEGER');
  add('restaurant_photos', 'height',        'INTEGER');

  // referral_clicks
  add('referral_clicks', 'visitor_name',  'TEXT');
  add('referral_clicks', 'visitor_email', 'TEXT');
  add('referral_clicks', 'verified',      'INTEGER DEFAULT 0');
  add('referral_clicks', 'verified_at',   'DATETIME');

  // customer_shares
  add('customer_shares', 'verified_clicks', 'INTEGER DEFAULT 0');
  add('customer_shares', 'sharer_email',    'TEXT');
  add('customer_shares', 'sharer_phone',    'TEXT');

  // restaurants: per-venue threshold
  add('restaurants', 'min_verified_referrals', 'INTEGER DEFAULT 5');
}

module.exports = { getDb, initDb };
