const app = require("../src/app");
const { initPromise } = app;

module.exports = async (req, res) => {
  try {
    await initPromise;
    return app(req, res);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Init failed in Vercel function:", error);
    return res.status(500).send("Server init failed");
  }
};
