/*!
 * Saku — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Saku — app.js
 * UI, router, engine telemetry, gesture layer. Classic script, no modules, no
 * dependencies. Every storage read is guarded; every gesture has a button and a
 * keyboard equivalent.
 */
(function () {
  'use strict';

  var S = window.SakuStore;
  var P = window.SakuParse;
  var Sync = window.SakuSync;

  /* ---------------- tiny DOM helpers ---------------- */

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function kvRow(k, v, cls) {
    var tr = el('tr');
    tr.appendChild(el('td', null, k));
    var td = el('td', cls || null, v);
    tr.appendChild(td);
    return tr;
  }
  function fmtTime(ms) {
    var d = new Date(ms);
    return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }
  function fmtDate(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtBytes(n) {
    if (!n && n !== 0) return '—';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i === 0 ? n : n.toFixed(1)) + ' ' + u[i];
  }
  function fmtMoney(amount, currency, direction) {
    if (amount === null || typeof amount === 'undefined') return '—';
    var digits = (currency === 'IDR' || currency === 'JPY') ? 0 : 2;
    var s;
    try {
      s = new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
    } catch (e) { s = String(amount); }
    return (direction === 'in' ? '+' : '−') + ' ' + (currency || '') + ' ' + s;
  }
  function relTime(ms) {
    var d = Date.now() - ms;
    if (d < 0) return 'in ' + Math.round(-d / 1000) + 's';
    if (d < 60000) return Math.round(d / 1000) + 's ago';
    if (d < 3600000) return Math.round(d / 60000) + 'm ago';
    if (d < 86400000) return Math.round(d / 3600000) + 'h ago';
    return Math.round(d / 86400000) + 'd ago';
  }
  var REDUCED = false;
  try { REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* ---------------- snackbar ---------------- */

  var snackTimer = null;
  function hideSnack() {
    $('snackbar').hidden = true;
    if (snackTimer) { clearTimeout(snackTimer); snackTimer = null; }
  }
  function snack(text, actionLabel, onAction) {
    var bar = $('snackbar'), btn = $('snackAction');
    $('snackText').textContent = text;
    btn.hidden = !actionLabel;
    if (actionLabel) {
      btn.textContent = actionLabel;
      btn.onclick = function () { hideSnack(); onAction && onAction(); };
    }
    bar.hidden = false;
    if (snackTimer) clearTimeout(snackTimer);
    snackTimer = setTimeout(function () { bar.hidden = true; snackTimer = null; }, actionLabel ? 7000 : 3500);
  }
  $('snackClose').addEventListener('click', hideSnack);

  /* ---------------- theme ---------------- */

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    $('themeBtn').setAttribute('aria-pressed', t === 'light' ? 'true' : 'false');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#f5f7fc' : '#0b1020');
    try { localStorage.setItem('saku_theme', t); } catch (e) { /* site data blocked; theme is session-only */ }
  }
  $('themeBtn').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    applyTheme(cur === 'light' ? 'dark' : 'light');
  });
  applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

  /* ---------------- router ---------------- */

  var VIEWS = ['engine', 'inbox', 'capture'];
  var current = 'engine';

  /* Storage can be denied outright (Firefox with cookies blocked, Chrome with
     site data blocked). Every fire-and-forget renderer routes its rejection here
     so a blocked browser produces a degraded UI, not console noise. */
  var lastDbError = null;
  function noteDbError(err) {
    lastDbError = err || new Error('storage unavailable');
    return null;
  }

  function showView(name, push) {
    if (VIEWS.indexOf(name) < 0) name = 'engine';
    current = name;
    VIEWS.forEach(function (v) {
      $('view-' + v).hidden = (v !== name);
      var t = $('tab-' + v);
      t.setAttribute('aria-selected', v === name ? 'true' : 'false');
    });
    if (push !== false) {
      try { history.replaceState(null, '', '#/' + name); } catch (e) {}
    }
    if (name === 'inbox') renderInbox().catch(noteDbError);
    if (name === 'engine') refreshEngine().catch(noteDbError);
    try { $('view-' + name).focus({ preventScroll: true }); } catch (e) { $('view-' + name).focus(); }
  }

  VIEWS.forEach(function (v) {
    $('tab-' + v).addEventListener('click', function () { showView(v); });
    $('tab-' + v).addEventListener('keydown', function (ev) {
      var i = VIEWS.indexOf(v);
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        ev.preventDefault();
        var next = VIEWS[(i + (ev.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length];
        $('tab-' + next).focus();
        showView(next);
      }
    });
  });
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-goto]');
    if (t) showView(t.getAttribute('data-goto'));
  });

  /* ---------------- service worker ---------------- */

  var swReg = null;
  /* Probe by READING, not by `in`: in a sandboxed iframe without allow-same-origin
     the property exists but throws on access, which would kill this whole IIFE. */
  var swApi = null;
  var swError = null;
  try { swApi = navigator.serviceWorker || null; } catch (e) { swApi = null; swError = String(e && e.message || e); }
  var swSupported = !!swApi;
  var swUnregistered = false;
  var lastBus = [];

  function swController() {
    if (!swApi) return null;
    try { return swApi.controller || null; } catch (e) { return null; }
  }

  function swStateText() {
    if (!swSupported) return swError ? 'unavailable' : 'unsupported';
    if (swError) return 'failed';
    if (swUnregistered && !swReg) {
      return swController() ? 'unregistered (still controlling until reload)' : 'unregistered';
    }
    if (!swReg) return 'registering…';
    if (swController()) return 'controlling';
    if (swReg.active) return 'active, not controlling';
    if (swReg.installing) return 'installing';
    if (swReg.waiting) return 'waiting';
    return 'registered';
  }

  function paintSWPill() {
    var pill = $('pillSW');
    var s = swStateText();
    pill.textContent = 'sw: ' + s;
    pill.className = 'pill' + (s === 'controlling' ? ' good'
      : (s === 'unsupported' || s === 'failed' || s === 'unavailable' ? ' bad' : ' warn'));
    var ready = !!swController();
    $('shareFetchBtn').disabled = !ready;
    $('shareNavBtn').disabled = !ready;
    $('shareHint').textContent = ready
      ? 'The worker controls this page, so the POST below is intercepted locally. Watch the trace.'
      : (swUnregistered && !swReg
        ? 'You unregistered the worker. The already-active worker keeps controlling this page until you reload, so the share pipeline still commits — but nothing is registered any more. Reload to register a fresh one and replay the cold start.'
        : swError
        ? 'Service worker unavailable here: ' + swError + '. That happens in a private window, behind a blocked-worker policy, or on an insecure origin — so the share pipeline is switched off rather than left to fail silently. Capture, the parser, IndexedDB, the outbox and every panel below still work.'
        : (swSupported
          ? 'Waiting for the service worker to take control of this client. Until it does, a POST to ./share would escape to the network and the host would answer 405 — which is exactly the failure window this app is built to close.'
          : 'This browser exposes no service worker API. The share pipeline cannot run here; everything else on this page still works.'));
  }

  function registerSW() {
    if (!swSupported) { paintSWPill(); return; }
    if (!window.isSecureContext) {
      swError = 'insecure context — service workers require https:// or http://localhost';
      paintSWPill();
      return;
    }
    swApi.register('./sw.js', { scope: './' }).then(function (reg) {
      if (!reg) throw new Error('registration returned nothing — workers are blocked in this context');
      swReg = reg;
      swUnregistered = false;
      paintSWPill();
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          paintSWPill();
          if (nw.state === 'installed' && swController()) {
            $('updateBanner').hidden = false;
          }
          refreshEngine();
        });
      });
      if (reg.waiting && swController()) $('updateBanner').hidden = false;
      return swApi.ready;
    }).then(function () {
      paintSWPill();
      refreshEngine();
      try {
        if (swReg && 'sync' in swReg) swReg.sync.register('saku-outbox').catch(function () {});
      } catch (e) {}
    }).catch(function (err) {
      swError = String(err && err.message || err);
      paintSWPill();
      refreshEngine();
    });

    swApi.addEventListener('controllerchange', function () {
      paintSWPill();
      refreshEngine();
    });
  }

  $('updateBtn').addEventListener('click', function () {
    if (swReg && swReg.waiting) swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(function () { location.reload(); }, 250);
  });

  $('swRefresh').addEventListener('click', function () {
    if (!swSupported) return;
    swApi.getRegistration().then(function (r) {
      swReg = r || null;
      if (r) { swUnregistered = false; r.update().catch(function () {}); }
      paintSWPill();
      refreshEngine();
      snack('Service worker state re-read.');
    }).catch(function (e) { snack('Could not re-read the worker: ' + String(e && e.message || e)); });
  });

  $('swUnregister').addEventListener('click', function () {
    if (!swReg) return;
    swReg.unregister().then(function () {
      swReg = null;
      swUnregistered = true;
      paintSWPill();
      refreshEngine().catch(noteDbError);
      snack('Unregistered. Reload to register a fresh worker and replay the cold start.', 'Reload', function () { location.reload(); });
    });
  });

  /* bus from the worker */
  var bus = null;
  try {
    if (typeof BroadcastChannel === 'function') {
      bus = new BroadcastChannel('saku-bus');
      bus.onmessage = function (ev) {
        var m = ev.data || {};
        lastBus.unshift(m);
        lastBus = lastBus.slice(0, 40);
        if (m.type === 'share-committed' || m.type === 'share-failed') {
          renderTrace(m.trace, m.type === 'share-failed');
        }
        if (m.type === 'sw-installed' || m.type === 'sw-activated') refreshEngine();
      };
    }
  } catch (e) { bus = null; }

  /* ---------------- share simulation ---------------- */

  var PRESETS = P.SAMPLES.concat(['A receipt photo with no readable text at all']);

  (function fillPresets() {
    var sel = $('sharePreset');
    PRESETS.forEach(function (s, i) {
      var o = el('option', null, s.length > 68 ? s.slice(0, 66) + '…' : s);
      o.value = String(i);
      sel.appendChild(o);
    });
  })();

  function presetText() { return PRESETS[parseInt($('sharePreset').value, 10) || 0]; }

  function makeReceiptFile() {
    // A deliberately oversized PNG so the worker-side downscale actually fires.
    return new Promise(function (resolve) {
      var w = 1400, h = 1900;
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var g = c.getContext('2d');
      var grd = g.createLinearGradient(0, 0, w, h);
      grd.addColorStop(0, '#f8fafc'); grd.addColorStop(1, '#dbeafe');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      // noise, so PNG cannot compress it down under the budget
      var img = g.getImageData(0, 0, w, h);
      for (var i = 0; i < img.data.length; i += 4) {
        var n = (Math.random() * 40) | 0;
        img.data[i] = Math.min(255, img.data[i] + n);
        img.data[i + 1] = Math.min(255, img.data[i + 1] + n);
        img.data[i + 2] = Math.min(255, img.data[i + 2] + n);
      }
      g.putImageData(img, 0, 0);
      g.fillStyle = '#0f172a';
      g.font = 'bold 74px system-ui, sans-serif';
      g.fillText('RECEIPT', 90, 180);
      g.font = '52px system-ui, sans-serif';
      g.fillText(presetText().slice(0, 34), 90, 300);
      g.fillText(new Date().toISOString().slice(0, 19).replace('T', ' '), 90, 380);
      c.toBlob(function (blob) {
        resolve(new File([blob || new Blob([''])], 'receipt.png', { type: 'image/png' }));
      }, 'image/png');
    });
  }

  function renderTrace(trace, isError) {
    var ol = $('shareTrace');
    clear(ol);
    if (!trace || !trace.length) {
      ol.appendChild(el('li', 'empty', 'No trace recorded.'));
      return;
    }
    trace.forEach(function (t, i) {
      var li = el('li', i === trace.length - 1 ? (isError ? 'err' : 'ok') : null);
      li.appendChild(el('span', 'ts', fmtTime(t.t)));
      li.appendChild(el('span', null, t.step));
      ol.appendChild(li);
    });
  }

  function traceLocal(step, cls) {
    var ol = $('shareTrace');
    var first = ol.querySelector('li.empty');
    if (first) clear(ol);
    var li = el('li', cls || null);
    li.appendChild(el('span', 'ts', fmtTime(Date.now())));
    li.appendChild(el('span', null, step));
    ol.appendChild(li);
    ol.scrollTop = ol.scrollHeight;
  }

  $('shareFetchBtn').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    $('shareStatus').textContent = 'POSTing multipart/form-data to ./share …';
    clear($('shareTrace'));
    traceLocal('page → POST ./share (multipart/form-data), exactly what the OS share sheet sends');

    var text = presetText();
    var want = $('sharePhoto').checked;
    (want ? makeReceiptFile() : Promise.resolve(null)).then(function (file) {
      var fd = new FormData();
      fd.append('title', 'Shared to Saku');
      fd.append('text', text);
      fd.append('url', '');
      if (file) {
        fd.append('photo', file, file.name);
        traceLocal('attached ' + fmtBytes(file.size) + ' PNG as the "photo" field');
      }
      var t0 = performance.now();
      return fetch('./share', { method: 'POST', body: fd }).then(function (res) {
        var ms = Math.round(performance.now() - t0);
        var url = new URL(res.url, location.href);
        var id = url.searchParams.get('shared');
        var err = url.searchParams.get('shareError');
        var observed = 'page observed: redirect followed=' + res.redirected + ', final status ' +
          res.status + ' at ' + url.pathname + url.search + ' (' + ms + 'ms end to end)';
        traceLocal(observed);
        if (err) {
          $('shareStatus').textContent = 'Share failed (on purpose?): ' + err;
          traceLocal('handler reported: ' + err, 'err');
          return refreshEngine();
        }
        if (!id) {
          $('shareStatus').textContent =
            'The POST was not answered by a service worker — no ?shared= id came back. ' +
            'That means the worker is not controlling this page.';
          traceLocal('no ?shared= parameter on the final URL', 'err');
          return refreshEngine();
        }
        return S.getEntry(id).then(function (entry) {
          if (entry && entry.trace) {
            renderTrace(entry.trace, false);
            traceLocal(observed, 'ok');
          }
          $('shareStatus').textContent =
            'Committed. The 303 was followed to ' + url.pathname + url.search +
            ' and the row was already durable when it resolved.';
          snack('Shared entry captured: ' + (entry ? entry.merchant : id), 'Open inbox', function () { showView('inbox'); });
          return Promise.all([refreshEngine(), renderInbox()]);
        });
      });
    }).catch(function (err) {
      $('shareStatus').textContent = 'Share failed: ' + String(err && err.message || err);
      traceLocal('fetch threw: ' + String(err && err.message || err), 'err');
    }).then(function () {
      btn.disabled = !(swSupported && swController());
    });
  });

  $('shareNavBtn').addEventListener('click', function () {
    $('shareFormText').value = presetText();
    $('shareStatus').textContent = 'Submitting a real form navigation to ./share …';
    $('shareForm').submit();
  });

  /* ---------------- capability matrix ---------------- */

  function capRow(name, state, note) {
    var tr = el('tr');
    var mark = el('td', 'mark ' + (state === true ? 'yes' : state === false ? 'no' : 'maybe'),
      state === true ? '✓' : state === false ? '✗' : '~');
    tr.appendChild(mark);
    tr.appendChild(el('td', null, name));
    tr.appendChild(el('td', null, note));
    return tr;
  }

  function ua() { return navigator.userAgent || ''; }
  function isAndroid() { return /Android/i.test(ua()); }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(ua()) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isChromium() { return !!window.chrome || /Chrome|Chromium|Edg\//.test(ua()); }
  function standalone() {
    try {
      return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        window.navigator.standalone === true;
    } catch (e) { return false; }
  }

  var installPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPrompt = e;
    $('installBtn').hidden = false;
    renderCaps();
  });
  window.addEventListener('appinstalled', function () {
    installPrompt = null;
    $('installBtn').hidden = true;
    snack('Installed. Open it from your home screen — the share sheet entry appears there.');
    renderCaps();
  });
  $('installBtn').addEventListener('click', function () {
    if (!installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.then(function () { installPrompt = null; $('installBtn').hidden = true; });
  });

  var persistedState = 'unknown';

  function hasStorageAPI(name) {
    try { return !!(navigator.storage && navigator.storage[name]); } catch (e) { return false; }
  }

  /* window.caches THROWS, it does not return undefined, in a sandboxed iframe
     without allow-same-origin — same trap as navigator.serviceWorker. */
  var cachesError = null;
  function cacheStore() {
    try { return window.caches || null; } catch (e) { cachesError = String(e && e.message || e); return null; }
  }

  function renderCaps() {
    var body = $('capsBody');
    clear(body);
    var secure = !!window.isSecureContext;

    body.appendChild(capRow('Secure context', secure,
      secure ? location.protocol + '//' + location.hostname + ' is a secure context'
        : 'service workers are disabled outside https:// and http://localhost'));
    var swMark;
    if (!swSupported || swError) swMark = false;
    else if (!secure) swMark = false;
    else if (swUnregistered && !swReg) swMark = null;
    else swMark = true;
    body.appendChild(capRow('Service worker', swMark,
      swError ? swError : (swSupported ? 'state: ' + swStateText() : 'API absent (private window?)')));
    body.appendChild(capRow('Simulate a share (this page → ./share)',
      !!(swSupported && swController()),
      'works on every browser that runs a service worker, desktop included'));

    var shareTargetLikely = isAndroid() && isChromium();
    body.appendChild(capRow('OS share sheet → this app (share_target)',
      shareTargetLikely ? null : false,
      shareTargetLikely
        ? 'Android + Chromium detected: install Saku, then share from another app. Not directly feature-detectable, so this is a platform inference.'
        : (isIOS() ? 'iOS ignores share_target entirely. Use "Simulate a share" — it hits the same worker code.'
          : 'Chromium on Android only, after install. Desktop browsers do not register share targets.')));

    body.appendChild(capRow('Install prompt (beforeinstallprompt)',
      installPrompt ? true : (standalone() ? true : null),
      standalone() ? 'already running installed (display-mode: standalone)'
        : (installPrompt ? 'captured — the Install button in the header is live'
          : (isIOS() ? 'iOS fires no prompt: use Share → Add to Home Screen'
            : 'not fired yet (already installed, dismissed recently, or unsupported)'))));

    /* Reading window.indexedDB THROWS in Firefox when site data is blocked, so the
       one panel meant to report the degradation must not be the thing that breaks. */
    var idbOK = false, idbThrew = null;
    try { idbOK = !!window.indexedDB; } catch (e) { idbOK = false; idbThrew = String(e && e.message || e); }
    body.appendChild(capRow('IndexedDB', idbOK,
      idbOK ? 'every entry, the outbox and the simulated peer live here'
        : (idbThrew ? 'blocked by this browser\u2019s site-data setting (' + idbThrew + ') — the panels below say so instead of showing zeros'
          : 'API absent in this context — capture and the parser still run, nothing is persisted')));
    body.appendChild(capRow('Storage estimate', hasStorageAPI('estimate'), 'quota bar above'));
    body.appendChild(capRow('Persistent storage', hasStorageAPI('persist'),
      'current: ' + persistedState + ' — a denial is normal and is reported, not hidden'));

    var bgSync = false;
    try { bgSync = 'ServiceWorkerRegistration' in window && 'sync' in window.ServiceWorkerRegistration.prototype; } catch (e) {}
    body.appendChild(capRow('Background Sync', bgSync,
      bgSync ? 'the worker can drain the outbox after the tab closes'
        : 'Chromium only — elsewhere the outbox drains on online + visibilitychange, so it waits for the next open'));

    var hasCapture = 'capture' in document.createElement('input');
    body.appendChild(capRow('Camera capture attribute', hasCapture,
      hasCapture ? 'a phone opens the camera straight from the Capture tab'
        : 'desktop browsers ignore capture= and open the file picker instead — the photo pipeline still runs'));
    body.appendChild(capRow('OffscreenCanvas in the worker', typeof OffscreenCanvas === 'function',
      'used to downscale a shared photo before it is committed'));
    body.appendChild(capRow('Cache Storage (offline shell)', !!cacheStore(),
      cacheStore() ? 'the precached shell that makes a cold offline load work'
        : (cachesError ? 'blocked in this context: ' + cachesError : 'API absent — the app still runs, it just cannot serve itself offline')));
    body.appendChild(capRow('BroadcastChannel', typeof BroadcastChannel === 'function',
      'live pipeline trace; without it the trace is still persisted on the entry'));
    body.appendChild(capRow('Vibration', !!navigator.vibrate, 'long-press haptics on entry rows'));
    body.appendChild(capRow('Web Push / server notifications', false,
      'deliberately not shipped: it needs a push service and VAPID keys, which static hosting cannot have'));
  }

  /* ---------------- engine panels ---------------- */

  /* Every panel below is repainted from several places at once (boot, the SW
     lifecycle events, the BroadcastChannel, tab switches). A row appended from a
     stale async continuation into a tbody a newer pass already repainted is how
     the landing view ended up printing each counter seven times. So: one
     generation token per panel, and one synchronous swap of a DocumentFragment
     at the end — never clear-now-append-later. */
  var swGen = 0, idbGen = 0, quotaGen = 0;

  function swapRows(body, rows) {
    var frag = document.createDocumentFragment();
    rows.forEach(function (r) { frag.appendChild(r); });
    clear(body);
    body.appendChild(frag);
  }

  function refreshSW() {
    var gen = ++swGen;
    var body = $('swBody');
    var rows = [];
    rows.push(kvRow('state', swStateText()));
    rows.push(kvRow('controls this client', swSupported && swController() ? 'yes' : 'no'));
    rows.push(kvRow('scope', swReg ? swReg.scope.replace(location.origin, '') : '—'));
    rows.push(kvRow('installing / waiting / active',
      swReg ? [!!swReg.installing, !!swReg.waiting, !!swReg.active].join(' / ') : '— / — / —'));
    rows.push(kvRow('secure context', String(!!window.isSecureContext)));
    if (swError) rows.push(kvRow('error', swError));

    $('swNote').textContent = swReg && swReg.waiting
      ? 'A newer worker is installed and waiting. It will not take over until you say so.'
      : (swUnregistered && !swReg
        ? 'Nothing is registered. The worker that is still controlling this client keeps running until you reload — that is the spec, not a stale reading.'
        : 'No skipWaiting() on install: code is never swapped under a live session.');

    function paint(extra) {
      if (gen !== swGen) return false;          // a newer pass owns this tbody
      swapRows(body, rows.concat(extra || []));
      return true;
    }

    var cs = cacheStore();
    if (!cs) {
      paint([kvRow('Cache Storage', cachesError ? 'unavailable: ' + cachesError : 'unavailable')]);
      return Promise.resolve();
    }
    paint();   // never leave the card empty while caches.keys() resolves
    return cs.keys().then(function (keys) {
      var mine = keys.filter(function (k) { return k.indexOf('saku-shell-') === 0; });
      var extra = [kvRow('cache names', mine.join(', ') || '(none yet)')];
      if (!mine.length) return extra;
      return cs.open(mine[0]).then(function (c) { return c.keys(); }).then(function (reqs) {
        extra.push(kvRow('precached entries', String(reqs.length)));
        return extra;
      });
    }).then(function (extra) {
      paint(extra);
    }).catch(function (err) {
      paint([kvRow('Cache Storage', 'unreadable: ' + String(err && err.message || err))]);
    });
  }

  function refreshIDB() {
    var gen = ++idbGen;
    var body = $('idbBody');
    var rows = [];
    return S.schema().then(function (sc) {
      rows.push(kvRow('database', sc.name));
      rows.push(kvRow('schema version', 'v' + sc.version));
      rows.push(kvRow('object stores', sc.stores.join(', ')));
      return Promise.all([S.listEntries(), S.outboxAll(), S.peerAll(), S.merchantAll(), S.metaGet('lamport', 0)]);
    }).then(function (r) {
      rows.push(kvRow('entries', String(r[0].length)));
      rows.push(kvRow('outbox rows', String(r[1].length)));
      rows.push(kvRow('peer rows (simulated)', String(r[2].length)));
      rows.push(kvRow('merchant map', String(r[3].length)));
      rows.push(kvRow('Lamport counter', String(r[4])));
      if (gen !== idbGen) return r[0];
      swapRows(body, rows);
      var log = $('migrationLog');
      var lines = S.migrationLog;
      var items = [];
      if (!lines.length) {
        items.push(el('li', 'empty', 'Schema already at v' + S.DB_VERSION + ' — no migration ran in this session.'));
      } else {
        lines.forEach(function (m) { items.push(el('li', 'ok', fmtTime(m.t) + '  ' + m.msg)); });
      }
      swapRows(log, items);
      return r[0];
    }).catch(function (err) {
      if (gen === idbGen) {
        swapRows(body, [
          kvRow('error', String(err && err.message || err)),
          kvRow('what this means', 'this browser is refusing IndexedDB for this origin, so nothing below is persisted — the counters are withheld rather than shown as zero')
        ]);
      }
      return [];
    });
  }

  var outboxGen = 0;
  function refreshOutbox() {
    var gen = ++outboxGen;
    return S.outboxAll().then(function (jobs) {
      var rows = [];
      rows.push(kvRow('depth', String(jobs.length)));
      var next = jobs.length ? Math.min.apply(null, jobs.map(function (j) { return j.nextAt; })) : null;
      rows.push(kvRow('next retry', next === null ? '—' :
        (next <= Date.now() ? 'due now' : 'in ' + Math.round((next - Date.now()) / 1000) + 's (' + fmtTime(next) + ')')));
      var attempts = jobs.reduce(function (a, j) { return Math.max(a, j.attempts || 0); }, 0);
      rows.push(kvRow('max attempts on a row', String(attempts)));
      rows.push(kvRow('backoff', 'min(30s, 500ms·2^n) with half-range jitter'));
      var leased = jobs.filter(function (j) { return j.claimedBy && j.leaseUntil > Date.now(); });
      rows.push(kvRow('leased by a client', leased.length ? leased.length + ' (claim + ' + S.LEASE_MS / 1000 + 's lease)' : 'none'));
      var lastErr = jobs.map(function (j) { return j.lastError; }).filter(Boolean)[0];
      rows.push(kvRow('last error', lastErr || 'none'));
      rows.push(kvRow('sync trigger', autoDrain ? 'auto: online + visibilitychange + 5s timer' : 'manual only'));
      if (gen === outboxGen) swapRows($('outboxBody'), rows);
      return jobs;
    }, function (err) {
      if (gen === outboxGen) {
        swapRows($('outboxBody'), [kvRow('error', String(err && err.message || err))]);
      }
      return [];
    });
  }

  function refreshQuota() {
    var gen = ++quotaGen;
    var text = $('quotaText'), fill = $('quotaFill'), body = $('storageBody');
    function paint(rows) {
      if (gen !== quotaGen) return false;
      swapRows(body, rows);
      return true;
    }
    if (!hasStorageAPI('estimate')) {
      if (gen === quotaGen) {
        text.textContent = 'navigator.storage.estimate() is unavailable in this browser.';
        fill.style.width = '0%';
      }
      paint([kvRow('estimate API', 'unavailable')]);
      return Promise.resolve();
    }
    return navigator.storage.estimate().then(function (est) {
      var used = est.usage || 0, quota = est.quota || 0;
      var pct = quota ? Math.min(100, (used / quota) * 100) : 0;
      var rows = [kvRow('usage', fmtBytes(used)), kvRow('quota', fmtBytes(quota))];
      if (gen === quotaGen) {
        fill.style.width = pct.toFixed(2) + '%';
        text.textContent = fmtBytes(used) + ' used of ' + fmtBytes(quota) + ' (' + pct.toFixed(3) + '%)';
      }
      if (hasStorageAPI('persisted')) {
        return navigator.storage.persisted().then(function (p) {
          persistedState = p ? 'granted' : 'not granted';
          rows.push(kvRow('persistent', persistedState));
          paint(rows);
        });
      }
      persistedState = 'API unavailable';
      rows.push(kvRow('persistent', persistedState));
      paint(rows);
    }).catch(function (err) {
      if (gen === quotaGen) text.textContent = 'estimate failed: ' + String(err && err.message || err);
      paint([kvRow('estimate', 'failed: ' + String(err && err.message || err))]);
    });
  }

  $('persistBtn').addEventListener('click', function () {
    if (!(navigator.storage && navigator.storage.persist)) {
      snack('This browser has no navigator.storage.persist().');
      return;
    }
    navigator.storage.persist().then(function (granted) {
      persistedState = granted ? 'granted' : 'denied by the browser';
      snack(granted ? 'Persistent storage granted.' : 'Persistent storage denied — reported, not hidden.');
      refreshQuota().then(renderCaps);
    });
  });

  function refreshEngine() {
    try { refreshSW(); } catch (e) { noteDbError(e); }
    try { renderCaps(); } catch (e) { noteDbError(e); }
    return Promise.all([refreshIDB(), refreshOutbox(), refreshQuota()]).then(function () {
      return null;
    }).catch(function () { return null; });
  }

  /* ---------------- chaos ---------------- */

  function loadChaos() {
    return S.getChaos().then(function (c) {
      $('chaosOffline').checked = !!c.offline;
      $('chaosDuplicate').checked = !!c.duplicate;
      $('chaosQuota').checked = !!c.quota;
      $('chaosSwThrow').checked = !!c.swThrow;
      $('chaosFailRate').value = String(Math.round((c.failRate || 0) * 100));
      $('failRateOut').textContent = Math.round((c.failRate || 0) * 100) + '%';
      $('chaosLatency').value = String(c.latencyMs || 0);
      $('latencyOut').textContent = (c.latencyMs || 0) + ' ms';
      return c;
    });
  }

  function bindChaos(id, key, transform) {
    $(id).addEventListener('change', function () {
      var v = transform ? transform(this) : this.checked;
      var patch = {};
      patch[key] = v;
      S.setChaos(patch).then(function () { snack('Chaos updated: ' + key + ' = ' + v); })
        .catch(function (e) { snack('Chaos not stored: ' + String(e && e.message || e)); });
    });
  }
  bindChaos('chaosOffline', 'offline');
  bindChaos('chaosDuplicate', 'duplicate');
  bindChaos('chaosQuota', 'quota');
  bindChaos('chaosSwThrow', 'swThrow');
  $('chaosFailRate').addEventListener('input', function () {
    $('failRateOut').textContent = this.value + '%';
  });
  $('chaosFailRate').addEventListener('change', function () {
    S.setChaos({ failRate: parseInt(this.value, 10) / 100 }).catch(noteDbError);
  });
  $('chaosLatency').addEventListener('input', function () { $('latencyOut').textContent = this.value + ' ms'; });
  $('chaosLatency').addEventListener('change', function () {
    S.setChaos({ latencyMs: parseInt(this.value, 10) }).catch(noteDbError);
  });

  $('divergeBtn').addEventListener('click', function () {
    S.listEntries().then(function (rows) {
      if (!rows.length) { snack('Capture something first.'); return; }
      return Sync.peerDiverge(rows[0].id).then(function (r) {
        snack('Peer copy of "' + rows[0].merchant + '" changed at clock ' + r.peerClock +
          '. Edit that entry, then drain, to hit a real conflict.', 'Open inbox', function () { showView('inbox'); });
        return refreshEngine();
      });
    }).catch(function (e) { snack('Diverge failed: ' + e.message); });
  });

  /* ---------------- sync driving ---------------- */

  var autoDrain = true;
  var clientId = (function () {
    var id = null;
    try { id = sessionStorage.getItem('saku_client'); } catch (e) {}
    if (!id) {
      id = S.uid('tab_').slice(0, 12);
      try { sessionStorage.setItem('saku_client', id); } catch (e) {}
    }
    return id;
  })();

  function syncLog(text, cls) {
    var ul = $('syncLog');
    var li = el('li', cls || null, fmtTime(Date.now()) + '  ' + text);
    ul.insertBefore(li, ul.firstChild);
    while (ul.children.length > 30) ul.removeChild(ul.lastChild);
  }

  var draining = false;
  function doDrain(manual) {
    if (draining) return Promise.resolve();
    draining = true;
    return Sync.drain({
      clientId: clientId,
      onEvent: function (e) {
        if (e.type === 'send') syncLog('→ send ' + e.entryId.slice(0, 8) + ' idem=' + e.idem.slice(5, 13) + (e.copies > 1 ? ' ×' + e.copies + ' (duplicate injected)' : ''));
        else if (e.type === 'applied') syncLog('✓ applied ' + e.entryId.slice(0, 8) + ' peerClock=' + e.peerClock, 'ok');
        else if (e.type === 'duplicate-absorbed') syncLog('= duplicate absorbed by idempotency key ×' + e.count, 'ok');
        else if (e.type === 'conflict') syncLog('! conflict on ' + e.fields.map(function (f) { return f.field; }).join(', '), 'err');
        else if (e.type === 'failed') syncLog('✗ ' + e.error + ' — attempt ' + e.attempts + ', retry in ' + Math.round(e.retryInMs / 100) / 10 + 's', 'err');
        else if (e.type === 'lost-claim') syncLog('· row leased by another tab, skipped');
      }
    }).then(function (sum) {
      draining = false;
      if (manual) {
        snack('Drain: ' + sum.applied + ' applied, ' + sum.conflicts + ' conflict(s), ' +
          sum.failed + ' failed, depth now ' + sum.depth + '.');
      }
      return Promise.all([refreshOutbox(), renderInbox(), refreshConflicts()]);
    }).catch(function (err) {
      draining = false;
      syncLog('drain threw: ' + String(err && err.message || err), 'err');
    });
  }

  $('drainBtn').addEventListener('click', function () { doDrain(true); });
  $('autoDrainBtn').addEventListener('click', function () {
    autoDrain = !autoDrain;
    this.setAttribute('aria-pressed', autoDrain ? 'true' : 'false');
    this.textContent = 'Auto-drain: ' + (autoDrain ? 'on' : 'off');
    refreshOutbox().catch(noteDbError);
  });

  setInterval(function () {
    if (!autoDrain || document.hidden) return;
    S.outboxAll().then(function (jobs) {
      var now = Date.now();
      if (jobs.some(function (j) { return j.nextAt <= now; })) doDrain(false);
    }).catch(function () {});
  }, 5000);

  window.addEventListener('online', function () { paintNet(); if (autoDrain) doDrain(false); });
  window.addEventListener('offline', paintNet);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && autoDrain) doDrain(false);
  });

  function paintNet() {
    var p = $('pillNet');
    var on = navigator.onLine !== false;
    p.textContent = on ? 'online' : 'offline';
    p.className = 'pill ' + (on ? 'good' : 'warn');
  }

  /* ---------------- inbox ---------------- */

  var lastDeleted = null;

  var inboxEmptyHTML = $('inboxEmptyText').innerHTML;

  function setInboxEmpty(err) {
    var title = $('inboxEmptyTitle'), text = $('inboxEmptyText'), cta = $('inboxEmptyCta');
    if (err) {
      title.textContent = 'The inbox cannot be read — storage is blocked here';
      text.textContent = 'This browser refused IndexedDB for this origin (' +
        String(err && err.message || err) + '). That is a site-data setting, not an empty list: ' +
        'nothing was captured, and nothing was lost. The parser, the capability matrix and the ' +
        'service-worker panels above still run.';
      cta.hidden = true;
    } else {
      title.textContent = 'Nothing captured yet';
      text.innerHTML = inboxEmptyHTML;
      cta.hidden = false;
    }
  }

  function renderInbox() {
    return S.listEntries().then(function (rows) {
      var list = $('entryList');
      clear(list);
      setInboxEmpty(null);
      $('inboxCount').textContent = String(rows.length);
      $('inboxEmpty').hidden = rows.length > 0;
      var pending = rows.filter(function (r) { return !r.synced; }).length;
      $('inboxSummary').textContent = rows.length
        ? rows.length + ' entr' + (rows.length === 1 ? 'y' : 'ies') + ', ' + pending + ' awaiting the simulated peer.'
        : '';
      rows.forEach(function (r) { list.appendChild(entryRow(r)); });
      return rows;
    }, function (err) {
      clear($('entryList'));
      $('inboxCount').textContent = '—';
      $('inboxSummary').textContent = '';
      setInboxEmpty(err);
      $('inboxEmpty').hidden = false;
      noteDbError(err);
      return [];
    });
  }

  function entryRow(r) {
    var li = el('li', 'entry');
    li.setAttribute('data-id', r.id);
    var under = el('div', 'entry-under', 'Release to delete');
    li.appendChild(under);

    var face = el('div', 'entry-face');
    if (r.photo) {
      var img = el('img', 'thumb');
      img.alt = '';
      var url = URL.createObjectURL(r.photo);
      img.src = url;
      img.addEventListener('load', function () { URL.revokeObjectURL(url); });
      face.appendChild(img);
    }
    var main = el('div', 'entry-main');
    main.appendChild(el('div', 'm', r.merchant || 'Unknown'));
    var meta = el('div', 'meta');
    meta.appendChild(el('span', null, fmtDate(r.occurredAt || r.createdAt)));
    meta.appendChild(el('span', null, r.source));
    if (r.category) meta.appendChild(el('span', null, r.category));
    meta.appendChild(el('span', null, r.synced ? 'synced (local peer)' : 'pending'));
    if (typeof r.confidence === 'number') meta.appendChild(el('span', null, Math.round(r.confidence * 100) + '% conf'));
    main.appendChild(meta);
    face.appendChild(main);
    face.appendChild(el('div', 'entry-amt' + (r.direction === 'in' ? ' in' : ''), fmtMoney(r.amount, r.currency, r.direction)));

    var acts = el('div', 'entry-actions');
    var open = el('button', 'btn small', 'Open');
    open.type = 'button';
    open.setAttribute('aria-label', 'Open details for ' + (r.merchant || 'entry'));
    open.addEventListener('click', function () { openEntry(r.id); });
    var del = el('button', 'btn small danger', 'Delete');
    del.type = 'button';
    del.setAttribute('aria-label', 'Delete ' + (r.merchant || 'entry'));
    del.addEventListener('click', function () { removeEntry(r); });
    acts.appendChild(open);
    acts.appendChild(del);
    face.appendChild(acts);

    attachSwipe(face, r);
    li.appendChild(face);
    return li;
  }

  /* velocity-committed swipe + long press, both with button equivalents above */
  function attachSwipe(face, r) {
    var startX = 0, startY = 0, startT = 0, dx = 0, dragging = false, longTimer = null, moved = false;

    face.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest('button')) return;
      startX = ev.clientX; startY = ev.clientY; startT = performance.now();
      dx = 0; dragging = true; moved = false;
      face.classList.add('dragging');
      face.setPointerCapture && face.setPointerCapture(ev.pointerId);
      longTimer = setTimeout(function () {
        if (moved) return;
        try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
        dragging = false;
        openEntry(r.id);
      }, 520);
    });

    face.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      var ddx = ev.clientX - startX, ddy = ev.clientY - startY;
      if (Math.abs(ddx) > 8 || Math.abs(ddy) > 8) { moved = true; clearTimeout(longTimer); }
      if (Math.abs(ddy) > Math.abs(ddx)) return;
      dx = Math.min(0, ddx);
      face.style.transform = 'translateX(' + dx + 'px)';
    });

    function end(ev) {
      clearTimeout(longTimer);
      face.classList.remove('dragging');
      if (!dragging) { face.style.transform = ''; return; }
      dragging = false;
      var dt = Math.max(1, performance.now() - startT);
      var velocity = Math.abs(dx) / dt;              // px per ms
      var commit = velocity > 0.45 || dx < -110;      // flick OR distance
      face.style.transform = '';
      if (commit) removeEntry(r);
      if (ev && face.releasePointerCapture && ev.pointerId !== undefined) {
        try { face.releasePointerCapture(ev.pointerId); } catch (e) {}
      }
    }
    face.addEventListener('pointerup', end);
    face.addEventListener('pointercancel', end);
    face.addEventListener('lostpointercapture', function () {
      dragging = false; face.style.transform = ''; face.classList.remove('dragging');
    });
  }

  function removeEntry(r) {
    lastDeleted = r;
    S.deleteEntry(r.id).then(function () {
      renderInbox().catch(noteDbError);
      refreshEngine().catch(noteDbError);
      snack('Deleted "' + (r.merchant || 'entry') + '".', 'Undo', function () {
        var copy = {};
        for (var k in lastDeleted) copy[k] = lastDeleted[k];
        copy.__isEntry = true;
        S.commitEntry(copy).then(function () {
          snack('Restored, with a fresh outbox job.');
          renderInbox().catch(noteDbError); refreshEngine().catch(noteDbError);
        }).catch(function (e) { snack('Undo failed: ' + String(e && e.message || e)); });
      });
    }).catch(function (e) { snack('Delete failed: ' + String(e && e.message || e)); });
  }

  /* ---------------- entry sheet ---------------- */

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var sheetOpener = null;
  var sheetOpenerEntry = null;
  var SHEET_IDS = { scrim: 1, entrySheet: 1, conflictSheet: 1, snackbar: 1 };

  /* aria-modal alone is a promise the page has to keep: while a sheet is open the
     rest of the document is inert, so Tab and a screen reader cannot walk behind
     the scrim, and closing hands focus back to whatever opened the sheet. */
  function setBackgroundInert(on) {
    Array.prototype.forEach.call(document.body.children, function (n) {
      if (n.tagName === 'SCRIPT' || (n.id && SHEET_IDS[n.id])) return;
      if (on) {
        n.setAttribute('aria-hidden', 'true');
        try { n.inert = true; } catch (e) {}
      } else {
        n.removeAttribute('aria-hidden');
        try { n.inert = false; } catch (e) {}
      }
    });
  }

  function openSheets() { return !$('entrySheet').hidden || !$('conflictSheet').hidden; }

  function openSheet(sheet) {
    var opener = document.activeElement;
    sheetOpener = (opener && opener !== document.body && document.contains(opener)) ? opener : null;
    /* the inbox re-renders on every drain, so remember WHICH row opened this,
       not just the button node — otherwise focus restore lands on a detached element */
    var row = sheetOpener && sheetOpener.closest ? sheetOpener.closest('.entry[data-id]') : null;
    sheetOpenerEntry = row ? row.getAttribute('data-id') : null;
    $('scrim').hidden = false;
    sheet.hidden = false;
    sheet.style.height = '62dvh';
    document.body.classList.add('sheet-open');
    setBackgroundInert(true);
    var f = sheet.querySelector('button, [tabindex]');
    if (f) f.focus();
  }

  function closeSheets() {
    var was = openSheets();
    $('scrim').hidden = true;
    $('entrySheet').hidden = true;
    $('conflictSheet').hidden = true;
    document.body.classList.remove('sheet-open');
    setBackgroundInert(false);
    if (was) {
      var target = null;
      if (sheetOpener && document.contains(sheetOpener)) target = sheetOpener;
      else if (sheetOpenerEntry) {
        var row = document.querySelector('.entry[data-id="' + sheetOpenerEntry.replace(/"/g, '\\"') + '"]');
        target = row ? row.querySelector('.entry-actions .btn') : null;
      }
      if (!target) target = $('view-' + current);   // never drop the user at <body>
      try { target.focus({ preventScroll: true }); } catch (e) { try { target.focus(); } catch (e2) {} }
    }
    sheetOpener = null;
    sheetOpenerEntry = null;
  }

  $('scrim').addEventListener('click', closeSheets);
  $('entryClose').addEventListener('click', closeSheets);
  $('conflictClose').addEventListener('click', closeSheets);
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { closeSheets(); return; }
    if (ev.key !== 'Tab') return;
    var sheet = !$('entrySheet').hidden ? $('entrySheet') : (!$('conflictSheet').hidden ? $('conflictSheet') : null);
    if (!sheet) return;
    var nodes = Array.prototype.filter.call(sheet.querySelectorAll(FOCUSABLE), function (n) {
      return n.offsetWidth > 0 || n.offsetHeight > 0 || n === document.activeElement;
    });
    if (!nodes.length) return;
    var first = nodes[0], last = nodes[nodes.length - 1];
    var inside = sheet.contains(document.activeElement);
    if (ev.shiftKey && (!inside || document.activeElement === first)) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && (!inside || document.activeElement === last)) { ev.preventDefault(); first.focus(); }
  });

  function openEntry(id) {
    S.getEntry(id).then(function (r) {
      if (!r) return;
      $('entrySheetTitle').textContent = r.merchant || 'Entry';
      var body = $('entryBody');
      clear(body);

      if (r.photo) {
        var img = el('img');
        img.alt = 'Captured photo for ' + (r.merchant || 'entry');
        img.style.maxWidth = '240px';
        img.style.borderRadius = '12px';
        var u = URL.createObjectURL(r.photo);
        img.src = u;
        img.addEventListener('load', function () { URL.revokeObjectURL(u); });
        body.appendChild(img);
      }

      var t = el('table', 'kv');
      var tb = el('tbody');
      tb.appendChild(kvRow('amount', fmtMoney(r.amount, r.currency, r.direction)));
      tb.appendChild(kvRow('merchant', r.merchant || '—'));
      tb.appendChild(kvRow('category', r.category || '—'));
      tb.appendChild(kvRow('date', fmtDate(r.occurredAt || r.createdAt)));
      tb.appendChild(kvRow('source', r.source));
      tb.appendChild(kvRow('rule', r.rule ? r.rule.id + ' — ' + r.rule.label : '—'));
      tb.appendChild(kvRow('confidence', typeof r.confidence === 'number' ? Math.round(r.confidence * 100) + '%' : '—'));
      tb.appendChild(kvRow('Lamport clock', String(r.clock)));
      tb.appendChild(kvRow('sync state', r.synced ? 'applied to the local peer' : 'pending in the outbox'));
      tb.appendChild(kvRow('photo bytes', r.photoBytes ? fmtBytes(r.photoBytes) : '—'));
      tb.appendChild(kvRow('raw text', r.rawText || '—'));
      t.appendChild(tb);
      body.appendChild(t);

      if (r.trace && r.trace.length) {
        body.appendChild(el('h3', 'mini', 'How this row arrived'));
        var ol = el('ol', 'trace');
        r.trace.forEach(function (x) {
          var li = el('li');
          li.appendChild(el('span', 'ts', fmtTime(x.t)));
          li.appendChild(el('span', null, x.step));
          ol.appendChild(li);
        });
        body.appendChild(ol);
      }

      body.appendChild(el('h3', 'mini', 'Correct a field'));
      var wrap = el('div', 'row');
      var mi = el('input', 'ctl grow');
      mi.type = 'text'; mi.value = r.merchant || ''; mi.setAttribute('aria-label', 'Merchant');
      var cat = el('select', 'ctl');
      cat.setAttribute('aria-label', 'Category');
      ['', 'Food', 'Transport', 'Shopping', 'Bills', 'Income', 'Other'].forEach(function (c) {
        var o = el('option', null, c || '(none)');
        o.value = c;
        if ((r.category || '') === c) o.selected = true;
        cat.appendChild(o);
      });
      var save = el('button', 'btn small primary', 'Save correction');
      save.type = 'button';
      save.addEventListener('click', function () {
        S.updateEntry(r.id, { merchant: mi.value.trim() || r.merchant, category: cat.value || null })
          .then(function () { return S.merchantLearn(mi.value.trim() || r.merchant, cat.value); })
          .then(function () {
            snack('Correction committed — new outbox job queued, merchant map updated.');
            closeSheets();
            renderInbox().catch(noteDbError);
            refreshEngine().catch(noteDbError);
            renderMerchants().catch(noteDbError);
          })
          .catch(function (e) { snack('Update failed: ' + e.message); });
      });
      wrap.appendChild(mi); wrap.appendChild(cat); wrap.appendChild(save);
      body.appendChild(wrap);

      openSheet($('entrySheet'));
    });
  }

  /* ---------------- conflicts ---------------- */

  function refreshConflicts() {
    return S.conflictAll().then(function (list) {
      var banner = $('conflictBanner');
      banner.hidden = list.length === 0;
      if (list.length) {
        $('conflictText').textContent = list.length + ' entr' + (list.length === 1 ? 'y has' : 'ies have') +
          ' a field-level conflict with the simulated peer.';
        $('conflictBtn').onclick = function () { openConflict(list[0]); };
      }
      return list;
    });
  }

  function openConflict(c) {
    S.getEntry(c.entryId).then(function (entry) {
      $('conflictSheetTitle').textContent = 'Conflict — ' + (entry ? entry.merchant : c.entryId);
      var body = $('conflictBody');
      clear(body);
      body.appendChild(el('p', 'sub',
        'The peer holds a newer Lamport clock for these fields, so a blind last-write-wins would ' +
        'silently drop one side. Choose per field; whichever you keep is re-committed with a clock ' +
        'above the peer\'s, so the retry is ordered rather than racing.'));

      var choices = {};
      var table = el('table', 'diff');
      var thead = el('thead');
      var htr = el('tr');
      ['Field', 'This device', 'Peer', 'Keep'].forEach(function (h) { htr.appendChild(el('th', null, h)); });
      thead.appendChild(htr);
      table.appendChild(thead);
      var tb = el('tbody');
      c.fields.forEach(function (f) {
        choices[f.field] = 'mine';
        var tr = el('tr');
        tr.appendChild(el('td', null, f.field));
        var mine = el('td', 'chosen', String(f.mine) + '  (clock ' + f.myClock + ')');
        var theirs = el('td', null, String(f.theirs) + '  (clock ' + f.theirClock + ')');
        tr.appendChild(mine); tr.appendChild(theirs);
        var pick = el('td');
        var sel = el('select', 'ctl');
        sel.setAttribute('aria-label', 'Keep which value for ' + f.field);
        [['mine', 'this device'], ['theirs', 'peer']].forEach(function (o) {
          var op = el('option', null, o[1]);
          op.value = o[0];
          sel.appendChild(op);
        });
        sel.addEventListener('change', function () {
          choices[f.field] = sel.value;
          mine.className = sel.value === 'mine' ? 'chosen' : '';
          theirs.className = sel.value === 'theirs' ? 'chosen' : '';
        });
        pick.appendChild(sel);
        tr.appendChild(pick);
        tb.appendChild(tr);
      });
      table.appendChild(tb);
      body.appendChild(table);

      var row = el('div', 'row');
      var apply = el('button', 'btn small primary', 'Resolve and re-queue');
      apply.type = 'button';
      apply.addEventListener('click', function () {
        Sync.resolveConflict(c.id, choices).then(function () {
          snack('Resolved. A new outbox job carries the merged row.');
          closeSheets();
          return Promise.all([renderInbox(), refreshConflicts(), refreshEngine()]).then(function () { return doDrain(false); });
        }).catch(function (e) { snack('Resolve failed: ' + e.message); });
      });
      row.appendChild(apply);
      body.appendChild(row);
      openSheet($('conflictSheet'));
    });
  }

  /* ---------------- sheet drag (with keyboard parity) ---------------- */

  var SNAPS = [40, 62, 88];
  function bindGrip(gripId, sheetId) {
    var grip = $(gripId), sheet = $(sheetId);
    var startY = 0, startH = 0, dragging = false, startT = 0, lastH = 62;

    grip.addEventListener('pointerdown', function (ev) {
      dragging = true;
      startY = ev.clientY;
      startH = sheet.getBoundingClientRect().height;
      startT = performance.now();
      sheet.style.transition = 'none';
      grip.setPointerCapture && grip.setPointerCapture(ev.pointerId);
    });
    grip.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      var h = startH - (ev.clientY - startY);
      var vh = window.innerHeight;
      var pct = Math.max(18, Math.min(94, (h / vh) * 100));
      if (pct > 88) pct = 88 + (pct - 88) * 0.35;   // rubber band past the top snap
      lastH = pct;
      sheet.style.height = pct + 'dvh';
    });
    function endDrag(ev) {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = '';
      var dt = Math.max(1, performance.now() - startT);
      var vy = (startH - sheet.getBoundingClientRect().height) / dt;
      var target = lastH + vy * 60;                  // velocity carries the snap
      var best = SNAPS[0];
      SNAPS.forEach(function (s) { if (Math.abs(s - target) < Math.abs(best - target)) best = s; });
      if (best === SNAPS[0] && target < 28) { closeSheets(); return; }
      sheet.style.height = best + 'dvh';
      if (ev && grip.releasePointerCapture && ev.pointerId !== undefined) {
        try { grip.releasePointerCapture(ev.pointerId); } catch (e) {}
      }
    }
    grip.addEventListener('pointerup', endDrag);
    grip.addEventListener('pointercancel', endDrag);

    grip.addEventListener('keydown', function (ev) {
      var i = SNAPS.indexOf(parseInt(sheet.style.height, 10));
      if (i < 0) i = 1;
      if (ev.key === 'ArrowUp') { ev.preventDefault(); sheet.style.height = SNAPS[Math.min(SNAPS.length - 1, i + 1)] + 'dvh'; }
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (i === 0) closeSheets(); else sheet.style.height = SNAPS[i - 1] + 'dvh';
      }
    });
  }
  bindGrip('entryGrip', 'entrySheet');
  bindGrip('conflictGrip', 'conflictSheet');

  /* ---------------- capture ---------------- */

  var parsed = null;
  var pendingPhoto = null;

  function renderRules() {
    var tb = $('ruleBody');
    clear(tb);
    P.RULES.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', null, r.id));
      var td = el('td');
      td.appendChild(el('div', null, r.label));
      td.appendChild(el('div', 'note', r.hint));
      if (r.examples && r.examples[0]) td.appendChild(el('div', 'note', '“' + r.examples[0] + '”'));
      tr.appendChild(td);
      tb.appendChild(tr);
    });
  }

  function doParse() {
    var text = $('pasteText').value;
    if (!text.trim()) {
      $('parseOut').hidden = true;
      parsed = null;
      return;
    }
    parsed = P.parse(text);
    $('parseOut').hidden = false;
    var tb = $('parseBody');
    clear(tb);
    tb.appendChild(kvRow('rule fired', parsed.rule ? parsed.rule.id + ' — ' + parsed.rule.label : 'none matched'));
    tb.appendChild(kvRow('matched text', parsed.rule ? parsed.rule.matchedText : '—'));
    tb.appendChild(kvRow('amount', parsed.amount === null ? 'not found' : String(parsed.amount)));
    tb.appendChild(kvRow('currency', parsed.currency));
    tb.appendChild(kvRow('merchant', parsed.merchant || 'not found'));
    tb.appendChild(kvRow('direction', parsed.direction));
    tb.appendChild(kvRow('date', fmtDate(parsed.occurredAt)));
    tb.appendChild(kvRow('confidence', Math.round(parsed.confidence * 100) + '%'));

    var ul = $('signalList');
    clear(ul);
    parsed.signals.forEach(function (s) {
      var li = el('li');
      li.appendChild(el('span', null, s.name));
      li.appendChild(el('b', null, (s.weight > 0 ? '+' : '') + s.weight.toFixed(2)));
      ul.appendChild(li);
    });

    $('fAmount').value = parsed.amount === null ? '' : parsed.amount;
    $('fCurrency').value = parsed.currency;
    $('fMerchant').value = parsed.merchant || '';
    $('fDirection').value = parsed.direction;
    $('fDate').value = fmtDate(parsed.occurredAt);
    S.merchantLookup(parsed.merchant).then(function (cat) {
      if (cat) {
        $('fCategory').value = cat;
        snack('Merchant map applied category "' + cat + '" from an earlier correction.');
      }
    }).catch(function () {});
  }

  var parseTimer = null;
  $('pasteText').addEventListener('input', function () {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(doParse, 180);
  });
  $('sampleBtn').addEventListener('click', function () {
    var i = Math.floor(Math.random() * P.SAMPLES.length);
    $('pasteText').value = P.SAMPLES[i];
    doParse();
  });
  $('clearPasteBtn').addEventListener('click', function () {
    $('pasteText').value = '';
    doParse();
  });

  $('saveEntryBtn').addEventListener('click', function () {
    var amountRaw = $('fAmount').value;
    var seed = {
      amount: amountRaw === '' ? null : parseFloat(amountRaw),
      currency: ($('fCurrency').value || 'IDR').toUpperCase(),
      merchant: $('fMerchant').value.trim() || 'Unknown',
      direction: $('fDirection').value,
      category: $('fCategory').value || null,
      source: pendingPhoto ? 'camera' : 'paste',
      rawText: $('pasteText').value,
      rule: parsed && parsed.rule ? parsed.rule : null,
      confidence: parsed ? parsed.confidence : null,
      occurredAt: $('fDate').value ? new Date($('fDate').value + 'T12:00:00').getTime() : Date.now(),
      photo: pendingPhoto ? pendingPhoto.blob : null,
      photoType: pendingPhoto ? pendingPhoto.type : null,
      photoBytes: pendingPhoto ? pendingPhoto.bytes : 0,
      trace: [{ t: Date.now(), step: 'captured in-page via ' + (pendingPhoto ? 'camera + ' : '') + 'paste, committed by the same atomic transaction the share handler uses' }]
    };
    S.commitEntry(seed).then(function (res) {
      snack('Committed entry ' + res.entry.id.slice(0, 10) + ' + outbox job in one transaction.', 'Open inbox', function () { showView('inbox'); });
      if (seed.category) S.merchantLearn(seed.merchant, seed.category);
      pendingPhoto = null;
      $('photoOut').hidden = true;
      $('pasteText').value = '';
      doParse();
      return Promise.all([renderInbox(), refreshEngine(), renderMerchants()]).catch(noteDbError);
    }).catch(function (err) {
      var name = (err && err.name) || 'Error';
      snack(name + ': ' + (err && err.message || err) + ' — transaction aborted.');
      verifyNoOrphan();
    });
  });

  function verifyNoOrphan() {
    return Promise.all([S.listEntries(), S.outboxAll()]).then(function (r) {
      var ids = {};
      r[0].forEach(function (e) { ids[e.id] = true; });
      var orphanJobs = r[1].filter(function (j) { return !ids[j.entryId]; }).length;
      $('chaosNote').textContent =
        'Post-abort check: ' + r[0].length + ' entries, ' + r[1].length + ' outbox rows, ' +
        orphanJobs + ' orphaned job(s). The abort left nothing half-written.';
    }).catch(function (e) {
      $('chaosNote').textContent = 'Post-abort check could not run: ' + String(e && e.message || e) +
        ' — storage is unavailable in this browser, so there is nothing to verify.';
    });
  }

  $('photoInput').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    $('photoStatus').textContent = 'decoding ' + fmtBytes(f.size) + ' …';
    $('photoOut').hidden = false;
    downscaleInPage(f).then(function (out) {
      pendingPhoto = out;
      var u = URL.createObjectURL(out.blob);
      var img = $('photoPreview');
      img.src = u;
      img.addEventListener('load', function () { URL.revokeObjectURL(u); }, { once: true });
      $('photoStatus').textContent = fmtBytes(f.size) + ' → ' + fmtBytes(out.bytes) +
        ' (' + out.w + '×' + out.h + ', ' + out.type + '). Nothing left this page.';
    }).catch(function (e) {
      $('photoStatus').textContent = 'decode failed: ' + e.message;
    });
  });

  function downscaleInPage(file) {
    var MAX = 1280, BUDGET = 320 * 1024;
    return (typeof createImageBitmap === 'function'
      ? createImageBitmap(file, { imageOrientation: 'from-image' })
      : Promise.reject(new Error('createImageBitmap unavailable'))
    ).then(function (bmp) {
      var scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
      var w = Math.max(1, Math.round(bmp.width * scale));
      var h = Math.max(1, Math.round(bmp.height * scale));
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      return new Promise(function (resolve) {
        c.toBlob(function (blob) {
          if (blob) return resolve({ blob: blob, type: blob.type, bytes: blob.size, w: w, h: h });
          c.toBlob(function (b2) {
            resolve({ blob: b2 || file, type: (b2 || file).type, bytes: (b2 || file).size, w: w, h: h });
          }, 'image/jpeg', 0.8);
        }, 'image/webp', 0.8);
      });
    }).then(function (out) {
      if (out.bytes > BUDGET) out.note = 'still over the ' + fmtBytes(BUDGET) + ' budget';
      return out;
    });
  }

  function renderMerchants() {
    return S.merchantAll().then(function (rows) {
      var ul = $('merchantList');
      clear(ul);
      if (!rows.length) {
        ul.appendChild(el('li', 'empty', 'No corrections learned yet.'));
        return;
      }
      rows.sort(function (a, b) { return (b.hits || 0) - (a.hits || 0); });
      rows.forEach(function (r) {
        ul.appendChild(el('li', null, r.merchant + '  →  ' + r.category + '   (' + r.hits + '×)'));
      });
    });
  }

  /* ---------------- data ---------------- */

  $('exportBtn').addEventListener('click', function () {
    S.exportAll().then(function (doc) {
      var blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      var u = URL.createObjectURL(blob);
      a.href = u;
      a.download = 'saku-export-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
      snack('Exported ' + doc.entries.length + ' entries (photos base64-encoded inline).');
    }).catch(function (e) { snack('Export failed: ' + e.message); });
  });

  $('importInput').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var self = this;
    f.text().then(function (t) { return S.importAll(JSON.parse(t)); }).then(function (n) {
      snack('Imported ' + n + ' entries.');
      self.value = '';
      return Promise.all([renderInbox(), refreshEngine(), renderMerchants()]);
    }).catch(function (e) { snack('Import failed: ' + e.message); });
  });

  $('wipeBtn').addEventListener('click', function () {
    if (!window.confirm('Delete the database, every cache and the service worker registration?')) return;
    S.deleteDatabase().then(function () {
      var cs = cacheStore();
      if (!cs) return null;
      return cs.keys().then(function (ks) {
        return Promise.all(ks.map(function (k) { return cs.delete(k); }));
      });
    }).then(function () {
      if (!swSupported) return null;
      return swApi.getRegistrations().then(function (rs) {
        return Promise.all(rs.map(function (r) { return r.unregister(); }));
      });
    }).then(function () {
      /* The card these numbers sit in is titled "Detected live, not assumed", so
         it must not keep asserting 5 rows in a database that no longer exists. */
      swReg = null;
      swUnregistered = true;
      paintSWPill();
      return Promise.all([
        renderInbox().catch(noteDbError),
        renderMerchants().catch(noteDbError),
        refreshConflicts().catch(noteDbError),
        refreshEngine().catch(noteDbError)
      ]);
    }).then(function () {
      snack('Wiped. Reload for a genuine cold start.', 'Reload', function () { location.reload(); });
    }).catch(function (e) { snack('Wipe failed: ' + String(e && e.message || e)); });
  });

  $('seedBtn').addEventListener('click', function () {
    var texts = P.SAMPLES;
    var i = 0;
    function next() {
      if (i >= texts.length) {
        snack('Seeded ' + texts.length + ' entries through the real write path.');
        return Promise.all([renderInbox(), refreshEngine()]);
      }
      var p = P.parse(texts[i]);
      i++;
      return S.commitEntry({
        amount: p.amount, currency: p.currency, merchant: p.merchant || 'Unknown',
        direction: p.direction, source: 'seed', rawText: texts[i - 1],
        rule: p.rule, confidence: p.confidence, occurredAt: p.occurredAt,
        trace: [{ t: Date.now(), step: 'seeded locally through the same commitEntry transaction' }]
      }).then(next);
    }
    next().catch(function (e) { snack('Seed failed: ' + e.message); });
  });

  /* ---------------- boot ---------------- */

  function handleLandingParams() {
    var q = new URLSearchParams(location.search);
    var shared = q.get('shared');
    var err = q.get('shareError');
    var view = q.get('view');
    if (err) {
      $('shareStatus').textContent = 'The worker answered 303 with an error: ' + err;
      traceLocal('share failed: ' + err, 'err');
    }
    if (shared) {
      S.getEntry(shared).then(function (entry) {
        if (!entry) {
          $('shareStatus').textContent = 'Redirected with ?shared=' + shared + ' but that row is gone.';
          return;
        }
        renderTrace(entry.trace, false);
        $('shareStatus').textContent =
          'Arrived by navigation: the POST was answered 303 and the browser followed it to this GET. ' +
          'Press Back — you land on the previous page, not a re-POST.';
        snack('Shared entry "' + entry.merchant + '" is in the inbox.', 'Open', function () { showView('inbox'); });
      });
    }
    if (shared || err) {
      try { history.replaceState(null, '', location.pathname + '#/engine'); } catch (e) {}
    }
    if (view && VIEWS.indexOf(view) >= 0) return view;
    var h = (location.hash || '').replace('#/', '');
    return VIEWS.indexOf(h) >= 0 ? h : 'engine';
  }

  paintNet();
  paintSWPill();
  renderRules();
  registerSW();

  var startView = handleLandingParams();

  S.openDB().then(function () {
    return Promise.all([loadChaos(), renderInbox(), renderMerchants(), refreshConflicts(), refreshEngine()]);
  }).then(function () {
    showView(startView, false);
  }).catch(function (err) {
    // A blocked-storage browser must still get a usable page, not a blank one.
    noteDbError(err);
    snack('IndexedDB unavailable: ' + String(err && err.message || err) + '. The page still renders.');
    setInboxEmpty(err);
    showView(startView, false);
    refreshSW();
    renderCaps();
    refreshQuota().catch(noteDbError);
  });

  window.addEventListener('hashchange', function () {
    var h = (location.hash || '').replace('#/', '');
    if (VIEWS.indexOf(h) >= 0 && h !== current) showView(h, false);
  });
})();
