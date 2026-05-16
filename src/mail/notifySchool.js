const { hasSmtpConfig, sendMail } = require("./transport");

async function sendTelegram(text) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function notifySchool({ subject, text, html }) {
  const to = String(process.env.ADMIN_NOTIFY_EMAIL || process.env.SCHOOL_CONTACT_EMAIL || "").trim();
  const results = { email: false, telegram: false, logged: false };

  if (!to && !process.env.TELEGRAM_BOT_TOKEN) {
    // eslint-disable-next-line no-console
    console.info("[notify-school]", subject, text);
    results.logged = true;
    return results;
  }

  if (to && hasSmtpConfig()) {
    try {
      await sendMail({ to, subject, text, html: html || undefined });
      results.email = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[notify-school email]", err.message);
    }
  }

  results.telegram = await sendTelegram(`${subject}\n\n${text}`);
  return results;
}

async function notifyNewContact({ fullName, phone, message, email }) {
  const subject = `[Haabersti] Uus kontakt: ${fullName}`;
  const text = `Uus sonum kontaktivormist\n\nNimi: ${fullName}\nTelefon: ${phone}\nEmail: ${email || "(puudub)"}\n\n${message || "(puudub)"}`;
  return notifySchool({ subject, text });
}

async function notifyNewRegistration({ fullName, phone, email, courseName, comment }) {
  const subject = `[Haabersti] Uus registreerimine: ${fullName}`;
  const text = `Uus registreerimine\n\nNimi: ${fullName}\nTelefon: ${phone}\nEmail: ${email}\nKursus: ${courseName}\n\n${comment || ""}`;
  return notifySchool({ subject, text });
}

module.exports = { notifySchool, notifyNewContact, notifyNewRegistration, sendTelegram };
