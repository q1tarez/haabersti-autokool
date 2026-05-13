const driving = require("./drivingInstructors");

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function coerceArray(val) {
  if (Array.isArray(val)) return val;
  if (val === undefined || val === null || val === "") return [];
  return [val];
}

function parseCarPhotosFromForm(body) {
  const raw = String(body.car_photos ?? "");
  return raw
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("/") || s.startsWith("http://") || s.startsWith("https://"));
}

const ALLOW_LANGS = new Set(["et", "ru", "en"]);
const ALLOW_CATS = new Set(["b", "be", "moto"]);

const LOCATION_SLUGS = [
  "kopli",
  "mustamae",
  "lasnamae",
  "haabersti",
  "kristiine",
  "viimsi",
  "pirita",
  "maardu",
  "ulemiste",
  "kadaka",
];

const ALLOW_LOCS = new Set(LOCATION_SLUGS);

/**
 * Преобразует поля формы админки в полную модель инструктора (id из editingId или из manual_id/name).
 */
function formBodyToDrivingInstructor(body, { editingId = null } = {}) {
  const existing = editingId ? driving.getInstructorById(editingId) : null;
  const template = driving.mergeInstructorImported("__tpl__", {});

  let base;
  if (existing) {
    base = JSON.parse(JSON.stringify(existing));
  } else {
    base = JSON.parse(JSON.stringify(template));
    base.name = "";
    base.searchAliases = "";
    base.photo = "/images/instructors/talehh.svg";
    base.carPhotos = [];
  }

  delete base.id;

  const name = String(body.name || "").trim();
  base.name = name || base.name;

  const slugFromForm = slugify(body.manual_id);
  const slugFallback = slugify(body.name || body.manual_id);
  const slugPick =
    (slugFromForm && slugFromForm.replace(/-/g, "").length >= 2 && slugFromForm) ||
    (slugFallback && slugFallback.replace(/-/g, "").length >= 2 && slugFallback) ||
    slugify(`instr-${Date.now()}`);

  const langs = coerceArray(body.langs)
    .map((x) => String(x).trim())
    .filter((x) => ALLOW_LANGS.has(x));
  if (langs.length) base.filterGroupLanguages = langs;

  const cats = coerceArray(body.cats)
    .map((x) => String(x).trim())
    .filter((x) => ALLOW_CATS.has(x));
  if (cats.length) base.filterCategories = cats;

  const locs = coerceArray(body.locs)
    .map((x) => String(x).trim())
    .filter((x) => ALLOW_LOCS.has(x));
  if (locs.length) base.filterLocationIds = locs;

  base.photo = String(body.photo || "").trim() || base.photo;
  base.carPhotos = parseCarPhotosFromForm(body);

  base.badgePro = body.badge_pro === "1";
  base.payPerLessonOk = body.pay_per_lesson === "1";

  base.rating = Number(String(body.rating || "").trim());
  base.reviewCount = Math.round(Number(String(body.review_count || "").trim()));
  base.lessonsCount = Math.round(Number(String(body.lessons_count || "").trim()));
  base.lessonDurationMinutes = Math.round(Number(String(body.lesson_duration_min || "").trim()));
  base.firstLessonDays = Math.round(Number(String(body.first_lesson_days || "").trim()));
  base.sortPriceNumber = Number(String(body.sort_price || "").trim());
  base.registrationFeeEuro = Math.round(Number(String(body.registration_fee_euro || "").trim()));

  const tk = String(body.transmission_key || "").trim();
  if (tk === "automatic" || tk === "manual") base.transmissionKey = tk;

  base.pricePackage = String(body.price_package || "").trim();
  base.priceFormattedPackage = String(body.price_pkg_fmt || "").trim();
  base.priceLessonFormatted = String(body.price_lesson_fmt || "").trim();
  base.pricePerLesson = String(body.price_per_lesson || "").trim();
  base.totalCourseEuroDisplayed = String(body.total_course_disp || "").trim();

  base.searchAliases = String(body.search_aliases || "").trim();

  for (const lng of ["et", "ru", "en"]) {
    base.firstLesson[lng] = String(body[`first_${lng}`] || "").trim();
    base.languages[lng] = String(body[`spoken_${lng}`] || "").trim();
    base.location[lng] = String(body[`loc_text_${lng}`] || "").trim();
    base.transmission[lng] = String(body[`trans_${lng}`] || "").trim();
    base.description[lng] = String(body[`desc_${lng}`] || "").trim();
    base.modalDetailHtml[lng] = String(body[`modal_${lng}`] || "").trim();
  }

  const finalId = editingId || slugPick;

  return driving.mergeInstructorImported(finalId, base);
}

function stripIdForPayload(record) {
  const { id: _omit, ...rest } = record;
  return rest;
}

module.exports = {
  formBodyToDrivingInstructor,
  stripIdForPayload,
  ALLOW_LOCS,
  LOCATION_SLUGS,
  slugify,
};
