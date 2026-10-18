const { z } = require("zod");

/**
 * Validates an Estonian personal identification code (isikukood).
 * Uses the official checksum algorithm.
 */
function isEstonianPersonalCodeValid(code) {
  const value = String(code || "").trim();
  if (!/^\d{11}$/.test(value)) return false;
  const digits = value.split("").map((x) => Number(x));
  const w1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1];
  const w2 = [3, 4, 5, 6, 7, 8, 9, 1, 2, 3];
  const sum1 = w1.reduce((acc, w, i) => acc + w * digits[i], 0);
  let check = sum1 % 11;
  if (check === 10) {
    const sum2 = w2.reduce((acc, w, i) => acc + w * digits[i], 0);
    check = sum2 % 11;
    if (check === 10) check = 0;
  }
  return check === digits[10];
}

/**
 * Contact form validation schema.
 */
const contactSchema = z.object({
  fullName: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must not exceed 100 characters")
    .refine((val) => !/\d/.test(val), "Name must not contain digits"),
  phone: z
    .string()
    .min(7, "Phone number too short")
    .max(25, "Phone number too long")
    .regex(/^[+\d\s()\-]{7,25}$/, "Invalid phone number format")
    .refine((val) => val.replace(/\D/g, "").length >= 7, "Phone must have at least 7 digits"),
  message: z.string().max(2000, "Message too long").optional(),
  email: z.string().email("Invalid email address").max(200, "Email too long").or(z.literal("")).optional(),
});

/**
 * Registration form validation schema.
 */
const registrationSchema = z.object({
  firstName: z
    .string()
    .min(1, "First name is required")
    .max(60, "First name too long")
    .refine((val) => !/\d/.test(val), "First name must not contain digits"),
  lastName: z
    .string()
    .min(1, "Last name is required")
    .max(60, "Last name too long")
    .refine((val) => !/\d/.test(val), "Last name must not contain digits"),
  isikukood: z
    .string()
    .length(11, "Estonian personal code must be exactly 11 digits")
    .regex(/^\d{11}$/, "Estonian personal code must contain only digits")
    .refine(isEstonianPersonalCodeValid, "Invalid Estonian personal code (checksum failed)"),
  phone: z
    .string()
    .min(7, "Phone number too short")
    .max(25, "Phone number too long")
    .regex(/^[+\d\s()\-]{7,25}$/, "Invalid phone number format")
    .refine((val) => val.replace(/\D/g, "").length >= 7, "Phone must have at least 7 digits"),
  email: z.string().email("Invalid email address").max(200, "Email too long"),
  courseId: z.string().min(1, "Course is required"),
  paymentMethod: z.enum(["cash", "bank", "online"], { errorMap: () => ({ message: "Invalid payment method" }) }),
  studyLang: z.enum(["et", "ru", "en"]).optional(),
  lessonTime: z.string().max(100).optional(),
  comment: z.string().max(1000, "Comment too long").optional(),
  instructorId: z.string().optional(),
  trainingOfferId: z.string().optional(),
});

/**
 * Admin login validation schema.
 */
const adminLoginSchema = z.object({
  username: z
    .string()
    .min(1, "Username is required")
    .max(100, "Username too long"),
  password: z
    .string()
    .min(1, "Password is required")
    .max(200, "Password too long"),
});

/**
 * Helper: parse and validate using a Zod schema.
 * Returns { success: true, data } or { success: false, errors: string[] }
 */
function validate(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  // Zod v4 uses .issues, Zod v3 uses .errors — support both
  const issues = result.error.issues || result.error.errors || [];
  const errors = issues.map((e) => e.message);
  return { success: false, errors };
}

module.exports = {
  contactSchema,
  registrationSchema,
  adminLoginSchema,
  isEstonianPersonalCodeValid,
  validate,
};
