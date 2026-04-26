// Screenshot script using node-fetch + local server
// Saves base64 images from Preview MCP manually - this is a placeholder
// We'll use the macOS `screencapture` approach via AppleScript + Safari
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const pages = [
  { name: '01-home', url: 'http://localhost:3000/', delay: 1500, scrollY: 0 },
  { name: '02-discover', url: 'http://localhost:3000/app/', delay: 2000, scrollY: 0 },
  { name: '03-venue', url: 'http://localhost:3000/app/#venue?slug=raos-new-york', delay: 2500, scrollY: 0 },
  { name: '04-share', url: 'http://localhost:3000/app/#venue?slug=raos-new-york', delay: 2500, scrollY: 300 },
  { name: '05-admin', url: 'http://localhost:3000/admin/', delay: 1500, scrollY: 0 },
];

// Output the URL list for use by other tools
pages.forEach(p => console.log(JSON.stringify(p)));
