const express = require("express");
const { runAsync, allAsync, getAsync } = require("../db/database");
const { courseRequiresInstructor, getInstructorsForLang, getInstructorById } = require("../data/drivingInstructors");
const { courseRequiresTrainingOffer, mergeTrainingOfferRow } = require("../data/trainingOffers");
const { sendBankTransferInstructionsMail } = require("../mail/bankTransferMail");
const { notifyNewContact, notifyNewRegistration } = require("../mail/notifySchool");
const { sendRegistrationReceivedMail } = require("../mail/registrationReceivedMail");
const { getReviewsForLang } = require("../data/reviews");
const { supportedLanguages, t } = require("../i18n");
const { contactSchema, registrationSchema, validate } = require("../validation/schemas");

const router = express.Router();

/** Интерфейсный язык из формы (сохраняем в куке — работает на Vercel serverless). */
function applyUiLangFromBody(req, res) {
  const raw = String(req.body.uiLang || "").trim();
  if (raw && supportedLanguages.includes(raw)) {
    // Persist in cookie (works on Vercel serverless, unlike express-session in-memory store)
    res.cookie("lang", raw, {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      sameSite: "lax",
      path: "/",
    });
    req.lang = raw;
    res.locals.lang = raw;
    req.t = (key) => t(raw, key);
    res.locals.t = req.t;
  }
}

// Validation is now handled by Zod schemas in src/validation/schemas.js

const REG_COMMENT_STUDY_LANG_KEYS = { et: "filterLangEt", ru: "filterLangRu", en: "filterLangEn" };
const REG_COMMENT_PAYMENT_KEYS = { cash: "paymentCash", card: "paymentCard", bank: "paymentBank" };

function registerViewLocals(req, overrides = {}) {
  return {
    title: req.t("registerWizardTitle"),
    drivingInstructors: getInstructorsForLang(req.lang),
    courses: [],
    trainingOffers: [],
    selectedCourseId: "",
    error: null,
    success: null,
    successBankInfo: null,
    ...overrides,
  };
}

async function getLocalizedCoursesFromDb(lang, onlyActive = true) {
  const whereClause = onlyActive ? "WHERE is_active = 1" : "";
  const rows = await allAsync(`SELECT * FROM courses ${whereClause} ORDER BY created_at DESC`);
  return rows.map((course) => ({
    id: course.id,
    name: course[`name_${lang}`] || course.name_et,
    description: course[`description_${lang}`] || course.description_et,
    duration: course[`duration_${lang}`] || course.duration_et,
    price: course.price,
  }));
}

/** Сопоставление курсов БД с «мастером Sky»: категория (B/BE/Moto) и секция списка */
const WIZARD_COURSE_META = {
  "b-category": { wizardCats: ["b", "be"], wizardSection: "start" },
  "winter-training": { wizardCats: ["b", "be"], wizardSection: "quick" },
  "first-aid": { wizardCats: ["b", "be"], wizardSection: "quick" },
  "night-driving": { wizardCats: ["b", "be"], wizardSection: "quick" },
  "slippery-driving": { wizardCats: ["b", "be"], wizardSection: "quick" },
  "driving-lessons-26": { wizardCats: ["b", "be"], wizardSection: "already" },
  "extra-driving": { wizardCats: ["b", "be"], wizardSection: "already" },
};

function enrichWizardCourse(course) {
  const meta = WIZARD_COURSE_META[course.id] || { wizardCats: ["b", "be"], wizardSection: "already" };
  const wizardCats = Array.isArray(meta.wizardCats) ? meta.wizardCats : ["b"];
  const wizardSection = meta.wizardSection || "already";
  return { ...course, wizardCats, wizardSection };
}

async function loadRegistrationTrainingOffers(lang) {
  const rows = await allAsync(
    "SELECT * FROM training_offers WHERE is_active = 1 ORDER BY course_id ASC, sort_order ASC, id ASC"
  );
  return rows.map((row) => mergeTrainingOfferRow(row, lang));
}

async function getRegistrationCourses(lang) {
  const rows = await getLocalizedCoursesFromDb(lang);
  return rows.map((course) => {
    const e = enrichWizardCourse(course);
    const reqInstr = courseRequiresInstructor(course.id);
    const reqTrain = courseRequiresTrainingOffer(course.id);
    return {
      ...e,
      requiresInstructor: reqInstr,
      requiresTrainingOffer: reqTrain,
      omitCourseListPrice: reqInstr || reqTrain,
    };
  });
}

