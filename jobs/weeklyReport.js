const nodemailer = require('nodemailer');
const { getDb } = require('../database/db');

// ─── Mailer setup ─────────────────────────────────────────────────────────────
// Supports any SMTP provider: Gmail, SendGrid, Postmark, etc.
// Set SMTP_* env vars; defaults to a test/preview mode when absent.
function createTransport() {
  if (!process.env.SMTP_HOST) {
    console.warn('[weeklyReport] No SMTP_HOST set — emails will be previewed in console only');
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

// ─── Data query ───────────────────────────────────────────────────────────────
function getWeeklyStats(restaurantId) {
  const db = getDb();

  // Pins posted in the last 7 days
  const postedThisWeek = db.prepare(`
    SELECT COUNT(*) as cnt FROM pinterest_pins
    WHERE restaurant_id = ? AND status = 'posted'
    AND posted_at >= datetime('now', '-7 days')
  `).get(restaurantId).cnt;

  // Cumulative performance across all posted pins
  const perf = db.prepare(`
    SELECT COALESCE(SUM(impressions), 0) as impressions,
           COALESCE(SUM(clicks), 0)      as clicks,
           COALESCE(SUM(saves), 0)       as saves
    FROM pinterest_pins
    WHERE restaurant_id = ? AND status = 'posted'
  `).get(restaurantId);

  // Attribution totals
  const attr = db.prepare(`
    SELECT COALESCE(SUM(landing_page_visits), 0) as visits,
           COALESCE(SUM(qr_scans), 0)            as scans,
           COALESCE(SUM(referrals_generated), 0)  as referrals
    FROM pinterest_attribution WHERE restaurant_id = ?
  `).get(restaurantId);

  // Top 3 pins this week by engagement
  const topPins = db.prepare(`
    SELECT title, impressions, clicks, saves,
           (impressions + clicks * 10 + saves * 5) as score
    FROM pinterest_pins
    WHERE restaurant_id = ? AND status = 'posted'
    ORDER BY score DESC LIMIT 3
  `).all(restaurantId);

  // Scheduled drafts coming up
  const upcoming = db.prepare(`
    SELECT COUNT(*) as cnt FROM pinterest_pins
    WHERE restaurant_id = ? AND status IN ('scheduled', 'draft')
  `).get(restaurantId).cnt;

  return { postedThisWeek, perf, attr, topPins, upcoming };
}

// ─── Email template ───────────────────────────────────────────────────────────
function buildEmailHtml(restaurant, stats, pinterestConnected) {
  const { postedThisWeek, perf, attr, topPins, upcoming } = stats;
  const estimatedRevenue = (attr.scans * (restaurant.min_spend || 50) * 0.10).toFixed(2);

  const topPinsHtml = topPins.length
    ? topPins.map(p => `
        <tr>
          <td style="padding:8px 0;font-size:14px;color:#374151;max-width:300px">${p.title}</td>
          <td style="padding:8px 12px;font-size:14px;text-align:center">${p.impressions.toLocaleString()}</td>
          <td style="padding:8px 12px;font-size:14px;text-align:center">${p.clicks}</td>
          <td style="padding:8px 12px;font-size:14px;text-align:center">${p.saves}</td>
        </tr>`).join('')
    : `<tr><td colspan="4" style="padding:8px;color:#6b7280;font-size:14px">No posted pins yet this week.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px">

    <!-- Header -->
    <div style="background:#0f172a;border-radius:12px 12px 0 0;padding:24px 32px;text-align:center">
      <div style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px">LoopRef</div>
      <div style="font-size:13px;color:#94a3b8;margin-top:4px">Weekly Pinterest Report</div>
    </div>

    <!-- Body -->
    <div style="background:#ffffff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">

      <p style="margin:0 0 24px;font-size:16px;color:#374151">
        Hi ${restaurant.contact_name || restaurant.name},<br><br>
        Here's how your Pinterest marketing performed this week.
      </p>

      <!-- Stats grid -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:28px">
        ${statCard('👁 Impressions', perf.impressions.toLocaleString(), '#dbeafe', '#1d4ed8')}
        ${statCard('🔗 Clicks', perf.clicks.toLocaleString(), '#dcfce7', '#15803d')}
        ${statCard('📌 Saves', perf.saves.toLocaleString(), '#fef9c3', '#a16207')}
        ${statCard('📍 QR Scans', attr.scans.toLocaleString(), '#fce7f3', '#be185d')}
        ${statCard('🧑‍🤝‍🧑 Referrals', attr.referrals.toLocaleString(), '#ede9fe', '#6d28d9')}
        ${statCard('💰 Est. Revenue', '$' + estimatedRevenue, '#d1fae5', '#065f46')}
      </div>

      <!-- Top pins -->
      <h3 style="margin:0 0 12px;font-size:16px;color:#111827">Top Performing Pins</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:28px">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:8px 0;font-size:12px;color:#6b7280;text-align:left;font-weight:600">PIN</th>
            <th style="padding:8px 12px;font-size:12px;color:#6b7280;font-weight:600">IMP.</th>
            <th style="padding:8px 12px;font-size:12px;color:#6b7280;font-weight:600">CLICKS</th>
            <th style="padding:8px 12px;font-size:12px;color:#6b7280;font-weight:600">SAVES</th>
          </tr>
        </thead>
        <tbody>${topPinsHtml}</tbody>
      </table>

      <!-- Activity summary -->
      <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:28px;font-size:14px;color:#374151">
        <strong>This week:</strong> ${postedThisWeek} pin${postedThisWeek !== 1 ? 's' : ''} posted
        &nbsp;·&nbsp; <strong>Upcoming:</strong> ${upcoming} pin${upcoming !== 1 ? 's' : ''} scheduled
        &nbsp;·&nbsp; <strong>Landing visits:</strong> ${attr.visits}
      </div>

      ${!pinterestConnected ? `
      <!-- CTA if not connected -->
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px;margin-bottom:28px">
        <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#c2410c">Pinterest not connected yet</p>
        <p style="margin:0 0 12px;font-size:13px;color:#7c2d12">Connect your Pinterest account to start reaching local food lovers automatically.</p>
        <a href="${process.env.BASE_URL || 'https://loopref.com'}/dashboard?restaurantId=${restaurant.id}" style="display:inline-block;background:#e60023;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600">Connect Pinterest →</a>
      </div>` : ''}

      <!-- Dashboard link -->
      <div style="text-align:center">
        <a href="${process.env.BASE_URL || 'https://loopref.com'}/dashboard?restaurantId=${restaurant.id}"
           style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600">
          View Full Dashboard →
        </a>
      </div>

    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:20px;font-size:12px;color:#9ca3af">
      LoopRef · Performance-based restaurant marketing<br>
      <a href="mailto:hello@loopref.com" style="color:#9ca3af">hello@loopref.com</a>
    </div>
  </div>
</body>
</html>`;
}

function statCard(label, value, bg, color) {
  return `
    <div style="background:${bg};border-radius:8px;padding:14px;text-align:center">
      <div style="font-size:20px;font-weight:700;color:${color}">${value}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:4px">${label}</div>
    </div>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────
async function sendWeeklyReports() {
  const db = getDb();

  const restaurants = db.prepare(`
    SELECT r.*, rp.board_id
    FROM restaurants r
    LEFT JOIN restaurant_pinterest rp ON rp.restaurant_id = r.id
    WHERE r.status = 'active' AND r.contact_email IS NOT NULL
  `).all();

  console.log(`[weeklyReport] Sending reports to ${restaurants.length} restaurant(s)...`);

  const transport = createTransport();

  for (const restaurant of restaurants) {
    try {
      const stats = getWeeklyStats(restaurant.id);
      const pinterestConnected = !!restaurant.board_id;
      const html = buildEmailHtml(restaurant, stats, pinterestConnected);

      const subject = stats.perf.impressions > 0
        ? `Your LoopRef Pinterest report: ${stats.perf.impressions.toLocaleString()} impressions this week`
        : `Your LoopRef Pinterest report — let's get your first pins live`;

      const mailOptions = {
        from: `LoopRef <${process.env.SMTP_FROM || 'hello@loopref.com'}>`,
        to: restaurant.contact_email,
        subject,
        html
      };

      if (transport) {
        await transport.sendMail(mailOptions);
        console.log(`[weeklyReport] Sent to ${restaurant.contact_email} (${restaurant.name})`);
      } else {
        // Preview mode — log subject and key stats
        console.log(`[weeklyReport] PREVIEW (no SMTP) → ${restaurant.contact_email}`);
        console.log(`  Subject: ${subject}`);
        console.log(`  Impressions: ${stats.perf.impressions} | Clicks: ${stats.perf.clicks} | Scans: ${stats.attr.scans}`);
      }
    } catch (err) {
      console.error(`[weeklyReport] Failed for ${restaurant.name}:`, err.message);
    }
  }
}

module.exports = { sendWeeklyReports };
