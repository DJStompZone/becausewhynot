/**
 * Controls Bottom Sheet
 *
 * - Toggles #controls-sheet open/closed with #controls-toggle
 * - Desktop: stays open; Mobile: starts closed, auto-hides on play
 * - ESC closes (mobile/desktop)
 *
 * Author: DJ Stomp <DJStompZone>
 * License: MIT
 */
(function () {
  function isMobile() { return window.matchMedia("(max-width: 900px)").matches; }
  function setOpen(el, open) { if (el) el.dataset.open = String(!!open); }
  function getOpen(el) { return el && el.dataset.open === "true"; }

  function init() {
    const sheet = document.getElementById("controls-sheet");
    const toggle = document.getElementById("controls-toggle");
    const audio = document.getElementById("player");
    if (!sheet) return;

    // start open on desktop, closed on mobile
    setOpen(sheet, !isMobile());

    // FAB toggles open/closed
    if (toggle) toggle.addEventListener("click", () => setOpen(sheet, !getOpen(sheet)));

    // viewport change: snap open on desktop, keep current on mobile
    const mq = window.matchMedia("(max-width: 900px)");
    mq.addEventListener("change", () => { if (!isMobile()) setOpen(sheet, true); });

    // auto-hide on play (mobile)
    const autoHide = () => { if (isMobile()) setOpen(sheet, false); };
    if (audio) {
      audio.addEventListener("play", autoHide);
      const playBtn = document.getElementById("play");
      if (playBtn) playBtn.addEventListener("click", () => setTimeout(autoHide, 250));
    }

    // ESC closes
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setOpen(sheet, false);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();