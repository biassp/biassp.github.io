/* Saku — theme.js
 * Loaded synchronously in <head> so the theme is settled before first paint.
 * Every storage access is wrapped: a browser configured to block site data
 * throws on read, and an unguarded read here would take the whole script down.
 */
(function () {
  'use strict';
  var t = null;
  try { t = window.localStorage.getItem('saku_theme'); } catch (e) { t = null; }
  if (t !== 'light' && t !== 'dark') {
    try {
      t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch (e2) { t = 'dark'; }
  }
  document.documentElement.setAttribute('data-theme', t);
})();
