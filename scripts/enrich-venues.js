/**
 * Enriches all venues with address, lat/lng and Google Maps URL
 * using Nominatim (OpenStreetMap) — completely free, no API key.
 *
 * Rate limit: 1 req/sec (Nominatim policy)
 * Run: node scripts/enrich-venues.js
 */
const Database = require('better-sqlite3');
const https = require('https');
const path = require('path');

const db = new Database(path.join(__dirname, '../database/loopref.db'));

// Add lat/lng columns if they don't exist
try { db.exec('ALTER TABLE restaurants ADD COLUMN lat REAL'); } catch {}
try { db.exec('ALTER TABLE restaurants ADD COLUMN lng REAL'); } catch {}

const updateVenue = db.prepare(`
  UPDATE restaurants
  SET address = ?, lat = ?, lng = ?, google_maps_url = ?
  WHERE id = ?
`);

function get(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        'User-Agent': 'LoopRef/1.0 (loopref.com)',
        'Accept-Language': 'en'
      }
    };
    https.get(url, opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    }).on('error', reject);
  });
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function mapsUrl(name, city, state, lat, lng) {
  if (lat && lng) return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const q = encodeURIComponent(`${name} ${city} ${state}`);
  return `https://maps.google.com/?q=${q}`;
}

async function enrich() {
  const venues = db.prepare(
    "SELECT id, name, city, state, lat FROM restaurants WHERE status='active' ORDER BY name"
  ).all();

  console.log(`Enriching ${venues.length} venues via Nominatim...\n`);

  let found = 0, skipped = 0, failed = 0;

  for (const v of venues) {
    // Skip if already has coordinates
    if (v.lat) {
      console.log(`  ⏭  ${v.name} — already has coords`);
      skipped++;
      continue;
    }

    const q = encodeURIComponent(`${v.name} ${v.city} ${v.state} USA`);
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=us&addressdetails=1`;

    try {
      const results = await get(url);

      if (results && results.length > 0) {
        const r = results[0];
        const lat = parseFloat(r.lat);
        const lng = parseFloat(r.lon);
        const addr = r.address;

        // Build a clean address string
        const street = addr.road
          ? `${addr.house_number || ''} ${addr.road}`.trim()
          : null;
        const address = [street, v.city, v.state].filter(Boolean).join(', ');

        const maps = mapsUrl(v.name, v.city, v.state, lat, lng);

        updateVenue.run(address, lat, lng, maps, v.id);
        console.log(`  ✅ ${v.name} → ${address} (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
        found++;
      } else {
        // Fallback: just set Maps URL from name+city, no coordinates
        const maps = mapsUrl(v.name, v.city, v.state, null, null);
        updateVenue.run(null, null, null, maps, v.id);
        console.log(`  ⚠️  ${v.name} — not found on OSM, Maps URL set`);
        failed++;
      }
    } catch (err) {
      console.log(`  ❌ ${v.name} — error: ${err.message}`);
      failed++;
    }

    // Nominatim requires 1 second between requests
    await wait(1100);
  }

  console.log(`\nDone! ✅ ${found} enriched, ⏭ ${skipped} skipped, ⚠️ ${failed} fallback`);
}

enrich().catch(console.error);
