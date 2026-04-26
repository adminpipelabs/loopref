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

// ─── Geo-enrichment data (Nominatim, one-time lookup) ───────────────────────
const enriched = {
  "5-rabanitos-chicago": {address:"1301 East 53rd Street, Chicago, IL",lat:41.7993384,lng:-87.5948433,google_maps_url:"https://www.google.com/maps/search/?api=1&query=41.7993384,-87.5948433"},
  "aloha-eats-chicago": {address:"2534 North Clark Street, Chicago, IL",lat:41.9288349,lng:-87.6425793,google_maps_url:"https://www.google.com/maps/search/?api=1&query=41.9288349,-87.6425793"},
  "bamontes-brooklyn": {address:"32 Withers Street, Brooklyn, NY",lat:40.7166443,lng:-73.9512196,google_maps_url:"https://www.google.com/maps/search/?api=1&query=40.7166443,-73.9512196"},
  "barney-greengrass-new-york": {address:"541 Amsterdam Avenue, New York, NY",lat:40.7879651,lng:-73.9745536,google_maps_url:"https://www.google.com/maps/search/?api=1&query=40.7879651,-73.9745536"},
  "barneys-beanery-west-hollywood": {address:"8447 Santa Monica Blvd, West Hollywood, CA",lat:34.0907823,lng:-118.3746609,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.0907823,-118.3746609"},
  "bay-cities-italian-deli-santa-monica": {address:"1517 Lincoln Boulevard, Santa Monica, CA",lat:34.0179803,lng:-118.4891866,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.0179803,-118.4891866"},
  "brighton-coffee-shop-beverly-hills": {address:"9600 Brighton Way, Beverly Hills, CA",lat:34.0683507,lng:-118.4040251,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.0683507,-118.4040251"},
  "cafe-la-trova-miami": {address:"971 Southwest 8th Street, Miami, FL",lat:25.7661828,lng:-80.2104728,google_maps_url:"https://www.google.com/maps/search/?api=1&query=25.7661828,-80.2104728"},
  "cairo-kebab-chicago": {address:"730 West Maxwell Street, Chicago, IL",lat:41.8649119,lng:-87.6463868,google_maps_url:"https://www.google.com/maps/search/?api=1&query=41.8649119,-87.6463868"},
  "canters-los-angeles": {address:"419 N Fairfax Ave, Los Angeles, CA",lat:34.0780,lng:-118.3616,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.0780,-118.3616"},
  "carnicera-maribel-chicago": {address:"1801 West Cermak Road, Chicago, IL",lat:41.8520994,lng:-87.6711026,google_maps_url:"https://www.google.com/maps/search/?api=1&query=41.8520994,-87.6711026"},
  "cedar-palace-chicago": {address:"655 West Armitage Avenue, Chicago, IL",lat:41.9180485,lng:-87.6456973,google_maps_url:"https://www.google.com/maps/search/?api=1&query=41.9180485,-87.6456973"},
  "chris-pitts-bellflower": {address:"13049 Artesia Blvd, Bellflower, CA",lat:33.8751394,lng:-118.123568,google_maps_url:"https://www.google.com/maps/search/?api=1&query=33.8751394,-118.123568"},
  "coles-los-angeles": {address:"118 East 6th Street, Los Angeles, CA",lat:34.0448335,lng:-118.2495584,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.0448335,-118.2495584"},
  "colonial-kitchen-san-marino": {address:"1110 Huntington Drive, San Marino, CA",lat:34.1135498,lng:-118.1235345,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.1135498,-118.1235345"},
  "damons-steak-house-glendale": {address:"317 North Brand Boulevard, Glendale, CA",lat:34.1506236,lng:-118.2553022,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.1506236,-118.2553022"},
  "du-pars-los-angeles": {address:"6333 West 3rd Street, Los Angeles, CA",lat:34.0719374,lng:-118.3609965,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.0719374,-118.3609965"},
  "el-cholo-los-angeles": {address:"1121 Western Avenue, Los Angeles, CA",lat:34.0502622,lng:-118.3093489,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.0502622,-118.3093489"},
  "el-coyote-los-angeles": {address:"7312 Beverly Boulevard, Los Angeles, CA",lat:34.0759336,lng:-118.3492387,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.0759336,-118.3492387"},
  "formosa-cafe-west-hollywood": {address:"7156 Santa Monica Boulevard, West Hollywood, CA",lat:34.090547,lng:-118.3460827,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.090547,-118.3460827"},
  "gene-georgetti-chicago": {address:"500 North Franklin Street, Chicago, IL",lat:41.8909126,lng:-87.6358047,google_maps_url:"https://www.google.com/maps/search/?api=1&query=41.8909126,-87.6358047"},
  "joe-jost-long-beach": {address:"2803 East Anaheim Street, Long Beach, CA",lat:33.7827312,lng:-118.1587199,google_maps_url:"https://www.google.com/maps/search/?api=1&query=33.7827312,-118.1587199"},
  "la-scarola-chicago": {address:"721 West Grand Avenue, Chicago, IL",lat:41.8910439,lng:-87.6468381,google_maps_url:"https://www.google.com/maps/search/?api=1&query=41.8910439,-87.6468381"},
  "mignonette-miami": {address:"210 Northeast 18th Street, Miami, FL",lat:25.7932402,lng:-80.1905953,google_maps_url:"https://www.google.com/maps/search/?api=1&query=25.7932402,-80.1905953"},
  "mitla-cafe-san-bernardino": {address:"602 6th Street, San Bernardino, CA",lat:34.1103494,lng:-117.3143423,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.1103494,-117.3143423"},
  "musso-frank-grill-los-angeles": {address:"6667 Hollywood Boulevard, Los Angeles, CA",lat:34.101763,lng:-118.3350264,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.101763,-118.3350264"},
  "original-pantry-cafe-los-angeles": {address:"875 James M Wood Boulevard, Los Angeles, CA",lat:34.0463719,lng:-118.2628977,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.0463719,-118.2628977"},
  "original-tommys-hamburgers-los-angeles": {address:"2575 Beverly Blvd, Los Angeles, CA",lat:34.0695496,lng:-118.2765586,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.0695496,-118.2765586"},
  "pauls-kitchen-los-angeles": {address:"1012 South San Pedro Street, Los Angeles, CA",lat:34.0353749,lng:-118.2515686,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.0353749,-118.2515686"},
  "philippe-the-original-los-angeles": {address:"1001 North Alameda Street, Los Angeles, CA",lat:34.0596738,lng:-118.236941,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.0596738,-118.236941"},
  "qing-xiang-yuan-dumplings-chicago": {address:"2002 South Wentworth Avenue, Chicago, IL",lat:41.8551965,lng:-87.6320105,google_maps_url:"https://www.google.com/maps/search/?api=1&query=41.8551965,-87.6320105"},
  "ragadan-chicago": {address:"4409 North Broadway, Chicago, IL",lat:41.9621297,lng:-87.655154,google_maps_url:"https://www.google.com/maps/search/?api=1&query=41.9621297,-87.655154"},
  "randazzos-clam-bar-brooklyn": {address:"2017 Emmons Avenue, Brooklyn, NY",lat:40.5838967,lng:-73.9476461,google_maps_url:"https://www.google.com/maps/search/?api=1&query=40.5838967,-73.9476461"},
  "raos-new-york": {address:"455 East 114th Street, New York, NY",lat:40.7939234,lng:-73.9342665,google_maps_url:"https://www.google.com/maps/search/?api=1&query=40.7939234,-73.9342665"},
  "ricobenes-chicago": {address:"252 West 26th Street, Chicago, IL",lat:41.8456025,lng:-87.6339433,google_maps_url:"https://www.google.com/maps/search/?api=1&query=41.8456025,-87.6339433"},
  "russ-daughters-new-york": {address:"179 East Houston Street, New York, NY",lat:40.7225826,lng:-73.9881925,google_maps_url:"https://www.google.com/maps/search/?api=1&query=40.7225826,-73.9881925"},
  "snug-harbor-santa-monica": {address:"2323 Wilshire Boulevard, Santa Monica, CA",lat:34.034014,lng:-118.4802161,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.034014,-118.4802161"},
  "tacotlan-chicago": {address:"4312 West Fullerton Avenue, Chicago, IL",lat:41.9245881,lng:-87.7346906,google_maps_url:"https://www.google.com/maps/search/?api=1&query=41.9245881,-87.7346906"},
  "tam-oshanter-los-angeles": {address:"2980 Los Feliz Boulevard, Los Angeles, CA",lat:34.1254538,lng:-118.2641986,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.1254538,-118.2641986"},
  "the-derby-restaurant-arcadia": {address:"233 East Huntington Drive, Arcadia, CA",lat:34.1404804,lng:-118.0237202,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.1404804,-118.0237202"},
  "the-rock-inn-lake-hughes": {address:"Elizabeth Lake Road, Lake Hughes, CA",lat:34.675184,lng:-118.4404998,google_maps_url:"https://www.google.com/maps/search/?api=1&query=34.675184,-118.4404998"},
  "tonys-di-napoli-new-york": {address:"147 West 43rd Street, New York, NY",lat:40.7563915,lng:-73.9854253,google_maps_url:"https://www.google.com/maps/search/?api=1&query=40.7563915,-73.9854253"},
  "twin-anchors-chicago": {address:"1655 North Sedgwick Street, Chicago, IL",lat:41.9127223,lng:-87.638378,google_maps_url:"https://www.google.com/maps/search/?api=1&query=41.9127223,-87.638378"},
  "venieros-pasticceria-caffe-new-york": {address:"342 East 11th Street, New York, NY",lat:40.7294715,lng:-73.9844822,google_maps_url:"https://www.google.com/maps/search/?api=1&query=40.7294715,-73.9844822"},
  "zaros-family-bakery-new-york": {address:"2916 Ditmars Blvd, Astoria, NY",lat:40.7735267,lng:-73.8717729,google_maps_url:"https://www.google.com/maps/search/?api=1&query=40.7735267,-73.8717729"},
};

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
       min_verified_referrals, source, status, contact_email,
       address, lat, lng, google_maps_url, website, phone)
    VALUES (?, ?, ?, ?, ?, 'US', 50, 20, 5, 'seed', 'active', ?,
            ?, ?, ?, ?, ?, ?)
  `).run(
    venue.name, slug, venue.cuisine, venue.city, venue.state,
    `imported+${slug}@loopref.com`,
    (enriched[slug] && enriched[slug].address) || venue.address || null,
    (enriched[slug] && enriched[slug].lat) || venue.lat || null,
    (enriched[slug] && enriched[slug].lng) || venue.lng || null,
    (enriched[slug] && enriched[slug].google_maps_url) || venue.google_maps_url || `https://maps.google.com/?q=${encodeURIComponent(venue.name + ' ' + venue.city + ' ' + (venue.state||''))}`,
    venue.website || null,
    venue.phone || null
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
