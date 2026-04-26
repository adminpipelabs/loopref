/**
 * Generates a Pinterest bulk pin CSV for all active LoopRef venues.
 * Pinterest image pin CSV format:
 *   Title, Description, Link, Image URL
 *
 * Uses Unsplash Source for cuisine-matched images.
 * Run: node scripts/generate-pinterest-csv.js
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const db = new Database(path.join(__dirname, '../database/loopref.db'));

// Resolve picsum redirect to direct fastly URL (no redirect, ends in .jpg)
async function resolveImageUrl(slug) {
  const url = `https://picsum.photos/seed/${slug}/800/1200.jpg`;
  return new Promise((resolve) => {
    const https = require('https');
    const req = https.get(url, { headers: { 'User-Agent': 'LoopRef/1.0' } }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        resolve(res.headers.location);
      } else {
        resolve(url); // fallback
      }
      res.destroy();
    });
    req.on('error', () => resolve(url));
    req.setTimeout(8000, () => { req.destroy(); resolve(url); });
  });
}

function escapeCsv(str) {
  if (!str) return '';
  const s = String(str).replace(/"/g, '""');
  return `"${s}"`;
}

const venues = db.prepare(
  "SELECT name, slug, city, state, cuisine FROM restaurants WHERE status='active' ORDER BY name"
).all();

(async () => {
  console.log(`Resolving ${venues.length} image URLs (fetching redirects)...`);

  // Resolve all image URLs in parallel (batches of 10)
  const resolved = [];
  for (let i = 0; i < venues.length; i += 10) {
    const batch = venues.slice(i, i + 10);
    const urls = await Promise.all(batch.map(v => resolveImageUrl(v.slug)));
    resolved.push(...urls);
    process.stdout.write(`  ${Math.min(i + 10, venues.length)}/${venues.length}\r`);
  }
  console.log('');

  // Pinterest CSV header for image pins (Creator Hub bulk upload)
  const header = ['Title', 'Media URL', 'Pinterest board', 'Thumbnail', 'Description', 'Link'];
  const rows = [header.join(',')];

  for (let i = 0; i < venues.length; i++) {
    const v = venues[i];
    const title = `${v.name} — ${v.city}, ${v.state}`.slice(0, 100);
    const desc = `Visit ${v.name} in ${v.city}, ${v.state} and share your experience with friends to earn real discounts. Find more venues on LoopRef. #LoopRef #${v.cuisine.replace(/\s+/g,'')} #${v.city.replace(/\s+/g,'')}`.slice(0, 500);
    const link = `https://loopref.com/places/venue/?slug=${v.slug}`;
    const img  = resolved[i];

    rows.push([
      escapeCsv(title),
      escapeCsv(img),
      escapeCsv('loopref/venue'),
      '',               // Thumbnail - blank for image pins
      escapeCsv(desc),
      escapeCsv(link),
    ].join(','));
  }

  const outPath = path.join(__dirname, '../loopref-pins.csv');
  fs.writeFileSync(outPath, rows.join('\n'), 'utf8');
  console.log(`✅ Generated ${venues.length} rows → ${outPath}`);
  console.log('\nFirst 2 rows preview:');
  rows.slice(0, 3).forEach(r => console.log(r));
})();
