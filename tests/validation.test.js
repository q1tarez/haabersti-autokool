/**
 * Unit tests for Zod validation schemas.
 * Run with: npm test
 */

const {
  contactSchema,
  registrationSchema,
  adminLoginSchema,
  isEstonianPersonalCodeValid,
  validate,
} = require("../src/validation/schemas");

// ============================================================
// isEstonianPersonalCodeValid
// ============================================================
describe("isEstonianPersonalCodeValid", () => {
  test("accepts a valid personal code", () => {
    // Real valid Estonian personal codes for testing
    expect(isEstonianPersonalCodeValid("49403136515")).toBe(true);
    expect(isEstonianPersonalCodeValid("38001085718")).toBe(true);
  });

  test("rejects code with wrong length", () => {
    expect(isEstonianPersonalCodeValid("1234567890")).toBe(false);
    expect(isEstonianPersonalCodeValid("123456789012")).toBe(false);
  });

  test("rejects code with letters", () => {
    expect(isEstonianPersonalCodeValid("3800108571A")).toBe(false);
  });

  test("rejects code with wrong checksum", () => {
    expect(isEstonianPersonalCodeValid("38001085719")).toBe(false);
  });

  test("rejects empty string", () => {
    expect(isEstonianPersonalCodeValid("")).toBe(false);
  });
});

// ============================================================
// contactSchema
// ============================================================
describe("contactSchema", () => {
  test("accepts valid contact data", () => {
    const result = validate(contactSchema, {
      fullName: "Ivan Petrov",
      phone: "+372 5123 4567",
      message: "Hello, I want to register.",
    });
    expect(result.success).toBe(true);
  });

  test("rejects name with digits", () => {
    const result = validate(contactSchema, {
      fullName: "Ivan123",
      phone: "+372 5123 4567",
    });
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("digit"))).toBe(true);
  });

  test("rejects short name", () => {
    const result = validate(contactSchema, {
      fullName: "A",
      phone: "+372 5123 4567",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid phone", () => {
    const result = validate(contactSchema, {
      fullName: "Ivan Petrov",
      phone: "abc",
    });
    expect(result.success).toBe(false);
  });

  test("accepts contact without message (optional)", () => {
    const result = validate(contactSchema, {
      fullName: "Maria Tamm",
      phone: "5123456",
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================
// registrationSchema
// ============================================================
describe("registrationSchema", () => {
  const validData = {
    firstName: "Ivan",
    lastName: "Petrov",
    isikukood: "49403136515",
    phone: "+372 5123 4567",
    email: "ivan@example.com",
    courseId: "b-category",
    paymentMethod: "cash",
    studyLang: "ru",
  };

  test("accepts valid registration data", () => {
    const result = validate(registrationSchema, validData);
    expect(result.success).toBe(true);
  });

  test("rejects invalid email", () => {
    const result = validate(registrationSchema, { ...validData, email: "not-an-email" });
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes("email"))).toBe(true);
  });

  test("rejects invalid isikukood", () => {
    const result = validate(registrationSchema, { ...validData, isikukood: "12345678901" });
    expect(result.success).toBe(false);
  });

  test("rejects invalid payment method", () => {
    const result = validate(registrationSchema, { ...validData, paymentMethod: "bitcoin" });
    expect(result.success).toBe(false);
  });

  test("rejects first name with digits", () => {
    const result = validate(registrationSchema, { ...validData, firstName: "Ivan123" });
    expect(result.success).toBe(false);
  });

  test("rejects missing courseId", () => {
    const result = validate(registrationSchema, { ...validData, courseId: "" });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// adminLoginSchema
// ============================================================
describe("adminLoginSchema", () => {
  test("accepts valid login data", () => {
    const result = validate(adminLoginSchema, { username: "admin", password: "secret123" });
    expect(result.success).toBe(true);
  });

  test("rejects empty username", () => {
    const result = validate(adminLoginSchema, { username: "", password: "secret123" });
    expect(result.success).toBe(false);
  });

  test("rejects empty password", () => {
    const result = validate(adminLoginSchema, { username: "admin", password: "" });
    expect(result.success).toBe(false);
  });
});
