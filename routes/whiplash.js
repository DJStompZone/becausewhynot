/**
 * routes/whiplash.js
 * Renders the Whiplash page using views/whiplash.pug
 */
const express = require("express");
const router = express.Router();

/** GET /whiplash */
router.get("/", (req, res) => {
  res.render("whiplash", { title: "DJ Stomp | Whiplash! (Flatline)" });
});

module.exports = router;
