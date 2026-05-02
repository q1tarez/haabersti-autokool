const express = require("express");
const { runAsync, allAsync } = require("../db/database");
const { courseRequiresInstructor, getInstructorsForLang, getInstructorById } = require("../data/drivingInstructors");

const router = express.Router();

function registerViewLocals(req, overrides = {}) {
  return {
    title: req.t("registerWizardTitle"),
    drivingInstructors: getInstructorsForLang(req.lang),
    courses: [],
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

async function getRegistrationCourses(lang) {
  const rows = await getLocalizedCoursesFromDb(lang);
  return rows.map((course) => ({
    ...course,
    requiresInstructor: courseRequiresInstructor(course.id),
    omitCourseListPrice: courseRequiresInstructor(course.id),
  }));
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
    res.render("pages/register", registerViewLocals(req, { courses, selectedCourseId: req.query.course || "" }));
  } catch (error) {
    next(error);
  }
});

router.post("/register", async (req, res, next) => {
  try {
    const courses = await getRegistrationCourses(req.lang);
    const {
      fullName,
      isikukood,
      phone,
      email,
      courseId,
      startDate,
      lessonTime,
      paymentMethod,
      comment,
      instructorId,
    } = req.body;
    const chosenCourse = courses.find((course) => course.id === courseId);

    if (!fullName || !isikukood || !phone || !email || !courseId || !chosenCourse) {
      res.status(400).render(
        "pages/register",
        registerViewLocals(req, {
          courses,
          selectedCourseId: courseId || "",
          error: req.t("registerRequired"),
        })
      );
      return;
    }

    if (courseRequiresInstructor(courseId)) {
      const instructor = getInstructorById(instructorId);
      if (!instructor) {
        res.status(400).render(
          "pages/register",
          registerViewLocals(req, {
            courses,
            selectedCourseId: courseId || "",
            error: req.t("instructorRequired"),
          })
        );
        return;
      }
    }

    const registrationNote = [
      lessonTime ? `lesson_time:${lessonTime}` : "",
      paymentMethod ? `payment:${paymentMethod}` : "",
      courseRequiresInstructor(courseId) && instructorId ? `instructor:${instructorId}` : "",
      comment || "",
    ]
      .filter(Boolean)
      .join(" | ");

    await runAsync(
      `INSERT INTO course_registrations
        (full_name, isikukood, phone, email, course_id, course_name, start_date, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [fullName, isikukood, phone, email, chosenCourse.id, chosenCourse.name, startDate || "", registrationNote]
    );

    res.render("pages/register", registerViewLocals(req, { courses, selectedCourseId: "", success: req.t("registerSuccess") }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
