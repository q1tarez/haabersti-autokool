const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const { initDatabase } = require("./db/database");
const { formatEtDateTime } = require("./formatEtDateTime");
const { supportedLanguages, defaultLanguage, t } = require("./i18n");
const siteRoutes = require("./routes/siteRoutes");
const adminRoutes = require("./routes/adminRoutes");
const { reportError } = require("./lib/errorReporter");

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Vercel's reverse proxy (required for rate limiting and X-Forwarded-For)
app.set("trust proxy", 1);
const initPromise = initDatabase();

// Security headers via Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://www.googletagmanager.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://api.telegram.org", "https://www.google-analytics.com"],
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
  validate: { xForwardedForHeader: false },
});

// General rate limiter for public forms
const formLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../public")));
app.use(cookieParser());

// Language middleware — cookie-based (works on Vercel serverless)
app.use((req, res, next) => {
  const queryLang = req.query.lang;
  if (queryLang && supportedLanguages.includes(queryLang)) {
    res.cookie("lang", queryLang, {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: false,
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
  res.locals.gaId = String(process.env.GA_MEASUREMENT_ID || "").trim();
  res.locals.whatsappPhone = String(process.env.WHATSAPP_PHONE || "37256847904").replace(/\D/g, "");
  res.locals.telegramUrl = String(process.env.TELEGRAM_PUBLIC_URL || "").trim();
  next();
});

// Attach rate limiters to routes
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
  // eslint-disable-next-line no-console
  console.error("[APP ERROR]", err.message, err.stack);
  reportError(err, req).catch(() => null);
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
