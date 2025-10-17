/**
 * routes/cotl.js
 * Renders the Children of the Loop page using views/cotl.pug
 */
const express = require("express");
const router = express.Router();

/** GET /cotl */
router.get("/", (req, res) => {
  res.render("cotl", { title: "DJ Stomp | Children of the Loop" });
});

module.exports = router;
