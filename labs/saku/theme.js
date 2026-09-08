/*!
 * Saku — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Saku — theme.js
 * Loaded synchronously in <head> so the theme is settled before first paint.
 * Dark is the default, exactly as on the CV; a stored choice overrides it.
 * The storage read is wrapped: a browser configured to block site data throws
 * here, and an unguarded read would take the whole script down — the CV shipped
 * that bug once already.
 */
(function () {
  'use strict';
  var t = null;
  try { t = window.localStorage.getItem('saku_theme'); } catch (e) { t = null; }
  document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
})();
