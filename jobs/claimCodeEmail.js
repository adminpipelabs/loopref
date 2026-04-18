const nodemailer = require('nodemailer');

function createTransport() {
  if (!process.env.SMTP_HOST) {
    console.warn('[claimCodeEmail] No SMTP_HOST set — emails will be previewed in console only');
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

function buildEmailHtml({ sharerName, restaurantName, discountPct, minSpend, claimCode, claimUrl }) {
  const greeting = sharerName ? `Hi ${sharerName},` : 'Hi there,';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fffdf9;">
<div style="max-width:520px;margin:0 auto;padding:32px 20px;">

  <div style="text-align:center;margin-bottom:28px;">
    <div style="font-size:22px;font-weight:800;color:#1a1208;">loop<span style="color:#ff6b35;">ref</span></div>
  </div>

  <div style="background:#fff;border:1px solid #e8e0d0;border-radius:14px;padding:32px;text-align:center;">
    <div style="font-size:40px;margin-bottom:12px;">&#127881;</div>
    <h1 style="font-size:22px;color:#1a1208;margin:0 0 12px 0;">Your discount is unlocked!</h1>
    <p style="font-size:14px;color:#5a4f40;line-height:1.6;margin:0 0 24px 0;">${greeting} your friends came through &mdash; you&rsquo;ve unlocked <strong>${discountPct}% off</strong> at <strong>${restaurantName}</strong>${minSpend ? ` when you spend $${minSpend}+` : ''}.</p>

    <div style="background:#ff6b3510;border:2px dashed #ff6b35;border-radius:10px;padding:20px;margin-bottom:24px;">
      <div style="font-size:11px;color:#9a8a78;margin-bottom:6px;letter-spacing:0.1em;">YOUR CLAIM CODE</div>
      <div style="font-family:monospace;font-size:28px;font-weight:800;color:#1a1208;letter-spacing:2px;">${claimCode}</div>
    </div>

    <a href="${claimUrl}" style="display:inline-block;padding:14px 32px;background:#ff6b35;color:#fff;border-radius:8px;font-size:14px;font-weight:700;text-decoration:none;">Open claim page</a>

    <p style="font-size:12px;color:#9a8a78;line-height:1.6;margin:20px 0 0 0;">Show this code at the till on your next visit. The staff will tap to redeem and apply your discount.</p>
  </div>

  <div style="text-align:center;font-size:11px;color:#9a8a78;margin-top:24px;">
    Thanks for sharing! Powered by <a href="${process.env.BASE_URL || 'https://loopref.com'}" style="color:#ff6b35;text-decoration:none;">LoopRef</a>
  </div>

</div>
</body></html>`;
}

async function sendClaimCodeEmail({ to, sharerName, restaurantName, discountPct, minSpend, claimCode, claimUrl }) {
  const transport = createTransport();
  const from = process.env.SMTP_FROM || 'LoopRef <hello@loopref.com>';
  const subject = `Your ${discountPct}% off at ${restaurantName} is unlocked! Code: ${claimCode}`;
  const html = buildEmailHtml({ sharerName, restaurantName, discountPct, minSpend, claimCode, claimUrl });

  if (!transport) {
    console.log(`[claimCodeEmail] PREVIEW for ${to}:`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Code: ${claimCode}`);
    return;
  }

  await transport.sendMail({ from, to, subject, html });
  console.log(`[claimCodeEmail] Sent to ${to} (code: ${claimCode})`);
}

module.exports = { sendClaimCodeEmail };
