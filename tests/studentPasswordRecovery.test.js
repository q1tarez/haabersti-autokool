describe("student password recovery", () => {
  let app;
  let db;
  let request;
  let sendMailMock;
  let warnSpy;
  const previousEnv = {};
  const envKeys = [
    "VERCEL",
    "DATABASE_URL",
    "STORAGE_URL",
    "POSTGRES_URL",
    "SESSION_SECRET",
    "SMTP_URL",
    "SMTP_HOST",
    "SMTP_USE_GMAIL",
    "SMTP_PROVIDER",
    "SMTP_USER",
    "SMTP_PASS",
    "DOTENV_CONFIG_QUIET",
  ];

  beforeAll(async () => {
    envKeys.forEach((key) => {
      previousEnv[key] = process.env[key];
    });
    process.env.VERCEL = "1";
    delete process.env.DATABASE_URL;
    delete process.env.STORAGE_URL;
    delete process.env.POSTGRES_URL;
    process.env.SESSION_SECRET = "student-password-recovery-test-secret";
    process.env.SMTP_URL = "";
    process.env.SMTP_HOST = "smtp.test.invalid";
    process.env.SMTP_USER = "";
    process.env.SMTP_PASS = "";
    process.env.DOTENV_CONFIG_QUIET = "true";
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    sendMailMock = jest.fn().mockResolvedValue({ ok: true });
    jest.doMock("../src/mail/transport", () => ({
      hasSmtpConfig: () => true,
      sendMail: sendMailMock,
    }));
    jest.isolateModules(() => {
      db = require("../src/db/database");
      app = require("../src/app");
    });
    request = require("supertest");
    await app.initPromise;
  });

  afterAll(() => {
    warnSpy.mockRestore();
    jest.dontMock("../src/mail/transport");
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  test("sends a one-time reset link, changes the password, and revokes existing sessions", async () => {
    const passwordHash = await require("bcrypt").hash("old-student-password", 4);
    const account = await db.runAsync(
      `INSERT INTO student_accounts
       (email, username, password_hash, verification_token_hash, verification_expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      ["student-recovery@example.com", "recoverstudent", passwordHash, "verify-token", "2026-10-23T00:00:00Z"]
    );
    await db.runAsync(
      "UPDATE student_accounts SET verified_at = ? WHERE id = ? AND verification_token_hash = ?",
      ["2026-10-22T18:00:00Z", account.lastID, "verify-token"]
    );

    const existingSession = request.agent(app);
    await existingSession
      .post("/account/login")
      .type("form")
      .send({ login: "recoverstudent", password: "old-student-password" })
      .expect(303);

    await request(app)
      .post("/account/password/forgot")
      .set("Accept-Language", "en")
      .type("form")
      .send({ email: "student-recovery@example.com" })
      .expect(200)
      .expect((response) => {
        expect(response.text).toContain("If a verified account uses that email");
      });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const resetUrl = /https?:\/\/\S+\/account\/password\/reset\/([a-f0-9]{64})/.exec(
      sendMailMock.mock.calls[0][0].text
    )[0];
    const token = resetUrl.split("/").pop();

    await request(app).get(`/account/password/reset/${token}`).expect(200);
    await request(app)
      .post(`/account/password/reset/${token}`)
      .type("form")
      .send({ password: "new-student-password-2026", confirmPassword: "new-student-password-2026" })
      .expect(303)
      .expect("Location", "/account/login?passwordReset=1");
    await request(app).get(`/account/password/reset/${token}`).expect(400);
    await existingSession.get("/account/dashboard").expect(303).expect("Location", "/account/login");

    await request(app)
      .post("/account/login")
      .type("form")
      .send({ login: "recoverstudent", password: "old-student-password" })
      .expect(200);
    await request(app)
      .post("/account/login")
      .type("form")
      .send({ login: "recoverstudent", password: "new-student-password-2026" })
      .expect(303)
      .expect("Location", "/account/dashboard");
  });

  test("returns the same confirmation without revealing unknown email addresses", async () => {
    const response = await request(app)
      .post("/account/password/forgot")
      .set("Accept-Language", "en")
      .type("form")
      .send({ email: "not-registered@example.com" })
      .expect(200);
    expect(response.text).toContain("If a verified account uses that email");
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });
});
