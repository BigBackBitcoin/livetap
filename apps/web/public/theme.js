/*
 * The marketing page's only script, and the only thing on it that needs one.
 *
 * The page follows the operating system by itself: `tokens.css` paints the dark palette on
 * `:root` and the light one under `prefers-color-scheme: light`, so with no attribute on
 * `<html>` the visitor's machine decides (DESIGN_SYSTEM §2.1). This carries the one case CSS
 * cannot know about: a visitor who went into the app and *chose* light or dark should not have
 * the choice forgotten the moment they come back to `/`.
 *
 * A classic script in `<head>`, deliberately: it runs before first paint, so a user who chose
 * dark on a light machine never sees a flash of the wrong palette. It reads one key, writes one
 * attribute, throws nothing, and stores nothing.
 */
(function () {
  try {
    var choice = window.localStorage.getItem('livetap.theme');
    if (choice === 'dark' || choice === 'light') {
      document.documentElement.setAttribute('data-theme', choice);
    }
  } catch (_) {
    /* Private mode, or site data blocked. The OS preference still decides. */
  }

  /*
   * Reduced motion, honoured for the films.
   *
   * CSS cannot pause a video. `prefers-reduced-motion` can hide one or stop a transition, and a
   * stylesheet claiming to pause playback would be a comment that is not true. So the autoplay
   * attribute is removed before the element exists, by the time the parser reaches it, and the
   * poster carries the picture instead. Paused rather than hidden: a person who asked for less
   * motion asked for less motion, not for a wall of type.
   */
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.addEventListener('DOMContentLoaded', function () {
        var films = document.querySelectorAll('video[autoplay]');
        for (var i = 0; i < films.length; i += 1) {
          films[i].removeAttribute('autoplay');
          films[i].pause();
        }
      });
    }
  } catch (_) {
    /* No matchMedia. The film plays, which is the pre-existing behaviour. */
  }
})();
