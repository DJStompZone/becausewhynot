/**
 * Controls Bottom Sheet
 *
 * - Turns #controls-sheet into a mobile bottom sheet with a FAB (#controls-toggle)
 * - Desktop: panel stays open; Mobile: starts closed and auto-hides on play
 * - No coupling to the visualizer; just DOM + media queries
 *
 * Author: DJ Stomp <DJStompZone>
 * License: MIT
 */
(function () {
  function isMobile() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  function setOpen(el, open) {
    if (!el) return;
    el.dataset.open = String(!!open);
  }

  function init() {
    const sheet = document.getElementById("controls-sheet");
    const toggle = document.getElementById("controls-toggle");
    const closeBtn = document.getElementById("controls-close");
    const audio = document.getElementById("player");

    if (!sheet) return; // nothing to do

    // start open on desktop, closed on mobile
    setOpen(sheet, !isMobile());

    // FAB opens the sheet on mobile
    if (toggle) {
      toggle.addEventListener("click", () => setOpen(sheet, true));
    }

    // Close button hides it
    if (closeBtn) {
      closeBtn.addEventListener("click", () => setOpen(sheet, false));
    }

    // On viewport change, adjust state: keep open on desktop, keep current state on mobile
    const mq = window.matchMedia("(max-width: 900px)");
    mq.addEventListener("change", () => {
      if (!isMobile()) setOpen(sheet, true);
    });

    // Auto-hide on play so the visualizer isn't blocked
    if (audio) {
      const autoHide = () => { if (isMobile()) setOpen(sheet, false); };
      audio.addEventListener("play", autoHide);
      // You can also hide after the user hits the Play button if your browser blocks autoplay.
      const playBtn = document.getElementById("play");
      if (playBtn) playBtn.addEventListener("click", () => setTimeout(autoHide, 250));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();