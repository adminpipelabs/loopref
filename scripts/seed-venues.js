/**
 * Seed LoopRef with venue directory — no API keys required.
 * Run: node scripts/seed-venues.js
 *
 * This inserts venues as 'active' status with default 20% discount / $50 min spend /
 * min_verified_referrals=5. Basic tier venues are active by default — no registration needed.
 */
require('dotenv').config();
const { getDb, initDb } = require('../database/db');

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '').trim()
    .replace(/\s+/g, '-').replace(/-+/g, '-');
}

// ─── Venue list ──────────────────────────────────────────────────────────────

const venues = [
  // New York City
  { name: "Russ & Daughters", city: "New York", state: "NY", cuisine: "Deli" },
  { name: "Rao's", city: "New York", state: "NY", cuisine: "Italian" },
  { name: "Ferrara Bakery & Cafe", city: "New York", state: "NY", cuisine: "Bakery" },
  { name: "Veniero's Pasticceria & Caffe", city: "New York", state: "NY", cuisine: "Bakery" },
  { name: "Zaro's Family Bakery", city: "New York", state: "NY", cuisine: "Bakery" },
  { name: "Bamonte's", city: "Brooklyn", state: "NY", cuisine: "Italian" },
  { name: "Randazzo's Clam Bar", city: "Brooklyn", state: "NY", cuisine: "Seafood" },
  { name: "DiTondo's", city: "New York", state: "NY", cuisine: "Italian" },
  { name: "Tony's Di Napoli", city: "New York", state: "NY", cuisine: "Italian" },
  { name: "Barney Greengrass", city: "New York", state: "NY", cuisine: "Deli" },

  // California
  { name: "The Saugus Cafe", city: "Santa Clarita", state: "CA", cuisine: "Restaurant" },
  { name: "Cole's", city: "Los Angeles", state: "CA", cuisine: "Restaurant" },
  { name: "Philippe the Original", city: "Los Angeles", state: "CA", cuisine: "Restaurant" },
  { name: "Fair Oaks Pharmacy & Soda Fountain", city: "South Pasadena", state: "CA", cuisine: "Restaurant" },
  { name: "Musso & Frank Grill", city: "Los Angeles", state: "CA", cuisine: "Restaurant" },
  { name: "Joe Jost", city: "Long Beach", state: "CA", cuisine: "Restaurant" },
  { name: "Original Pantry Cafe", city: "Los Angeles", state: "CA", cuisine: "Restaurant" },
  { name: "Bay Cities Italian Deli", city: "Santa Monica", state: "CA", cuisine: "Deli" },
  { name: "Formosa Cafe", city: "West Hollywood", state: "CA", cuisine: "Restaurant" },
  { name: "Tam O'Shanter", city: "Los Angeles", state: "CA", cuisine: "Restaurant" },
  { name: "Lanza Brothers Market", city: "Los Angeles", state: "CA", cuisine: "Deli" },
  { name: "Barney's Beanery", city: "West Hollywood", state: "CA", cuisine: "Restaurant" },
  { name: "El Cholo", city: "Los Angeles", state: "CA", cuisine: "Mexican" },
  { name: "Eastside Market & Italian Deli", city: "Los Angeles", state: "CA", cuisine: "Deli" },
  { name: "The Rock Inn", city: "Lake Hughes", state: "CA", cuisine: "Restaurant" },
  { name: "Brighton Coffee Shop", city: "Beverly Hills", state: "CA", cuisine: "Coffee" },
  { name: "Canter's", city: "Los Angeles", state: "CA", cuisine: "Deli" },
  { name: "El Coyote", city: "Los Angeles", state: "CA", cuisine: "Mexican" },
  { name: "Halfway House Cafe", city: "Santa Clarita", state: "CA", cuisine: "Restaurant" },
  { name: "Colonial Kitchen", city: "San Marino", state: "CA", cuisine: "Restaurant" },
  { name: "Damon's Steak House", city: "Glendale", state: "CA", cuisine: "Steakhouse" },
  { name: "Mitla Cafe", city: "San Bernardino", state: "CA", cuisine: "Mexican" },
  { name: "The Derby Restaurant", city: "Arcadia", state: "CA", cuisine: "Restaurant" },
  { name: "Du-par's", city: "Los Angeles", state: "CA", cuisine: "Restaurant" },
  { name: "Lawry's The Prime Rib", city: "Beverly Hills", state: "CA", cuisine: "Steakhouse" },
  { name: "Snug Harbor", city: "Santa Monica", state: "CA", cuisine: "Restaurant" },
  { name: "Carrillo's Tortilleria", city: "San Fernando", state: "CA", cuisine: "Mexican" },
  { name: "Barone's Pizzeria", city: "Valley Glen", state: "CA", cuisine: "Pizza" },
  { name: "Nate 'n Al", city: "Beverly Hills", state: "CA", cuisine: "Deli" },
  { name: "Chili John's", city: "Burbank", state: "CA", cuisine: "Restaurant" },
  { name: "Chris & Pitts", city: "Bellflower", state: "CA", cuisine: "BBQ" },
  { name: "Clearman's Steak 'n Stein", city: "Pico Rivera", state: "CA", cuisine: "Steakhouse" },
  { name: "Nick's Coffee Shop", city: "Los Angeles", state: "CA", cuisine: "Coffee" },
  { name: "Original Tommy's Hamburgers", city: "Los Angeles", state: "CA", cuisine: "Burgers" },
  { name: "Paul's Kitchen", city: "Los Angeles", state: "CA", cuisine: "Restaurant" },
  { name: "Pecos Bill's BBQ", city: "Glendale", state: "CA", cuisine: "BBQ" },
  { name: "The Smoke House Restaurant", city: "Burbank", state: "CA", cuisine: "Restaurant" },

  // Chicago
  { name: "Ragadan", city: "Chicago", state: "IL", cuisine: "Restaurant" },
  { name: "Aloha Eats", city: "Chicago", state: "IL", cuisine: "Restaurant" },
  { name: "Tacotlan", city: "Chicago", state: "IL", cuisine: "Mexican" },
  { name: "Cedar Palace", city: "Chicago", state: "IL", cuisine: "Restaurant" },
  { name: "Twin Anchors", city: "Chicago", state: "IL", cuisine: "BBQ" },
  { name: "Marrakech", city: "Chicago", state: "IL", cuisine: "Restaurant" },
  { name: "La Scarola", city: "Chicago", state: "IL", cuisine: "Italian" },
  { name: "Gene & Georgetti", city: "Chicago", state: "IL", cuisine: "Steakhouse" },
  { name: "Cairo Kebab", city: "Chicago", state: "IL", cuisine: "Restaurant" },
  { name: "5 Rabanitos", city: "Chicago", state: "IL", cuisine: "Mexican" },
  { name: "Qing Xiang Yuan Dumplings", city: "Chicago", state: "IL", cuisine: "Chinese" },
  { name: "Carnicería Maribel", city: "Chicago", state: "IL", cuisine: "Mexican" },
  { name: "Ricobene's", city: "Chicago", state: "IL", cuisine: "Restaurant" },

  // Miami
  { name: "Amelia's 1931", city: "Miami", state: "FL", cuisine: "Restaurant" },
  { name: "Awash Ethiopian Restaurant", city: "Miami", state: "FL", cuisine: "Ethiopian" },
  { name: "Mignonette", city: "Miami", state: "FL", cuisine: "Seafood" },
  { name: "Ghee Indian Kitchen", city: "Miami", state: "FL", cuisine: "Indian" },
  { name: "La Camaronera", city: "Miami", state: "FL", cuisine: "Seafood" },
  { name: "Sra. Martinez", city: "Miami", state: "FL", cuisine: "Restaurant" },
  { name: "Cafe La Trova", city: "Miami", state: "FL", cuisine: "Cuban" },
  { name: "Paya", city: "Miami", state: "FL", cuisine: "Restaurant" },
  { name: "Zitz Sum", city: "Miami", state: "FL", cuisine: "Chinese" },
];

