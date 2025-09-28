/**
 * app.js — BWN Visualizer (Express dev server)
 *
 *
 */

const createError = require("http-errors");
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const logger = require("morgan");

const indexRouter = require("./routes/index");
const victoryRouter = require("./routes/victory");
const soundscapeRouter = require("./routes/soundscape");
const singularityRouter = require("./routes/singularity");
const whiplashRouter = require("./routes/whiplash");

const app = express();

// --- View engine setup ---
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

// --- Middleware ---
app.disable("x-powered-by");
app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Serve static assets from /public at web root "/"
app.use(express.static(path.join(__dirname, "public")));

// --- Routes ---
app.use("/", indexRouter);
app.use("/soundscape", soundscapeRouter);
app.use("/victory", victoryRouter);
app.use("/singularity", singularityRouter);
app.use("/whiplash", whiplashRouter);

app.get("/becausewhynot", (req, res) => res.render("index"));

// --- 404 handler ---
app.use(function (req, res, next) {
  next(createError(404));
});

// --- Error handler ---
app.use(function (err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};
  res.status(err.status || 500);
  res.render("error");
});

// Serve app if running with node
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`BWN Visualizer running at http://localhost:${PORT}/`);
  });
}

module.exports = app;

