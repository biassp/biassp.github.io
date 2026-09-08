/*!
 * Saku — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Saku — sw.js
 * The whole point of the app lives in this file.
 *
 * A PWA that declares share_target with method POST gets the OS share sheet to
 * send a real multipart/form-data POST at ./share. GitHub Pages would answer
 * that with 405 — but the request never reaches GitHub, because a service
 * worker controlling this scope intercepts every fetch from its clients,
 * including one the operating system generated while the app was closed.
 * The handler below parses the FormData, writes it to IndexedDB, and answers
 * 303 with a Location to a GET URL, so the reviewer's back button cannot
 * re-POST and duplicate the entry (POST/Redirect/GET, moved into a worker).
 */
/* global SakuStore, SakuParse, SakuSync */
importScripts('./store.js', './parse.js', './sync.js');

var VERSION = 'v1.0.0';
var CACHE = 'saku-shell-' + VERSION;
var PRECACHE = [
  './',
  './index.html',
  './app.css',
  './theme.js',
  './store.js',
  './parse.js',
  './sync.js',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

var BUS = 'saku-bus';

function bus(msg) {
  msg.t = Date.now();
  msg.from = 'sw';
  try {
    if (typeof BroadcastChannel === 'function') {
      var ch = new BroadcastChannel(BUS);
      ch.postMessage(msg);
      ch.close();
    }
  } catch (e) { /* BroadcastChannel is absent on older Safari; traces still persist on the entry */ }
  return msg;
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (c) {
      // addAll is atomic-ish: one 404 fails the whole install, which is what we want.
      return c.addAll(PRECACHE);
    }).then(function () {
      bus({ type: 'sw-installed', cache: CACHE, precached: PRECACHE.length });
    })
    // NOTE: no skipWaiting() here on purpose. A new worker waits, the page says
    // "Update ready", and code is only swapped when the user says so.
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf('saku-shell-') === 0 && k !== CACHE) return caches.delete(k);
        return null;
      }));
    }).then(function () {
      // Claim immediately: the window between "registered" and "controlling" is
      // exactly when a share can arrive, and an unclaimed client means the POST
      // would escape to the network and 405.
      return self.clients.claim();
    }).then(function () {
      bus({ type: 'sw-activated', cache: CACHE });
    })
  );
});

self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'PING' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ type: 'PONG', cache: CACHE, version: VERSION, precached: PRECACHE.length });
  }
});

/* ---------- share target ------------------------------------------------ */

var IMAGE_BUDGET = 320 * 1024;   // bytes we are willing to commit per photo
var MAX_EDGE = 1280;

function downscale(file, trace) {
  if (!file || !file.size) return Promise.resolve(null);
  if (file.size <= IMAGE_BUDGET) {
    trace.push({ t: Date.now(), step: 'photo under budget (' + file.size + 'B), stored as-is' });
    return Promise.resolve({ blob: file, type: file.type, bytes: file.size });
  }
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    trace.push({ t: Date.now(), step: 'OffscreenCanvas unavailable in this worker — photo stored undownscaled' });
    return Promise.resolve({ blob: file, type: file.type, bytes: file.size });
  }
  return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bmp) {
    var scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    var w = Math.max(1, Math.round(bmp.width * scale));
    var h = Math.max(1, Math.round(bmp.height * scale));
    var canvas = new OffscreenCanvas(w, h);
    var ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return canvas.convertToBlob({ type: 'image/webp', quality: 0.8 }).catch(function () {
      return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    }).then(function (blob) {
      trace.push({
        t: Date.now(),
        step: 'photo downscaled ' + file.size + 'B → ' + blob.size + 'B (' + w + '×' + h + ', ' + blob.type + ')'
      });
      return { blob: blob, type: blob.type, bytes: blob.size };
    });
  }).catch(function (err) {
    trace.push({ t: Date.now(), step: 'downscale failed (' + err.message + '), stored as-is' });
    return { blob: file, type: file.type, bytes: file.size };
  });
}

function abs(rel) {
  return new URL(rel, self.location.href).href;
}

