const express = require("express");
const { runAsync, allAsync, getAsync } = require("../db/database");
const { courseRequiresInstructor, getInstructorsForLang, getInstructorById } = require("../data/drivingInstructors");
const { courseRequiresTrainingOffer, mergeTrainingOfferRow } = require("../data/trainingOffers");

const router = express.Router();

function registerViewLocals(req, overrides = {}) {
  return {
    title: req.t("registerWizardTitle"),
    drivingInstructors: getInstructorsForLang(req.lang),
    courses: [],
    trainingOffers: [],
    selectedCourseId: "",
    error: null,
    success: null,
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

router.get("/", (req, res) => {
  res.render("pages/home", { title: "Haabersti Autokool" });
});

router.get("/courses", async (req, res, next) => {
  try {
    const courses = await getLocalizedCoursesFromDb(req.lang);
    res.render("pages/courses", { title: "Kursused", courses });
  } catch (error) {
    next(error);
  }
});

router.get("/contacts", (req, res) => {
  res.render("pages/contacts", {
    title: "Kontakt",
    error: null,
    success: null,
  });
});

router.post("/contacts", async (req, res, next) => {
  try {
    const { fullName, phone, message } = req.body;
    if (!fullName || !phone) {
      res.status(400).render("pages/contacts", {
        title: "Kontakt",
        error: req.t("contactRequired"),
        success: null,
      });
      return;
    }

    await runAsync(
      "INSERT INTO contacts (full_name, phone, message) VALUES (?, ?, ?)",
      [fullName, phone, message || ""]
    );
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

    if (!fullName || !isikukood || !phone || !email || !courseId || !chosenCourse) {
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
    const allowedPay = ["cash", "card", "bank"];
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

    const registrationNote = [
      studyLang ? `study_lang:${studyLang}` : "",
      lessonTime ? `lesson_time:${lessonTime}` : "",
      payNorm ? `payment:${payNorm}` : "",
      courseRequiresInstructor(courseId) && instructorId ? `instructor:${instructorId}` : "",
      courseRequiresTrainingOffer(courseId) && trainingOfferId
        ? `training_offer:${String(trainingOfferId).trim()}`
        : "",
      comment || "",
    ]
      .filter(Boolean)
      .join(" | ");

    await runAsync(
      `INSERT INTO course_registrations
        (full_name, isikukood, phone, email, course_id, course_name, start_date, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [fullName, isikukood, phone, email, chosenCourse.id, chosenCourse.name, "", registrationNote]
    );

    res.render(
      "pages/register",
      registerViewLocals(req, { courses, trainingOffers, selectedCourseId: "", success: req.t("registerSuccess") })
    );
  } catch (error) {
    next(error);
  }
});

module.exports = router;
