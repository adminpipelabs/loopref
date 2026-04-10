/**
 * Seed script — import venues into LoopRef without requiring owner sign-up.
 * Run: node scripts/seed-venues.js
 */
require('dotenv').config();
const { getDb, initDb } = require('../database/db');

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

const venues = [
  {
    name: 'Bebe Zito',
    cuisine: 'Ice Cream',
    city: 'Minneapolis',
    state: 'MN',
    country: 'US',
    address: '704 W. 22nd Street, Minneapolis, MN 55405',
    phone: '(612) 315-5180',
    tagline: 'Handmade, deliciously compelling Minneapolis ice cream.',
    website: 'https://www.bebezitomn.com',
    instagram_handle: 'bebezito',
    min_spend: 12,
    discount_pct: 20,
    google_maps_url: 'https://maps.google.com/?q=Bebe+Zito+Minneapolis',
    imported_from: 'https://www.bebezitomn.com',
    photos: [
      // Pull from their public website / social media
      // Swap for real CDN URLs once you have them
      {
        url: 'https://images.squarespace-cdn.com/content/v1/5e6a2a7f5fe58536f7b88025/ice-cream-1.jpg',
        dish_name: 'Signature Scoop'
      },
      {
        url: 'https://images.squarespace-cdn.com/content/v1/5e6a2a7f5fe58536f7b88025/ice-cream-2.jpg',
        dish_name: 'Double Cone'
      },
    ]
  }
];

function importVenue(db, venue) {
  const slug = slugify(`${venue.name}-${venue.city}`);
  const existing = db.prepare('SELECT id FROM restaurants WHERE slug = ?').get(slug);

  let restaurantId;

  if (existing) {
    db.prepare(`
      UPDATE restaurants SET
        name=?, cuisine=?, city=?, state=?, country=?, address=?, phone=?, tagline=?,
        website=?, instagram_handle=?, min_spend=?, discount_pct=?, google_maps_url=?,
        imported_from=?, source='imported', status='imported'
      WHERE slug=?
    `).run(
      venue.name, venue.cuisine, venue.city, venue.state, venue.country,
      venue.address, venue.phone, venue.tagline, venue.website,
      venue.instagram_handle, venue.min_spend, venue.discount_pct,
      venue.google_maps_url, venue.imported_from, slug
    );
    restaurantId = existing.id;
    console.log(`Updated: ${venue.name} (slug: ${slug}, id: ${restaurantId})`);
  } else {
    const r = db.prepare(`
      INSERT INTO restaurants
        (name, slug, cuisine, city, state, country, address, phone, tagline, website,
         instagram_handle, min_spend, discount_pct, google_maps_url, imported_from,
         source, status, contact_email)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'imported','imported',?)
    `).run(
      venue.name, slug, venue.cuisine, venue.city, venue.state, venue.country,
      venue.address, venue.phone, venue.tagline, venue.website,
      venue.instagram_handle, venue.min_spend, venue.discount_pct,
      venue.google_maps_url, venue.imported_from,
      `imported+${slug}@loopref.com`
    );
    restaurantId = r.lastInsertRowid;
    console.log(`Imported: ${venue.name} (slug: ${slug}, id: ${restaurantId})`);
  }

  // Insert photos (skip duplicates)
  if (venue.photos?.length) {
    const insertPhoto = db.prepare(`
      INSERT OR IGNORE INTO restaurant_photos (restaurant_id, photo_url, dish_name, source)
      VALUES (?, ?, ?, 'import')
    `);
    for (const p of venue.photos) {
      insertPhoto.run(restaurantId, p.url, p.dish_name || null);
    }
    console.log(`  → ${venue.photos.length} photo(s) attached`);
  }

  return { restaurantId, slug };
}

// ── Run ──
initDb();
const db = getDb();

console.log('Seeding venues…\n');
for (const venue of venues) {
  const { slug } = importVenue(db, venue);
  console.log(`  Preview: http://localhost:3000/places/venue/?slug=${slug}\n`);
}
console.log('Done.');
