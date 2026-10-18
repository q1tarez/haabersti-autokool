describe("student lesson storage", () => {
  let db;
  let app;
  let signAdminSession;
  let signStudentSession;
  let request;
  let warnSpy;
  const previousEnv = {};
  const isolatedEnvKeys = [
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
    isolatedEnvKeys.forEach((key) => {
      previousEnv[key] = process.env[key];
    });
    process.env.VERCEL = "1";
    delete process.env.DATABASE_URL;
    delete process.env.STORAGE_URL;
    delete process.env.POSTGRES_URL;
    process.env.SESSION_SECRET = "student-lessons-test-secret";
    process.env.SMTP_URL = "";
    process.env.SMTP_HOST = "";
    process.env.SMTP_USE_GMAIL = "";
    process.env.SMTP_PROVIDER = "";
    process.env.SMTP_USER = "";
    process.env.SMTP_PASS = "";
    process.env.DOTENV_CONFIG_QUIET = "true";
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.isolateModules(() => {
      db = require("../src/db/database");
      app = require("../src/app");
      ({ signAdminSession, signStudentSession } = require("../src/lib/signedCookie"));
    });
    request = require("supertest");
    await app.initPromise;
  });

  afterAll(() => {
    warnSpy.mockRestore();
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });

  test("manages lessons and notifications end to end while keeping account data private", async () => {
    await db.runAsync(
      `INSERT INTO course_registrations
       (full_name, isikukood, phone, email, course_id, course_name, start_date, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["Test Student", null, "5551234", "student@example.com", "b-category", "B course", "", ""]
    );
    const accountResult = await db.runAsync(
      `INSERT INTO student_accounts
       (email, username, password_hash, verification_token_hash, verification_expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      ["student@example.com", "teststudent", "hash", "verification-token", "2026-10-19T00:00:00Z"]
    );
    await db.runAsync(
      "UPDATE student_accounts SET verified_at = ? WHERE id = ? AND verification_token_hash = ?",
      ["2026-10-18T12:00:00Z", accountResult.lastID, "verification-token"]
    );
    const adminResult = await db.runAsync(
      "INSERT INTO admins (username, password_hash) VALUES (?, ?)",
      ["lesson-admin", "test-hash"]
    );
    const adminCookie = `admin_auth=${signAdminSession(adminResult.lastID, "lesson-admin")}`;
    const studentCookie = `student_auth=${signStudentSession(accountResult.lastID)}`;

    await request(app)
      .get("/admin/student-accounts?search=teststudent&verification=verified")
      .set("Cookie", adminCookie)
      .expect(200)
      .expect((response) => {
        expect(response.text).toContain("teststudent");
        expect(response.text).not.toContain("test-hash");
      });
    await request(app)
      .get("/admin/student-accounts/export.csv?verification=verified")
      .set("Cookie", adminCookie)
      .expect(200)
      .expect((response) => {
        expect(response.text).toContain("username,email,verification_status");
        expect(response.text).toContain("teststudent");
      });
    await request(app).get("/admin/lessons").set("Cookie", adminCookie).expect(200);

    await request(app)
      .post("/admin/lessons")
      .set("Cookie", adminCookie)
      .type("form")
      .send({
        registration_id: 1,
        starts_at: "2026-02-31T14:00",
        duration_minutes: 45,
      })
      .expect(400);

    const createResponse = await request(app)
      .post("/admin/lessons")
      .set("Cookie", adminCookie)
      .type("form")
      .send({
        registration_id: 1,
        starts_at: "2026-10-19T14:00",
        duration_minutes: 45,
        status: "planned",
      })
      .expect(303);
    expect(createResponse.headers.location).toContain("notice=created");

    const lessons = await db.allAsync(
      "SELECT * FROM student_lessons WHERE registration_id IN (?) ORDER BY starts_at ASC",
      [1]
    );
    expect(lessons).toHaveLength(1);

    const updateResponse = await request(app)
      .post(`/admin/lessons/${lessons[0].id}/update`)
      .set("Cookie", adminCookie)
      .type("form")
      .send({
        registration_id: 1,
        starts_at: "2026-10-19T15:00",
        duration_minutes: 60,
        status: "attended",
        internal_note: "",
      })
      .expect(303);
    expect(updateResponse.headers.location).toContain("notice=updated");
    const updatedLessons = await db.allAsync(
      "SELECT * FROM student_lessons WHERE registration_id IN (?) ORDER BY starts_at ASC",
      [1]
    );
    expect(updatedLessons[0]).toMatchObject({ starts_at: "2026-10-19T15:00", status: "attended" });

    const dashboardResponse = await request(app)
      .get("/account/dashboard")
      .set("Cookie", studentCookie)
      .expect(200);
    expect(dashboardResponse.text).toContain("2026-10-19 15:00");
    expect(dashboardResponse.text).toMatch(/1\s*\/\s*1/);
    expect(dashboardResponse.text).toContain("Расписание изменено");

    const readResponse = await request(app)
      .post("/account/notifications/1/read")
      .set("Cookie", studentCookie)
      .expect(303);
    const notifications = await db.allAsync(
      "SELECT * FROM student_notifications WHERE email = ? ORDER BY created_at DESC",
      ["student@example.com"]
    );
    expect(readResponse.headers.location).toBe("/account/dashboard");
    expect(notifications.find((notification) => notification.id === 1).read_at).toBeTruthy();

    const accounts = await db.allAsync(
      `SELECT id, email, username, verified_at, created_at
       FROM student_accounts
      WHERE 1=1 AND (LOWER(username) LIKE ? OR LOWER(email) LIKE ?) AND verified_at IS NOT NULL
       ORDER BY created_at DESC`,
      ["%teststudent%", "%teststudent%"]
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).not.toHaveProperty("password_hash");
  });
});
