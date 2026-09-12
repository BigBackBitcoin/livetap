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
})();
