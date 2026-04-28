const path = require("path");
const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
require("dotenv").config();

const { initDatabase } = require("./db/database");
const { supportedLanguages, defaultLanguage, t } = require("./i18n");
const siteRoutes = require("./routes/siteRoutes");
const adminRoutes = require("./routes/adminRoutes");

const app = express();
const PORT = process.env.PORT || 3000;
const initPromise = initDatabase();
const appSecret = process.env.SESSION_SECRET || "change-this-secret";

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../public")));
app.use(cookieParser(appSecret));
app.use(
  session({
    secret: appSecret,
    resave: false,
    saveUninitialized: false,
  })
);

app.use((req, res, next) => {
  const queryLang = req.query.lang;
  if (queryLang && supportedLanguages.includes(queryLang)) {
    req.session.lang = queryLang;
  }

  const activeLang = req.session.lang || defaultLanguage;
  req.lang = activeLang;
  req.t = (key) => t(activeLang, key);
  res.locals.lang = activeLang;
  res.locals.t = req.t;
  next();
});

app.use("/", siteRoutes);
app.use("/admin", adminRoutes);

app.use((req, res) => {
  res.status(404).render("pages/404", { title: "404" });
});

app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).send(req.t ? req.t("serverError") : "Server error");
});

if (require.main === module) {
  initPromise
    .then(() => {
      app.listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log(`Server started at http://localhost:${PORT}`);
      });
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error("Database init failed:", error);
      process.exit(1);
    });
}

module.exports = app;
module.exports.initPromise = initPromise;
