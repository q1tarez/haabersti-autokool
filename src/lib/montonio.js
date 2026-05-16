const jwt = require("jsonwebtoken");
const { parsePriceEur } = require("./parsePrice");
const { getSiteUrl } = require("../data/siteContact");

function isMontonioConfigured() {
  return Boolean(
    String(process.env.MONTONIO_ACCESS_KEY || "").trim() &&
      String(process.env.MONTONIO_SECRET_KEY || "").trim()
  );
}

function apiBase() {
  return String(process.env.MONTONIO_SANDBOX || "").trim() === "1"
    ? "https://sandbox-stargate.montonio.com/api"
    : "https://stargate.montonio.com/api";
}

function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/);
  if (parts.length < 2) return { firstName: parts[0] || "Student", lastName: "-" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * @param {{ id: string|number, full_name: string, email: string, course_name: string, price: string, lang?: string }} opts
 */
async function createMontonioPaymentUrl(opts) {
  try {
    if (!isMontonioConfigured()) {
      return { ok: false, reason: "not_configured" };
    }
    const amount = parsePriceEur(opts.price);
    if (!amount) {
      return { ok: false, reason: "invalid_amount" };
    }

    const accessKey = String(process.env.MONTONIO_ACCESS_KEY).trim();
    const secretKey = String(process.env.MONTONIO_SECRET_KEY).trim();
    const base = getSiteUrl() || "http://localhost:3000";
    const locale = ["et", "ru", "en"].includes(opts.lang) ? opts.lang : "et";
    const { firstName, lastName } = splitName(opts.full_name);
    const merchantReference = `reg-${opts.id}`;

    const payload = {
      accessKey,
      merchantReference,
      returnUrl: `${base}/payment/return?ref=${encodeURIComponent(merchantReference)}`,
      notificationUrl: `${base}/api/webhooks/montonio`,
      currency: "EUR",
      grandTotal: amount,
      locale,
      billingAddress: {
        firstName,
        lastName,
        email: opts.email,
        country: "EE",
      },
      lineItems: [
        {
          name: opts.course_name || "Course",
          quantity: 1,
          finalPrice: amount,
        },
      ],
      payment: {
        method: "paymentInitiation",
        methodDisplay: "Pay with your bank",
        methodOptions: {
          preferredCountry: "EE",
          paymentDescription: `Haabersti Autokool — ${opts.course_name || "course"}`,
        },
        amount,
        currency: "EUR",
      },
    };

    const token = jwt.sign(payload, secretKey, { algorithm: "HS256", expiresIn: "10m" });

    const res = await fetch(`${apiBase()}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: token }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, reason: "api_error", detail: text.slice(0, 200) };
    }

    let data;
    try {
      data = await res.json();
    } catch {
      return { ok: false, reason: "invalid_response" };
    }
    if (!data || !data.paymentUrl) {
      return { ok: false, reason: "no_payment_url" };
    }
    return { ok: true, paymentUrl: data.paymentUrl, merchantReference };
  } catch (err) {
    return { ok: false, reason: "exception", detail: err.message };
  }
}

function verifyMontonioNotification(token) {
  if (!isMontonioConfigured()) return null;
  try {
    return jwt.verify(token, String(process.env.MONTONIO_SECRET_KEY).trim());
  } catch {
    return null;
  }
}

module.exports = {
  isMontonioConfigured,
  createMontonioPaymentUrl,
  verifyMontonioNotification,
};
