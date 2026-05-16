const path = require("path");
const express = require("express");
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

// CSRF protection (cookie-based — works on Vercel serverless, no session needed)
const csrfProtection = csurf({ cookie: { httpOnly: true, sameSite: "lax" } });

app.use((req, res, next) => {
  // Language: prefer query param, then cookie, then default
  const queryLang = req.query.lang;
  if (queryLang && supportedLanguages.includes(queryLang)) {
    // Persist language choice in a plain cookie (works on Vercel serverless)
    res.cookie("lang", queryLang, {
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
      httpOnly: false, // readable by JS if needed
      sameSite: "lax",
      path: "/",
    });
    req.lang = queryLang;
  } else {
    const cookieLang = req.cookies && req.cookies.lang;
    req.lang = (cookieLang && supportedLanguages.includes(cookieLang)) ? cookieLang : defaultLanguage;
  }

  req.t = (key) => t(req.lang, key);
  res.locals.lang = req.lang;
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

// Global error handler
app.use((err, req, res, next) => {
  if (err.code === "EBADCSRFTOKEN") {
    res.status(403).send("Invalid or missing CSRF token. Please reload the page and try again.");
    return;
  }
  // eslint-disable-next-line no-console
  console.error("[APP ERROR]", err.message, err.stack);
  const isDev = process.env.NODE_ENV !== "production";
  const msg = isDev
    ? `Server error: ${err.message}`
    : (req.t ? req.t("serverError") : "Server error");
  res.status(500).send(msg);
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
