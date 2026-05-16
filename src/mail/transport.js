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

async function sendMail({ to, subject, text, html }) {
  if (!hasSmtpConfig()) {
    // eslint-disable-next-line no-console
    console.info("[mail]", subject, "→", to, text);
    return { ok: true, mode: "log" };
  }
  const from = String(process.env.MAIL_FROM || process.env.SMTP_USER || "noreply@example.com").trim();
  const transporter = createTransporter();
  await transporter.sendMail({ from, to, subject, text, html });
  return { ok: true, mode: "smtp" };
}

module.exports = { hasSmtpConfig, sendMail };
