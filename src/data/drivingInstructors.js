const DRIVING_LESSONS_COURSE_ID = "driving-lessons-26";
const EXTRA_DRIVING_COURSE_ID = "extra-driving";

const COURSE_IDS_REQUIRING_INSTRUCTOR = [DRIVING_LESSONS_COURSE_ID, EXTRA_DRIVING_COURSE_ID];

function courseRequiresInstructor(courseId) {
  return COURSE_IDS_REQUIRING_INSTRUCTOR.includes(courseId);
}

const RAW_DEFAULT_INSTRUCTORS = require("./drivingInstructorDefaults");

function cloneDeep(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** Стартуем с локального списка до первой загрузки из БД. */
let instructorsInternal = RAW_DEFAULT_INSTRUCTORS.map((row) => cloneDeep(row));

function normalizeComparableForSearch(fragment) {
  return String(fragment || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[-_/,.;:+|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Нормализованная строка: слова имени (любой порядок) + алиасы + id; подстроки вроде «tale» находят «Taleh». */
function buildSearchHaystack(instr) {
  const buckets = [];
  buckets.push(normalizeComparableForSearch(instr.name));
  buckets.push(normalizeComparableForSearch(instr.id));
  buckets.push(normalizeComparableForSearch(String(instr.id || "").replace(/-/g, " ")));
  if (instr.searchAliases) {
    String(instr.searchAliases)
      .split(/[,;/|]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((frag) => buckets.push(normalizeComparableForSearch(frag)));
  }
  String(instr.name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .forEach((w) => buckets.push(normalizeComparableForSearch(w)));
  const unique = [...new Set(buckets.filter(Boolean))];
  return normalizeComparableForSearch(unique.join(" "));
}

function normalizeDrivingInstructorRow(rowIn) {
  const row = cloneDeep(typeof rowIn === "object" && rowIn !== null ? rowIn : {});
  row.id = String(row.id || "").trim();
  row.name = String(row.name || "").trim();
  row.photo = String(row.photo || "/images/instructors/talehh.svg").trim();
  row.badgePro = Boolean(row.badgePro);
  row.rating = Number(row.rating) || 0;
  row.reviewCount = Math.max(0, Math.round(Number(row.reviewCount) || 0));
  row.lessonsCount = Math.max(1, Math.round(Number(row.lessonsCount) || 26));
  row.lessonDurationMinutes = Math.max(15, Math.round(Number(row.lessonDurationMinutes) || 45));
  row.payPerLessonOk = Boolean(row.payPerLessonOk);
  row.filterGroupLanguages = Array.isArray(row.filterGroupLanguages) ? row.filterGroupLanguages : ["et"];
  row.transmissionKey =
    row.transmissionKey === "automatic" ? "automatic" : row.transmissionKey === "manual" ? "manual" : "manual";
  row.filterCategories = Array.isArray(row.filterCategories) && row.filterCategories.length ? row.filterCategories : ["b"];
  row.filterLocationIds =
    Array.isArray(row.filterLocationIds) && row.filterLocationIds.length ? row.filterLocationIds : ["haabersti"];
  row.firstLessonDays = Math.max(0, Math.round(Number(row.firstLessonDays) || 14));
  row.sortPriceNumber = Math.max(0, Number(row.sortPriceNumber) || 0);
  row.registrationFeeEuro = Math.max(0, Math.round(Number(row.registrationFeeEuro) || 0));
  row.searchAliases = typeof row.searchAliases === "string" ? row.searchAliases : "";
  for (const k of ["firstLesson", "languages", "location", "transmission", "description", "modalDetailHtml"]) {
    if (!row[k] || typeof row[k] !== "object") row[k] = {};
  }
  for (const lng of ["et", "ru", "en"]) {
    row.firstLesson[lng] = String(row.firstLesson[lng] || "").trim();
    row.languages[lng] = String(row.languages[lng] || "").trim();
    row.location[lng] = String(row.location[lng] || "").trim();
    row.transmission[lng] = String(row.transmission[lng] || "").trim();
    row.description[lng] = String(row.description[lng] || "").trim();
    row.modalDetailHtml[lng] = String(row.modalDetailHtml[lng] || "").trim();
  }
  row.pricePackage = String(row.pricePackage || "").trim() || `${row.sortPriceNumber} €`;
  row.priceFormattedPackage = String(row.priceFormattedPackage || "").trim();
  row.priceLessonFormatted = String(row.priceLessonFormatted || "").trim();
  row.pricePerLesson = String(row.pricePerLesson || "").trim();
  row.totalCourseEuroDisplayed = String(row.totalCourseEuroDisplayed || "").trim();
  const carPhotosRaw = Array.isArray(row.carPhotos) ? row.carPhotos : [];
  row.carPhotos = carPhotosRaw
    .map((x) => String(x || "").trim())
    .filter((u) => u.startsWith("/") || u.startsWith("http://") || u.startsWith("https://"));
  const carPhotosExplicitlyCleared =
    rowIn &&
    typeof rowIn === "object" &&
    "carPhotos" in rowIn &&
    Array.isArray(rowIn.carPhotos) &&
    rowIn.carPhotos.length === 0;
  if (!carPhotosExplicitlyCleared && row.carPhotos.length === 0 && row.id) {
    const def = RAW_DEFAULT_INSTRUCTORS.find((r) => r.id === row.id);
    if (def && Array.isArray(def.carPhotos) && def.carPhotos.length) {
      row.carPhotos = def.carPhotos
        .map((x) => String(x || "").trim())
        .filter((u) => u.startsWith("/") || u.startsWith("http://") || u.startsWith("https://"));
    }
  }
  return row;
}

function mergeInstructorImported(id, parsedPayload) {
  const merged = { ...(typeof parsedPayload === "object" && parsedPayload !== null ? parsedPayload : {}), id };
  return normalizeDrivingInstructorRow(merged);
}

function replaceInstructorsList(list) {
  if (!Array.isArray(list) || list.length === 0) {
    instructorsInternal = RAW_DEFAULT_INSTRUCTORS.map((row) => cloneDeep(row));
    return;
  }
  instructorsInternal = list.map((r) => normalizeDrivingInstructorRow(r));
}

function getSeedInstructorInsertionRows() {
  return RAW_DEFAULT_INSTRUCTORS.map((row, idx) => {
    const { id: rid, ...rest } = row;
    return [rid, idx, JSON.stringify(rest)];
  });
}

function getInstructorsSnapshot() {
  return instructorsInternal.map((row) => cloneDeep(row));
}

function getInstructorsForLang(lang) {
  const l = ["et", "ru", "en"].includes(lang) ? lang : "et";
  return instructorsInternal.map((row) => ({
    ...row,
    location: row.location[l],
    transmission: row.transmission[l],
    description: row.description[l],
    firstLessonEta: row.firstLesson[l],
    spokenLanguage: row.languages[l],
    modalArticleHtml: row.modalDetailHtml[l] || row.modalDetailHtml.ru || row.modalDetailHtml.et,
    searchHaystack: buildSearchHaystack(row),
  }));
}

function getInstructorById(id) {
  return instructorsInternal.find((i) => i.id === id);
}

module.exports = {
  DRIVING_LESSONS_COURSE_ID,
  EXTRA_DRIVING_COURSE_ID,
  COURSE_IDS_REQUIRING_INSTRUCTOR,
  courseRequiresInstructor,
  buildSearchHaystack,
  replaceInstructorsList,
  mergeInstructorImported,
  getSeedInstructorInsertionRows,
  getInstructorsSnapshot,
  getInstructorsForLang,
  getInstructorById,
};
