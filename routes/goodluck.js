/**
 * routes/goodluck.js
 * Renders the GoodLuck page using views/goodluck.pug
 */
const express = require("express");
const router = express.Router();

/** GET /goodluck */
router.get("/", (req, res) => {
  res.render("goodluck", { title: "DJ Stomp | Good Luck With That (Redux)" });
});

module.exports = router;
