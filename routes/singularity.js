/**
 * routes/singularity.js
 * Renders the Singularity page using views/singularity.pug
 */
const express = require("express");
const router = express.Router();

/** GET /singularity */
router.get("/", (req, res) => {
  res.render("singularity", { title: "DJ Stomp | Singularity" });
});

module.exports = router;