// ─── Import logic ────────────────────────────────────────────────────────────

function seedVenue(db, venue) {
  const slug = slugify(`${venue.name}-${venue.city}`);
  const existing = db.prepare('SELECT id FROM restaurants WHERE slug = ?').get(slug);

  if (existing) {
    console.log(`  SKIP (exists): ${venue.name} — ${venue.city}`);
    return { id: existing.id, slug, skipped: true };
  }

  const r = db.prepare(`
    INSERT INTO restaurants
      (name, slug, cuisine, city, state, country, min_spend, discount_pct,
       min_verified_referrals, source, status, contact_email)
    VALUES (?, ?, ?, ?, ?, 'US', 50, 20, 5, 'seed', 'active', ?)
  `).run(
    venue.name, slug, venue.cuisine, venue.city, venue.state,
    `imported+${slug}@loopref.com`
  );

  console.log(`  ADDED: ${venue.name} — ${venue.city} (id: ${r.lastInsertRowid})`);
  return { id: r.lastInsertRowid, slug, skipped: false };
}

// ─── Exported seed function (called from server.js on first boot) ────────────

function seedAll(db) {
  let added = 0, skipped = 0;
  for (const venue of venues) {
    const result = seedVenue(db, venue);
    if (result.skipped) skipped++; else added++;
  }
  console.log(`Seeded: ${added} added, ${skipped} skipped (${venues.length} total)`);
  return { added, skipped };
}

module.exports = { seedAll, venues };

// ─── CLI: node scripts/seed-venues.js ────────────────────────────────────────

if (require.main === module) {
  initDb();
  const db = getDb();
  console.log(`\nSeeding ${venues.length} venues...\n`);
  seedAll(db);
}
