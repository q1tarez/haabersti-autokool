const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { runAsync, allAsync, getAsync } = require("../db/database");
const { courseRequiresInstructor, getInstructorsForLang, getInstructorById } = require("../data/drivingInstructors");
const { courseRequiresTrainingOffer, mergeTrainingOfferRow } = require("../data/trainingOffers");
const { sendBankTransferInstructionsMail } = require("../mail/bankTransferMail");
const { notifyNewContact, notifyNewRegistration } = require("../mail/notifySchool");
const { sendRegistrationReceivedMail } = require("../mail/registrationReceivedMail");
const { sendMail, hasSmtpConfig } = require("../mail/transport");
const { createMontonioPaymentUrl } = require("../lib/montonio");
const { isOnlinePaymentEnabled } = require("../lib/onlinePayment");
const { getTestimonialsForLang } = require("../lib/testimonials");
const { signStudentSession, verifyStudentSession, COOKIE_MAX_AGE_MS } = require("../lib/signedCookie");
const { courseForWhom } = require("../data/courseMeta");
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
const REG_COMMENT_PAYMENT_KEYS = {
  cash: "paymentCash",
  card: "paymentCard",
  bank: "paymentBank",
  online: "paymentOnline",
};

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
    hideStickyCta: true,
    onlinePaymentEnabled: isOnlinePaymentEnabled(),
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
    forWhom: courseForWhom(course.id, lang),
  }));
}

