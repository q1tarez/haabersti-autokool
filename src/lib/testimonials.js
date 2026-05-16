const { allAsync } = require("../db/database");
const { getReviewsForLang, reviews: staticReviews } = require("../data/reviews");

async function getTestimonialsForLang(lang) {
  try {
    const rows = await allAsync(
      `SELECT name, text_et, text_ru, text_en, rating FROM testimonials
       WHERE is_active = 1 ORDER BY sort_order ASC, id ASC`
    );
    if (rows && rows.length) {
      const L = ["et", "ru", "en"].includes(lang) ? lang : "et";
      return rows.map((r) => ({
        name: r.name,
        rating: Number(r.rating) || 5,
        text: r[`text_${L}`] || r.text_et || r.text_ru || "",
      }));
    }
  } catch {
    /* table may not exist yet */
  }
  return getReviewsForLang(lang);
}

module.exports = { getTestimonialsForLang, staticReviews };
