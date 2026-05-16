const { sendMail } = require("./transport");

const COPY = {
  et: {
    subject: "Registreerimine vastu võetud — Haabersti Autokool",
    greeting: (name) => `Tere, ${name}!`,
    body: (course) =>
      `Oleme teie registreerimise kursile «${course}» kätte saanud. Võtame peagi ühendust või saadame täpsema info e-posti teel.`,
    footer: "Haabersti Autokool · Tallinn",
  },
  ru: {
    subject: "Заявка получена — Haabersti Autokool",
    greeting: (name) => `Здравствуйте, ${name}!`,
    body: (course) =>
      `Мы получили вашу заявку на курс «${course}». Скоро свяжемся с вами или пришлём уточнения на email.`,
    footer: "Haabersti Autokool · Tallinn",
  },
  en: {
    subject: "Registration received — Haabersti Autokool",
    greeting: (name) => `Hello ${name}!`,
    body: (course) =>
      `We have received your registration for «${course}». We will contact you soon or send details by email.`,
    footer: "Haabersti Autokool · Tallinn",
  },
};

function langOr(lang) {
  return ["et", "ru", "en"].includes(lang) ? lang : "et";
}

async function sendRegistrationReceivedMail({ to, lang, fullName, courseName }) {
  const L = COPY[langOr(lang)];
  const text = `${L.greeting(fullName)}\n\n${L.body(courseName)}\n\n${L.footer}`;
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.55">
<p>${L.greeting(fullName)}</p>
<p>${L.body(courseName)}</p>
<p style="color:#64748b;font-size:13px">${L.footer}</p>
</body></html>`;
  return sendMail({ to, subject: L.subject, text, html });
}

module.exports = { sendRegistrationReceivedMail };
