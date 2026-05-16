const { sendMail } = require("./transport");
const { getBankDetails } = require("./bankTransferMail");
const { PHONE_DISPLAY, EMAIL } = require("../data/siteContact");
const { isMontonioConfigured, createMontonioPaymentUrl } = require("../lib/montonio");

const COPY = {
  et: {
    subject: "Meeldetuletus: kursuse tasumine — Haabersti Autokool",
    greeting: (n) => `Tere, ${n}!`,
    body: (course) =>
      `Meenutame, et kursuse «${course}» eest tasumine on veel tegemata. Allpool on makseinfo.`,
    payOnline: "Maksa pangalingiga veebis",
    bankTitle: "Pangaülekanne",
    footer: "Küsimuste korral võtke meiega ühendust.",
  },
  ru: {
    subject: "Напоминание об оплате курса — Haabersti Autokool",
    greeting: (n) => `Здравствуйте, ${n}!`,
    body: (course) =>
      `Напоминаем, что оплата за курс «${course}» ещё не поступила. Ниже — реквизиты и способы оплаты.`,
    payOnline: "Оплатить онлайн (банк)",
    bankTitle: "Банковский перевод",
    footer: "Если уже оплатили — напишите нам. По вопросам звоните или пишите на email.",
  },
  en: {
    subject: "Payment reminder — Haabersti Autokool",
    greeting: (n) => `Hello ${n}!`,
    body: (course) =>
      `This is a reminder that payment for «${course}» is still pending. Payment details are below.`,
    payOnline: "Pay online via bank link",
    bankTitle: "Bank transfer",
    footer: "If you already paid, please let us know.",
  },
};

function langOr(lang) {
  return COPY[lang] ? lang : "ru";
}

async function sendPaymentReminderMail({ to, lang, fullName, courseName, amount, registrationId, price }) {
  const L = COPY[langOr(lang)];
  const bank = getBankDetails();
  const lines = [L.greeting(fullName), "", L.body(courseName)];

  let payUrl = null;
  if (isMontonioConfigured() && registrationId) {
    const pay = await createMontonioPaymentUrl({
      id: registrationId,
      full_name: fullName,
      email: to,
      course_name: courseName,
      price: price || amount,
      lang: langOr(lang),
    });
    if (pay.ok) payUrl = pay.paymentUrl;
  }

  if (payUrl) {
    lines.push("", `${L.payOnline}: ${payUrl}`);
  }

  if (bank.isComplete) {
    lines.push("", L.bankTitle, `Saaja: ${bank.beneficiary}`, `IBAN: ${bank.iban}`);
    if (amount) lines.push(`Summa: ${amount}`);
    lines.push(`Selgitus: ${fullName}, ${courseName}`);
  }

  lines.push("", `Tel: ${PHONE_DISPLAY}`, `Email: ${EMAIL}`, "", L.footer);

  const text = lines.join("\n");
  let html = `<p>${L.greeting(fullName)}</p><p>${L.body(courseName)}</p>`;
  if (payUrl) {
    html += `<p><a href="${payUrl}" style="display:inline-block;padding:12px 18px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:8px">${L.payOnline}</a></p>`;
  }
  if (bank.isComplete) {
    html += `<div style="margin:16px 0;padding:14px;background:#f8fafc;border-radius:8px">
<p><strong>${L.bankTitle}</strong></p>
<p>${bank.beneficiary}<br>IBAN: ${bank.iban}</p>
${amount ? `<p>Summa: ${amount}</p>` : ""}
</div>`;
  }
  html += `<p style="color:#64748b;font-size:13px">${L.footer}</p>`;

  return sendMail({ to, subject: L.subject, text, html });
}

module.exports = { sendPaymentReminderMail };
