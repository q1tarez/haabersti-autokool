/** Parse admin form body into training offer payload object (stored as JSON). */

function numOrNull(v) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function formBodyToTrainingOfferPayload(body) {
  return {
    image: String(body.image || "").trim() || "/images/training/placeholder.svg",
    priceDisplay: String(body.priceDisplay || "").trim() || "—",
    sortPriceNumber: numOrNull(body.sortPriceNumber),
    locationBadge: String(body.locationBadge || "").trim(),
    badgeExtra: String(body.badgeExtra || "").trim(),
    timeDisplay: String(body.timeDisplay || "").trim() || "—",
    seats: body.seats === "" || body.seats == null ? null : numOrNull(body.seats),
    transportIncluded: Boolean(body.transportIncluded),
    titleEt: String(body.title_et || "").trim(),
    titleRu: String(body.title_ru || "").trim(),
    titleEn: String(body.title_en || "").trim(),
    eyebrowEt: String(body.eyebrow_et || "").trim(),
    eyebrowRu: String(body.eyebrow_ru || "").trim(),
    eyebrowEn: String(body.eyebrow_en || "").trim(),
    locationEt: String(body.location_et || "").trim(),
    locationRu: String(body.location_ru || "").trim(),
    locationEn: String(body.location_en || "").trim(),
    dateDisplayEt: String(body.date_display_et || "").trim(),
    dateDisplayRu: String(body.date_display_ru || "").trim(),
    dateDisplayEn: String(body.date_display_en || "").trim(),
    transmissionEt: String(body.transmission_et || "").trim(),
    transmissionRu: String(body.transmission_ru || "").trim(),
    transmissionEn: String(body.transmission_en || "").trim(),
    languageEt: String(body.language_et || "").trim(),
    languageRu: String(body.language_ru || "").trim(),
    languageEn: String(body.language_en || "").trim(),
    modalEt: String(body.modal_et || "").trim(),
    modalRu: String(body.modal_ru || "").trim(),
    modalEn: String(body.modal_en || "").trim(),
  };
}

function payloadToFormDefaults(payload) {
  let p = {};
  try {
    p = typeof payload === "string" ? JSON.parse(payload || "{}") : payload || {};
  } catch (_) {
    p = {};
  }
  return {
    image: p.image || "",
    priceDisplay: p.priceDisplay || "",
    sortPriceNumber: p.sortPriceNumber != null ? String(p.sortPriceNumber) : "",
    locationBadge: p.locationBadge || "",
    badgeExtra: p.badgeExtra || "",
    timeDisplay: p.timeDisplay || "",
    seats: p.seats != null ? String(p.seats) : "",
    transportIncluded: Boolean(p.transportIncluded),
    title_et: p.titleEt || "",
    title_ru: p.titleRu || "",
    title_en: p.titleEn || "",
    eyebrow_et: p.eyebrowEt || "",
    eyebrow_ru: p.eyebrowRu || "",
    eyebrow_en: p.eyebrowEn || "",
    location_et: p.locationEt || "",
    location_ru: p.locationRu || "",
    location_en: p.locationEn || "",
    date_display_et: p.dateDisplayEt || "",
    date_display_ru: p.dateDisplayRu || "",
    date_display_en: p.dateDisplayEn || "",
    transmission_et: p.transmissionEt || "",
    transmission_ru: p.transmissionRu || "",
    transmission_en: p.transmissionEn || "",
    language_et: p.languageEt || "",
    language_ru: p.languageRu || "",
    language_en: p.languageEn || "",
    modal_et: p.modalEt || "",
    modal_ru: p.modalRu || "",
    modal_en: p.modalEn || "",
  };
}

module.exports = {
  formBodyToTrainingOfferPayload,
  payloadToFormDefaults,
};
