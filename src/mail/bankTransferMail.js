const nodemailer = require("nodemailer");

const TEST_BANK = {
  beneficiary: "Haabersti Autokool (TEST)",
  iban: "EE00 0000 0000 0000 0000",
  bic: "TESTBIC0",
};

function copy(lang) {
  const l = ["et", "ru", "en"].includes(lang) ? lang : "et";
  if (l === "ru") {
    return {
      subject: "Реквизиты для оплаты переводом (тест) — Haabersti Autokool",
      intro: (name, course) =>
        `Здравствуйте, ${name}!\n\nВы выбрали оплату банковским переводом по курсу «${course}». Ниже — тестовые реквизиты для проверки письма (не используйте для реального перевода).`,
      outro:
        "После настройки SMTP на сервере письмо будет уходить с вашего почтового ящика. Сейчас без SMTP текст дублируется в лог сервера.",
    };
  }
  if (l === "en") {
    return {
      subject: "Bank transfer details (TEST) — Haabersti Autokool",
      intro: (name, course) =>
        `Hello ${name},\n\nYou chose bank transfer for «${course}». Below are TEST payment details (do not use for a real transfer).`,
      outro:
        "When SMTP is configured on the server, messages are sent from your mailbox. Without SMTP the body is logged on the server.",
    };
  }
  return {
    subject: "Pangaumberkande andmed (TEST) — Haabersti Autokool",
    intro: (name, course) =>
      `Tere, ${name}!\n\nValisite kursile «${course}» pangaumberkande. All on testandmed kirja kontrolliks (mitte päris makseks).`,
    outro:
      "Kui serveris on SMTP seadistatud, saadetakse kiri teie postkastist. Ilma SMTP-ta kopeeritakse sisu serveri logisse.",
  };
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildMessage(lang, fullName, courseName) {
  const c = copy(lang);
  const safeName = escapeHtml(fullName);
  const safeCourse = escapeHtml(courseName);
  const text =
    `${c.intro(fullName, courseName)}\n\n` +
    `Beneficiary / Saaja: ${TEST_BANK.beneficiary}\n` +
    `IBAN: ${TEST_BANK.iban}\n` +
    `BIC/SWIFT: ${TEST_BANK.bic}\n` +
    `Reference / Selgitus: ${fullName} — ${courseName}\n\n` +
    `${c.outro}`;

  const html = `
    <p>${c.intro(fullName, courseName).replace(/\n/g, "<br/>")}</p>
    <table style="border-collapse:collapse;margin:12px 0;font-size:14px;">
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Beneficiary</td><td>${TEST_BANK.beneficiary}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;">IBAN</td><td>${TEST_BANK.iban}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;">BIC</td><td>${TEST_BANK.bic}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Reference</td><td>${safeName} — ${safeCourse}</td></tr>
    </table>
    <p style="color:#555;font-size:13px;">${c.outro}</p>
  `.trim();

  return { subject: c.subject, text, html };
}

async function sendBankTransferInstructionsMail({ to, lang, fullName, courseName }) {
  const { subject, text, html } = buildMessage(lang, fullName, courseName);
  const smtpUrl = String(process.env.SMTP_URL || "").trim();
  const smtpHost = String(process.env.SMTP_HOST || "").trim();
  const useGmail =
    String(process.env.SMTP_USE_GMAIL || "").trim() === "1" ||
    String(process.env.SMTP_PROVIDER || "").toLowerCase().trim() === "gmail" ||
    smtpHost.toLowerCase() === "smtp.gmail.com";
  const gmailUser = String(process.env.SMTP_USER || "").trim();
  const gmailPass = String(process.env.SMTP_PASS || "").trim();

  const hasGmailAuth = useGmail && gmailUser && gmailPass;
  if (!smtpUrl && !smtpHost && !hasGmailAuth) {
    // eslint-disable-next-line no-console
    console.info("[bank-transfer mail — TEST, no SMTP]", { to, subject, text });
    return { ok: true, mode: "log" };
  }

  let transporter;
  if (smtpUrl) {
    transporter = nodemailer.createTransport(smtpUrl);
  } else if (hasGmailAuth) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass.replace(/\s+/g, "") },
    });
  } else {
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || "") === "1",
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? {
              user: String(process.env.SMTP_USER).trim(),
              pass: String(process.env.SMTP_PASS).trim(),
            }
          : undefined,
    });
  }

  const from = String(process.env.MAIL_FROM || process.env.SMTP_USER || "noreply@example.com").trim();

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });

  return { ok: true, mode: "smtp" };
}

module.exports = { sendBankTransferInstructionsMail };
