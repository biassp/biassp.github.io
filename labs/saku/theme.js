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
  // Values are stored RAW ('light' / 'dark') by this lab and by the CV. Strip
  // stray quotes so a legacy JSON-encoded value does not pin a returning
  // visitor to the wrong theme forever.
  function read(key) {
    var v = null;
    try { v = window.localStorage.getItem(key); } catch (e) { return null; }
    if (v == null) return null;
    v = String(v).replace(/^"+|"+$/g, '');
    return (v === 'light' || v === 'dark') ? v : null;
  }
  // 'saku.theme' is the per-lab key, named like every other lab's; 'saku_theme'
  // is the key this page shipped with and is still honoured so a returning
  // visitor keeps their choice. The site-wide 'theme' key comes last: a theme
  // chosen on the CV has to carry here, and this page was the one that ignored it.
  var t = read('saku.theme') || read('saku_theme') || read('theme');
  document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
})();
