const nodemailer = require("nodemailer");

/** Реквизиты из окружения (Vercel → Environment Variables). */
function getBankDetails() {
  const beneficiary = String(
    process.env.BANK_BENEFICIARY_NAME || process.env.BANK_BENEFICIARY || ""
  ).trim();
  const iban = String(process.env.BANK_IBAN || "")
    .trim()
    .replace(/\s+/g, " ");
  const bic = String(process.env.BANK_BIC || "").trim();
  const phone = String(process.env.SCHOOL_CONTACT_PHONE || "").trim();
  const contactEmail = String(process.env.SCHOOL_CONTACT_EMAIL || "").trim();
  return {
    beneficiary,
    iban,
    bic,
    phone,
    contactEmail,
    isComplete: Boolean(beneficiary && iban),
  };
}

function siteBaseUrl() {
  const explicit = String(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  if (process.env.VERCEL_URL) return `https://${String(process.env.VERCEL_URL).replace(/^https?:\/\//, "")}`;
  return "";
}

const COPY = {
  et: {
    subject: "Pangaumberkande andmed — Haabersti Autokool",
    preheader: "Makse juhised ja rekvizidid",
    headline: "Pangaumberkande andmed",
    greeting: (name) => `Tere, ${name}!`,
    intro: (course) =>
      `Valisite kursile «${course}» tasumise pangaumberkandega. All on meie rekvizidid. Makse selgituse väljale kirjutage oma nimi ja kursus.`,
    labelBeneficiary: "Saaja",
    labelIban: "IBAN",
    labelBic: "BIC / SWIFT",
    labelPurpose: "Makse selgitus",
    notice:
      "Kui summa või saaja ei vasta kokkuleppele, helistage või kirjutage enne tasumist. Lõplik hind võib kinnituda telefoni teel.",
    cardTitle: "Rekvizidid",
    footerBrand: "Haabersti Autokool",
    footerCity: "Tallinn, Eesti",
    footerContact: "Kontakt",
    disclaimer:
      "See kiri saadetakse automaatselt pärast registreerumist. Kui te ei nõustunud selle kirja saamisega, võtke meiega ühendust.",
  },
  ru: {
    subject: "Реквизиты для банковского перевода — Haabersti Autokool",
    preheader: "Инструкция по оплате",
    headline: "Реквизиты для банковского перевода",
    greeting: (name) => `Здравствуйте, ${name}!`,
    intro: (course) =>
      `Вы выбрали оплату банковским переводом по курсу «${course}». Ниже — наши реквизиты. В назначении платежа укажите своё имя и курс.`,
    labelBeneficiary: "Получатель",
    labelIban: "IBAN",
    labelBic: "BIC / SWIFT",
    labelPurpose: "Назначение платежа",
    notice:
      "Если сумма или получатель не совпадают с договорённостью, свяжитесь с нами до оплаты. Итоговая цена может быть подтверждена по телефону.",
    cardTitle: "Реквизиты",
    footerBrand: "Haabersti Autokool",
    footerCity: "Tallinn, Eesti",
    footerContact: "Контакты",
    disclaimer:
      "Это автоматическое письмо после регистрации. Если вы получили его по ошибке, напишите нам.",
  },
  en: {
    subject: "Bank transfer details — Haabersti Autokool",
    preheader: "Payment instructions",
    headline: "Bank transfer details",
    greeting: (name) => `Hello ${name}!`,
    intro: (course) =>
      `You chose bank transfer for «${course}». Below are our payment details. Please put your name and course in the payment reference.`,
    labelBeneficiary: "Beneficiary",
    labelIban: "IBAN",
    labelBic: "BIC / SWIFT",
    labelPurpose: "Payment reference",
    notice:
      "If the amount or beneficiary does not match what we agreed, contact us before paying. The final price may be confirmed by phone.",
    cardTitle: "Payment details",
    footerBrand: "Haabersti Autokool",
    footerCity: "Tallinn, Estonia",
    footerContact: "Contact",
    disclaimer:
      "This message was sent automatically after registration. If you believe this was sent in error, please contact us.",
  },
};

function langOrEt(lang) {
  return ["et", "ru", "en"].includes(lang) ? lang : "et";
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatIbanDisplay(iban) {
  const compact = String(iban || "").replace(/\s/g, "").toUpperCase();
  return compact.replace(/(.{4})/g, "$1 ").trim();
}

function buildMessage(lang, fullName, courseName, bank) {
  const L = COPY[langOrEt(lang)];
  const purpose = `${fullName} — ${courseName}`;
  const safePurpose = escapeHtml(purpose);

  const ben = bank.beneficiary;
  const iban = bank.iban;
  const bic = bank.bic;

  const textLines = [
    L.greeting(fullName),
    "",
    L.intro(courseName),
    "",
    `${L.labelBeneficiary}: ${ben}`,
    `${L.labelIban}: ${iban}`,
    ...(bic ? [`${L.labelBic}: ${bic}`] : []),
    `${L.labelPurpose}: ${purpose}`,
    "",
    L.notice,
    "",
    `${L.footerBrand} — ${L.footerCity}`,
    ...(bank.phone ? [`${L.footerContact}: ${bank.phone}`] : []),
    ...(bank.contactEmail ? [`Email: ${bank.contactEmail}`] : []),
    "",
    L.disclaimer,
  ];

  const text = textLines.join("\n");

  const base = siteBaseUrl();
  const logoHtml = base
    ? `<img src="${escapeHtml(base)}/images/haabersti-autokool-icon.png" width="48" height="48" alt="" style="display:block;border:0;margin:0 0 12px;" />`
    : "";

  const bicRow = bic
    ? `<tr>
          <td style="padding:8px 0;font-size:13px;color:#64748b;vertical-align:top;">${L.labelBic}</td>
          <td style="padding:8px 0;font-size:15px;font-weight:700;color:#0f172a;font-family:Consolas,'Courier New',monospace;">${escapeHtml(bic)}</td>
        </tr>`
    : "";

  const contactBlock =
    bank.phone || bank.contactEmail
      ? `<p style="margin:12px 0 0;font-size:13px;color:#64748b;line-height:1.6;">
          <strong style="color:#334155;">${L.footerContact}</strong><br />
          ${bank.phone ? escapeHtml(bank.phone) : ""}${bank.phone && bank.contactEmail ? " · " : ""}${
            bank.contactEmail
              ? `<a href="mailto:${escapeHtml(bank.contactEmail)}" style="color:#2563eb;">${escapeHtml(bank.contactEmail)}</a>`
              : ""
          }
        </p>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="${langOrEt(lang)}">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="${escapeHtml(L.preheader)}" />
  <title>${escapeHtml(L.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6fb;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(L.preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f6fb;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5eaf2;box-shadow:0 4px 24px rgba(15,23,42,0.06);">
          <tr>
            <td style="background:linear-gradient(135deg,#2563eb 0%,#1d4ed8 100%);padding:24px 28px 22px;">
              ${logoHtml}
              <p style="margin:0;font-size:13px;font-weight:700;color:rgba(255,255,255,0.9);letter-spacing:0.06em;text-transform:uppercase;">Haabersti Autokool</p>
              <p style="margin:8px 0 0;font-size:22px;font-weight:800;color:#ffffff;line-height:1.25;">${L.headline}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;">
              <p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#1e293b;">${escapeHtml(L.greeting(fullName))}</p>
              <p style="margin:0;font-size:15px;line-height:1.6;color:#475569;">${escapeHtml(L.intro(courseName))}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 28px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #dbeafe;border-radius:10px;background:linear-gradient(180deg,#f8fafc 0%,#f1f5f9 100%);">
                <tr>
                  <td style="padding:18px 20px;">
                    <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.04em;">${L.cardTitle}</p>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="padding:8px 0;font-size:13px;color:#64748b;width:132px;vertical-align:top;">${L.labelBeneficiary}</td>
                        <td style="padding:8px 0;font-size:15px;font-weight:700;color:#0f172a;line-height:1.35;">${escapeHtml(ben)}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;font-size:13px;color:#64748b;vertical-align:top;">${L.labelIban}</td>
                        <td style="padding:8px 0;font-size:16px;font-weight:700;color:#0f172a;letter-spacing:0.06em;font-family:Consolas,'Courier New',monospace;">${escapeHtml(formatIbanDisplay(iban))}</td>
                      </tr>
                      ${bicRow}
                      <tr>
                        <td style="padding:8px 0;font-size:13px;color:#64748b;vertical-align:top;">${L.labelPurpose}</td>
                        <td style="padding:8px 0;font-size:15px;color:#0f172a;line-height:1.45;">${safePurpose}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px;">
              <p style="margin:0;font-size:13px;line-height:1.55;color:#64748b;border-left:3px solid #93c5fd;padding-left:14px;">${L.notice}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background:#f1f5f9;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">
                <strong style="color:#334155;">${L.footerBrand}</strong><br />
                ${L.footerCity}
              </p>
              ${contactBlock}
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;max-width:600px;line-height:1.45;">${L.disclaimer}</p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject: L.subject, text, html };
}

function hasSmtpConfig() {
  const smtpUrl = String(process.env.SMTP_URL || "").trim();
  const smtpHost = String(process.env.SMTP_HOST || "").trim();
  const useGmail =
    String(process.env.SMTP_USE_GMAIL || "").trim() === "1" ||
    String(process.env.SMTP_PROVIDER || "").toLowerCase().trim() === "gmail" ||
    smtpHost.toLowerCase() === "smtp.gmail.com";
  const gmailUser = String(process.env.SMTP_USER || "").trim();
  const gmailPass = String(process.env.SMTP_PASS || "").trim();
  const hasGmailAuth = useGmail && gmailUser && gmailPass;
  return Boolean(smtpUrl || smtpHost || hasGmailAuth);
}

async function sendBankTransferInstructionsMail({ to, lang, fullName, courseName }) {
  const bank = getBankDetails();

  if (!bank.isComplete) {
    // eslint-disable-next-line no-console
    console.error(
      "[bank-transfer mail] Missing BANK_BENEFICIARY_NAME or BANK_IBAN — set them in environment variables."
    );
    return { ok: false, mode: "skipped", reason: "missing-bank-config" };
  }

  const { subject, text, html } = buildMessage(langOrEt(lang), fullName, courseName, bank);

  if (!hasSmtpConfig()) {
    // eslint-disable-next-line no-console
    console.info("[bank-transfer mail — no SMTP, body logged]", { to, subject, text });
    return { ok: true, mode: "log" };
  }

  const smtpUrl = String(process.env.SMTP_URL || "").trim();
  const smtpHost = String(process.env.SMTP_HOST || "").trim();
  const useGmail =
    String(process.env.SMTP_USE_GMAIL || "").trim() === "1" ||
    String(process.env.SMTP_PROVIDER || "").toLowerCase().trim() === "gmail" ||
    smtpHost.toLowerCase() === "smtp.gmail.com";
  const gmailUser = String(process.env.SMTP_USER || "").trim();
  const gmailPass = String(process.env.SMTP_PASS || "").trim();
  const hasGmailAuth = useGmail && gmailUser && gmailPass;

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
