const express = require("express");

const router = express.Router();

const pages = Object.freeze({
  "introductory-antimimetics": "audiobook-introductory-antimimetics",
  unforgettable: "audiobook-unforgettable",
  "we-need-to-talk-about-fifty-five":
    "audiobook-we-need-to-talk-about-fifty-five",
});

router.get("/:slug", (req, res, next) => {
  const view = pages[req.params.slug];
  if (!view) return next();
  return res.render(view);
});

module.exports = router;
