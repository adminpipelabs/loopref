const nodemailer = require('nodemailer');
const { getDb } = require('../database/db');

// ─── Mailer setup (reuses same SMTP config as weekly reports) ────────────────
function createTransport() {
  if (!process.env.SMTP_HOST) {
    console.warn('[monthlyReport] No SMTP_HOST set — emails will be previewed in console only');
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

// ─── Data query ──────────────────────────────────────────────────────────────
function getMonthlyStats(restaurantId) {
  const db = getDb();

  const shares = db.prepare(`
    SELECT COUNT(*) as total_shares, COALESCE(SUM(clicks), 0) as total_clicks,
           COALESCE(SUM(verified_clicks), 0) as verified_clicks
    FROM customer_shares
    WHERE restaurant_id = ? AND created_at >= datetime('now', '-30 days')
  `).get(restaurantId);

  const allTime = db.prepare(`
    SELECT COUNT(*) as total_shares, COALESCE(SUM(clicks), 0) as total_clicks,
           COALESCE(SUM(verified_clicks), 0) as verified_clicks
    FROM customer_shares WHERE restaurant_id = ?
  `).get(restaurantId);

  const topSharers = db.prepare(`
    SELECT sharer_name, clicks, created_at
    FROM customer_shares
    WHERE restaurant_id = ? AND clicks > 0
    ORDER BY clicks DESC LIMIT 5
  `).all(restaurantId);

  return { shares, allTime, topSharers };
}

// ─── Email HTML ──────────────────────────────────────────────────────────────
function buildEmailHtml(restaurant, stats) {
  const monthName = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const BASE = process.env.BASE_URL || 'https://loopref.com';

  function statCard(label, value) {
    return `<td style="padding:12px 16px;text-align:center;background:#fff;border-radius:8px;border:1px solid #e8e0d0;">
      <div style="font-size:28px;font-weight:800;color:#1a1208;line-height:1;">${value}</div>
      <div style="font-size:11px;color:#9a8a78;margin-top:4px;">${label}</div>
    </td>`;
  }

  const topSharersHtml = stats.topSharers.length
    ? stats.topSharers.map((s, i) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e8e0d0;font-size:13px;color:#5a4f40;">${i + 1}. ${s.sharer_name || 'Anonymous'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e8e0d0;font-size:13px;font-weight:700;color:#1a1208;text-align:right;">${s.clicks} clicks</td>
        </tr>`
      ).join('')
    : '<tr><td colspan="2" style="padding:12px;font-size:13px;color:#9a8a78;text-align:center;">No shares yet this month</td></tr>';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fffdf9;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;">

  <!-- Header -->
  <div style="text-align:center;margin-bottom:28px;">
    <div style="font-size:22px;font-weight:800;color:#1a1208;">loop<span style="color:#ff6b35;">ref</span></div>
    <div style="font-size:12px;color:#9a8a78;margin-top:4px;">Monthly Report &mdash; ${monthName}</div>
  </div>

  <!-- Greeting -->
  <div style="margin-bottom:24px;">
    <div style="font-size:20px;font-weight:700;color:#1a1208;margin-bottom:8px;">Hi ${restaurant.contact_name || 'there'},</div>
    <div style="font-size:14px;color:#5a4f40;line-height:1.6;">
      Here is your monthly summary for <strong>${restaurant.name}</strong>. This shows how many people shared your venue and how many friends clicked through.
    </div>
  </div>

  <!-- Stats -->
  <table style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:24px;">
    <tr>
      ${statCard('Shares this month', stats.shares.total_shares)}
      ${statCard('Verified referrals', stats.shares.verified_clicks)}
    </tr>
    <tr>
      ${statCard('All-time shares', stats.allTime.total_shares)}
      ${statCard('All-time verified', stats.allTime.verified_clicks)}
    </tr>
  </table>

  <!-- Top sharers -->
  <div style="background:#fff;border:1px solid #e8e0d0;border-radius:10px;padding:16px;margin-bottom:24px;">
    <div style="font-size:14px;font-weight:700;color:#1a1208;margin-bottom:12px;">Top sharers</div>
    <table style="width:100%;border-collapse:collapse;">
      ${topSharersHtml}
    </table>
  </div>

  <!-- CTA -->
  <div style="text-align:center;margin-bottom:32px;">
    <a href="${BASE}/places/venue/?slug=${restaurant.slug}" style="display:inline-block;padding:12px 28px;background:#ff6b35;color:#fff;border-radius:8px;font-size:14px;font-weight:700;text-decoration:none;">View your venue page</a>
  </div>

  <!-- Footer -->
  <div style="text-align:center;font-size:11px;color:#9a8a78;border-top:1px solid #e8e0d0;padding-top:16px;">
    <a href="${BASE}" style="color:#ff6b35;text-decoration:none;">loopref.com</a> &mdash; Real discounts, real places.<br>
    Questions? Reply to this email.
  </div>

</div>
</body></html>`;
}

// ─── Send reports ────────────────────────────────────────────────────────────
async function sendMonthlyReports() {
  const db = getDb();
  const transport = createTransport();

  const restaurants = db.prepare(`
    SELECT * FROM restaurants
    WHERE contact_email IS NOT NULL AND contact_email NOT LIKE 'imported+%'
  `).all();

  if (!restaurants.length) {
    console.log('[monthlyReport] No restaurants with real contact emails — skipping');
    return;
  }

  const from = process.env.SMTP_FROM || 'LoopRef <hello@loopref.com>';

  for (const r of restaurants) {
    const stats = getMonthlyStats(r.id);
    const html = buildEmailHtml(r, stats);
    const subject = `Your LoopRef monthly report: ${stats.shares.verified_clicks} verified referrals in ${new Date().toLocaleString('en-US', { month: 'long' })}`;

    if (!transport) {
      console.log(`[monthlyReport] PREVIEW for ${r.name} (${r.contact_email}):`);
      console.log(`  Subject: ${subject}`);
      console.log(`  Shares: ${stats.shares.total_shares}, Clicks: ${stats.shares.total_clicks}`);
      continue;
    }

    try {
      await transport.sendMail({ from, to: r.contact_email, subject, html });
      console.log(`[monthlyReport] Sent to ${r.contact_email} (${r.name})`);
    } catch (err) {
      console.error(`[monthlyReport] Failed for ${r.contact_email}:`, err.message);
    }
  }
}

module.exports = { sendMonthlyReports, getMonthlyStats };
