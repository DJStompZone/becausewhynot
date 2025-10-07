/**
 * routes/goodluck.js
 * Renders the GoodLuck page using views/gravytrain.pug
 */
const express = require("express");
const router = express.Router();

/** GET /goodluck */
router.get("/", (req, res) => {
  res.render("gravytrain", { title: "DJ Stomp | Gravy Train (Grassroots)" });
});

module.exports = router;
