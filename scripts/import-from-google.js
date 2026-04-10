/**
 * Import a venue from Google Places API into LoopRef.
 *
 * Usage:
 *   node scripts/import-from-google.js "Bebe Zito Minneapolis"
 *   node scripts/import-from-google.js "https://maps.google.com/?place_id=ChIJ..."
 *
 * Requires GOOGLE_PLACES_API_KEY (or GOOGLE_MAPS_API_KEY / GOOGLE_API_KEY) in environment.
 */
require('dotenv').config();
const fetch = require('node-fetch');
const { getDb, initDb } = require('../database/db');

// Read at call time — not module load — so Railway env vars are always current
function getApiKey() {
  return process.env.GOOGLE_PLACES_API_KEY
    || process.env.GOOGLE_MAPS_API_KEY
    || process.env.GOOGLE_API_KEY;
}

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '').trim()
    .replace(/\s+/g, '-').replace(/-+/g, '-');
}

// ─── Google Places helpers ────────────────────────────────────────────────────

async function findPlaceId(query) {
  const pidMatch = query.match(/place_id=([^&]+)/);
  if (pidMatch) return pidMatch[1];

  const key = getApiKey();
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?` +
    `input=${encodeURIComponent(query)}&inputtype=textquery` +
    `&fields=place_id,name&key=${key}`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== 'OK' || !data.candidates?.length) {
    throw new Error(`Place not found: "${query}" (status: ${data.status})`);
  }
  return data.candidates[0].place_id;
}

async function getPlaceDetails(placeId) {
  const key = getApiKey();
  const fields = [
    'name', 'formatted_address', 'formatted_phone_number',
    'website', 'photos', 'types', 'rating', 'url',
    'address_components', 'editorial_summary'
  ].join(',');

  const url = `https://maps.googleapis.com/maps/api/place/details/json?` +
    `place_id=${placeId}&fields=${fields}&key=${key}`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== 'OK') throw new Error(`Places detail error: ${data.status}`);
  return data.result;
}

function photoUrl(photoReference, maxWidth = 1200) {
  const key = getApiKey();
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoReference}&key=${key}`;
}

function extractCity(addressComponents) {
  const locality = addressComponents.find(c => c.types.includes('locality'));
  const area = addressComponents.find(c => c.types.includes('sublocality_level_1'));
  return (locality || area)?.long_name || null;
}

function extractState(addressComponents) {
  const comp = addressComponents.find(c => c.types.includes('administrative_area_level_1'));
  return comp?.short_name || null;
}

function guessCuisine(types) {
  const map = {
    'bakery': 'Bakery', 'bar': 'Bar', 'cafe': 'Coffee',
    'meal_delivery': 'Restaurant', 'meal_takeaway': 'Restaurant',
    'restaurant': 'Restaurant', 'food': 'Food', 'store': 'Store',
    'night_club': 'Nightlife', 'gym': 'Fitness',
  };
  for (const t of (types || [])) {
    if (map[t]) return map[t];
  }
  return 'Venue';
}

// ─── Import into DB ───────────────────────────────────────────────────────────

function upsertVenue(db, data) {
  const slug = slugify(`${data.name}-${data.city}`);
  const existing = db.prepare('SELECT id FROM restaurants WHERE slug = ?').get(slug);

  let restaurantId;

  if (existing) {
    db.prepare(`
      UPDATE restaurants SET
        name=?, cuisine=?, city=?, state=?, address=?, phone=?, tagline=?,
        website=?, google_maps_url=?, imported_from=?,
        source='imported', status='imported'
      WHERE slug=?
    `).run(data.name, data.cuisine, data.city, data.state, data.address,
      data.phone, data.tagline, data.website, data.mapsUrl, data.mapsUrl, slug);
    restaurantId = existing.id;
    console.log(`Updated: ${data.name} (id: ${restaurantId})`);
  } else {
    const r = db.prepare(`
      INSERT INTO restaurants
        (name, slug, cuisine, city, state, address, phone, tagline, website,
         google_maps_url, imported_from, source, status, contact_email, min_spend, discount_pct)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'imported','imported',?,12,20)
    `).run(data.name, slug, data.cuisine, data.city, data.state, data.address,
      data.phone, data.tagline, data.website, data.mapsUrl, data.mapsUrl,
      `imported+${slug}@loopref.com`);
    restaurantId = r.lastInsertRowid;
    console.log(`Imported: ${data.name} (id: ${restaurantId})`);
  }

  if (data.photos?.length) {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO restaurant_photos (restaurant_id, photo_url, source) VALUES (?, ?, 'google')`
    );
    for (const url of data.photos) insert.run(restaurantId, url);
    console.log(`  → ${data.photos.length} photo(s) attached`);
  }

  return { restaurantId, slug };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function importVenue(query, { autoInitDb = false } = {}) {
  const key = getApiKey();
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY environment variable is not set');

  console.log(`Searching Google Places for: "${query}" (key: ${key.slice(0, 8)}...)`);

  const placeId = await findPlaceId(query);
  console.log(`Found place_id: ${placeId}`);

  const place = await getPlaceDetails(placeId);
  console.log(`Details fetched: ${place.name}`);

  const city  = extractCity(place.address_components || []);
  const state = extractState(place.address_components || []);
  const photos = (place.photos || []).slice(0, 10).map(p => photoUrl(p.photo_reference));

  const venueData = {
    name:    place.name,
    cuisine: guessCuisine(place.types),
    city:    city || 'Unknown',
    state:   state || '',
    address: place.formatted_address || '',
    phone:   place.formatted_phone_number || '',
    tagline: place.editorial_summary?.overview || '',
    website: place.website || '',
    mapsUrl: place.url || '',
    photos
  };

  // Only initialise DB when running standalone (CLI). When called from the
  // Express server the DB is already initialised at startup.
  if (autoInitDb) initDb();

  const db = getDb();
  const { restaurantId, slug } = upsertVenue(db, venueData);

  const BASE = process.env.BASE_URL || 'http://localhost:3000';
  console.log(`✓ Live at: ${BASE}/places/venue/?slug=${slug}`);

  return { restaurantId, slug };
}

module.exports = { importVenueFromGoogle: importVenue };

if (require.main === module) {
  const query = process.argv.slice(2).join(' ');
  if (!query) { console.log('Usage: node scripts/import-from-google.js "Restaurant Name City"'); process.exit(1); }
  importVenue(query, { autoInitDb: true }).catch(err => { console.error('Import failed:', err.message); process.exit(1); });
}
