const express = require("express");
const { runAsync, allAsync } = require("../db/database");

const router = express.Router();

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

router.get("/register", async (req, res, next) => {
  try {
    const courses = await getLocalizedCoursesFromDb(req.lang);
    res.render("pages/register", {
      title: "Registreeru kursusele",
      courses,
      selectedCourseId: req.query.course || "",
      error: null,
      success: null,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/register", async (req, res, next) => {
  try {
    const courses = await getLocalizedCoursesFromDb(req.lang);
    const { fullName, isikukood, phone, email, courseId, startDate, lessonTime, paymentMethod, comment } = req.body;
    const chosenCourse = courses.find((course) => course.id === courseId);

    if (!fullName || !isikukood || !phone || !email || !courseId || !chosenCourse) {
      res.status(400).render("pages/register", {
        title: "Registreeru kursusele",
        courses,
        selectedCourseId: courseId || "",
        error: req.t("registerRequired"),
        success: null,
      });
      return;
    }

    const registrationNote = [
      lessonTime ? `lesson_time:${lessonTime}` : "",
      paymentMethod ? `payment:${paymentMethod}` : "",
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

    res.render("pages/register", {
      title: "Registreeru kursusele",
      courses,
      selectedCourseId: "",
      error: null,
      success: req.t("registerSuccess"),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