router.get("/", async (req, res, next) => {
  try {
    const metaDescriptions = {
      et: "Haabersti Autokool — kaasaegne autokool Tallinnas. B-kategooria sõiduõpe, kogenud instruktorid, paindlik graafik. Registreeru juhiloale!",
      ru: "Haabersti Autokool — современная автошкола в Таллине. Курсы вождения категории B, опытные инструкторы, гибкий график. Запишитесь на права!",
      en: "Haabersti Autokool — modern driving school in Tallinn. Category B driving courses, experienced instructors, flexible schedule. Register now!",
    };
    const courses = await getLocalizedCoursesFromDb(req.lang);
    res.render("pages/home", {
      title: "Haabersti Autokool",
      metaTitle: "Haabersti Autokool — Autokool Tallinnas",
      metaDescription: metaDescriptions[req.lang] || metaDescriptions.et,
      courses,
      reviews: getReviewsForLang(req.lang),
      instagramUrl: String(process.env.INSTAGRAM_URL || "").trim(),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/courses", async (req, res, next) => {
  try {
    const courses = await getLocalizedCoursesFromDb(req.lang);
    const courseTitles = { et: "Kursused", ru: "Курсы", en: "Courses" };
    const courseDesc = {
      et: "Haabersti Autokool kursused: B-kategooria, talvesõit, esmaabi, öine sõit ja muud. Vaata hinnad ja registreeru.",
      ru: "Курсы Haabersti Autokool: категория B, зимнее вождение, первая помощь, ночное вождение и другие. Смотри цены и записывайся.",
      en: "Haabersti Autokool courses: category B, winter driving, first aid, night driving and more. View prices and register.",
    };
    res.render("pages/courses", {
      title: courseTitles[req.lang] || "Kursused",
      metaDescription: courseDesc[req.lang] || courseDesc.et,
      courses,
    });
  } catch (error) {
    next(error);
  }
});

function siteBaseUrl(req) {
  const explicit = String(process.env.PUBLIC_SITE_URL || process.env.SITE_URL || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  if (process.env.VERCEL_URL) return `https://${String(process.env.VERCEL_URL).replace(/^https?:\/\//, "")}`;
  return `${req.protocol}://${req.get("host")}`;
}

router.get("/instructors", (req, res) => {
  const titles = { et: "Instruktorid", ru: "Инструкторы", en: "Instructors" };
  const desc = {
    et: "Haabersti Autokool instruktorid — kogenud opetajad Tallinnas.",
    ru: "Инструкторы Haabersti Autokool — опытные педагоги в Таллине.",
    en: "Haabersti Autokool instructors — experienced teachers in Tallinn.",
  };
  res.render("pages/instructors", {
    title: titles[req.lang] || titles.et,
    metaDescription: desc[req.lang] || desc.et,
    currentPath: "/instructors",
    instructors: getInstructorsForLang(req.lang),
  });
});

router.get("/faq", (req, res) => {
  const titles = { et: "KKK", ru: "Вопросы и ответы", en: "FAQ" };
  res.render("pages/faq", {
    title: titles[req.lang] || titles.et,
    currentPath: "/faq",
  });
});

router.get("/sitemap.xml", async (req, res, next) => {
  try {
    const base = siteBaseUrl(req);
    const courses = await getLocalizedCoursesFromDb(req.lang);
    const urls = ["/", "/courses", "/register/steps", "/contacts", "/instructors", "/faq", ...courses.map((c) => `/register/steps?course=${c.id}`)];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${base}${u}</loc></url>`).join("\n")}
</urlset>`;
    res.type("application/xml").send(xml);
  } catch (error) {
    next(error);
  }
});

router.get("/contacts", (req, res) => {
  const contactTitles = { et: "Kontakt", ru: "Контакты", en: "Contact" };
  const contactDesc = {
    et: "Võtke ühendust Haabersti Autokooliga. Telefon, e-post ja tööaeg.",
    ru: "Свяжитесь с Haabersti Autokool. Телефон, e-mail и часы работы.",
    en: "Contact Haabersti Autokool. Phone, email and working hours.",
  };
  res.render("pages/contacts", {
    title: contactTitles[req.lang] || "Kontakt",
    metaDescription: contactDesc[req.lang] || contactDesc.et,
    error: null,
    success: null,
  });
});

router.post("/contacts", async (req, res, next) => {
  try {
    const { fullName, phone, message, email } = req.body;
    if (!fullName || !phone) {
      res.status(400).render("pages/contacts", {
        title: "Kontakt",
        error: req.t("contactRequired"),
        success: null,
      });
      return;
    }

    const emailTrim = String(email || "").trim();
    await runAsync(
      "INSERT INTO contacts (full_name, phone, message, email) VALUES (?, ?, ?, ?)",
      [fullName, phone, message || "", emailTrim || null]
    );
    notifyNewContact({ fullName, phone, message: message || "", email: emailTrim }).catch(() => null);
    res.render("pages/contacts", {
      title: "Kontakt",
      error: null,
      success: req.t("contactSuccess"),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/register", (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  res.redirect(302, qs ? `/register/steps?${qs}` : "/register/steps");
});

router.get("/register/steps", async (req, res, next) => {
  try {
    const courses = await getRegistrationCourses(req.lang);
    const trainingOffers = await loadRegistrationTrainingOffers(req.lang);
    res.render(
      "pages/register",
      registerViewLocals(req, { courses, trainingOffers, selectedCourseId: req.query.course || "" })
    );
  } catch (error) {
    next(error);
  }
});

router.post("/register", async (req, res, next) => {
  try {
    applyUiLangFromBody(req, res);
    const courses = await getRegistrationCourses(req.lang);
    const trainingOffers = await loadRegistrationTrainingOffers(req.lang);
    const firstName = String(req.body.firstName || "").trim();
    const lastName = String(req.body.lastName || "").trim();
    let fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
    if (!fullName) fullName = String(req.body.fullName || "").trim();

    const {
      isikukood,
      phone,
      email,
      courseId,
      lessonTime,
      paymentMethod,
      comment,
      instructorId,
      studyLang,
      trainingOfferId,
    } = req.body;
        const chosenCourse = courses.find((course) => course.id === courseId);

    // Zod validation
    const validation = validate(registrationSchema, {
      firstName,
      lastName: lastName || firstName, // fallback if single field
      isikukood,
      phone,
      email,
      courseId,
      paymentMethod,
      studyLang,
      lessonTime,
      comment,
      instructorId,
      trainingOfferId,
    });

    if (!fullName || !courseId || !chosenCourse) {
      res.status(400).render(
        "pages/register",
        registerViewLocals(req, {
          courses,
          trainingOffers,
          selectedCourseId: courseId || "",
          error: req.t("registerRequired"),
        })
      );
      return;
    }

    if (!validation.success) {
      // Map Zod error messages to i18n keys where possible
      const firstError = validation.errors[0] || "";
      let errorKey = "registerRequired";
      if (firstError.toLowerCase().includes("name")) errorKey = "registerNameInvalid";
      else if (firstError.toLowerCase().includes("phone")) errorKey = "registerPhoneInvalid";
      else if (firstError.toLowerCase().includes("personal code") || firstError.toLowerCase().includes("isikukood")) errorKey = "registerIsikukoodInvalid";
      else if (firstError.toLowerCase().includes("email")) errorKey = "registerRequired";
      res.status(400).render(
        "pages/register",
        registerViewLocals(req, {
          courses,
          trainingOffers,
          selectedCourseId: courseId || "",
          error: req.t(errorKey),
        })
      );
      return;
    }

    let trainingOfferRowForNote = null;
    if (courseRequiresTrainingOffer(courseId)) {
      const tid = String(trainingOfferId || "").trim();
      const row = tid ? await getAsync("SELECT * FROM training_offers WHERE id = ?", [tid]) : null;
      if (!row || row.course_id !== courseId || !row.is_active) {
        res.status(400).render(
          "pages/register",
          registerViewLocals(req, {
            courses,
            trainingOffers,
            selectedCourseId: courseId || "",
            error: req.t("trainingOfferRequired"),
          })
        );
        return;
      }
      trainingOfferRowForNote = row;
    }

    if (courseRequiresInstructor(courseId)) {
      const instructor = getInstructorById(instructorId);
      if (!instructor) {
        res.status(400).render(
          "pages/register",
          registerViewLocals(req, {
            courses,
            trainingOffers,
            selectedCourseId: courseId || "",
            error: req.t("instructorRequired"),
          })
        );
        return;
      }
    }

    const payRaw = String(paymentMethod || "").trim();
    const allowedPay = ["cash", "bank"];
    const payNorm = allowedPay.includes(payRaw) ? payRaw : "";

    if (!payNorm) {
      res.status(400).render(
        "pages/register",
        registerViewLocals(req, {
          courses,
          trainingOffers,
          selectedCourseId: courseId || "",
          error: req.t("paymentRequired"),
        })
      );
      return;
    }

    const noteParts = [];
    const studyLangCode = String(studyLang || "").trim();
    const studyLangI18nKey = REG_COMMENT_STUDY_LANG_KEYS[studyLangCode];
    if (studyLangI18nKey) {
      noteParts.push(`${req.t("regCommentStudyLangLabel")}: ${req.t(studyLangI18nKey)}`);
    }
    const lessonTimeTrim = String(lessonTime || "").trim();
    if (lessonTimeTrim) {
      noteParts.push(`${req.t("lessonTime")}: ${lessonTimeTrim}`);
    }
    noteParts.push(`${req.t("paymentMethod")}: ${req.t(REG_COMMENT_PAYMENT_KEYS[payNorm])}`);
    if (courseRequiresInstructor(courseId) && instructorId) {
      const instr = getInstructorById(instructorId);
      if (instr?.name) {
        noteParts.push(`${req.t("regCommentInstructorLabel")}: ${instr.name}`);
      }
    }
    if (trainingOfferRowForNote) {
      const offerLoc = mergeTrainingOfferRow(trainingOfferRowForNote, req.lang);
      const offerSummary = [offerLoc.title, offerLoc.dateDisplay].filter(Boolean).join(", ");
      if (offerSummary) {
        noteParts.push(`${req.t("regCommentTrainingOfferLabel")}: ${offerSummary}`);
      }
    }
    const userComment = String(comment || "").trim();
    if (userComment) {
      noteParts.push(userComment);
    }
    const registrationNote = noteParts.join("; ");

    const instructorIdForDb =
      courseRequiresInstructor(courseId) && instructorId ? String(instructorId).trim() : null;

    await runAsync(
      `INSERT INTO course_registrations
        (full_name, isikukood, phone, email, course_id, course_name, start_date, comment, instructor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fullName,
        isikukood,
        phone,
        email,
        chosenCourse.id,
        chosenCourse.name,
        "",
        registrationNote,
        instructorIdForDb,
      ]
    );

    const mailLang = supportedLanguages.includes(String(studyLang || "").trim())
      ? String(studyLang).trim()
      : req.lang;
    sendRegistrationReceivedMail({
      to: email,
      lang: mailLang,
      fullName,
      courseName: chosenCourse.name,
    }).catch(() => null);

    notifyNewRegistration({
      fullName,
      phone,
      email,
      courseName: chosenCourse.name,
      comment: registrationNote,
    }).catch(() => null);

    let successBankInfo = null;
    if (payNorm === "bank") {
      const mailLang = supportedLanguages.includes(String(studyLang || "").trim()) ? String(studyLang).trim() : req.lang;
      try {
        const mailResult = await sendBankTransferInstructionsMail({
          to: email,
          lang: mailLang,
          fullName,
          courseName: chosenCourse.name,
          amount: chosenCourse.price,
          courseId: chosenCourse.id,
        });
        if (mailResult.mode === "smtp") {
          successBankInfo = req.t("registerBankEmailSent");
        } else if (mailResult.mode === "skipped") {
          successBankInfo = req.t("registerBankPaymentManual");
        } else {
          successBankInfo = req.t("registerBankFollowupGeneric");
        }
      } catch (mailErr) {
        // eslint-disable-next-line no-console
        console.error("Bank transfer email failed:", mailErr.message);
        successBankInfo = req.t("registerBankFollowupGeneric");
      }
    }

    res.render(
      "pages/register",
      registerViewLocals(req, {
        courses,
        trainingOffers,
        selectedCourseId: "",
        success: req.t("registerSuccess"),
        successBankInfo,
      })
    );
  } catch (error) {
    next(error);
  }
});

module.exports = router;
