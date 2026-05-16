const nodemailer = require("nodemailer");

function hasSmtpConfig() {
  const smtpUrl = String(process.env.SMTP_URL || "").trim();
  const smtpHost = String(process.env.SMTP_HOST || "").trim();
  const useGmail =
    String(process.env.SMTP_USE_GMAIL || "").trim() === "1" ||
    String(process.env.SMTP_PROVIDER || "").toLowerCase().trim() === "gmail" ||
    smtpHost.toLowerCase() === "smtp.gmail.com";
  const gmailUser = String(process.env.SMTP_USER || "").trim();
  const gmailPass = String(process.env.SMTP_PASS || "").trim();
  return Boolean(smtpUrl || smtpHost || (useGmail && gmailUser && gmailPass));
}

function createTransporter() {
  const smtpUrl = String(process.env.SMTP_URL || "").trim();
  const smtpHost = String(process.env.SMTP_HOST || "").trim();
  const useGmail =
    String(process.env.SMTP_USE_GMAIL || "").trim() === "1" ||
    String(process.env.SMTP_PROVIDER || "").toLowerCase().trim() === "gmail" ||
    smtpHost.toLowerCase() === "smtp.gmail.com";
  const gmailUser = String(process.env.SMTP_USER || "").trim();
  const gmailPass = String(process.env.SMTP_PASS || "").trim();
  if (smtpUrl) return nodemailer.createTransport(smtpUrl);
  if (useGmail && gmailUser && gmailPass) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass.replace(/\s+/g, "") },
    });
  }
  return nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "") === "1",
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: String(process.env.SMTP_USER).trim(), pass: String(process.env.SMTP_PASS).trim() }
        : undefined,
  });
}

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
  const from = String(process.env.MAIL_FROM || process.env.SMTP_USER || "noreply@example.com").trim();
  const results = { email: false, telegram: false, logged: false };

  if (!to && !process.env.TELEGRAM_BOT_TOKEN) {
    // eslint-disable-next-line no-console
    console.info("[notify-school]", subject, text);
    results.logged = true;
    return results;
  }

  if (to && hasSmtpConfig()) {
    try {
      const transporter = createTransporter();
      await transporter.sendMail({ from, to, subject, text, html: html || undefined });
      results.email = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[notify-school email]", err.message);
    }
  }

  results.telegram = await sendTelegram(`${subject}\n\n${text}`);
  return results;
}

async function notifyNewContact({ fullName, phone, message }) {
  const subject = `[Haabersti] Uus kontakt: ${fullName}`;
  const text = `Uus sonum kontaktivormist\n\nNimi: ${fullName}\nTelefon: ${phone}\n\n${message || "(puudub)"}`;
  return notifySchool({ subject, text });
}

async function notifyNewRegistration({ fullName, phone, email, courseName, comment }) {
  const subject = `[Haabersti] Uus registreerimine: ${fullName}`;
  const text = `Uus registreerimine\n\nNimi: ${fullName}\nTelefon: ${phone}\nEmail: ${email}\nKursus: ${courseName}\n\n${comment || ""}`;
  return notifySchool({ subject, text });
}

module.exports = { notifySchool, notifyNewContact, notifyNewRegistration };
