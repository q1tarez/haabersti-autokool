const nodemailer = require("nodemailer");

/** Реквизиты из окружения (Vercel → Environment Variables). */
function getBankDetails() {
  const beneficiary = String(
    process.env.BANK_BENEFICIARY_NAME || process.env.BANK_BENEFICIARY || ""
  ).trim();
  const iban = String(process.env.BANK_IBAN || "")
    .trim()
    .replace(/\s+/g, " ");
  const phone = String(process.env.SCHOOL_CONTACT_PHONE || "").trim();
  const contactEmail = String(process.env.SCHOOL_CONTACT_EMAIL || "").trim();
  return {
    beneficiary,
    iban,
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

const DRIVING_COURSE_IDS = new Set(["driving-lessons-26", "extra-driving"]);

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
    labelAmount: "Summa",
    labelPurpose: "Makse selgitus",
    notice:
      "Kui summa või saaja ei vasta kokkuleppele, helistage või kirjutage enne tasumist. Lõplik hind võib kinnituda telefoni teel.",
    cardTitle: "Rekvizidid",
    footerBrand: "Haabersti Autokool",
    footerCity: "Tallinn, Eesti",
    footerContact: "Kontakt",
    memoTitle: "Õpilase meelespea",
    memoLines: [
      "⏰ Teavita puudumisest vähemalt 24 tundi ette",
      "❗️ Hilinemine üle 15 minuti – tund loetakse toimunuks",
      "💸 Etteteatamata puudumise korral raha ei tagastata",
      "🔧 Õpetaja või tehnilise põhjuse tõttu ära jäänud tund -> lepitakse kokku uus aeg",
      "🚫 Tundi ei tohi tulla joobes ega joobetunnustega",
      "🪪 Kaasa võtta isikut tõendav dokument",
      "💶 Lisatunnid: 55 EUR / 90 min",
    ],
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
    labelAmount: "Сумма",
    labelPurpose: "Назначение платежа",
    notice:
      "Если сумма или получатель не совпадают с договорённостью, свяжитесь с нами до оплаты. Итоговая цена может быть подтверждена по телефону.",
    cardTitle: "Реквизиты",
    footerBrand: "Haabersti Autokool",
    footerCity: "Tallinn, Eesti",
    footerContact: "Контакты",
    memoTitle: "Памятка ученика",
    memoLines: [
      "⏰ Сообщайте об отмене занятия минимум за 24 часа",
      "❗️ Опоздание более чем на 15 минут — урок считается состоявшимся",
      "💸 При отсутствии без предупреждения оплата не возвращается",
      "🔧 Если урок отменён по вине инструктора или по технической причине — согласовывается новое время",
      "🚫 Нельзя приходить на занятие в состоянии опьянения или с его признаками",
      "🪪 Возьмите с собой документ, удостоверяющий личность",
      "💶 Дополнительные занятия: 55 EUR / 90 мин",
    ],
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
    labelAmount: "Amount",
    labelPurpose: "Payment reference",
    notice:
      "If the amount or beneficiary does not match what we agreed, contact us before paying. The final price may be confirmed by phone.",
    cardTitle: "Payment details",
    footerBrand: "Haabersti Autokool",
    footerCity: "Tallinn, Estonia",
    footerContact: "Contact",
    memoTitle: "Student memo",
    memoLines: [
      "⏰ Notify about absence at least 24 hours in advance",
      "❗️ If you are more than 15 minutes late, the lesson is considered completed",
      "💸 No refund is provided for no-shows without notice",
      "🔧 If a lesson is canceled due to the instructor or technical reasons, a new time will be agreed",
      "🚫 Do not attend the lesson under the influence of alcohol or with intoxication signs",
      "🪪 Bring an identity document with you",
      "💶 Additional lessons: 55 EUR / 90 min",
    ],
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

function buildMessage(lang, fullName, courseName, amount, courseId, bank) {
  const L = COPY[langOrEt(lang)];
  const purpose = `${fullName} — ${courseName}`;
  const safePurpose = escapeHtml(purpose);

  const ben = bank.beneficiary;
  const iban = bank.iban;
  const amountLine = String(amount || "").trim();
  const includeMemo = DRIVING_COURSE_IDS.has(String(courseId || "").trim());

  const textLines = [
    L.greeting(fullName),
    "",
    L.intro(courseName),
    "",
    `${L.labelBeneficiary}: ${ben}`,
    `${L.labelIban}: ${iban}`,
    ...(amountLine ? [`${L.labelAmount}: ${amountLine}`] : []),
    `${L.labelPurpose}: ${purpose}`,
    "",
    L.notice,
    "",
    `${L.footerBrand} — ${L.footerCity}`,
    ...(bank.phone ? [`${L.footerContact}: ${bank.phone}`] : []),
    ...(bank.contactEmail ? [`Email: ${bank.contactEmail}`] : []),
    ...(includeMemo ? ["", L.memoTitle, ...L.memoLines] : []),
    "",
    L.disclaimer,
  ];

  const text = textLines.join("\n");

  const base = siteBaseUrl();
  const logoHtml = base
    ? `<img src="${escapeHtml(base)}/images/haabersti-autokool-icon.png" width="48" height="48" alt="" style="display:block;border:0;margin:0 0 12px;" />`
    : "";

  const contactBlock =
    bank.phone || bank.contactEmail
      ? `<p style="margin:12px 0 0;font-size:13px;color:#334155 !important;-webkit-text-fill-color:#334155 !important;line-height:1.6;">
          <strong style="color:#0f172a !important;-webkit-text-fill-color:#0f172a !important;">${L.footerContact}</strong><br />
          ${bank.phone ? escapeHtml(bank.phone) : ""}${bank.phone && bank.contactEmail ? " · " : ""}${
            bank.contactEmail
              ? `<a href="mailto:${escapeHtml(bank.contactEmail)}" style="color:#1d4ed8 !important;-webkit-text-fill-color:#1d4ed8 !important;">${escapeHtml(bank.contactEmail)}</a>`
              : ""
          }
        </p>`
      : "";

  const memoHtml = includeMemo
    ? `<div style="margin:16px 0 0;padding:14px 14px 8px;border:1px solid #c7d2fe;border-radius:10px;background-color:#eef2ff !important;">
          <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#1e3a8a !important;-webkit-text-fill-color:#1e3a8a !important;">${escapeHtml(L.memoTitle)}</p>
          <ul style="margin:0;padding:0 0 0 18px;font-size:13px;line-height:1.55;color:#0f172a !important;-webkit-text-fill-color:#0f172a !important;">
            ${L.memoLines.map((line) => `<li style="margin:0 0 6px;color:#0f172a !important;-webkit-text-fill-color:#0f172a !important;">${escapeHtml(line)}</li>`).join("")}
          </ul>
        </div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="${langOrEt(lang)}">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <meta name="description" content="${escapeHtml(L.preheader)}" />
  <title>${escapeHtml(L.subject)}</title>
  <style type="text/css">
    :root { color-scheme: light only; supported-color-schemes: light; }
    @media (prefers-color-scheme: dark) {
      .hm-body { background-color: #f4f6fb !important; }
      .hm-intro p { color: #0f172a !important; -webkit-text-fill-color: #0f172a !important; }
      .hm-card td { color: #0f172a !important; -webkit-text-fill-color: #0f172a !important; background-color: #f1f5f9 !important; }
      .hm-card td.hm-label { color: #334155 !important; -webkit-text-fill-color: #334155 !important; }
      .hm-notice { color: #334155 !important; -webkit-text-fill-color: #334155 !important; }
    }
  </style>
</head>
<body class="hm-body" style="margin:0;padding:0;background-color:#f4f6fb !important;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;color-scheme:light only;">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(L.preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#f4f6fb" style="background-color:#f4f6fb !important;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" bgcolor="#ffffff" style="max-width:600px;width:100%;background-color:#ffffff !important;border-radius:12px;overflow:hidden;border:1px solid #e5eaf2;box-shadow:0 4px 24px rgba(15,23,42,0.06);">
          <tr>
            <td style="background:linear-gradient(135deg,#2563eb 0%,#1d4ed8 100%);padding:24px 28px 22px;">
              ${logoHtml}
              <p style="margin:0;font-size:13px;font-weight:700;color:rgba(255,255,255,0.95) !important;-webkit-text-fill-color:rgba(255,255,255,0.95) !important;letter-spacing:0.06em;text-transform:uppercase;">Haabersti Autokool</p>
              <p style="margin:8px 0 0;font-size:22px;font-weight:800;color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;line-height:1.25;">${L.headline}</p>
            </td>
          </tr>
          <tr>
            <td class="hm-intro" bgcolor="#ffffff" style="padding:28px 28px 8px;background-color:#ffffff !important;">
              <p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#0f172a !important;-webkit-text-fill-color:#0f172a !important;">${escapeHtml(L.greeting(fullName))}</p>
              <p style="margin:0;font-size:15px;line-height:1.6;color:#1e293b !important;-webkit-text-fill-color:#1e293b !important;">${escapeHtml(L.intro(courseName))}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 28px 28px;background-color:#ffffff !important;">
              <table role="presentation" class="hm-card" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#f1f5f9" style="border:1px solid #dbeafe;border-radius:10px;background-color:#f1f5f9 !important;">
                <tr>
                  <td style="padding:18px 20px;background-color:#f1f5f9 !important;">
                    <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:#1d4ed8 !important;-webkit-text-fill-color:#1d4ed8 !important;text-transform:uppercase;letter-spacing:0.04em;">${L.cardTitle}</p>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td class="hm-label" style="padding:8px 0;font-size:13px;color:#334155 !important;-webkit-text-fill-color:#334155 !important;width:132px;vertical-align:top;background-color:transparent !important;">${L.labelBeneficiary}</td>
                        <td style="padding:8px 0;font-size:15px;font-weight:700;color:#0f172a !important;-webkit-text-fill-color:#0f172a !important;line-height:1.35;background-color:transparent !important;">${escapeHtml(ben)}</td>
                      </tr>
                      <tr>
                        <td class="hm-label" style="padding:8px 0;font-size:13px;color:#334155 !important;-webkit-text-fill-color:#334155 !important;vertical-align:top;background-color:transparent !important;">${L.labelIban}</td>
                        <td style="padding:8px 0;font-size:16px;font-weight:700;color:#0f172a !important;-webkit-text-fill-color:#0f172a !important;letter-spacing:0.06em;font-family:Consolas,'Courier New',monospace;background-color:transparent !important;">${escapeHtml(formatIbanDisplay(iban))}</td>
                      </tr>
                      ${
                        amountLine
                          ? `<tr>
                        <td class="hm-label" style="padding:8px 0;font-size:13px;color:#334155 !important;-webkit-text-fill-color:#334155 !important;vertical-align:top;background-color:transparent !important;">${L.labelAmount}</td>
                        <td style="padding:8px 0;font-size:15px;font-weight:700;color:#0f172a !important;-webkit-text-fill-color:#0f172a !important;background-color:transparent !important;">${escapeHtml(amountLine)}</td>
                      </tr>`
                          : ""
                      }
                      <tr>
                        <td class="hm-label" style="padding:8px 0;font-size:13px;color:#334155 !important;-webkit-text-fill-color:#334155 !important;vertical-align:top;background-color:transparent !important;">${L.labelPurpose}</td>
                        <td style="padding:8px 0;font-size:15px;color:#0f172a !important;-webkit-text-fill-color:#0f172a !important;line-height:1.45;background-color:transparent !important;">${safePurpose}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px;background-color:#ffffff !important;">
              <p class="hm-notice" style="margin:0;font-size:13px;line-height:1.55;color:#334155 !important;-webkit-text-fill-color:#334155 !important;border-left:3px solid #93c5fd;padding-left:14px;">${L.notice}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background-color:#e8edf3 !important;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:13px;color:#334155 !important;-webkit-text-fill-color:#334155 !important;line-height:1.5;">
                <strong style="color:#0f172a !important;-webkit-text-fill-color:#0f172a !important;">${L.footerBrand}</strong><br />
                <span style="color:#334155 !important;-webkit-text-fill-color:#334155 !important;">${L.footerCity}</span>
              </p>
              ${contactBlock}
              ${memoHtml}
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#64748b !important;-webkit-text-fill-color:#64748b !important;max-width:600px;line-height:1.45;">${L.disclaimer}</p>
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

async function sendBankTransferInstructionsMail({ to, lang, fullName, courseName, amount, courseId }) {
  const bank = getBankDetails();

  if (!bank.isComplete) {
    // eslint-disable-next-line no-console
    console.warn(
      "[bank-transfer mail] Add BANK_BENEFICIARY_NAME and BANK_IBAN in Vercel → Environment Variables (same names as in .env.example), then redeploy."
    );
    return { ok: false, mode: "skipped", reason: "missing-bank-config" };
  }

  const { subject, text, html } = buildMessage(langOrEt(lang), fullName, courseName, amount, courseId, bank);

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
