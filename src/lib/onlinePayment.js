const { isMontonioConfigured } = require("./montonio");

/** Включить только когда Montonio готов и в env: ONLINE_PAYMENT_ENABLED=1 */
function isOnlinePaymentEnabled() {
  return (
    String(process.env.ONLINE_PAYMENT_ENABLED || "").trim() === "1" && isMontonioConfigured()
  );
}

module.exports = { isOnlinePaymentEnabled };
