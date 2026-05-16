const PHONE_E164 = "+37256847904";
const PHONE_DISPLAY = "+372 5684 7904";
const EMAIL = "haaberstiautokool@gmail.com";
const WHATSAPP_DEFAULT = "37256847904";

function getSiteUrl() {
  const raw = String(process.env.PUBLIC_SITE_URL || "").trim();
  if (raw) return raw.replace(/\/$/, "");
  return "";
}

function absoluteUrl(path) {
  const base = getSiteUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}

module.exports = {
  PHONE_E164,
  PHONE_DISPLAY,
  EMAIL,
  WHATSAPP_DEFAULT,
  getSiteUrl,
  absoluteUrl,
};
