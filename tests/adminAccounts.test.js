describe("admin account management", () => {
  let app;
  let db;
  let request;
  let signAdminSession;
  let sendMailMock;
  let warnSpy;
  let directorCookie;
  const previousEnv = {};
  const envKeys = [
    "VERCEL",
    "DATABASE_URL",
    "STORAGE_URL",
    "POSTGRES_URL",
    "ADMIN_USERNAME",
    "ADMIN_PASSWORD",
    "ADMIN_FORCE_PASSWORD_RESET",
    "SESSION_SECRET",
    "SMTP_URL",
    "SMTP_HOST",
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
    delete process.env.ADMIN_FORCE_PASSWORD_RESET;
    process.env.ADMIN_USERNAME = "settings-director";
    process.env.ADMIN_PASSWORD = "director-test-password-2026";
    process.env.SESSION_SECRET = "admin-account-test-session-secret";
    process.env.SMTP_HOST = "smtp.test.invalid";
    process.env.SMTP_URL = "";
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
      ({ signAdminSession } = require("../src/lib/signedCookie"));
    });
    request = require("supertest");
    await app.initPromise;
    directorCookie = `admin_auth=${signAdminSession(1, "settings-director", 0)}`;
    await db.runAsync(
      "INSERT INTO instructors (id, sort_order, payload, updated_at) VALUES (?, ?, ?, ?)",
      ["teacher-1", 0, JSON.stringify({ name: "Test Instructor" }), new Date().toISOString()]
    );
  });

  afterAll(() => {
    warnSpy.mockRestore();
    jest.dontMock("../src/mail/transport");
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  test("creates instructor access and supports verified email password recovery", async () => {
    await request(app).get("/admin/settings").set("Cookie", directorCookie).expect(200);
    await request(app)
      .post("/admin/instructor/login")
      .type("form")
      .send({ username: "settings-director", password: process.env.ADMIN_PASSWORD })
      .expect(401);
    await request(app)
      .post("/admin/team/create-instructor")
      .set("Cookie", directorCookie)
      .type("form")
      .send({
        username: "test-instructor",
        password: "initial-instructor-password",
        instructor_id: "teacher-1",
      })
      .expect(303)
      .expect((response) => {
        expect(response.headers.location).toBe("/admin/team?created=1");
      });

    const instructorBrowser = request.agent(app);
    const instructorLogin = await instructorBrowser
      .post("/admin/instructor/login")
      .type("form")
      .send({ username: "test-instructor", password: "initial-instructor-password" })
      .expect(303);
    expect(instructorLogin.headers.location).toBe("/admin/dashboard");
    expect(instructorLogin.headers["set-cookie"].join(";")).toContain("Max-Age=2592000");
    await instructorBrowser.get("/").expect(200);
    await instructorBrowser.get("/account").expect(303).expect("Location", "/admin/dashboard");
    await instructorBrowser.get("/admin/dashboard").expect(200);
    await instructorBrowser.get("/admin/my-schedule").expect(200);

    await request(app)
      .get("/account")
      .set("Cookie", directorCookie)
      .expect(303)
      .expect("Location", "/admin/dashboard");

    await request(app)
      .post("/admin/settings/email")
      .set("Cookie", directorCookie)
      .type("form")
      .send({ email: "director@example.com", password: process.env.ADMIN_PASSWORD })
      .expect(303)
      .expect((response) => {
        expect(response.headers.location).toBe("/admin/settings?saved=email_pending");
      });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const emailToken = /\/admin\/email\/verify\/([a-f0-9]{64})/.exec(sendMailMock.mock.calls[0][0].text)[1];
    await request(app).get(`/admin/email/verify/${emailToken}`).expect(200);
    await request(app)
      .post(`/admin/email/verify/${emailToken}`)
      .expect(303)
      .expect((response) => {
        expect(response.headers.location).toBe("/admin/login?emailVerified=1");
      });

    await request(app)
      .post("/admin/password/forgot")
      .type("form")
      .send({ email: "director@example.com" })
      .expect(200);
    expect(sendMailMock).toHaveBeenCalledTimes(2);
    const resetToken = /\/admin\/password\/reset\/([a-f0-9]{64})/.exec(sendMailMock.mock.calls[1][0].text)[1];
    await request(app).get(`/admin/password/reset/${resetToken}`).expect(200);
    await request(app)
      .post(`/admin/password/reset/${resetToken}`)
      .type("form")
      .send({ password: "recovered-director-password", confirmPassword: "recovered-director-password" })
      .expect(303)
      .expect((response) => {
        expect(response.headers.location).toBe("/admin/login?passwordChanged=1");
      });
    await request(app).get("/admin/dashboard").set("Cookie", directorCookie).expect(302);
    const recoveredLogin = await request(app)
      .post("/admin/login")
      .type("form")
      .send({ username: "settings-director", password: "recovered-director-password" })
      .expect(303);
    const recoveredCookie = recoveredLogin.headers["set-cookie"]
      .map((value) => value.split(";")[0])
      .join("; ");
    const passwordChange = await request(app)
      .post("/admin/settings/password")
      .set("Cookie", recoveredCookie)
      .type("form")
      .send({
        currentPassword: "recovered-director-password",
        newPassword: "changed-director-password",
        confirmPassword: "changed-director-password",
      })
      .expect(303);
    expect(passwordChange.headers.location).toBe("/admin/login?passwordChanged=1");
    await request(app).get("/admin/dashboard").set("Cookie", recoveredCookie).expect(302);
    await request(app)
      .post("/admin/login")
      .type("form")
      .send({ username: "settings-director", password: "changed-director-password" })
      .expect(303)
      .expect((response) => {
        expect(response.headers.location).toBe("/admin/dashboard");
      });
  });
});
