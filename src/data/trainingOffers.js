const TRAINING_OFFER_COURSE_IDS = ["winter-training", "first-aid", "night-driving", "slippery-driving"];

function courseRequiresTrainingOffer(courseId) {
  return TRAINING_OFFER_COURSE_IDS.includes(courseId);
}

function localizePayload(payload, lang) {
  const l = lang === "ru" ? "Ru" : lang === "en" ? "En" : "Et";
  const p = typeof payload === "string" ? JSON.parse(payload) : payload || {};
  const pick = (base) => p[`${base}${l}`] || p[`${base}Ru`] || p[`${base}Et`] || "";

  return {
    title: pick("title"),
    eyebrow: pick("eyebrow"),
    location: pick("location"),
    dateDisplay: pick("dateDisplay"),
    transmission: pick("transmission"),
    language: pick("language"),
    modalArticleHtml: pick("modal") || p.modalRu || "",
    image: p.image || "/images/training/placeholder.svg",
    priceDisplay: p.priceDisplay || "—",
    locationBadge: p.locationBadge || "",
    badgeExtra: p.badgeExtra || "",
    timeDisplay: p.timeDisplay || "—",
    seats: p.seats != null ? Number(p.seats) : null,
    transportIncluded: Boolean(p.transportIncluded),
    sortPriceNumber: Number(p.sortPriceNumber) || parsePriceRough(p.priceDisplay),
  };
}

function parsePriceRough(s) {
  const m = String(s || "").replace(/\s/g, "").match(/([\d,.]+)/);
  if (!m) return 0;
  return Number.parseFloat(m[1].replace(",", ".")) || 0;
}

function mergeTrainingOfferRow(row, lang) {
  const loc = localizePayload(row.payload, lang);
  return {
    id: row.id,
    courseId: row.course_id,
    variantKey: row.variant_key || "",
    ...loc,
    priceNumeric: loc.sortPriceNumber,
    searchHaystack: `${loc.title} ${loc.eyebrow} ${row.variant_key || ""}`.toLowerCase(),
  };
}

module.exports = {
  TRAINING_OFFER_COURSE_IDS,
  courseRequiresTrainingOffer,
  localizePayload,
  mergeTrainingOfferRow,
  parsePriceRough,
};
