const path = require("path");
const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const csurf = require("csurf");
require("dotenv").config();

const { initDatabase } = require("./db/database");
const { formatEtDateTime } = require("./formatEtDateTime");
const { supportedLanguages, defaultLanguage, t } = require("./i18n");
const siteRoutes = require("./routes/siteRoutes");
const adminRoutes = require("./routes/adminRoutes");

const app = express();
const PORT = process.env.PORT || 3000;
const initPromise = initDatabase();
const appSecret = process.env.SESSION_SECRET || "change-this-secret";

// Security headers via Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
      },
    },
  })
);

// Rate limiting for login route (brute-force protection)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 attempts per 15 min
  message: "Too many login attempts. Please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

// General rate limiter for public forms
const formLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

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
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  })
);

// CSRF protection (must be after session and cookieParser)
const csrfProtection = csurf({ cookie: false });

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
  res.locals.formatEtDateTime = formatEtDateTime;
  next();
});

// Attach rate limiters and CSRF to routes
app.use("/admin/login", loginLimiter);
app.use("/contacts", formLimiter);
app.use("/register", formLimiter);

app.use("/", siteRoutes);
app.use("/admin", adminRoutes);

app.use((req, res) => {
  res.status(404).render("pages/404", { title: "404" });
});

// CSRF error handler
app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    res.status(403).send("Invalid or missing CSRF token. Please reload the page and try again.");
    return;
  }
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
module.exports.csrfProtection = csrfProtection;