/** Сопоставление курсов БД: категория (B/BE/Moto) и секция списка */
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
    const bCourse = courses.find((c) => c.id === "b-category");
    res.render("pages/home", {
      title: "Haabersti Autokool",
      metaTitle: "Haabersti Autokool — Autokool Tallinnas",
      metaDescription: metaDescriptions[req.lang] || metaDescriptions.et,
      courses,
      reviews: await getTestimonialsForLang(req.lang),
      instagramUrl: String(process.env.INSTAGRAM_URL || "").trim(),
      bCategoryPrice: bCourse ? bCourse.price : null,
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

const ACCOUNT_COPY = {
  ru: {
    loginTitle: "Вход в личный кабинет",
    registerTitle: "Создать аккаунт ученика",
    loginLead: "Войдите, чтобы посмотреть свои курсы и данные об оплате.",
    registerLead: "Создайте аккаунт и подтвердите email по ссылке из письма. Курсы автоматически появятся в кабинете, если для записи на них указан тот же адрес.",
    email: "Email",
    password: "Пароль",
    confirmPassword: "Повторите пароль",
    login: "Войти",
    register: "Создать аккаунт",
    createAccount: "Создать аккаунт",
    existingAccount: "Уже есть аккаунт?",
    noAccount: "Нет аккаунта?",
    signIn: "Войти",
    signUp: "Зарегистрироваться",
    username: "Имя пользователя",
    loginIdentifier: "Имя пользователя или email",
    usernameHelp: "3–30 символов: латинские буквы, цифры, точка, дефис или подчёркивание.",
    invalidEmail: "Введите корректный email.",
    invalidUsername: "Имя пользователя должно содержать 3–30 символов: латинские буквы, цифры, точку, дефис или подчёркивание.",
    usernameExists: "Это имя пользователя уже занято. Выберите другое.",
    invalidPassword: "Пароль должен быть не короче 10 символов и не длиннее 72 байт.",
    passwordMismatch: "Пароли не совпадают.",
    emailNotConfigured: "Не настроена отправка почты для подтверждения аккаунта. Пожалуйста, свяжитесь с автошколой.",
    verificationSent: "На указанный адрес отправлена ссылка для подтверждения. Курсы появятся в кабинете, если при записи был указан этот же email.",
    loginFailed: "Неверный email или пароль.",
    accountExists: "Аккаунт уже создан. Войдите, используя email и пароль.",
    verifyTitle: "Подтвердить email",
    verifyLead: "Нажмите кнопку, чтобы подтвердить адрес и включить личный кабинет.",
    verifyAction: "Подтвердить email",
    verifyEmailSubject: "Подтвердите email — Haabersti Autokool",
    verifyEmailBody: "Подтвердите адрес электронной почты для личного кабинета.",
    verifyInvalid: "Ссылка недействительна или срок её действия истёк. Начните регистрацию заново.",
    verified: "Email подтверждён. Теперь можно войти.",
    courses: "Мои курсы",
    statusNew: "Новая",
    statusContacted: "Связались",
    statusClosed: "Закрыта",
    courseStatus: "Статус заявки",
    payment: "Оплата",
    instructor: "Инструктор",
    courseDate: "Дата начала курса",
    preferredTime: "Пожелание по времени уроков",
    noCourses: "К этому email пока не привязаны курсы. Вы можете записаться позже — для создания аккаунта курс не нужен.",
    paid: "Оплачено",
    unpaid: "Не оплачено",
    pendingPayment: "Ожидает оплаты",
    unknown: "Не указан",
    schedule: "Расписание занятий",
    scheduleLater: "Точные даты и время уроков пока не ведутся в личном кабинете. Указанное при записи время — пожелание, а не подтверждённое расписание. Свяжитесь с инструктором или автошколой.",
    attendance: "Посещаемость и прогресс",
    attendanceLater: "Информация о посещаемости появится здесь после запуска учёта уроков.",
    logout: "Выйти",
  },
  en: {
    loginTitle: "Student account sign in",
    registerTitle: "Create a student account",
    loginLead: "Sign in to view your courses and payment information.",
    registerLead: "Create an account and verify your email using the link we send. Courses will appear automatically if you used the same email when registering.",
    email: "Email",
    password: "Password",
    confirmPassword: "Confirm password",
    login: "Sign in",
    register: "Create account",
    createAccount: "Create an account",
    existingAccount: "Already have an account?",
    noAccount: "New here?",
    signIn: "Sign in",
    signUp: "Create account",
    username: "Username",
    loginIdentifier: "Username or email",
    usernameHelp: "3–30 characters: Latin letters, numbers, dot, hyphen, or underscore.",
    invalidEmail: "Enter a valid email address.",
    invalidUsername: "Username must be 3–30 characters: Latin letters, numbers, dot, hyphen, or underscore.",
    usernameExists: "That username is already taken. Please choose another.",
    invalidPassword: "Password must be at least 10 characters and no longer than 72 bytes.",
    passwordMismatch: "Passwords do not match.",
    emailNotConfigured: "Account verification email is not configured. Please contact the school.",
    verificationSent: "A verification link has been sent to this address. Courses will appear in your account if you used the same email when registering.",
    loginFailed: "Invalid email or password.",
    accountExists: "An account already exists. Sign in using your email and password.",
    verifyTitle: "Verify your email",
    verifyLead: "Click below to confirm your email address and activate your student account.",
    verifyAction: "Verify email",
    verifyEmailSubject: "Verify your email — Haabersti Autokool",
    verifyEmailBody: "Confirm your email address to activate your student account.",
    verifyInvalid: "This link is invalid or expired. Please register again.",
    verified: "Email verified. You can now sign in.",
    courses: "My courses",
    statusNew: "New",
    statusContacted: "Contacted",
    statusClosed: "Closed",
    courseStatus: "Registration status",
    payment: "Payment",
    instructor: "Instructor",
    courseDate: "Course start date",
    preferredTime: "Preferred lesson time",
    noCourses: "There are no courses linked to this email yet. You can register later; a course is not required to create an account.",
    paid: "Paid",
    unpaid: "Unpaid",
    pendingPayment: "Payment pending",
    unknown: "Not specified",
    schedule: "Lesson schedule",
    scheduleLater: "Exact lesson dates and times are not managed in the account yet. The time selected during registration is a preference, not a confirmed schedule. Please contact your instructor or the school.",
    attendance: "Attendance and progress",
    attendanceLater: "Attendance information will appear here when lesson tracking is available.",
    logout: "Sign out",
  },
  et: {
    loginTitle: "Õpilase konto sisselogimine",
    registerTitle: "Loo õpilase konto",
    loginLead: "Logi sisse, et vaadata kursuseid ja makseteavet.",
    registerLead: "Loo konto ja kinnita e-post lingiga, mille saadame. Kursused ilmuvad kontole automaatselt, kui kasutasid registreerumisel sama e-posti aadressi.",
    email: "E-post",
    password: "Parool",
    confirmPassword: "Korda parooli",
    login: "Logi sisse",
    register: "Loo konto",
    createAccount: "Loo konto",
    existingAccount: "Konto on juba olemas?",
    noAccount: "Uus kasutaja?",
    signIn: "Logi sisse",
    signUp: "Loo konto",
    username: "Kasutajanimi",
    loginIdentifier: "Kasutajanimi või e-post",
    usernameHelp: "3–30 märki: ladina tähed, numbrid, punkt, sidekriips või alakriips.",
    invalidEmail: "Sisesta korrektne e-posti aadress.",
    invalidUsername: "Kasutajanimi peab olema 3–30 märki: ladina tähed, numbrid, punkt, sidekriips või alakriips.",
    usernameExists: "See kasutajanimi on juba kasutusel. Vali teine.",
    invalidPassword: "Parool peab olema vähemalt 10 märki ja kuni 72 baiti pikk.",
    passwordMismatch: "Paroolid ei kattu.",
    emailNotConfigured: "Konto kinnitamiseks mõeldud e-posti saatmine pole seadistatud. Võta kooliga ühendust.",
    verificationSent: "Sellele aadressile saadeti kinnituslink. Kursused ilmuvad kontole, kui kasutasid registreerumisel sama e-posti aadressi.",
    loginFailed: "Vale e-post või parool.",
    accountExists: "Konto on juba loodud. Logi sisse e-posti ja parooliga.",
    verifyTitle: "Kinnita e-post",
    verifyLead: "Õpilaskonto aktiveerimiseks kinnita alloleva nupuga oma e-posti aadress.",
    verifyAction: "Kinnita e-post",
    verifyEmailSubject: "Kinnita e-post — Haabersti Autokool",
    verifyEmailBody: "Õpilaskonto aktiveerimiseks kinnita oma e-posti aadress.",
    verifyInvalid: "Link on kehtetu või aegunud. Palun alusta registreerimist uuesti.",
    verified: "E-post on kinnitatud. Nüüd saad sisse logida.",
    courses: "Minu kursused",
    statusNew: "Uus",
    statusContacted: "Ühendust võetud",
    statusClosed: "Suletud",
    courseStatus: "Registreeringu olek",
    payment: "Makse",
    instructor: "Sõiduõpetaja",
    courseDate: "Kursuse alguskuupäev",
    preferredTime: "Eelistatud sõidutunni aeg",
    noCourses: "Selle e-posti aadressiga pole veel kursuseid seotud. Saad registreeruda hiljem — konto loomiseks pole kursust vaja.",
    paid: "Makstud",
    unpaid: "Maksmata",
    pendingPayment: "Makse ootel",
    unknown: "Määramata",
    schedule: "Tundide ajakava",
    scheduleLater: "Tundide täpseid kuupäevi ja kellaaegu kontol veel ei hallata. Registreerimisel valitud aeg on soov, mitte kinnitatud tunniplaan. Palun võta ühendust õpetaja või kooliga.",
    attendance: "Osalemine ja edenemine",
    attendanceLater: "Osalemise teave lisatakse siia, kui tundide arvestus käivitub.",
    logout: "Logi välja",
  },
};

function accountCopy(lang) {
  return ACCOUNT_COPY[lang] || ACCOUNT_COPY.et;
}

function renderAccountAuth(req, res, mode, options = {}) {
  const copy = accountCopy(req.lang);
  res.render("pages/account-auth", {
    title: mode === "register" ? copy.registerTitle : copy.loginTitle,
    currentPath: "/account",
    hideStickyCta: true,
    mode,
    copy,
    error: options.error || null,
    notice: options.notice || null,
    email: options.email || "",
    username: options.username || "",
    login: options.login || "",
  });
}

function issueStudentSession(res, studentId) {
  res.cookie("student_auth", signStudentSession(studentId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_MS,
    path: "/",
  });
}

function readStudentSession(req) {
  const token = req.cookies && req.cookies.student_auth;
  return token ? verifyStudentSession(token) : null;
}

router.get("/account", (req, res) => {
  res.redirect(303, readStudentSession(req) ? "/account/dashboard" : "/account/login");
});

router.get("/account/register", (req, res) => {
  if (readStudentSession(req)) {
    res.redirect(303, "/account/dashboard");
    return;
  }
  renderAccountAuth(req, res, "register");
});

router.post("/account/register", async (req, res, next) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const username = String(req.body.username || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const confirmPassword = String(req.body.confirmPassword || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
      renderAccountAuth(req, res, "register", { error: accountCopy(req.lang).invalidEmail, email });
      return;
    }
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username)) {
      renderAccountAuth(req, res, "register", {
        error: accountCopy(req.lang).invalidUsername,
        email,
        username,
      });
      return;
    }
    if (password.length < 10 || Buffer.byteLength(password, "utf8") > 72) {
      renderAccountAuth(req, res, "register", {
        error: accountCopy(req.lang).invalidPassword,
        email,
        username,
      });
      return;
    }
    if (password !== confirmPassword) {
      renderAccountAuth(req, res, "register", {
        error: accountCopy(req.lang).passwordMismatch,
        email,
        username,
      });
      return;
    }
    if (!hasSmtpConfig()) {
      renderAccountAuth(req, res, "register", {
        error: accountCopy(req.lang).emailNotConfigured,
        email,
        username,
      });
      return;
    }

    const existing = await getAsync("SELECT * FROM student_accounts WHERE email = ?", [email]);
    const usernameOwner = await getAsync(
      "SELECT id FROM student_accounts WHERE LOWER(username) = ?",
      [username]
    );
    if (usernameOwner && (!existing || String(usernameOwner.id) !== String(existing.id))) {
      renderAccountAuth(req, res, "register", {
        error: accountCopy(req.lang).usernameExists,
        email,
        username,
      });
      return;
    }
    if (existing && existing.verified_at) {
      renderAccountAuth(req, res, "login", {
        notice: accountCopy(req.lang).accountExists,
        email,
        username,
      });
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const passwordHash = await bcrypt.hash(password, 12);
    if (existing) {
      await runAsync(
        `UPDATE student_accounts
         SET username = ?, password_hash = ?, verification_token_hash = ?, verification_expires_at = ?
         WHERE id = ?`,
        [username, passwordHash, tokenHash, expiresAt, existing.id]
      );
    } else {
      await runAsync(
        `INSERT INTO student_accounts
         (email, username, password_hash, verification_token_hash, verification_expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [email, username, passwordHash, tokenHash, expiresAt]
      );
    }

    const baseUrl = String(
      process.env.PUBLIC_SITE_URL || process.env.SITE_URL || "https://haabersti-autokool.vercel.app"
    ).trim().replace(/\/$/, "");
    const verifyUrl = `${baseUrl}/account/verify/${token}`;
    try {
      await sendMail({
        to: email,
        subject: accountCopy(req.lang).verifyEmailSubject,
        text: `${accountCopy(req.lang).verifyEmailBody} ${verifyUrl}\n${accountCopy(req.lang).verifyAction}`,
        html: `<p>${accountCopy(req.lang).verifyEmailBody}</p><p><a href="${verifyUrl}">${accountCopy(req.lang).verifyAction}</a></p>`,
      });
    } catch (error) {
      await runAsync(
        `UPDATE student_accounts
         SET verification_token_hash = NULL, verification_expires_at = NULL
         WHERE verification_token_hash = ?`,
        [tokenHash]
      );
      throw error;
    }

    renderAccountAuth(req, res, "login", {
      notice: accountCopy(req.lang).verificationSent,
      email,
      username,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/account/login", (req, res) => {
  if (readStudentSession(req)) {
    res.redirect(303, "/account/dashboard");
    return;
  }
  const notice = req.query.verified === "1" ? accountCopy(req.lang).verified : null;
  renderAccountAuth(req, res, "login", { notice });
});

router.post("/account/login", async (req, res, next) => {
  try {
    const login = String(req.body.login || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const account =
      login.length <= 200 && !/\s/.test(login)
        ? await getAsync(
            "SELECT * FROM student_accounts WHERE LOWER(email) = ? OR LOWER(username) = ?",
            [login, login]
          )
        : null;
    if (
      !account ||
      !account.verified_at ||
      Buffer.byteLength(password, "utf8") > 72 ||
      !(await bcrypt.compare(password, account.password_hash))
    ) {
      renderAccountAuth(req, res, "login", { error: accountCopy(req.lang).loginFailed, login });
      return;
    }
    issueStudentSession(res, account.id);
    res.redirect(303, "/account/dashboard");
  } catch (error) {
    next(error);
  }
});

router.get("/account/verify/:token", async (req, res, next) => {
  try {
    const token = String(req.params.token || "");
    const tokenHash = /^[a-f0-9]{64}$/.test(token)
      ? crypto.createHash("sha256").update(token).digest("hex")
      : "";
    const account = tokenHash
      ? await getAsync("SELECT * FROM student_accounts WHERE verification_token_hash = ?", [tokenHash])
      : null;
    const valid = account && new Date(account.verification_expires_at).getTime() > Date.now();
    res.render("pages/account-verify", {
      title: accountCopy(req.lang).verifyTitle,
      currentPath: "/account",
      hideStickyCta: true,
      copy: accountCopy(req.lang),
      token: valid ? token : "",
      invalid: !valid,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/account/verify/:token", async (req, res, next) => {
  try {
    const token = String(req.params.token || "");
    if (!/^[a-f0-9]{64}$/.test(token)) {
      res.redirect(303, "/account/login");
      return;
    }
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const account = await getAsync("SELECT * FROM student_accounts WHERE verification_token_hash = ?", [tokenHash]);
    if (!account || new Date(account.verification_expires_at).getTime() <= Date.now()) {
      renderAccountAuth(req, res, "login", { error: accountCopy(req.lang).verifyInvalid });
      return;
    }
    const result = await runAsync(
      `UPDATE student_accounts
       SET verified_at = ?, verification_token_hash = NULL, verification_expires_at = NULL
       WHERE id = ? AND verification_token_hash = ?`,
      [new Date().toISOString(), account.id, tokenHash]
    );
    if (!result.changes) {
      renderAccountAuth(req, res, "login", { error: accountCopy(req.lang).verifyInvalid });
      return;
    }
    res.redirect(303, "/account/login?verified=1");
  } catch (error) {
    next(error);
  }
});

router.post("/account/logout", (_req, res) => {
  res.clearCookie("student_auth", { httpOnly: true, sameSite: "lax", path: "/" });
  res.redirect(303, "/account/login");
});

router.get("/account/dashboard", async (req, res, next) => {
  try {
    const session = readStudentSession(req);
    if (!session) {
      res.redirect(303, "/account/login");
      return;
    }
    const account = await getAsync("SELECT * FROM student_accounts WHERE id = ?", [session.id]);
    if (!account || !account.verified_at) {
      res.clearCookie("student_auth", { path: "/" });
      res.redirect(303, "/account/login");
      return;
    }

    const rows = await allAsync(
      `SELECT * FROM course_registrations
       WHERE LOWER(email) = ?
       ORDER BY created_at DESC`,
      [account.email]
    );
    const instructors = getInstructorsForLang(req.lang);
    const courses = rows.map((row) => ({
      ...row,
      instructorName: instructors.find((instructor) => instructor.id === row.instructor_id)?.name || "",
      preferredTime:
        /(?:Eelistatud sõidutunni aeg|Предпочтительное время обучения|Preferred lesson time):\s*([^;]+)/i.exec(
          row.comment || ""
        )?.[1]?.trim() || "",
    }));
    res.render("pages/account-dashboard", {
      title: accountCopy(req.lang).courses,
      currentPath: "/account",
      hideStickyCta: true,
      copy: accountCopy(req.lang),
      email: account.email,
      username: account.username,
      courses,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/instructors", (req, res) => {
  const titles = { et: "Instruktorid", ru: "Инструкторы", en: "Instructors" };
  const desc = {
    et: "Haabersti Autokooli kogenud sõiduõpetajad Tallinnas.",
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
    if (isOnlinePaymentEnabled()) allowedPay.push("online");
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

    const insertResult = await runAsync(
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
    const registrationId = insertResult?.lastID;

    const mailLang = supportedLanguages.includes(String(studyLang || "").trim())
      ? String(studyLang).trim()
      : req.lang;

    let confirmEmailStatus = "pending";
    try {
      const confirmResult = await sendRegistrationReceivedMail({
        to: email,
        lang: mailLang,
        fullName,
        courseName: chosenCourse.name,
      });
      confirmEmailStatus = confirmResult.mode === "smtp" ? "sent" : "pending";
    } catch (mailErr) {
      // eslint-disable-next-line no-console
      console.error("[registration-confirm-mail]", mailErr.message);
      confirmEmailStatus = "failed";
    }

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

    if (payNorm === "online" && registrationId) {
      const pay = await createMontonioPaymentUrl({
        id: registrationId,
        full_name: fullName,
        email,
        course_name: chosenCourse.name,
        price: chosenCourse.price,
        lang: mailLang,
      });
      if (pay.ok && pay.paymentUrl) {
        res.redirect(303, pay.paymentUrl);
        return;
      }
      // eslint-disable-next-line no-console
      console.error("[montonio]", pay.reason || "unknown", pay.detail || "");
      if (!successBankInfo) {
        try {
          const bankFallback = await sendBankTransferInstructionsMail({
            to: email,
            lang: mailLang,
            fullName,
            courseName: chosenCourse.name,
            amount: chosenCourse.price,
            courseId: chosenCourse.id,
          });
          if (bankFallback.mode === "smtp") {
            successBankInfo = req.t("registerBankEmailSent");
          }
        } catch (bankErr) {
          // eslint-disable-next-line no-console
          console.error("[montonio-fallback-bank-mail]", bankErr.message);
        }
      }
    }

    const thanksQs = new URLSearchParams();
    if (successBankInfo) thanksQs.set("bank", "1");
    if (payNorm === "bank") thanksQs.set("pay", "bank");
    if (payNorm === "online") thanksQs.set("pay", "online_failed");
    thanksQs.set("email", confirmEmailStatus);
    res.redirect(303, `/register/thanks${thanksQs.toString() ? `?${thanksQs}` : ""}`);
  } catch (error) {
    next(error);
  }
});

router.get("/register/thanks", (req, res) => {
  const emailStatus = String(req.query.email || "");
  res.render("pages/register-thanks", {
    title: req.t("thanksTitle"),
    hideStickyCta: true,
    bankNote: req.query.bank === "1",
    onlinePayFailed: req.query.pay === "online_failed",
    confirmEmailSent: emailStatus === "sent",
    confirmEmailPending: emailStatus === "pending" || emailStatus === "failed",
    currentPath: "/register/steps",
    metaDescription: req.t("thanksLead"),
  });
});

router.get("/payment/return", async (req, res, next) => {
  try {
    const ref = String(req.query.ref || "").trim();
    let paid = false;
    const match = /^reg-(\d+)$/.exec(ref);
    if (match) {
      const row = await getAsync("SELECT payment_status FROM course_registrations WHERE id = ?", [match[1]]);
      paid = row?.payment_status === "paid";
    }
    res.render("pages/payment-return", {
      title: paid ? req.t("paymentReturnPaidTitle") : req.t("paymentReturnPendingTitle"),
      paid,
      hideStickyCta: true,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/prices", async (req, res, next) => {
  try {
    const courses = await getLocalizedCoursesFromDb(req.lang);
    res.render("pages/prices", {
      title: req.t("pricesTitle"),
      metaDescription: req.t("pricesLead"),
      courses,
      currentPath: "/prices",
    });
  } catch (error) {
    next(error);
  }
});

router.get("/privacy", (req, res) => {
  res.render("pages/privacy", { title: req.t("privacyTitle"), currentPath: "/privacy" });
});

router.get("/consultation", (req, res) => {
  res.render("pages/consultation", {
    title: req.t("consultationTitle"),
    error: null,
    success: null,
    currentPath: "/consultation",
  });
});

router.post("/consultation", async (req, res, next) => {
  try {
    const fullName = String(req.body.fullName || "").trim();
    const phone = String(req.body.phone || "").trim();
    if (!fullName || !phone) {
      res.status(400).render("pages/consultation", {
        title: req.t("consultationTitle"),
        error: req.t("contactRequired"),
        success: null,
        currentPath: "/consultation",
      });
      return;
    }
    await runAsync("INSERT INTO lead_inquiries (full_name, phone, source) VALUES (?, ?, ?)", [
      fullName,
      phone,
      "consultation",
    ]);
    notifyNewRegistration({
      fullName,
      phone,
      email: "—",
      courseName: req.t("consultationTitle"),
      comment: "Consultation / callback request",
    }).catch(() => null);
    res.render("pages/consultation", {
      title: req.t("consultationTitle"),
      error: null,
      success: req.t("consultationSuccess"),
      currentPath: "/consultation",
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