function handleShare(request) {
  var trace = [{ t: Date.now(), step: 'POST ' + new URL(request.url).pathname + ' intercepted by the service worker (never reached the network)' }];
  bus({ type: 'share-start' });

  return SakuStore.getChaos().then(function (chaos) {
    if (chaos.swThrow) {
      throw new Error('Chaos: injected throw inside the service worker fetch handler');
    }
    return request.formData();
  }).then(function (fd) {
    var title = (fd.get('title') || '') + '';
    var text = (fd.get('text') || '') + '';
    var url = (fd.get('url') || '') + '';
    var files = fd.getAll('photo').filter(function (f) { return f && typeof f !== 'string' && f.size; });
    trace.push({
      t: Date.now(),
      step: 'FormData parsed: title=' + JSON.stringify(title.slice(0, 40)) +
        ', text=' + text.length + ' chars, url=' + (url ? 'yes' : 'none') +
        ', files=' + files.length
    });

    // Parse the shared TEXT on its own when there is one: the OS-supplied title
    // ("Shared to Saku", "Photos") would otherwise win the merchant pattern.
    var combined = text || [title, url].filter(Boolean).join(' · ');
    var parsed = SakuParse.parse(combined);
    trace.push({
      t: Date.now(),
      step: 'parser rule "' + (parsed.rule ? parsed.rule.id : 'none') + '" matched, confidence ' +
        Math.round(parsed.confidence * 100) + '%'
    });

    return downscale(files[0], trace).then(function (photo) {
      return SakuStore.merchantLookup(parsed.merchant).then(function (cat) {
        if (cat) trace.push({ t: Date.now(), step: 'merchant map hit: category "' + cat + '"' });
        var seed = {
          amount: parsed.amount,
          currency: parsed.currency,
          merchant: parsed.merchant || (title || 'Shared item'),
          direction: parsed.direction,
          category: cat,
          note: url || '',
          source: 'share-target',
          rawText: combined,
          rule: parsed.rule,
          confidence: parsed.confidence,
          occurredAt: parsed.occurredAt,
          photo: photo ? photo.blob : null,
          photoType: photo ? photo.type : null,
          photoBytes: photo ? photo.bytes : 0,
          trace: trace
        };
        return SakuStore.commitEntry(seed);
      });
    });
  }).then(function (res) {
    trace.push({
      t: Date.now(),
      step: 'IndexedDB transaction committed: entry ' + res.entry.id + ' + outbox job ' +
        (res.job ? res.job.id : '(none)') + ' (one transaction, three stores)'
    });
    var to = abs('./?shared=' + encodeURIComponent(res.entry.id));
    trace.push({ t: Date.now(), step: '303 See Other → ' + to.replace(self.location.origin, '') });
    // Persist the finished trace on the row itself, so a COLD share (app not
    // running, nothing listening on the BroadcastChannel) can still show the
    // reviewer every step the worker took.
    res.entry.trace = trace;
    return SakuStore.putEntryRaw(res.entry).then(function () {
      bus({ type: 'share-committed', entryId: res.entry.id, trace: trace });
      return Response.redirect(to, 303);
    });
  }).catch(function (err) {
    var msg = String(err && err.message || err);
    trace.push({ t: Date.now(), step: 'FAILED: ' + msg + ' — transaction aborted, nothing half-written' });
    bus({ type: 'share-failed', error: msg, trace: trace });
    return Response.redirect(abs('./?shareError=' + encodeURIComponent(msg)), 303);
  });
}

/* ---------- fetch ------------------------------------------------------- */

function isSharePath(url) {
  return url.pathname.replace(/\/+$/, '').slice(-6) === '/share';
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  if (req.method === 'POST' && isSharePath(url)) {
    event.respondWith(handleShare(req));
    return;
  }
  if (req.method === 'GET' && isSharePath(url)) {
    // Someone landed on /share with a GET (bookmark, refresh after redirect).
    event.respondWith(Promise.resolve(Response.redirect(abs('./'), 303)));
    return;
  }
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    // Cache-first navigation: a cold start in airplane mode paints instantly.
    event.respondWith(
      caches.match(abs('./index.html')).then(function (hit) {
        if (hit) return hit;
        return fetch(req).catch(function () {
          return caches.match(abs('./')).then(function (root) {
            return root || new Response(
              '<h1>Saku is offline and its shell is not cached yet.</h1>',
              { status: 503, headers: { 'Content-Type': 'text/html' } }
            );
          });
        });
      })
    );
    return;
  }

  if (url.searchParams.has('shared') || url.searchParams.has('shareError')) {
    // The GET half of POST/Redirect/GET. Serve the shell as a FRESH Response
    // rather than handing back the cached object: a cached Response carries the
    // cache entry's own URL, which would erase the ?shared= id the redirect just
    // handed us and make response.redirected read false.
    event.respondWith(
      caches.match(abs('./index.html')).then(function (hit) {
        if (!hit) return fetch(req);
        return hit.blob().then(function (body) {
          return new Response(body, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).catch(function () {
        return new Response('', { status: 504, statusText: 'offline and not precached' });
      });
    })
  );
});

/* ---------- Background Sync (Chromium only) ----------------------------- */

self.addEventListener('sync', function (event) {
  if (event.tag !== 'saku-outbox') return;
  bus({ type: 'bg-sync-fired', tag: event.tag });
  event.waitUntil(
    SakuSync.drain({
      clientId: 'sw',
      onEvent: function (e) { bus({ type: 'sync-event', event: e }); }
    }).then(function (summary) {
      bus({ type: 'bg-sync-done', summary: summary });
    }).catch(function (err) {
      bus({ type: 'bg-sync-failed', error: String(err && err.message || err) });
    })
  );
});
