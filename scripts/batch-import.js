/**
 * Batch import venues from Google Places into LoopRef.
 *
 * Usage:
 *   node scripts/batch-import.js venues.txt
 *   node scripts/batch-import.js venues.csv
 *
 * Input file format — one venue per line:
 *   Papa Pizza New York
 *   Sushi Palace Los Angeles
 *   The Great Burger Chicago
 *
 * Or CSV (name, city):
 *   Papa Pizza, New York
 *   Sushi Palace, Los Angeles
 *
 * Or Google Maps URLs:
 *   https://maps.google.com/?place_id=ChIJ...
 *
 * Skips duplicates (matched by slug). Pauses between requests to avoid
 * Google API rate limits. Writes a results summary at the end.
 *
 * Requires GOOGLE_PLACES_API_KEY in .env
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { initDb } = require('../database/db');
const { importVenueFromGoogle } = require('./import-from-google');

const DELAY_MS = 1500; // pause between Google API calls

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseLines(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return raw
    .split('\n')
    .map(line => line.replace(/^["']|["']$/g, '').trim())
    .filter(line => line && !line.startsWith('#'));
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.log('Usage: node scripts/batch-import.js <venues-file>');
    console.log('');
    console.log('File format — one venue per line:');
    console.log('  Papa Pizza New York');
    console.log('  Sushi Palace Los Angeles');
    console.log('  https://maps.google.com/?place_id=ChIJ...');
    process.exit(1);
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const queries = parseLines(resolved);
  console.log(`\nFound ${queries.length} venues to import\n`);

  initDb();

  const results = { imported: [], skipped: [], failed: [] };

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    const progress = `[${i + 1}/${queries.length}]`;

    try {
      console.log(`${progress} Importing: ${query}`);
      const { restaurantId, slug } = await importVenueFromGoogle(query);
      results.imported.push({ query, restaurantId, slug });
      console.log(`${progress} Done: ${slug}\n`);
    } catch (err) {
      if (err.message.includes('Place not found')) {
        console.log(`${progress} SKIPPED (not found on Google): ${query}\n`);
        results.skipped.push({ query, reason: 'not found' });
      } else {
        console.error(`${progress} FAILED: ${query} — ${err.message}\n`);
        results.failed.push({ query, error: err.message });
      }
    }

    // Don't hammer Google API
    if (i < queries.length - 1) await sleep(DELAY_MS);
  }

  // Summary
  console.log('═══════════════════════════════════════');
  console.log(`  Imported: ${results.imported.length}`);
  console.log(`  Skipped:  ${results.skipped.length}`);
  console.log(`  Failed:   ${results.failed.length}`);
  console.log(`  Total:    ${queries.length}`);
  console.log('═══════════════════════════════════════');

  if (results.failed.length) {
    console.log('\nFailed venues:');
    results.failed.forEach(f => console.log(`  - ${f.query}: ${f.error}`));
  }

  // Write results to a log file for reference
  const logPath = path.join(__dirname, `../batch-import-${Date.now()}.json`);
  fs.writeFileSync(logPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to: ${logPath}`);
}

main().catch(err => {
  console.error('Batch import failed:', err);
  process.exit(1);
});
