/** Audience / pitch per course id for cards */
const FOR_WHOM = {
  et: {
    "b-category": "Algajatele, kes soovivad B-kategooria juhiluba.",
    "winter-training": "Neile, kes soovivad kindlust talvel sõites.",
    "first-aid": "Kõigile, kellel on vaja esmaabikursust.",
    "night-driving": "Öisesõidu kogemuse soovijatele.",
    "slippery-driving": "Libedaga sõidu praktika (RS).",
  },
  ru: {
    "b-category": "Новичкам, которые получают права категории B.",
    "winter-training": "Для уверенного вождения зимой.",
    "first-aid": "Для прохождения курса первой помощи.",
    "night-driving": "Для практики вождения в темноте.",
    "slippery-driving": "Скользкая дорога и контраварийная подготовка.",
  },
  en: {
    "b-category": "For beginners aiming for a category B licence.",
    "winter-training": "For confident winter driving.",
    "first-aid": "For required first-aid certification.",
    "night-driving": "For night driving practice.",
    "slippery-driving": "Slippery road and skid training.",
  },
};

function courseForWhom(courseId, lang) {
  const L = FOR_WHOM[lang] ? lang : "et";
  return FOR_WHOM[L][courseId] || "";
}

module.exports = { courseForWhom };
