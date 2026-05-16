/** Static testimonials for home / reviews section */
const reviews = [
  {
    name: "Anna K.",
    lang: "et",
    text: {
      et: "Sain juhiloa esimesel katsel. Õpetaja oli kannatlik ja selgitas kõik arusaadavalt.",
      ru: "Сдала экзамен с первого раза. Преподаватель терпеливый, всё объяснял понятно.",
      en: "Passed on the first try. Patient instructor, everything explained clearly.",
    },
    rating: 5,
  },
  {
    name: "Михаил П.",
    lang: "ru",
    text: {
      et: "Hea kool Tallinnas — paindlik ajakava ja aus hind.",
      ru: "Хорошая школа в Таллинне — гибкий график и честная цена.",
      en: "Good school in Tallinn — flexible schedule and fair price.",
    },
    rating: 5,
  },
  {
    name: "Laura T.",
    lang: "et",
    text: {
      et: "Teooriakursus oli struktureeritud, praktika autoga uus ja mugav.",
      ru: "Теория структурирована, практика на новой удобной машине.",
      en: "Structured theory, practical lessons in a new comfortable car.",
    },
    rating: 5,
  },
];

function getReviewsForLang(lang) {
  const L = ["et", "ru", "en"].includes(lang) ? lang : "et";
  return reviews.map((r) => ({
    name: r.name,
    rating: r.rating,
    text: r.text[L] || r.text.et,
  }));
}

module.exports = { reviews, getReviewsForLang };
