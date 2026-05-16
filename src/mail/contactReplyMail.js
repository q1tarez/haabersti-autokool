const { sendMail } = require("./transport");

async function sendContactReplyMail({ to, recipientName, subject, message }) {
  const subj = subject || "Haabersti Autokool — ответ на ваше обращение";
  const greeting = recipientName ? `Здравствуйте, ${recipientName}!` : "Здравствуйте!";
  const text = `${greeting}\n\n${message}\n\n— Haabersti Autokool\nTallinn`;
  const bodyHtml = String(message).replace(/\n/g, "<br>");
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.55">
<p>${greeting}</p>
<div style="margin:16px 0;padding:14px;background:#f8fafc;border-radius:8px">${bodyHtml}</div>
<p style="color:#64748b;font-size:13px">— Haabersti Autokool · Tallinn</p>
</body></html>`;
  return sendMail({ to, subject: subj, text, html });
}

module.exports = { sendContactReplyMail };
