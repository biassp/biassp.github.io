/*!
 * HARvest — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* HARvest — analyze.js
 * Pure analysis engine for HAR traces. No DOM, no network, no timers.
 * Safe to run on the main thread, in a Worker, or under node (for the test suite).
 *
 * Everything here is deterministic: given the same set of entries in any order,
 * the emitted schemas and specs are byte-identical. That property is asserted in
 * tests.js ("schema merge is order-independent") because it is the property that
 * most real implementations quietly violate.
 */
(function (root) {
  'use strict';

  var H = root.HARVEST || {};
  root.HARVEST = H;

  /* ------------------------------------------------------------------ utils */

  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }
  function num(v, d) { return isFiniteNum(v) ? v : d; }
  function lower(s) { return String(s == null ? '' : s).toLowerCase(); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function sortedKeys(o) { return Object.keys(o).sort(); }

  function headerList(headers) {
    var out = [];
    if (!headers) return out;
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i];
      if (!h) continue;
      out.push({ name: String(h.name == null ? '' : h.name), value: String(h.value == null ? '' : h.value) });
    }
    return out;
  }
  function headerGet(headers, name) {
    var n = lower(name);
    for (var i = 0; i < headers.length; i++) if (lower(headers[i].name) === n) return headers[i].value;
    return null;
  }
  function headerAll(headers, name) {
    var n = lower(name), out = [];
    for (var i = 0; i < headers.length; i++) if (lower(headers[i].name) === n) out.push(headers[i].value);
    return out;
  }
  H.headerGet = headerGet;
  H.headerAll = headerAll;

  function b64decode(s) {
    var str = String(s || '').replace(/[\r\n\s]/g, '');
    var pad = str.length % 4;
    if (pad === 2) str += '==';
    else if (pad === 3) str += '=';
    else if (pad === 1) return null;
    try {
      if (typeof atob === 'function') return atob(str);
      if (typeof Buffer !== 'undefined') return Buffer.from(str, 'base64').toString('binary');
    } catch (e) { return null; }
    return null;
  }
  H.b64decode = b64decode;

  function b64urlDecode(s) {
    return b64decode(String(s || '').replace(/-/g, '+').replace(/_/g, '/'));
  }
  H.b64urlDecode = b64urlDecode;

  /* ------------------------------------------------------- url parsing */

  var URL_RE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i;

  function parseUrl(raw) {
    var s = String(raw == null ? '' : raw);
    var m = URL_RE.exec(s);
    var scheme = '', authority = '', path = s, query = '';
    if (m) { scheme = lower(m[1]); authority = m[2]; path = m[3] || '/'; query = m[4] || ''; }
    else {
      var qi = s.indexOf('?');
      if (qi >= 0) { path = s.slice(0, qi); query = s.slice(qi + 1); }
    }
    var host = authority, port = '';
    var at = host.lastIndexOf('@');
    if (at >= 0) host = host.slice(at + 1);
    if (host.charAt(0) === '[') {
      var cb = host.indexOf(']');
      if (cb > 0) { port = host.slice(cb + 2); host = host.slice(0, cb + 1); }
    } else {
      var ci = host.lastIndexOf(':');
      if (ci >= 0) { port = host.slice(ci + 1); host = host.slice(0, ci); }
    }
    if (!path) path = '/';
    return {
      scheme: scheme, host: lower(host), port: port,
      hostport: lower(host) + (port && !((scheme === 'https' && port === '443') || (scheme === 'http' && port === '80')) ? ':' + port : ''),
      path: path, query: query,
      params: parseQuery(query)
    };
  }
  H.parseUrl = parseUrl;

  function decodeComp(s) {
    try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch (e) { return String(s); }
  }
  function parseQuery(q) {
    var out = [];
    if (!q) return out;
    var parts = String(q).split('&');
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      var eq = parts[i].indexOf('=');
      if (eq < 0) out.push({ name: decodeComp(parts[i]), value: '' });
      else out.push({ name: decodeComp(parts[i].slice(0, eq)), value: decodeComp(parts[i].slice(eq + 1)) });
    }
    return out;
  }
  H.parseQuery = parseQuery;

  function pathSegments(path) {
    var raw = String(path || '/').split('/');
    var out = [];
    for (var i = 0; i < raw.length; i++) if (raw[i] !== '') out.push(decodeComp(raw[i]));
    return out;
  }
  H.pathSegments = pathSegments;

  /* ---------------------------------------------------- HAR normalisation */

  var TIMING_KEYS = ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive'];

  function normaliseTimings(t, total) {
    var out = {}, sum = 0, any = false;
    for (var i = 0; i < TIMING_KEYS.length; i++) {
      var k = TIMING_KEYS[i];
      var v = t ? t[k] : undefined;
      // HAR uses -1 for "not applicable"; ssl is included inside connect.
      if (isFiniteNum(v) && v >= 0) { out[k] = v; if (k !== 'ssl') sum += v; any = true; }
      else out[k] = 0;
    }
    if (!any || sum <= 0) {
      out.wait = num(total, 0);
      sum = out.wait;
      out._synthetic = true;
    }
    out._sum = sum;
    return out;
  }

  function bodyOf(content, warnings, idx) {
    var res = { text: null, missing: false, encoded: false, size: 0, mime: '' };
    if (!content) { res.missing = true; return res; }
    res.mime = lower(content.mimeType || '');
    res.size = num(content.size, 0);
    var text = content.text;
    if (typeof text !== 'string' || text === '') {
      if (res.size > 0) res.missing = true;
      return res;
    }
    if (lower(content.encoding) === 'base64') {
      var dec = b64decode(text);
      res.encoded = true;
      if (dec == null) {
        res.missing = true;
        warnings.push('entry ' + idx + ': response body declared base64 but failed to decode');
        return res;
      }
      // Best-effort UTF-8 repair for byte strings produced by atob.
      try { dec = decodeURIComponent(escape(dec)); } catch (e) { /* keep raw */ }
      res.text = dec;
    } else {
      res.text = text;
    }
    return res;
  }

  function looksJson(mime, text) {
    if (/json/.test(mime)) return true;
    if (!text) return false;
    var t = text.replace(/^﻿/, '').trim();
    return (t.charAt(0) === '{' || t.charAt(0) === '[');
  }

  function parseCookiesHeader(v) {
    var out = [];
    String(v || '').split(';').forEach(function (part) {
      var p = part.trim();
      if (!p) return;
      var eq = p.indexOf('=');
      out.push(eq < 0 ? { name: p, value: '' } : { name: p.slice(0, eq).trim(), value: p.slice(eq + 1).trim() });
    });
    return out;
  }

  function parseSetCookie(raw) {
    var parts = String(raw || '').split(';');
    var first = parts.shift() || '';
    var eq = first.indexOf('=');
    var c = {
      raw: String(raw || ''),
      name: eq < 0 ? first.trim() : first.slice(0, eq).trim(),
      value: eq < 0 ? '' : first.slice(eq + 1).trim(),
      secure: false, httpOnly: false, sameSite: null, path: null, domain: null,
      maxAge: null, expires: null
    };
    parts.forEach(function (p) {
      var s = p.trim(), k = lower(s), eqi = s.indexOf('=');
      var attr = eqi < 0 ? k : lower(s.slice(0, eqi).trim());
      var val = eqi < 0 ? '' : s.slice(eqi + 1).trim();
      if (attr === 'secure') c.secure = true;
      else if (attr === 'httponly') c.httpOnly = true;
      else if (attr === 'samesite') c.sameSite = val;
      else if (attr === 'path') c.path = val;
      else if (attr === 'domain') c.domain = val;
      else if (attr === 'max-age') c.maxAge = val;
      else if (attr === 'expires') c.expires = val;
    });
    return c;
  }
  H.parseSetCookie = parseSetCookie;

  /**
   * Accepts a parsed HAR object (or a bare {entries:[]}) and returns a trace:
   *   { name, entries:[normalised], warnings:[], bodyCoverage:{...} }
   * Tolerates Chrome / Firefox / Safari / Charles / mitmproxy shape differences.
   */
  function normalise(har, name) {
    var warnings = [];
    var log = (har && har.log) ? har.log : har;
    var rawEntries = (log && log.entries) || [];
    if (!Array.isArray(rawEntries)) { rawEntries = []; warnings.push('no log.entries array found — is this a HAR file?'); }
    var creator = (log && log.creator && log.creator.name) ? String(log.creator.name) : 'unknown';
    var version = (log && log.version) ? String(log.version) : '?';

    var out = [], baseT = null;
    for (var i = 0; i < rawEntries.length; i++) {
      var e = rawEntries[i] || {};
      var req = e.request || {}, res = e.response || {};
      var u = parseUrl(req.url || '');
      var reqHeaders = headerList(req.headers);
      var resHeaders = headerList(res.headers);
      var started = Date.parse(e.startedDateTime);
      if (!isFinite(started)) started = null;
      var total = num(e.time, null);
      var timings = normaliseTimings(e.timings, total);
      if (total == null) total = timings._sum;
      var content = res.content || {};
      var body = bodyOf(content, warnings, i);
      var json = null, jsonError = null;
      if (body.text != null && looksJson(body.mime, body.text)) {
        try { json = JSON.parse(body.text); }
        catch (err) { jsonError = String(err && err.message || err); }
      }
      var reqBodyText = (req.postData && typeof req.postData.text === 'string') ? req.postData.text : null;
      var reqJson = null;
      if (reqBodyText != null && looksJson(lower(req.postData.mimeType || ''), reqBodyText)) {
        try { reqJson = JSON.parse(reqBodyText); } catch (err2) { /* ignore */ }
      }
      var setCookies = headerAll(resHeaders, 'set-cookie').map(parseSetCookie);
      // Some tools only fill response.cookies, not the Set-Cookie header.
      if (!setCookies.length && Array.isArray(res.cookies)) {
        setCookies = res.cookies.map(function (c) {
          return {
            raw: '(from response.cookies)', name: String(c.name || ''), value: String(c.value || ''),
            secure: !!c.secure, httpOnly: !!c.httpOnly, sameSite: c.sameSite || null,
            path: c.path || null, domain: c.domain || null, maxAge: null, expires: c.expires || null
          };
        });
      }
      var cookieHeader = headerGet(reqHeaders, 'cookie');
      var reqCookies = cookieHeader ? parseCookiesHeader(cookieHeader)
        : (Array.isArray(req.cookies) ? req.cookies.map(function (c) { return { name: String(c.name || ''), value: String(c.value || '') }; }) : []);

      var transfer = num(res._transferSize, null);
      if (transfer == null) {
        var bs = num(res.bodySize, -1), hs = num(res.headersSize, -1);
        transfer = (bs > 0 ? bs : 0) + (hs > 0 ? hs : 0);
        if (bs < 0 && body.size > 0) transfer = body.size;
      }

      var ne = {
        i: out.length,
        method: String(req.method || 'GET').toUpperCase(),
        url: String(req.url || ''),
        scheme: u.scheme || (String(req.url || '').indexOf('http://') === 0 ? 'http' : 'https'),
        host: u.hostport || u.host || '(unknown host)',
        bareHost: u.host,
        path: u.path,
        segments: pathSegments(u.path),
        query: u.params,
        status: num(res.status, 0),
        statusText: String(res.statusText || ''),
        httpVersion: lower(res.httpVersion || req.httpVersion || ''),
        serverIP: String(e.serverIPAddress || ''),
        connection: String(e.connection || ''),
        reqHeaders: reqHeaders,
        resHeaders: resHeaders,
        reqCookies: reqCookies,
        setCookies: setCookies,
        mime: body.mime,
        bodyText: body.text,
        bodyMissing: body.missing,
        bodyJson: json,
        bodyJsonError: jsonError,
        bodySize: body.size,
        transferSize: transfer,
        reqBodyText: reqBodyText,
        reqBodyJson: reqJson,
        reqMime: lower((req.postData && req.postData.mimeType) || ''),
        startedMs: started,
        time: num(total, 0),
        timings: timings
      };
      if (started != null && (baseT == null || started < baseT)) baseT = started;
      out.push(ne);
    }

    // Relative offsets. Entries with no timestamp are laid out sequentially so the
    // waterfall still renders instead of collapsing to zero.
    var cursor = 0;
    for (var j = 0; j < out.length; j++) {
      if (out[j].startedMs != null && baseT != null) out[j].offsetMs = out[j].startedMs - baseT;
      else { out[j].offsetMs = cursor; out[j].syntheticTime = true; }
      cursor = out[j].offsetMs + out[j].time;
    }

    var withBody = 0, jsonBodies = 0, missing = 0;
    for (var k = 0; k < out.length; k++) {
      if (out[k].bodyText != null) withBody++;
      if (out[k].bodyJson != null) jsonBodies++;
      if (out[k].bodyMissing) missing++;
    }
    if (missing > 0) {
      warnings.push(missing + ' of ' + out.length + ' responses have no body in the HAR. ' +
        'Re-capture with right-click \u2192 "Save all as HAR with content"; the plain ' +
        '"Save all as HAR" omits response bodies. Schema inference degrades to ' +
        'header-level for those requests.');
    }

    return {
      name: name || (log && log.creator && log.creator.name) || 'trace',
      creator: creator, harVersion: version,
      entries: out,
      warnings: warnings,
      coverage: {
        total: out.length, withBody: withBody, jsonBodies: jsonBodies, missingBody: missing,
        pct: out.length ? Math.round(jsonBodies / out.length * 100) : 0
      }
    };
  }
  H.normalise = normalise;

  root.HARVEST = H;
  if (typeof module !== 'undefined' && module.exports) module.exports = H;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));

/* ============================================================ templater ==
 * Endpoint recovery: a trie over raw path segments, then a top-down
 * literal-vs-parameter decision per sibling set. Every decision records the
 * evidence that produced it so the UI can explain it on hover, and every
 * decision can be overridden by key.
 */
(function (root) {
  'use strict';
  var H = root.HARVEST || {}; root.HARVEST = H;

  var SHAPES = [
    { id: 'uuid', label: 'UUID', strong: true, re: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/ },
    { id: 'ulid', label: 'ULID', strong: true, re: /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/ },
    { id: 'objectid', label: '24-char hex (Mongo ObjectId)', strong: true, re: /^[0-9a-f]{24}$/ },
    { id: 'longhex', label: 'long hex', strong: true, re: /^[0-9a-fA-F]{16,}$/ },
    { id: 'isodate', label: 'ISO date', strong: true, re: /^\d{4}-\d{2}-\d{2}$/ },
    { id: 'jwtish', label: 'JWT-shaped', strong: true, re: /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}$/ },
    { id: 'version', label: 'API version', strong: false, literal: true, re: /^v\d+(\.\d+)?$/i },
    { id: 'numeric', label: 'all digits', strong: false, re: /^\d+$/ },
    { id: 'opaque', label: 'opaque token', strong: false, re: /^(?=.*\d)[A-Za-z0-9_-]{12,}$/ },
    { id: 'slug', label: 'slug', strong: false, re: /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/ },
    { id: 'word', label: 'word', strong: false, re: /^[A-Za-z_][A-Za-z0-9_]*$/ }
  ];

  // Segments that are almost always route literals even though they can look
  // like identifiers. Without this, /users/me/posts is eaten by /users/{userId}/posts.
  var RESERVED = {};
  ('me self current mine my all any new latest default search query filter count summary stats status ' +
    'health healthz _health readiness liveness ping metrics version login logout register refresh token ' +
    'revoke verify confirm reset password profile settings preferences batch bulk import export download ' +
    'upload sync undefined null none true false actions activate deactivate publish unpublish archive ' +
    'restore duplicate clone preview render thumbnail avatar icon feed index list create update delete')
    .split(' ').forEach(function (w) { if (w) RESERVED[w] = true; });

  function shapeOf(seg) {
    for (var i = 0; i < SHAPES.length; i++) if (SHAPES[i].re.test(seg)) return SHAPES[i];
    return { id: 'other', label: 'other', strong: false, re: null };
  }
  H.shapeOf = shapeOf;
  H.RESERVED = RESERVED;

  function singularise(word) {
    var w = String(word || '');
    if (!w) return 'id';
    var lw = w.toLowerCase();
    if (/(ss|us|is)$/.test(lw)) return w;
    if (/ies$/.test(lw)) return w.slice(0, -3) + 'y';
    if (/(ches|shes|xes|zes|sses)$/.test(lw)) return w.slice(0, -2);
    if (/ves$/.test(lw)) return w.slice(0, -3) + 'f';
    if (lw === 'people') return 'person';
    if (lw === 'children') return 'child';
    if (/s$/.test(lw)) return w.slice(0, -1);
    return w;
  }
  H.singularise = singularise;

  function camel(a, b) {
    if (!a) return b;
    return a.replace(/[^A-Za-z0-9]+(.)?/g, function (m, c) { return c ? c.toUpperCase() : ''; }) +
      b.charAt(0).toUpperCase() + b.slice(1);
  }

  function paramName(parentSeg, shapeId) {
    if (shapeId === 'isodate') return 'date';
    if (!parentSeg) return 'id';
    var base = singularise(parentSeg);
    if (!/^[A-Za-z]/.test(base)) return 'id';
    return camel(base, 'id');
  }

  function newNode(seg) {
    return { seg: seg, children: Object.create(null), terminal: [], count: 0 };
  }

  function insert(rootNode, entry) {
    var node = rootNode;
    node.count++;
    for (var i = 0; i < entry.segments.length; i++) {
      var s = entry.segments[i];
      if (!node.children[s]) node.children[s] = newNode(s);
      node = node.children[s];
      node.count++;
    }
    node.terminal.push(entry.i);
    return node;
  }

  function mergeInto(target, src) {
    target.count += src.count;
    for (var t = 0; t < src.terminal.length; t++) target.terminal.push(src.terminal[t]);
    var keys = Object.keys(src.children);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!target.children[k]) target.children[k] = newNode(k);
      mergeInto(target.children[k], src.children[k]);
    }
  }

  /**
   * Decide, for one sibling set, which raw segment values collapse into a
   * parameter. Returns { params: {shapeId: {values:[], reason, confidence, name}},
   *                      literals: [values] }
   */
  function classifySiblings(values, parentSeg, opts) {
    opts = opts || {};
    var byShape = Object.create(null);
    var literals = [];
    var reservedHit = [];
    var i, v, sh;

    for (i = 0; i < values.length; i++) {
      v = values[i];
      if (RESERVED[v.toLowerCase()]) { reservedHit.push(v); literals.push(v); continue; }
      sh = shapeOf(v);
      if (sh.literal) { literals.push(v); continue; }
      if (!byShape[sh.id]) byShape[sh.id] = { shape: sh, values: [] };
      byShape[sh.id].values.push(v);
    }

    var params = Object.create(null);
    var shapeIds = Object.keys(byShape).sort();
    var nonReserved = values.length - reservedHit.length;

    for (i = 0; i < shapeIds.length; i++) {
      var g = byShape[shapeIds[i]];
      var n = g.values.length;
      var decision = null, reason = '', confidence = 'low';

      if (g.shape.strong) {
        decision = 'param';
        confidence = n >= 2 ? 'high' : 'medium';
        reason = n + ' sibling' + (n === 1 ? '' : 's') + ' of ' + g.shape.label + ' shape' +
          (n === 1 ? ' (shape alone is decisive: a route literal is never a ' + g.shape.label + ')' : '');
      } else if (g.shape.id === 'numeric') {
        decision = 'param';
        confidence = n >= 3 ? 'high' : (n >= 2 ? 'medium' : 'low');
        reason = n + ' distinct all-digit sibling' + (n === 1 ? '' : 's') +
          (n === 1 ? ' — single sample, so this is the weakest call the classifier makes' : '');
      } else if (g.shape.id === 'opaque') {
        if (n >= 3) { decision = 'param'; confidence = 'medium'; reason = n + ' distinct opaque tokens (mixed letters+digits, length >= 12) as siblings'; }
        else { decision = 'literal'; reason = 'only ' + n + ' opaque-looking sibling' + (n === 1 ? '' : 's') + ' — below the 3-sibling threshold, kept literal'; }
      } else if (g.shape.id === 'word') {
        // Bare words are route names. Eight sibling words is a normal API surface
        // (/orders /products /customers ...), not a parameter, so this shape never
        // auto-collapses — the human pins it instead.
        decision = 'literal';
        reason = n + ' distinct bare-word sibling' + (n === 1 ? '' : 's') + '. Route names look exactly like this, ' +
          'so word-shaped segments are never collapsed automatically. Click to force a parameter if this really is one.';
      } else {
        // slugs and everything else: collapse only on high cardinality AND
        // id-like usage (each value requested roughly once, not revisited).
        var perValue = 0;
        for (var pv = 0; pv < g.values.length; pv++) perValue += (opts.counts && opts.counts[g.values[pv]]) || 1;
        perValue = perValue / n;
        if (n >= 12 && perValue <= 2) {
          decision = 'param'; confidence = 'medium';
          reason = n + ' distinct ' + g.shape.label + '-shaped siblings, each requested ' + perValue.toFixed(1) +
            ' time(s) on average — high cardinality with no revisiting is identifier-like, not route-like';
        } else {
          decision = 'literal';
          reason = n + ' distinct ' + g.shape.label + '-shaped sibling' + (n === 1 ? '' : 's') +
            ' — kept literal (needs >= 12 distinct values, each requested <= 2x on average, to read as an identifier)';
        }
      }

      if (decision === 'param') {
        params[shapeIds[i]] = {
          shapeId: g.shape.id, shapeLabel: g.shape.label, values: g.values.slice().sort(),
          reason: reason, confidence: confidence, name: paramName(parentSeg, g.shape.id)
        };
      } else {
        // NOT pushed into `literals` here: the caller re-adds them only if the
        // decision survives, so an override to 'param' cannot leave the same
        // values in both the literal and the parameter branch.
        params['!' + shapeIds[i]] = { rejected: true, shapeId: g.shape.id, shapeLabel: g.shape.label, values: g.values.slice().sort(), reason: reason };
      }
    }

    return {
      params: params, literals: literals.sort(), reserved: reservedHit.sort(),
      total: values.length
    };
  }
  H.classifySiblings = classifySiblings;

  function decisionKey(host, tmplSoFar, shapeId) {
    return host + '|/' + tmplSoFar.join('/') + '|' + shapeId;
  }
  H.decisionKey = decisionKey;

  /**
   * templatise(entries, overrides) -> {
   *   endpoints: [ {key, host, template, segments:[{kind,text,decision}], methods:{}, entryIdx:[] } ],
   *   decisions: [ {key, host, prefix, shapeId, kind, reason, confidence, values, name, overridden} ]
   * }
   * overrides: { <decisionKey>: 'literal' | 'param' }
   */
  function templatise(entries, overrides) {
    overrides = overrides || {};
    var byHost = Object.create(null), hosts = [];
    for (var i = 0; i < entries.length; i++) {
      var h = entries[i].host;
      if (!byHost[h]) { byHost[h] = newNode(''); hosts.push(h); }
      insert(byHost[h], entries[i]);
    }
    hosts.sort();

    var endpoints = [], decisions = [];

    function walk(host, node, tmplSegs, parentSeg, uniq) {
      if (node.terminal.length) {
        endpoints.push({
          key: host + ' /' + tmplSegs.map(function (s) { return s.text; }).join('/'),
          host: host,
          template: '/' + tmplSegs.map(function (s) { return s.text; }).join('/'),
          segments: tmplSegs.slice(),
          entryIdx: node.terminal.slice().sort(function (a, b) { return a - b; })
        });
      }
      var kids = Object.keys(node.children).sort();
      if (!kids.length) return;
      var plain = tmplSegs.map(function (s) { return s.text; });
      var counts = Object.create(null);
      for (var kc = 0; kc < kids.length; kc++) counts[kids[kc]] = node.children[kids[kc]].count;
      var cls = classifySiblings(kids, parentSeg, { counts: counts });

      // literals first (deterministic order), then parameter groups by shape id
      var litSet = Object.create(null);
      cls.literals.forEach(function (v) { litSet[v] = true; });

      var shapeIds = Object.keys(cls.params).sort();
      var groups = [];
      for (var s = 0; s < shapeIds.length; s++) {
        var sid = shapeIds[s], p = cls.params[sid];
        var baseId = p.shapeId;
        var key = decisionKey(host, plain, baseId);
        var ov = overrides[key];
        var isParam = !p.rejected;
        if (ov === 'param') isParam = true;
        if (ov === 'literal') isParam = false;
        var rec = {
          key: key, host: host, prefix: '/' + plain.join('/'), shapeId: baseId, shapeLabel: p.shapeLabel,
          reason: p.reason, confidence: p.confidence || 'n/a', values: p.values,
          sampleCount: p.values.length, name: p.name || null,
          kind: isParam ? 'param' : 'literal',
          defaultKind: p.rejected ? 'literal' : 'param',
          overridden: !!ov
        };
        decisions.push(rec);
        if (isParam) groups.push({ rec: rec, values: p.values });
        else p.values.forEach(function (v) { litSet[v] = true; });
      }
      if (cls.reserved.length) {
        decisions.push({
          key: decisionKey(host, plain, 'reserved'), host: host, prefix: '/' + plain.join('/'),
          shapeId: 'reserved', shapeLabel: 'reserved keyword', kind: 'literal', defaultKind: 'literal',
          reason: 'matches the reserved-route list (' + cls.reserved.join(', ') + '), so it is kept literal even next to identifier-shaped siblings',
          confidence: 'high', values: cls.reserved, sampleCount: cls.reserved.length, overridden: false
        });
      }

      // recurse into literals
      Object.keys(litSet).sort().forEach(function (v) {
        var child = node.children[v];
        if (!child) return;
        walk(host, child, tmplSegs.concat([{ kind: 'literal', text: v, decisionKey: null }]), v, uniq);
      });

      // recurse into merged parameter groups
      for (var gi = 0; gi < groups.length; gi++) {
        var grp = groups[gi];
        var merged = newNode('{param}');
        for (var vi = 0; vi < grp.values.length; vi++) {
          var c = node.children[grp.values[vi]];
          if (c) mergeInto(merged, c);
        }
        var nm = grp.rec.name || 'id';
        var used = uniq[nm] || 0;
        var finalName = used ? nm + (used + 1) : nm;
        uniq[nm] = used + 1;
        grp.rec.name = finalName;
        walk(host, merged,
          tmplSegs.concat([{ kind: 'param', text: '{' + finalName + '}', name: finalName, decisionKey: grp.rec.key, shapeId: grp.rec.shapeId }]),
          parentSeg, uniq);
      }
    }

    for (var hi = 0; hi < hosts.length; hi++) walk(hosts[hi], byHost[hosts[hi]], [], null, Object.create(null));

    endpoints.sort(function (a, b) { return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0); });
    decisions.sort(function (a, b) { return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0); });
    // dedupe decisions by key (the same position can be visited once per literal branch)
    var seen = Object.create(null), dedup = [];
    for (var d = 0; d < decisions.length; d++) {
      if (seen[decisions[d].key]) continue;
      seen[decisions[d].key] = true;
      dedup.push(decisions[d]);
    }
    return { endpoints: endpoints, decisions: dedup };
  }
  H.templatise = templatise;

  if (typeof module !== 'undefined' && module.exports) module.exports = H;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));

/* ========================================================= schema lattice ==
 * A join-semilattice over observed JSON values. Every combining operation is
 * addition, min/max or boolean OR, so join is commutative and associative and
 * the canonical output does not depend on the order the bodies arrived in.
 *
 * The two places where naive implementations lose that property are:
 *   - required-ness (must be present-in-k-of-n counting, NOT pairwise key-set
 *     intersection), and
 *   - the caps (enum cardinality, object breadth). Those are resolved from the
 *     size of the *union*, and once tripped they stay tripped, so the outcome is
 *     the same whichever order the samples arrive in.
 */
(function (root) {
  'use strict';
  var H = root.HARVEST || {}; root.HARVEST = H;

  var MAX_DEPTH = 12;
  var ENUM_MAX = 12;
  var DISTINCT_CAP = 40;
  var MAX_PROPS = 64;

  var FORMATS = [
    { id: 'uuid', re: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/ },
    { id: 'date-time', re: /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:?\d{2})?$/ },
    { id: 'date', re: /^\d{4}-\d{2}-\d{2}$/ },
    { id: 'email', re: /^[^@\s]+@[^@\s.]+\.[^@\s]+$/ },
    { id: 'uri', re: /^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/i },
    { id: 'ipv4', re: /^(\d{1,3}\.){3}\d{1,3}$/ }
  ];

  function emptyType() {
    return {
      n: 0, nulls: 0, bool: 0, int: 0, frac: 0, str: 0, arr: 0, obj: 0,
      numMin: null, numMax: null, strMin: null, strMax: null,
      fmt: null, vals: null, valsOverflow: false, distinct: 0,
      props: null, dictLike: false, addl: null,
      items: null, arrLenMin: null, arrLenMax: null,
      depthCapped: false
    };
  }
  H.emptyType = emptyType;

  function minOf(a, b) { return a == null ? b : (b == null ? a : Math.min(a, b)); }
  function maxOf(a, b) { return a == null ? b : (b == null ? a : Math.max(a, b)); }

  function noteValue(t, v) {
    if (t.valsOverflow) return;
    if (!t.vals) t.vals = Object.create(null);
    var k = (typeof v) + ':' + String(v);
    if (t.vals[k] === undefined) {
      if (t.distinct >= DISTINCT_CAP) { t.valsOverflow = true; t.vals = null; return; }
      t.vals[k] = { v: v, c: 0 };
      t.distinct++;
    }
    t.vals[k].c++;
  }

  function noteFormats(t, s) {
    if (!t.fmt) t.fmt = Object.create(null);
    for (var i = 0; i < FORMATS.length; i++) {
      if (FORMATS[i].re.test(s)) t.fmt[FORMATS[i].id] = (t.fmt[FORMATS[i].id] || 0) + 1;
    }
  }

  function foldProps(t) {
    // Collapse a wide object into a dictionary: additionalProperties = join of
    // every value type seen. join is associative+commutative so the fold order
    // does not matter.
    var acc = t.addl || emptyType();
    var keys = Object.keys(t.props);
    for (var i = 0; i < keys.length; i++) acc = join(acc, t.props[keys[i]].t);
    t.addl = acc;
    t.props = null;
    t.dictLike = true;
  }

  function observe(t, value, depth) {
    depth = depth || 0;
    t.n++;
    if (value === null || value === undefined) { t.nulls++; return t; }
    var ty = typeof value;
    if (ty === 'boolean') { t.bool++; noteValue(t, value); return t; }
    if (ty === 'number') {
      if (!isFinite(value)) { t.nulls++; return t; }
      if (Math.floor(value) === value) t.int++; else t.frac++;
      t.numMin = minOf(t.numMin, value); t.numMax = maxOf(t.numMax, value);
      noteValue(t, value);
      return t;
    }
    if (ty === 'string') {
      t.str++;
      t.strMin = minOf(t.strMin, value.length); t.strMax = maxOf(t.strMax, value.length);
      noteFormats(t, value);
      noteValue(t, value);
      return t;
    }
    if (Array.isArray(value)) {
      t.arr++;
      t.arrLenMin = minOf(t.arrLenMin, value.length); t.arrLenMax = maxOf(t.arrLenMax, value.length);
      if (depth >= MAX_DEPTH) { t.depthCapped = true; return t; }
      if (!t.items) t.items = emptyType();
      for (var i = 0; i < value.length; i++) observe(t.items, value[i], depth + 1);
      return t;
    }
    if (ty === 'object') {
      t.obj++;
      if (depth >= MAX_DEPTH) { t.depthCapped = true; return t; }
      var keys = Object.keys(value);
      if (t.dictLike) {
        if (!t.addl) t.addl = emptyType();
        for (var d = 0; d < keys.length; d++) observe(t.addl, value[keys[d]], depth + 1);
        return t;
      }
      if (!t.props) t.props = Object.create(null);
      for (var k = 0; k < keys.length; k++) {
        var name = keys[k];
        if (!t.props[name]) {
          if (Object.keys(t.props).length >= MAX_PROPS) {
            foldProps(t);
            for (var d2 = k; d2 < keys.length; d2++) observe(t.addl, value[keys[d2]], depth + 1);
            return t;
          }
          t.props[name] = { present: 0, t: emptyType() };
        }
        t.props[name].present++;
        observe(t.props[name].t, value[name], depth + 1);
      }
      return t;
    }
    t.nulls++;
    return t;
  }
  H.observe = observe;

  function join(a, b) {
    if (!a) return b ? clone(b) : emptyType();
    if (!b) return clone(a);
    var t = emptyType();
    t.n = a.n + b.n; t.nulls = a.nulls + b.nulls; t.bool = a.bool + b.bool;
    t.int = a.int + b.int; t.frac = a.frac + b.frac; t.str = a.str + b.str;
    t.arr = a.arr + b.arr; t.obj = a.obj + b.obj;
    t.numMin = minOf(a.numMin, b.numMin); t.numMax = maxOf(a.numMax, b.numMax);
    t.strMin = minOf(a.strMin, b.strMin); t.strMax = maxOf(a.strMax, b.strMax);
    t.depthCapped = a.depthCapped || b.depthCapped;

    if (a.fmt || b.fmt) {
      t.fmt = Object.create(null);
      [a.fmt, b.fmt].forEach(function (f) {
        if (!f) return;
        Object.keys(f).forEach(function (k) { t.fmt[k] = (t.fmt[k] || 0) + f[k]; });
      });
    }

    if (a.valsOverflow || b.valsOverflow) { t.valsOverflow = true; t.vals = null; t.distinct = DISTINCT_CAP + 1; }
    else {
      t.vals = Object.create(null); t.distinct = 0;
      [a.vals, b.vals].forEach(function (m) {
        if (!m || t.valsOverflow) return;
        Object.keys(m).forEach(function (k) {
          if (t.valsOverflow) return;
          if (t.vals[k] === undefined) {
            if (t.distinct >= DISTINCT_CAP) { t.valsOverflow = true; t.vals = null; return; }
            t.vals[k] = { v: m[k].v, c: 0 }; t.distinct++;
          }
          t.vals[k].c += m[k].c;
        });
      });
      if (t.valsOverflow) t.distinct = DISTINCT_CAP + 1;
    }

    if (a.items || b.items) t.items = join(a.items, b.items);
    t.arrLenMin = minOf(a.arrLenMin, b.arrLenMin); t.arrLenMax = maxOf(a.arrLenMax, b.arrLenMax);

    var aDict = a.dictLike, bDict = b.dictLike;
    if (aDict || bDict) {
      t.dictLike = true;
      var acc = null;
      [a, b].forEach(function (x) {
        if (x.dictLike) acc = join(acc, x.addl);
        else if (x.props) Object.keys(x.props).forEach(function (k) { acc = join(acc, x.props[k].t); });
      });
      t.addl = acc || emptyType();
      t.props = null;
    } else if (a.props || b.props) {
      t.props = Object.create(null);
      var names = {};
      if (a.props) Object.keys(a.props).forEach(function (k) { names[k] = true; });
      if (b.props) Object.keys(b.props).forEach(function (k) { names[k] = true; });
      var all = Object.keys(names);
      if (all.length > MAX_PROPS) {
        var acc2 = null;
        for (var i = 0; i < all.length; i++) {
          var pa = a.props && a.props[all[i]], pb = b.props && b.props[all[i]];
          acc2 = join(acc2, join(pa ? pa.t : null, pb ? pb.t : null));
        }
        t.addl = acc2 || emptyType(); t.props = null; t.dictLike = true;
      } else {
        for (var j = 0; j < all.length; j++) {
          var nm = all[j];
          var xa = a.props && a.props[nm], xb = b.props && b.props[nm];
          t.props[nm] = {
            present: (xa ? xa.present : 0) + (xb ? xb.present : 0),
            t: join(xa ? xa.t : null, xb ? xb.t : null)
          };
        }
      }
    }
    return t;
  }
  H.joinType = join;

  function clone(t) { return join(t, emptyType()); }

  /* ------------------------------------------------------- canonical form */

  function enumValues(t) {
    if (t.valsOverflow || !t.vals) return null;
    var keys = Object.keys(t.vals);
    if (keys.length < 2 || keys.length > ENUM_MAX) return null;
    var scalarCount = t.str + t.int + t.frac + t.bool;
    if (scalarCount < keys.length * 2) return null;   // needs repetition, not just variety
    var vals = keys.map(function (k) { return t.vals[k].v; });
    var allStr = vals.every(function (v) { return typeof v === 'string'; });
    var allNum = vals.every(function (v) { return typeof v === 'number'; });
    if (!allStr && !allNum) return null;
    if (allStr && vals.some(function (v) { return v.length > 48; })) return null;
    vals.sort(function (x, y) { return x < y ? -1 : (x > y ? 1 : 0); });
    return vals;
  }

  function formatOf(t) {
    if (!t.fmt || !t.str) return null;
    var best = null;
    var keys = Object.keys(t.fmt).sort();
    for (var i = 0; i < keys.length; i++) {
      if (t.fmt[keys[i]] === t.str) { best = keys[i]; break; }
    }
    return best;
  }

  /** Deterministic JSON-Schema (2020-12 / OpenAPI 3.1) rendering of a type. */
  function toSchema(t, opts) {
    opts = opts || {};
    if (!t || t.n === 0) return {};
    var types = [];
    if (t.bool) types.push('boolean');
    if (t.int && !t.frac) types.push('integer');
    else if (t.int || t.frac) types.push('number');
    if (t.str) types.push('string');
    if (t.arr) types.push('array');
    if (t.obj) types.push('object');
    var nullable = t.nulls > 0;

    var s = {};
    if (!types.length) {
      if (nullable) s.type = 'null';
      return s;
    }
    if (types.length === 1) s.type = nullable ? [types[0], 'null'] : types[0];
    else s.type = nullable ? types.concat(['null']) : types.slice();

    if (t.str) {
      var f = formatOf(t);
      if (f) s.format = f;
    }
    var en = enumValues(t);
    if (en && types.length === 1 && (types[0] === 'string' || types[0] === 'integer' || types[0] === 'number')) {
      s.enum = nullable ? en.concat([null]) : en;
    }
    if (types.indexOf('object') >= 0) {
      if (t.dictLike) {
        s.additionalProperties = toSchema(t.addl, opts);
        if (opts.annotate) s['x-harvest-note'] = 'dictionary-shaped: more than ' + MAX_PROPS + ' distinct keys observed';
      } else if (t.props) {
        var names = Object.keys(t.props).sort();
        var props = {}, required = [];
        for (var i = 0; i < names.length; i++) {
          var p = t.props[names[i]];
          var sub = toSchema(p.t, opts);
          if (opts.annotate) sub['x-harvest-presence'] = p.present + '/' + t.obj;
          props[names[i]] = sub;
          if (p.present === t.obj && t.obj > 0) required.push(names[i]);
        }
        s.properties = props;
        if (required.length) s.required = required;
      }
    }
    if (types.indexOf('array') >= 0) s.items = t.items ? toSchema(t.items, opts) : {};
    if (t.depthCapped && opts.annotate) s['x-harvest-note'] = 'nesting deeper than ' + MAX_DEPTH + ' levels was not modelled';
    return s;
  }
  H.toSchema = toSchema;

  /** Canonical (sorted-key) JSON string — used for structural hashing and tests. */
  function canonicalJson(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
    if (typeof v === 'object') {
      var keys = Object.keys(v).sort();
      return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + canonicalJson(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v);
  }
  H.canonicalJson = canonicalJson;

  function hashString(s) {
    // FNV-1a, 32-bit, rendered hex. Plenty for de-duplicating schema shapes.
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  H.hashString = hashString;

  H.SCHEMA_LIMITS = { MAX_DEPTH: MAX_DEPTH, ENUM_MAX: ENUM_MAX, DISTINCT_CAP: DISTINCT_CAP, MAX_PROPS: MAX_PROPS };

  if (typeof module !== 'undefined' && module.exports) module.exports = H;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));

/* ============================================ statistics + endpoint model == */
(function (root) {
  'use strict';
  var H = root.HARVEST || {}; root.HARVEST = H;

  /** Nearest-rank percentile: rank = ceil(p/100 * n), 1-indexed into the sorted array. */
  function percentile(sortedAsc, p) {
    var n = sortedAsc.length;
    if (!n) return null;
    var rank = Math.ceil((p / 100) * n);
    if (rank < 1) rank = 1;
    if (rank > n) rank = n;
    return sortedAsc[rank - 1];
  }
  H.percentile = percentile;

  function stats(values) {
    var v = values.slice().sort(function (a, b) { return a - b; });
    var n = v.length;
    if (!n) return { n: 0 };
    var sum = 0;
    for (var i = 0; i < n; i++) sum += v[i];
    return {
      n: n, min: v[0], max: v[n - 1], mean: sum / n,
      p50: percentile(v, 50), p90: percentile(v, 90), p95: percentile(v, 95), p99: percentile(v, 99),
      // A p99 from fewer than 100 samples is just the max wearing a hat.
      p99Trustworthy: n >= 100, p95Trustworthy: n >= 20, sorted: v
    };
  }
  H.stats = stats;

  var IDEMPOTENT = { GET: 1, HEAD: 1, PUT: 1, DELETE: 1, OPTIONS: 1, TRACE: 1 };
  H.isIdempotent = function (m) { return !!IDEMPOTENT[String(m || '').toUpperCase()]; };

  function buildEndpoints(trace, overrides) {
    var entries = trace.entries;
    var t = H.templatise(entries, overrides);
    var eps = [];
    for (var i = 0; i < t.endpoints.length; i++) {
      var ep = t.endpoints[i];
      var ops = Object.create(null), methods = [];
      for (var j = 0; j < ep.entryIdx.length; j++) {
        var e = entries[ep.entryIdx[j]];
        var m = e.method;
        if (!ops[m]) {
          ops[m] = {
            method: m, entryIdx: [], times: [], statuses: Object.create(null),
            reqType: null, respTypes: Object.create(null), queryParams: Object.create(null),
            bodiesSeen: 0, bodiesMissing: 0, reqBodiesSeen: 0
          };
          methods.push(m);
        }
        var op = ops[m];
        op.entryIdx.push(e.i);
        op.times.push(e.time);
        var sc = String(e.status);
        if (!op.statuses[sc]) op.statuses[sc] = { code: e.status, count: 0, entryIdx: [] };
        op.statuses[sc].count++;
        op.statuses[sc].entryIdx.push(e.i);

        if (e.bodyJson !== null && e.bodyJson !== undefined) {
          if (!op.respTypes[sc]) op.respTypes[sc] = H.emptyType();
          H.observe(op.respTypes[sc], e.bodyJson, 0);
          op.bodiesSeen++;
        } else if (e.bodyMissing) op.bodiesMissing++;

        if (e.reqBodyJson !== null && e.reqBodyJson !== undefined) {
          if (!op.reqType) op.reqType = H.emptyType();
          H.observe(op.reqType, e.reqBodyJson, 0);
          op.reqBodiesSeen++;
        }

        var seenNames = Object.create(null);
        for (var q = 0; q < e.query.length; q++) {
          var qp = e.query[q];
          if (!op.queryParams[qp.name]) op.queryParams[qp.name] = { name: qp.name, count: 0, examples: [], type: H.emptyType() };
          var rec = op.queryParams[qp.name];
          if (!seenNames[qp.name]) { rec.count++; seenNames[qp.name] = true; }
          if (rec.examples.length < 5 && rec.examples.indexOf(qp.value) < 0) rec.examples.push(qp.value);
          H.observe(rec.type, /^-?\d+(\.\d+)?$/.test(qp.value) ? Number(qp.value) : qp.value, 0);
        }
      }
      methods.sort();
      for (var mi = 0; mi < methods.length; mi++) {
        var o = ops[methods[mi]];
        o.latency = stats(o.times);
        o.reqCount = o.entryIdx.length;
        var errs = 0, srv = 0, cli = 0;
        Object.keys(o.statuses).forEach(function (k) {
          var c = o.statuses[k].code;
          if (c >= 500) { srv += o.statuses[k].count; errs += o.statuses[k].count; }
          else if (c >= 400) { cli += o.statuses[k].count; errs += o.statuses[k].count; }
        });
        o.errorCount = errs; o.serverErrors = srv; o.clientErrors = cli;
        o.errorRate = o.reqCount ? errs / o.reqCount : 0;
        Object.keys(o.queryParams).forEach(function (k) {
          var p = o.queryParams[k];
          p.required = p.count === o.reqCount && o.reqCount > 0;
          p.presence = p.count + '/' + o.reqCount;
          // sorted, so the emitted spec does not depend on request order
          p.examples.sort();
        });
      }
      ep.ops = ops; ep.methods = methods;
      ep.reqCount = ep.entryIdx.length;
      var allTimes = [];
      for (var z = 0; z < ep.entryIdx.length; z++) allTimes.push(entries[ep.entryIdx[z]].time);
      ep.latency = stats(allTimes);
      eps.push(ep);
    }
    return { endpoints: eps, decisions: t.decisions };
  }
  H.buildEndpoints = buildEndpoints;

  /** Peak requests-per-second over the trace's own timestamps (1s sliding window). */
  function peakRps(entries) {
    if (!entries.length) return 0;
    var starts = entries.map(function (e) { return e.offsetMs; }).sort(function (a, b) { return a - b; });
    var best = 0, lo = 0;
    for (var hi = 0; hi < starts.length; hi++) {
      while (starts[hi] - starts[lo] > 1000) lo++;
      var w = hi - lo + 1;
      if (w > best) best = w;
    }
    return best;
  }
  H.peakRps = peakRps;

  /** Concurrency profile + HTTP/1.1 head-of-line analysis, per host. */
  function concurrency(entries) {
    var events = [];
    entries.forEach(function (e) {
      events.push({ t: e.offsetMs, d: 1, host: e.host, i: e.i });
      events.push({ t: e.offsetMs + e.time, d: -1, host: e.host, i: e.i });
    });
    events.sort(function (a, b) { return a.t - b.t || a.d - b.d; });
    var cur = 0, peak = 0, perHost = Object.create(null);
    events.forEach(function (ev) {
      cur += ev.d;
      if (cur > peak) peak = cur;
      var h = perHost[ev.host] || (perHost[ev.host] = { cur: 0, peak: 0, http1: false });
      h.cur += ev.d;
      if (h.cur > h.peak) h.peak = h.cur;
    });
    entries.forEach(function (e) {
      var h = perHost[e.host];
      if (h && /^http\/1/.test(e.httpVersion)) h.http1 = true;
    });
    // Longest strictly serialised chain: each request starts after the previous ends.
    var byStart = entries.slice().sort(function (a, b) { return a.offsetMs - b.offsetMs || a.time - b.time; });
    var chain = [], best = [];
    for (var i = 0; i < byStart.length; i++) {
      var e = byStart[i];
      if (chain.length && e.offsetMs >= (chain[chain.length - 1].offsetMs + chain[chain.length - 1].time - 5)) chain.push(e);
      else { if (chain.length > best.length) best = chain; chain = [e]; }
    }
    if (chain.length > best.length) best = chain;
    var chainMs = 0;
    best.forEach(function (e) { chainMs += e.time; });
    return { peak: peak, perHost: perHost, longestChain: best.map(function (e) { return e.i; }), longestChainMs: chainMs };
  }
  H.concurrency = concurrency;

  if (typeof module !== 'undefined' && module.exports) module.exports = H;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));

/* ================================================ N+1 correlator ==
 * Links cause to effect without a trace id: id-shaped values are pulled out of
 * response bodies at arbitrary depth, indexed by value, then matched against the
 * path and query values of *later* requests. A finding only fires when several
 * distinct children of one parent hit the SAME endpoint template inside a time
 * window - one coincidental match is not fan-out.
 */
(function (root) {
  'use strict';
  var H = root.HARVEST || {}; root.HARVEST = H;

  var STRONG_ID = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{24}|[0-9a-fA-F]{16,}|[0-7][0-9A-HJKMNP-TV-Z]{25})$/;
  var ID_KEY = /(^|[_.-])(id|uuid|guid|key|ref)$|Id$|_id$/;

  function extractIds(value, key, depth, out) {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length && i < 500; i++) extractIds(value[i], key, depth + 1, out);
      return;
    }
    if (typeof value === 'object') {
      var keys = Object.keys(value);
      for (var k = 0; k < keys.length && k < 200; k++) extractIds(value[keys[k]], keys[k], depth + 1, out);
      return;
    }
    var keyed = key && ID_KEY.test(key);
    if (typeof value === 'number') {
      if (keyed && Math.floor(value) === value && value >= 0) out[String(value)] = true;
      return;
    }
    if (typeof value === 'string') {
      if (value.length < 2 || value.length > 128) return;
      if (STRONG_ID.test(value)) { out[value] = true; return; }
      if (keyed && /^[A-Za-z0-9_.:-]{2,}$/.test(value)) out[value] = true;
    }
  }

  function correlateNPlusOne(entries, entryToEndpoint, opts) {
    opts = opts || {};
    var windowMs = opts.windowMs || 30000;
    var minFanout = opts.minFanout || 3;
    var index = Object.create(null);   // value -> [{i, at}]

    for (var p = 0; p < entries.length; p++) {
      var e = entries[p];
      if (e.bodyJson == null) continue;
      var ids = Object.create(null);
      extractIds(e.bodyJson, null, 0, ids);
      var vals = Object.keys(ids);
      if (vals.length > 2000) vals = vals.slice(0, 2000);
      for (var v = 0; v < vals.length; v++) {
        (index[vals[v]] || (index[vals[v]] = [])).push({ i: e.i, at: e.offsetMs });
      }
    }

    var groups = Object.create(null);
    for (var c = 0; c < entries.length; c++) {
      var child = entries[c];
      var cands = [];
      for (var s = 0; s < child.segments.length; s++) cands.push(child.segments[s]);
      for (var q = 0; q < child.query.length; q++) if (child.query[q].value) cands.push(child.query[q].value);
      var matched = null;
      for (var ci = 0; ci < cands.length; ci++) {
        var hits = index[cands[ci]];
        if (!hits) continue;
        for (var hi = hits.length - 1; hi >= 0; hi--) {
          var h = hits[hi];
          if (h.i === child.i) continue;
          if (h.at > child.offsetMs) continue;
          if (child.offsetMs - h.at > windowMs) continue;
          if (!matched || h.at > matched.at) matched = { i: h.i, at: h.at, value: cands[ci] };
          break;
        }
      }
      if (!matched) continue;
      var tmpl = entryToEndpoint[child.i];
      if (!tmpl) continue;
      var gk = matched.i + ' ' + tmpl;
      if (!groups[gk]) groups[gk] = { parent: matched.i, template: tmpl, children: [], values: Object.create(null) };
      groups[gk].children.push(child.i);
      groups[gk].values[matched.value] = true;
    }

    var out = [];
    Object.keys(groups).sort().forEach(function (k) {
      var g = groups[k];
      var distinct = Object.keys(g.values).length;
      if (g.children.length >= minFanout && distinct >= minFanout) {
        g.children.sort(function (a, b) { return a - b; });
        out.push({ parent: g.parent, template: g.template, children: g.children, distinctIds: distinct });
      }
    });
    out.sort(function (a, b) { return b.children.length - a.children.length || a.parent - b.parent; });
    return out;
  }
  H.correlateNPlusOne = correlateNPlusOne;
  H.extractIdsForTest = function (v) { var o = Object.create(null); extractIds(v, null, 0, o); return Object.keys(o).sort(); };

  if (typeof module !== 'undefined' && module.exports) module.exports = H;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));

/* ================================================== JWT (decode only) == */
(function (root) {
  'use strict';
  var H = root.HARVEST || {}; root.HARVEST = H;

  var JWT_RE = /^([A-Za-z0-9_-]{4,})\.([A-Za-z0-9_-]{4,})\.([A-Za-z0-9_-]*)$/;
  H.JWT_RE = JWT_RE;

  /**
   * Decode a JWT locally. This NEVER verifies the signature: verification needs
   * the signing key, which this page does not have and will not ask for.
   */
  function decodeJwt(token) {
    var t = String(token || '').trim();
    var m = JWT_RE.exec(t);
    if (!m) return null;
    var head = null, payload = null, err = null;
    try { head = JSON.parse(H.b64urlDecode(m[1])); } catch (e) { err = 'header is not JSON'; }
    try { payload = JSON.parse(H.b64urlDecode(m[2])); } catch (e2) { err = err || 'payload is not JSON'; }
    if (!head || !payload) return null;
    var now = Math.floor(Date.now() / 1000);
    var alg = String(head.alg == null ? '' : head.alg);
    var out = {
      raw: t, header: head, payload: payload, alg: alg,
      signaturePresent: !!m[3], signatureVerified: false, error: err,
      exp: typeof payload.exp === 'number' ? payload.exp : null,
      iat: typeof payload.iat === 'number' ? payload.iat : null,
      nbf: typeof payload.nbf === 'number' ? payload.nbf : null,
      issues: []
    };
    if (/^none$/i.test(alg)) out.issues.push({ id: 'alg-none', severity: 'critical', text: 'alg is "none" - the token is unsigned and anyone can forge one.' });
    if (!head.alg) out.issues.push({ id: 'alg-missing', severity: 'high', text: 'no alg header.' });
    if (out.exp == null) out.issues.push({ id: 'no-exp', severity: 'medium', text: 'no exp claim - this token never expires on its own.' });
    else if (out.exp < now) out.issues.push({ id: 'expired', severity: 'low', text: 'already expired (exp ' + new Date(out.exp * 1000).toISOString() + ') - fine in an old capture, a bug if it is live.' });
    if (out.exp != null && out.iat != null) {
      var life = out.exp - out.iat;
      out.lifetimeSec = life;
      if (life > 7 * 86400) out.issues.push({ id: 'long-life', severity: 'medium', text: 'lifetime is ' + Math.round(life / 86400) + ' days - a stolen access token stays valid that long.' });
    }
    if (!out.signaturePresent) out.issues.push({ id: 'no-sig', severity: 'high', text: 'empty signature segment.' });
    return out;
  }
  H.decodeJwt = decodeJwt;

  if (typeof module !== 'undefined' && module.exports) module.exports = H;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));

/* ==================================================== findings engine ==
 * Five families - caching, auth, design, efficiency, concurrency - plus the
 * edge/security family salvaged from the WAF design. Every rule carries the
 * request indices that triggered it, why it matters, the fix, and an explicit
 * "heuristic" flag where the rule is a judgement call rather than a fact.
 */
(function (root) {
  'use strict';
  var H = root.HARVEST || {}; root.HARVEST = H;

  var SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  H.SEV_ORDER = SEV_ORDER;

  function lower(s) { return String(s == null ? '' : s).toLowerCase(); }

  function parseCacheControl(v) {
    var out = { raw: v || '', directives: Object.create(null), maxAge: null, noStore: false, noCache: false, isPrivate: false, immutable: false };
    if (!v) return out;
    String(v).split(',').forEach(function (part) {
      var p = part.trim();
      if (!p) return;
      var eq = p.indexOf('=');
      if (eq < 0) out.directives[lower(p)] = true;
      else out.directives[lower(p.slice(0, eq).trim())] = p.slice(eq + 1).trim().replace(/^"|"$/g, '');
    });
    out.maxAge = out.directives['max-age'] !== undefined ? parseInt(out.directives['max-age'], 10) : null;
    out.noStore = !!out.directives['no-store'];
    out.noCache = !!out.directives['no-cache'];
    out.isPrivate = !!out.directives['private'];
    out.immutable = !!out.directives['immutable'];
    return out;
  }
  H.parseCacheControl = parseCacheControl;

  var SECRETY_PARAM = /^(api[_-]?key|apikey|access[_-]?token|auth[_-]?token|id[_-]?token|refresh[_-]?token|token|key|secret|password|passwd|pwd|signature|sig|sso|session|sessionid|jwt|bearer|client[_-]?secret)$/i;
  var SECRETY_VALUE = /^(sk_live_|sk_test_|pk_live_|ghp_|gho_|github_pat_|xox[baprs]-|AKIA|ASIA|AIza)/;
  var HASHED_ASSET = /\.[0-9a-f]{8,}\.(js|css|png|jpe?g|gif|svg|woff2?|ttf)$/i;
  var TEXTY = /(json|javascript|text|xml|html|css|svg)/;

  function uniqueStrings(list) {
    var seen = Object.create(null), out = [];
    for (var i = 0; i < list.length; i++) {
      if (seen[list[i]]) continue;
      seen[list[i]] = true;
      out.push(list[i]);
    }
    return out;
  }

  function fnd(o) {
    o.evidence = (o.evidence || []).slice(0, 40);
    o.heuristic = !!o.heuristic;
    return o;
  }

  function bearerOf(entry) {
    var a = H.headerGet(entry.reqHeaders, 'authorization');
    if (!a) return null;
    var m = /^\s*(bearer|token|jwt)\s+(\S+)/i.exec(a);
    return m ? m[2] : null;
  }
  H.bearerOf = bearerOf;

  function findings(trace, model) {
    var entries = trace.entries;
    var out = [];
    var i, e;

    /* ---------------------------------------------------- transport / auth */

    var httpReqs = [], authOverHttp = [];
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (e.scheme === 'http') {
        httpReqs.push(e.i);
        if (H.headerGet(e.reqHeaders, 'authorization') || e.reqCookies.length) authOverHttp.push(e.i);
      }
    }
    if (authOverHttp.length) {
      out.push(fnd({
        id: 'auth-over-http', family: 'auth', severity: 'critical',
        title: 'Credentials sent over plaintext http://',
        detail: authOverHttp.length + ' request(s) carried an Authorization header or cookies over http://.',
        why: 'Anything on the path - proxy, coffee-shop AP, ISP - reads the credential verbatim. TLS is the only control that stops this.',
        fix: 'Serve the API over https only, redirect http to https with HSTS (Strict-Transport-Security: max-age=31536000; includeSubDomains), and rotate anything captured in this trace.',
        evidence: authOverHttp
      }));
    } else if (httpReqs.length) {
      out.push(fnd({
        id: 'plaintext-http', family: 'auth', severity: 'high',
        title: 'Plaintext http:// requests in the trace',
        detail: httpReqs.length + ' request(s) used http://.',
        why: 'Even without credentials, plaintext responses are readable and rewritable in flight.',
        fix: 'Redirect to https and add HSTS.',
        evidence: httpReqs
      }));
    }

    var secretParams = [];
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      for (var q = 0; q < e.query.length; q++) {
        var p = e.query[q];
        if (SECRETY_PARAM.test(p.name) || SECRETY_VALUE.test(p.value) || H.JWT_RE.test(p.value)) {
          secretParams.push({ i: e.i, name: p.name, value: p.value });
          break;
        }
      }
    }
    if (secretParams.length) {
      out.push(fnd({
        id: 'token-in-query', family: 'auth', severity: 'high',
        title: 'Credential in the query string',
        detail: secretParams.length + ' request(s) put a secret-looking parameter in the URL (' +
          secretParams.slice(0, 4).map(function (s) { return s.name; }).join(', ') + ').',
        why: 'URLs land in access logs, browser history, Referer headers and error trackers. A token in a query string is a token you have already leaked to every log aggregator you own.',
        fix: 'Move it to the Authorization header (or a Secure; HttpOnly cookie), then rotate the key that appears in this trace.',
        evidence: secretParams.map(function (s) { return s.i; })
      }));
    }

    // Same bearer token seen against more than one host.
    var tokenHosts = Object.create(null);
    for (i = 0; i < entries.length; i++) {
      var tok = bearerOf(entries[i]);
      if (!tok) continue;
      var rec = tokenHosts[tok] || (tokenHosts[tok] = { hosts: Object.create(null), idx: [] });
      rec.hosts[entries[i].host] = true;
      rec.idx.push(entries[i].i);
    }
    var reused = [];
    Object.keys(tokenHosts).forEach(function (t) {
      if (Object.keys(tokenHosts[t].hosts).length > 1) {
        reused.push({ token: t, hosts: Object.keys(tokenHosts[t].hosts).sort(), idx: tokenHosts[t].idx });
      }
    });
    if (reused.length) {
      out.push(fnd({
        id: 'token-cross-host', family: 'auth', severity: 'high',
        title: 'One bearer token sent to multiple hosts',
        detail: reused.map(function (r) { return r.hosts.join(' + '); }).join('; '),
        why: 'A token scoped to one audience is being handed to another origin. Whichever host is weaker becomes the theft point for both, and the aud claim (if any) is not being honoured.',
        fix: 'Issue per-audience tokens, set and check aud, and never attach the API token to requests going anywhere else.',
        evidence: reused.reduce(function (a, r) { return a.concat(r.idx); }, [])
      }));
    }

    // Cookie flags.
    var badCookies = [];
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      for (var c = 0; c < e.setCookies.length; c++) {
        var ck = e.setCookies[c];
        var missing = [];
        if (!ck.secure) missing.push('Secure');
        if (!ck.httpOnly) missing.push('HttpOnly');
        if (!ck.sameSite) missing.push('SameSite');
        if (missing.length) badCookies.push({ i: e.i, name: ck.name, missing: missing });
      }
    }
    if (badCookies.length) {
      var sev = badCookies.some(function (b) { return b.missing.indexOf('Secure') >= 0 || b.missing.indexOf('HttpOnly') >= 0; }) ? 'high' : 'medium';
      out.push(fnd({
        id: 'cookie-flags', family: 'auth', severity: sev,
        title: 'Set-Cookie missing hardening flags',
        detail: badCookies.slice(0, 6).map(function (b) { return b.name + ' (no ' + b.missing.join(', no ') + ')'; }).join('; ') +
          (badCookies.length > 6 ? ' and ' + (badCookies.length - 6) + ' more' : ''),
        why: 'No HttpOnly means any XSS reads the session. No Secure means it rides plaintext. No SameSite means it is attached to cross-site requests, which is the CSRF precondition.',
        fix: 'Set-Cookie: <name>=<v>; Secure; HttpOnly; SameSite=Lax (or Strict), Path=/, and a short Max-Age.',
        evidence: badCookies.map(function (b) { return b.i; })
      }));
    }

    // JWTs found anywhere in the trace.
    var jwts = [];
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      var cands = [];
      var auth = bearerOf(e);
      if (auth) cands.push({ where: 'Authorization header', token: auth });
      e.reqCookies.forEach(function (ck) { if (H.JWT_RE.test(ck.value)) cands.push({ where: 'Cookie ' + ck.name, token: ck.value }); });
      e.query.forEach(function (qp) { if (H.JWT_RE.test(qp.value)) cands.push({ where: 'query param ' + qp.name, token: qp.value }); });
      e.setCookies.forEach(function (ck) { if (H.JWT_RE.test(ck.value)) cands.push({ where: 'Set-Cookie ' + ck.name, token: ck.value }); });
      for (var cj = 0; cj < cands.length; cj++) {
        var dec = H.decodeJwt(cands[cj].token);
        if (dec) jwts.push({ i: e.i, where: cands[cj].where, jwt: dec });
      }
    }
    var seenTok = Object.create(null), uniqueJwts = [];
    jwts.forEach(function (j) { if (!seenTok[j.jwt.raw]) { seenTok[j.jwt.raw] = true; uniqueJwts.push(j); } });
    ['alg-none', 'no-exp', 'long-life', 'no-sig', 'alg-missing'].forEach(function (issueId) {
      var hits = jwts.filter(function (j) { return j.jwt.issues.some(function (x) { return x.id === issueId; }); });
      if (!hits.length) return;
      var first = hits[0].jwt.issues.filter(function (x) { return x.id === issueId; })[0];
      out.push(fnd({
        id: 'jwt-' + issueId, family: 'auth', severity: first.severity,
        title: 'JWT: ' + first.text.split(' - ')[0].replace(/\.$/, ''),
        detail: first.text + ' Seen in: ' + uniqueStrings(hits.map(function (h) { return h.where; })).slice(0, 3).join(', ') + '.',
        why: 'Decoded locally from the token itself. The signature is NOT checked - that needs the signing key.',
        fix: issueId === 'alg-none'
          ? 'Pin the accepted algorithms server-side and reject alg=none outright.'
          : (issueId === 'long-life'
            ? 'Shorten access-token lifetime to minutes and use a refresh token you can revoke.'
            : 'Always set exp, and verify it server-side.'),
        evidence: hits.map(function (h) { return h.i; })
      }));
    });

    /* --------------------------------------------------------- caching */

    var byUrl = Object.create(null);
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (e.method !== 'GET' || e.status !== 200) continue;
      (byUrl[e.url] || (byUrl[e.url] = [])).push(e);
    }
    var refetched = [], wasted = 0;
    Object.keys(byUrl).sort().forEach(function (u) {
      var list = byUrl[u];
      if (list.length < 2) return;
      var f = list[0];
      var cc = parseCacheControl(H.headerGet(f.resHeaders, 'cache-control'));
      var validator = H.headerGet(f.resHeaders, 'etag') || H.headerGet(f.resHeaders, 'last-modified');
      if ((cc.maxAge && cc.maxAge > 0) || validator) return;
      refetched.push({ url: u, n: list.length, idx: list.map(function (x) { return x.i; }) });
      for (var k = 1; k < list.length; k++) wasted += list[k].transferSize || 0;
    });
    if (refetched.length) {
      out.push(fnd({
        id: 'refetch-uncacheable', family: 'caching', severity: 'medium',
        title: 'Identical GETs refetched with nothing to cache on',
        detail: refetched.length + ' URL(s) were fetched more than once inside this trace with no max-age and no ETag/Last-Modified. Roughly ' +
          Math.round(wasted / 1024) + ' KB of transfer was spent re-downloading bytes the client already had.',
        why: 'Without a freshness lifetime or a validator the client cannot reuse or revalidate; every repeat is a full round trip and a full payload.',
        fix: 'Emit an ETag (or Last-Modified) so repeats become conditional 304s, and add a Cache-Control max-age that matches how stale the data may be.',
        evidence: refetched.reduce(function (a, r) { return a.concat(r.idx); }, []),
        extra: { wastedBytes: wasted, urls: refetched.slice(0, 10) }
      }));
    }

    var noCacheHeaders = [];
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (e.method !== 'GET' || e.status !== 200) continue;
      var cc2 = H.headerGet(e.resHeaders, 'cache-control');
      var val2 = H.headerGet(e.resHeaders, 'etag') || H.headerGet(e.resHeaders, 'last-modified');
      if (!cc2 && !val2 && !H.headerGet(e.resHeaders, 'expires')) noCacheHeaders.push(e.i);
    }
    if (noCacheHeaders.length) {
      out.push(fnd({
        id: 'no-cache-directives', family: 'caching', severity: 'low', heuristic: true,
        title: 'Successful GETs with no caching directives at all',
        detail: noCacheHeaders.length + ' of ' + entries.length + ' responses carry neither Cache-Control, Expires, ETag nor Last-Modified.',
        why: 'Cache behaviour then falls to heuristic freshness in each intermediary, which is unpredictable and differs between browser, CDN and proxy. Being explicit - even Cache-Control: no-store - is better than being silent.',
        fix: 'Decide per endpoint: no-store for anything user-specific and sensitive, private, max-age=N for per-user data, public, max-age=N for shared data, plus an ETag everywhere you can compute one cheaply.',
        evidence: noCacheHeaders
      }));
    }

    var immutableNoStore = [], varyStar = [];
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      var cc3 = parseCacheControl(H.headerGet(e.resHeaders, 'cache-control'));
      if (cc3.noStore && HASHED_ASSET.test(e.path)) immutableNoStore.push(e.i);
      var vary = H.headerGet(e.resHeaders, 'vary');
      if (vary && vary.trim() === '*') varyStar.push(e.i);
    }
    if (immutableNoStore.length) {
      out.push(fnd({
        id: 'nostore-on-immutable', family: 'caching', severity: 'low',
        title: 'no-store on content-hashed (immutable) assets',
        detail: immutableNoStore.length + ' asset(s) have a content hash in the filename but are served no-store.',
        why: 'A hashed filename can never change contents, so it is the one thing that is safe to cache forever. no-store throws that away and pays for it on every page load.',
        fix: 'Cache-Control: public, max-age=31536000, immutable for hashed assets.',
        evidence: immutableNoStore
      }));
    }
    if (varyStar.length) {
      out.push(fnd({
        id: 'vary-star', family: 'caching', severity: 'low',
        title: 'Vary: *',
        detail: varyStar.length + ' response(s) send Vary: *.',
        why: 'Vary: * makes every response uncacheable by any shared cache, permanently. It is almost always a copy-paste rather than a decision.',
        fix: 'List the headers the response actually varies on (Accept-Encoding, Accept-Language, Authorization), or drop the header.',
        evidence: varyStar
      }));
    }

    var uncompressed = [];
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (e.status !== 200) continue;
      if (!TEXTY.test(e.mime)) continue;
      if ((e.bodySize || 0) < 65536) continue;
      if (H.headerGet(e.resHeaders, 'content-encoding')) continue;
      uncompressed.push(e.i);
    }
    if (uncompressed.length) {
      out.push(fnd({
        id: 'uncompressed', family: 'caching', severity: 'medium',
        title: 'Large text responses served uncompressed',
        detail: uncompressed.length + ' response(s) over 64 KB of JSON/text with no Content-Encoding.',
        why: 'JSON compresses 6-10x. Skipping it is the cheapest latency and egress-cost regression there is.',
        fix: 'Enable gzip/brotli at the edge for application/json and text/*, above a small size threshold.',
        evidence: uncompressed
      }));
    }

    /* ---------------------------------------------------------- design */

    var errorBody200 = [];
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (e.status < 200 || e.status >= 300) continue;
      var b = e.bodyJson;
      if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
      var hasErr = (b.error !== undefined && b.error !== null && b.error !== false) ||
        (Array.isArray(b.errors) && b.errors.length > 0) ||
        (b.success === false) || (b.ok === false) ||
        (typeof b.status === 'string' && /^(error|fail(ed|ure)?)$/i.test(b.status));
      if (hasErr) errorBody200.push(e.i);
    }
    if (errorBody200.length) {
      out.push(fnd({
        id: 'error-body-200', family: 'design', severity: 'high',
        title: 'HTTP 200 carrying an error body',
        detail: errorBody200.length + ' response(s) returned 2xx with an error payload.',
        why: 'Every layer between the client and the server - retries, circuit breakers, CDN caching, alerting, the client SDK - keys off the status code. A 200 that means "failed" is invisible to all of them, so failures do not appear in error rates and get cached as successes.',
        fix: 'Return the status the outcome deserves (400/404/409/422/500) and put the machine-readable detail in the body, e.g. RFC 9457 application/problem+json.',
        evidence: errorBody200
      }));
    }

    var noRetryAfter = [];
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (e.status !== 429 && e.status !== 503) continue;
      if (!H.headerGet(e.resHeaders, 'retry-after')) noRetryAfter.push(e.i);
    }
    if (noRetryAfter.length) {
      out.push(fnd({
        id: 'no-retry-after', family: 'design', severity: 'medium',
        title: '429/503 without Retry-After',
        detail: noRetryAfter.length + ' throttled or unavailable response(s) gave the client no backoff hint.',
        why: 'Without Retry-After every client invents its own backoff, and the common invention is "immediately". That is how a rate limit turns into a retry storm that keeps the service down.',
        fix: 'Always send Retry-After (seconds or an HTTP date) on 429 and 503, and pair it with X-RateLimit-Remaining/Reset so clients can pace themselves before they get blocked.',
        evidence: noRetryAfter
      }));
    }

    var serverErrors = [];
    for (i = 0; i < entries.length; i++) if (entries[i].status >= 500) serverErrors.push(entries[i].i);
    if (serverErrors.length) {
      out.push(fnd({
        id: 'server-errors', family: 'design', severity: 'high',
        title: 'Server errors (5xx) in the trace',
        detail: serverErrors.length + ' response(s) returned 5xx.',
        why: 'These are the requests the service failed to serve at all.',
        fix: 'Trace each one server-side; a 5xx visible in a user-facing capture is by definition user-visible.',
        evidence: serverErrors
      }));
    }

    // Pagination idiom drift.
    var idioms = Object.create(null);
    var PAGINATION = [
      { id: 'page/per_page', re: /^(page|per_page|perpage|page_size|pagesize)$/i },
      { id: 'limit/offset', re: /^(limit|offset|skip|take)$/i },
      { id: 'cursor', re: /^(cursor|after|before|next_token|page_token|continuation)$/i }
    ];
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      for (var qq = 0; qq < e.query.length; qq++) {
        for (var pi = 0; pi < PAGINATION.length; pi++) {
          if (PAGINATION[pi].re.test(e.query[qq].name)) {
            (idioms[PAGINATION[pi].id] || (idioms[PAGINATION[pi].id] = [])).push(e.i);
          }
        }
      }
    }
    var idiomKeys = Object.keys(idioms).sort();
    if (idiomKeys.length > 1) {
      out.push(fnd({
        id: 'pagination-drift', family: 'design', severity: 'low', heuristic: true,
        title: 'Mixed pagination idioms across the API',
        detail: 'This trace uses ' + idiomKeys.join(' and ') + '.',
        why: 'Every client then needs one pagination implementation per idiom, and the SDK, the docs and the retry logic all fork. Consistency here is worth more than picking the theoretically best scheme.',
        fix: 'Pick one - cursor pagination if the data mutates under the reader - and migrate the rest behind the same parameter names.',
        evidence: idiomKeys.reduce(function (a, k) { return a.concat(idioms[k].slice(0, 6)); }, []),
        extra: { idioms: idiomKeys }
      }));
    }

    // Field casing drift across response bodies.
    var casing = { snake: 0, camel: 0, kebab: 0, snakeIdx: [], camelIdx: [] };
    function walkKeys(v, depth, idx) {
      if (!v || typeof v !== 'object' || depth > 4) return;
      if (Array.isArray(v)) { for (var a = 0; a < v.length && a < 20; a++) walkKeys(v[a], depth + 1, idx); return; }
      var ks = Object.keys(v);
      for (var k2 = 0; k2 < ks.length && k2 < 60; k2++) {
        var key = ks[k2];
        if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(key)) { casing.snake++; if (casing.snakeIdx.indexOf(idx) < 0) casing.snakeIdx.push(idx); }
        else if (/^[a-z]+([A-Z][a-z0-9]*)+$/.test(key)) { casing.camel++; if (casing.camelIdx.indexOf(idx) < 0) casing.camelIdx.push(idx); }
        else if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(key)) casing.kebab++;
        walkKeys(v[key], depth + 1, idx);
      }
    }
    for (i = 0; i < entries.length; i++) if (entries[i].bodyJson) walkKeys(entries[i].bodyJson, 0, entries[i].i);
    if (casing.snake > 0 && casing.camel > 0) {
      out.push(fnd({
        id: 'casing-drift', family: 'design', severity: 'low', heuristic: true,
        title: 'Response field casing is inconsistent',
        detail: casing.snake + ' snake_case and ' + casing.camel + ' camelCase field names appear across the responses in this trace.',
        why: 'Consumers end up hand-mapping fields per endpoint, and generated clients produce two naming conventions in one type system. It is a small thing that leaks into every consumer forever.',
        fix: 'Pick one convention, apply it at the serialisation layer, and keep the old names as aliases for one deprecation window.',
        evidence: casing.snakeIdx.slice(0, 8).concat(casing.camelIdx.slice(0, 8))
      }));
    }

    // POST used for reads.
    var postReads = [];
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (e.method !== 'POST') continue;
      if (/\b(search|query|list|find|fetch|get|lookup|filter)\b/i.test(e.path) && (!e.reqBodyText || e.reqBodyText.length < 512)) postReads.push(e.i);
    }
    if (postReads.length) {
      out.push(fnd({
        id: 'post-for-read', family: 'design', severity: 'low', heuristic: true,
        title: 'POST apparently used for a read',
        detail: postReads.length + ' POST request(s) to search/list-shaped paths with a small or empty body.',
        why: 'A read done as POST is uncacheable, unsafe to retry automatically, and invisible to any read-only replica routing. Sometimes it is the right call (long query bodies); often it is not.',
        fix: 'Use GET where the request is a read and the parameters fit in a URL. If they genuinely do not, keep POST but document it and set Cache-Control: no-store deliberately.',
        evidence: postReads
      }));
    }

    /* ----------------------------------------------------- efficiency */

    if (model.nplus1 && model.nplus1.length) {
      model.nplus1.forEach(function (g) {
        out.push(fnd({
          id: 'n-plus-1:' + g.parent + ':' + g.template, family: 'efficiency', severity: 'high', heuristic: true,
          title: 'N+1 fan-out: ' + g.children.length + ' calls to ' + g.template,
          detail: 'Request #' + g.parent + ' returned ' + g.distinctIds + ' identifiers which then appear one-by-one in ' +
            g.children.length + ' subsequent requests to ' + g.template + '.',
          why: 'The client is paying ' + g.children.length + ' round trips for data one call could have returned. On a mobile network that is ' +
            g.children.length + ' x RTT of dead time, and on the server it is ' + g.children.length + ' times the connection, auth and query overhead.',
          fix: 'Add a batch endpoint (?ids=a,b,c), embed the child objects in the parent response (?include=), or expose a field-selection/GraphQL-style projection. Correlation is by value matching, so confirm against your own code before acting.',
          evidence: [g.parent].concat(g.children)
        }));
      });
    }

    var dupes = [];
    var dupMap = Object.create(null);
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      var k3 = e.method + ' ' + e.url;
      (dupMap[k3] || (dupMap[k3] = [])).push(e.i);
    }
    Object.keys(dupMap).sort().forEach(function (k) {
      if (dupMap[k].length >= 3) dupes.push({ key: k, idx: dupMap[k] });
    });
    if (dupes.length) {
      out.push(fnd({
        id: 'duplicate-requests', family: 'efficiency', severity: 'medium',
        title: 'The same request repeated 3+ times',
        detail: dupes.length + ' distinct URL(s) were requested 3 or more times, e.g. ' + dupes[0].key.slice(0, 90) + ' (' + dupes[0].idx.length + 'x).',
        why: 'Usually a component mounting more than once, an unmemoised effect, or two features fetching the same resource independently. It multiplies backend load for zero user-visible benefit.',
        fix: 'De-duplicate in-flight requests in the data layer (a request cache keyed by URL), and give the response a cache lifetime so repeats are free.',
        evidence: dupes.reduce(function (a, d) { return a.concat(d.idx); }, [])
      }));
    }

    /* ---------------------------------------------------- concurrency */

    var conc = model.concurrency;
    if (conc) {
      Object.keys(conc.perHost).sort().forEach(function (h) {
        var ph = conc.perHost[h];
        if (ph.http1 && ph.peak >= 6) {
          var hostIdx = [];
          for (var hx = 0; hx < entries.length; hx++) if (entries[hx].host === h) hostIdx.push(entries[hx].i);
          out.push(fnd({
            id: 'http1-hol:' + h, family: 'concurrency', severity: 'medium',
            title: 'HTTP/1.1 connection limit reached on ' + h,
            detail: 'Peak of ' + ph.peak + ' concurrent requests to an HTTP/1.1 origin.',
            why: 'Browsers open at most six connections per HTTP/1.1 origin, so beyond that requests queue behind each other and the queueing time shows up as latency nobody can find in server metrics.',
            fix: 'Enable HTTP/2 or HTTP/3 on this origin. Domain sharding is the old workaround and it is strictly worse than h2.',
            evidence: hostIdx
          }));
        }
      });
      if (conc.longestChain.length >= 4) {
        out.push(fnd({
          id: 'serial-chain', family: 'concurrency', severity: 'medium', heuristic: true,
          title: 'Serialised request chain of ' + conc.longestChain.length + ' calls',
          detail: conc.longestChain.length + ' requests ran strictly one after another, totalling ' + Math.round(conc.longestChainMs) + ' ms of wall clock.',
          why: 'Each request in the chain waits for the previous response, so the user pays the sum of the latencies rather than the maximum. This is the single biggest lever on perceived speed.',
          fix: 'Identify which of these actually depend on the previous response. Fire the independent ones in parallel, and collapse genuine dependencies into one server-side call.',
          evidence: conc.longestChain
        }));
      }
    }

    var ttfbHeavy = [];
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (e.time < 300 || e.timings._synthetic) continue;
      if (e.timings.wait / e.time > 0.8) ttfbHeavy.push(e.i);
    }
    if (ttfbHeavy.length >= 3) {
      out.push(fnd({
        id: 'ttfb-heavy', family: 'concurrency', severity: 'info',
        title: 'Slow responses are server think-time, not transfer',
        detail: ttfbHeavy.length + ' request(s) over 300 ms spent more than 80% of their time waiting for the first byte.',
        why: 'The bottleneck is server-side work (query, upstream call, cold start), not bandwidth. Compressing or shrinking the payload will not help these.',
        fix: 'Profile the handler itself. The usual causes are an unindexed query, a synchronous upstream call, or a cold serverless instance.',
        evidence: ttfbHeavy
      }));
    }

    /* ------------------------------------------- edge / security headers */

    var noHsts = [], noNosniff = [], disclosure = [], noFrameOpts = [];
    var httpsHosts = Object.create(null);
    for (i = 0; i < entries.length; i++) {
      e = entries[i];
      if (e.status === 0) continue;
      if (e.scheme === 'https' && !H.headerGet(e.resHeaders, 'strict-transport-security')) {
        if (!httpsHosts[e.host]) { httpsHosts[e.host] = true; noHsts.push(e.i); }
      }
      if (!H.headerGet(e.resHeaders, 'x-content-type-options')) noNosniff.push(e.i);
      var srv = H.headerGet(e.resHeaders, 'server') || '';
      var pby = H.headerGet(e.resHeaders, 'x-powered-by') || '';
      if (/\d+\.\d+/.test(srv) || pby) disclosure.push({ i: e.i, v: (srv || pby) });
      if (/text\/html/.test(e.mime) && !H.headerGet(e.resHeaders, 'x-frame-options') && !/frame-ancestors/i.test(H.headerGet(e.resHeaders, 'content-security-policy') || '')) noFrameOpts.push(e.i);
    }
    if (noHsts.length) {
      out.push(fnd({
        id: 'no-hsts', family: 'edge', severity: 'medium',
        title: 'HTTPS responses without Strict-Transport-Security',
        detail: noHsts.length + ' host(s) served https without HSTS.',
        why: 'Without HSTS the very first navigation (and any manually typed http:// URL) is downgradeable, which is the whole opening for an SSL-strip.',
        fix: 'Strict-Transport-Security: max-age=31536000; includeSubDomains - and preload once you are certain every subdomain is https.',
        evidence: noHsts
      }));
    }
    if (noNosniff.length >= Math.max(3, entries.length * 0.5)) {
      out.push(fnd({
        id: 'no-nosniff', family: 'edge', severity: 'low',
        title: 'Missing X-Content-Type-Options: nosniff',
        detail: noNosniff.length + ' of ' + entries.length + ' responses omit it.',
        why: 'Without nosniff a browser may MIME-sniff a response into a type you did not intend - the classic path from "user-uploaded file" to "executed script".',
        fix: 'Set X-Content-Type-Options: nosniff globally at the edge.',
        evidence: noNosniff
      }));
    }
    if (disclosure.length) {
      out.push(fnd({
        id: 'version-disclosure', family: 'edge', severity: 'low',
        title: 'Server software version disclosed',
        detail: 'e.g. "' + disclosure[0].v + '" on ' + disclosure.length + ' response(s).',
        why: 'Not a vulnerability by itself, but it hands a scanner an exact version to match against a CVE list, which is free reconnaissance.',
        fix: 'server_tokens off in nginx, or strip Server/X-Powered-By at the edge.',
        evidence: disclosure.map(function (d) { return d.i; })
      }));
    }
    if (noFrameOpts.length) {
      out.push(fnd({
        id: 'no-frame-ancestors', family: 'edge', severity: 'low',
        title: 'HTML responses framable by any origin',
        detail: noFrameOpts.length + ' HTML response(s) with neither X-Frame-Options nor CSP frame-ancestors.',
        why: 'Clickjacking: an attacker frames the page invisibly over their own UI and harvests real clicks.',
        fix: "Content-Security-Policy: frame-ancestors 'none' (or 'self').",
        evidence: noFrameOpts
      }));
    }

    out.sort(function (a, b) {
      var d = SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
      if (d) return d;
      if (a.family !== b.family) return a.family < b.family ? -1 : 1;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    return { findings: out, jwts: uniqueJwts };
  }
  H.findings = findings;

  if (typeof module !== 'undefined' && module.exports) module.exports = H;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));

/* ============================================ OpenAPI 3.1 + YAML emitter ==
 * Emit-only. There is no YAML parser anywhere in this lab, so there is no YAML
 * dependency: writing YAML is string concatenation, reading it would not be.
 */
(function (root) {
  'use strict';
  var H = root.HARVEST || {}; root.HARVEST = H;

  var PLAIN_SCALAR = /^[A-Za-z0-9_][A-Za-z0-9_ .\/,()#+-]*$/;
  var RESERVED_SCALAR = /^(y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|null|Null|NULL|~)$/;

  function yamlScalar(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return isFinite(v) ? String(v) : 'null';
    var s = String(v);
    if (s === '') return "''";
    if (RESERVED_SCALAR.test(s)) return JSON.stringify(s);
    if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return JSON.stringify(s);
    if (!PLAIN_SCALAR.test(s) || /\s$/.test(s) || /^\s/.test(s)) return JSON.stringify(s);
    return s;
  }

  function yamlKey(k) {
    var s = String(k);
    // Response codes must stay strings: a bare 200 is an integer key in YAML.
    if (/^-?\d+(\.\d+)?$/.test(s)) return JSON.stringify(s);
    if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(s)) return s;
    return JSON.stringify(s);
  }

  function emitYaml(value, indent) {
    indent = indent || 0;
    var pad = new Array(indent + 1).join('  ');
    var lines = [];
    if (Array.isArray(value)) {
      if (!value.length) return pad + '[]\n';
      for (var i = 0; i < value.length; i++) {
        var v = value[i];
        if (v !== null && typeof v === 'object') {
          var sub = emitYaml(v, indent + 1);
          var subLines = sub.replace(/\n$/, '').split('\n');
          lines.push(pad + '- ' + subLines[0].slice((indent + 1) * 2));
          for (var s = 1; s < subLines.length; s++) lines.push(subLines[s]);
        } else {
          lines.push(pad + '- ' + yamlScalar(v));
        }
      }
      return lines.join('\n') + '\n';
    }
    if (value !== null && typeof value === 'object') {
      var keys = Object.keys(value);
      if (!keys.length) return pad + '{}\n';
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k], val = value[key];
        if (val !== null && typeof val === 'object') {
          if (Array.isArray(val) && !val.length) { lines.push(pad + yamlKey(key) + ': []'); continue; }
          if (!Array.isArray(val) && !Object.keys(val).length) { lines.push(pad + yamlKey(key) + ': {}'); continue; }
          lines.push(pad + yamlKey(key) + ':');
          lines.push(emitYaml(val, indent + 1).replace(/\n$/, ''));
        } else {
          lines.push(pad + yamlKey(key) + ': ' + yamlScalar(val));
        }
      }
      return lines.join('\n') + '\n';
    }
    return pad + yamlScalar(value) + '\n';
  }
  H.emitYaml = emitYaml;

  function pascal(s) {
    var parts = String(s || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
    if (!parts.length) return 'Schema';
    return parts.map(function (p) { return p.charAt(0).toUpperCase() + p.slice(1); }).join('');
  }

  function eligible(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
    if (node.$ref) return false;
    var t = node.type;
    var isObj = t === 'object' || (Array.isArray(t) && t.indexOf('object') >= 0);
    return isObj && node.properties && Object.keys(node.properties).length >= 2;
  }

  /**
   * Hoist structurally identical object schemas into components/schemas.
   * Two passes: a Merkle hash over the original trees (so a hash is stable no
   * matter where the node sits), then a post-order substitution that replaces
   * children before parents, so a hoisted component can itself contain $refs.
   */
  function hoistRefs(roots) {
    var hashOf = new Map();
    var counts = Object.create(null);
    var hints = Object.create(null);

    function hashNode(node, hint) {
      if (node === null || typeof node !== 'object') return JSON.stringify(node);
      if (Array.isArray(node)) return '[' + node.map(function (n) { return hashNode(n, hint); }).join(',') + ']';
      var keys = Object.keys(node).sort();
      var parts = [];
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var childHint = (k === 'properties' || k === 'items' || k === 'additionalProperties') ? hint : hint;
        parts.push(JSON.stringify(k) + ':' + hashChild(node[k], k, hint));
      }
      var sig = '{' + parts.join(',') + '}';
      var h = H.hashString(sig);
      hashOf.set(node, h);
      if (eligible(node)) {
        counts[h] = (counts[h] || 0) + 1;
        if (hints[h] === undefined) hints[h] = hint;
      }
      return h;
    }
    function hashChild(v, key, hint) {
      if (v === null || typeof v !== 'object') return JSON.stringify(v);
      if (Array.isArray(v)) return '[' + v.map(function (x) { return hashChild(x, key, hint); }).join(',') + ']';
      if (key === 'properties') {
        var ks = Object.keys(v).sort(), out = [];
        for (var i = 0; i < ks.length; i++) out.push(JSON.stringify(ks[i]) + ':' + hashNode(v[ks[i]], ks[i]));
        return '{' + out.join(',') + '}';
      }
      if (key === 'items') return hashNode(v, H.singularise(hint || 'item'));
      return hashNode(v, hint);
    }

    var rootKeys = Object.keys(roots).sort();
    for (var r = 0; r < rootKeys.length; r++) hashNode(roots[rootKeys[r]].schema, roots[rootKeys[r]].hint);

    var hoist = Object.create(null);
    Object.keys(counts).forEach(function (h) { if (counts[h] >= 2) hoist[h] = true; });

    var components = {}, nameByHash = Object.create(null), usedNames = Object.create(null);

    function nameFor(h) {
      if (nameByHash[h]) return nameByHash[h];
      var base = pascal(hints[h] || 'Schema') || 'Schema';
      if (!/^[A-Za-z]/.test(base)) base = 'Schema' + base;
      var name = base, n = 2;
      while (usedNames[name]) { name = base + n; n++; }
      usedNames[name] = true;
      nameByHash[h] = name;
      return name;
    }

    function substitute(node) {
      if (node === null || typeof node !== 'object') return node;
      if (Array.isArray(node)) return node.map(substitute);
      var h = hashOf.get(node);
      var keys = Object.keys(node);
      for (var i = 0; i < keys.length; i++) node[keys[i]] = substitute(node[keys[i]]);
      if (h && hoist[h] && eligible(node)) {
        var nm = nameFor(h);
        if (!components[nm]) components[nm] = node;
        return { $ref: '#/components/schemas/' + nm };
      }
      return node;
    }

    for (var r2 = 0; r2 < rootKeys.length; r2++) {
      roots[rootKeys[r2]].schema = substitute(roots[rootKeys[r2]].schema);
    }
    var sortedComponents = {};
    Object.keys(components).sort().forEach(function (k) { sortedComponents[k] = components[k]; });
    return { components: sortedComponents, hoisted: Object.keys(sortedComponents).length };
  }
  H.hoistRefs = hoistRefs;

  var STATUS_TEXT = {
    200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently',
    302: 'Found', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found', 409: 'Conflict', 422: 'Unprocessable Content', 429: 'Too Many Requests',
    500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout'
  };

  /** Build an OpenAPI 3.1 draft for one host from the endpoint model. */
  function buildOpenApi(model, trace, host) {
    var eps = model.endpoints.filter(function (e) { return e.host === host; });
    var roots = Object.create(null);
    var paths = {};
    var bodyDerived = 0, headerOnly = 0;

    eps.forEach(function (ep) {
      var item = {};
      ep.methods.forEach(function (m) {
        var op = ep.ops[m];
        var opObj = {
          summary: m + ' ' + ep.template,
          operationId: (m.toLowerCase() + ep.template.replace(/[^A-Za-z0-9]+/g, '_')).replace(/_+$/, ''),
          'x-harvest-observations': op.reqCount
        };
        var params = [];
        ep.segments.forEach(function (seg) {
          if (seg.kind !== 'param') return;
          params.push({
            name: seg.name, 'in': 'path', required: true,
            description: 'inferred from ' + (seg.shapeId || 'token') + '-shaped path segments',
            schema: { type: 'string' }
          });
        });
        Object.keys(op.queryParams).sort().forEach(function (qn) {
          var qp = op.queryParams[qn];
          var sch = H.toSchema(qp.type, {});
          if (!sch.type) sch = { type: 'string' };
          if (Array.isArray(sch.type)) sch.type = sch.type[0];
          params.push({
            name: qn, 'in': 'query', required: !!qp.required,
            description: 'observed in ' + qp.presence + ' requests',
            schema: sch,
            examples: qp.examples.slice(0, 2).reduce(function (acc, v, ix) { acc['e' + (ix + 1)] = { value: v }; return acc; }, {})
          });
        });
        if (params.length) opObj.parameters = params;

        if (op.reqType && op.reqBodiesSeen) {
          var rk = 'req|' + ep.template + '|' + m;
          roots[rk] = { schema: H.toSchema(op.reqType, {}), hint: H.singularise(lastLiteral(ep)) + 'Request' };
          opObj.requestBody = { required: true, content: { 'application/json': { schema: { 'x-harvest-root': rk } } } };
        }

        var responses = {};
        Object.keys(op.statuses).sort().forEach(function (code) {
          var st = op.statuses[code];
          var resp = { description: (STATUS_TEXT[st.code] || 'observed') + ' - seen ' + st.count + 'x' };
          var t = op.respTypes[code];
          if (t) {
            var key = 'res|' + ep.template + '|' + m + '|' + code;
            roots[key] = { schema: H.toSchema(t, {}), hint: hintFor(ep, m, st.code) };
            resp.content = { 'application/json': { schema: { 'x-harvest-root': key } } };
            bodyDerived++;
          } else {
            resp['x-harvest-note'] = 'no response body was present in the HAR for this status, so the shape is unknown';
            headerOnly++;
          }
          responses[String(st.code)] = resp;
        });
        opObj.responses = responses;
        item[m.toLowerCase()] = opObj;
      });
      paths[ep.template] = item;
    });

    var hoisted = hoistRefs(roots);

    // Splice the resolved root schemas back into the paths object.
    function splice(node) {
      if (!node || typeof node !== 'object') return node;
      if (Array.isArray(node)) return node.map(splice);
      if (node['x-harvest-root']) {
        var r = roots[node['x-harvest-root']];
        return r ? r.schema : {};
      }
      Object.keys(node).forEach(function (k) { node[k] = splice(node[k]); });
      return node;
    }
    splice(paths);

    var sortedPaths = {};
    Object.keys(paths).sort().forEach(function (p) { sortedPaths[p] = paths[p]; });

    var schemeCounts = Object.create(null);
    for (var i = 0; i < trace.entries.length; i++) {
      if (trace.entries[i].host !== host) continue;
      var sc = trace.entries[i].scheme || 'https';
      schemeCounts[sc] = (schemeCounts[sc] || 0) + 1;
    }
    var scheme = Object.keys(schemeCounts).sort(function (a, b) {
      return schemeCounts[b] - schemeCounts[a] || (a < b ? -1 : 1);
    })[0] || 'https';

    var doc = {
      openapi: '3.1.0',
      info: {
        title: host + ' (recovered from traffic)',
        version: '0.1.0-draft',
        description: 'DRAFT recovered by HARvest from ' + trace.entries.length + ' recorded requests. ' +
          'Path templates are heuristic; schemas describe only what was observed. Review before committing.'
      },
      servers: [{ url: scheme + '://' + host }],
      paths: sortedPaths
    };
    if (hoisted.hoisted) doc.components = { schemas: hoisted.components };

    var total = bodyDerived + headerOnly;
    return {
      doc: doc,
      yaml: emitYaml(doc, 0),
      json: JSON.stringify(doc, null, 2),
      coverage: {
        bodyDerived: bodyDerived, headerOnly: headerOnly, total: total,
        pct: total ? Math.round(bodyDerived / total * 100) : 0,
        hoisted: hoisted.hoisted
      }
    };
  }

  function lastLiteral(ep) {
    for (var i = ep.segments.length - 1; i >= 0; i--) if (ep.segments[i].kind === 'literal') return ep.segments[i].text;
    return 'resource';
  }
  function hintFor(ep, method, code) {
    var base = H.singularise(lastLiteral(ep));
    if (code >= 400) return base + 'Error';
    if (ep.segments.length && ep.segments[ep.segments.length - 1].kind === 'literal' && method === 'GET') return base + 'List';
    return base;
  }
  H.buildOpenApi = buildOpenApi;

  if (typeof module !== 'undefined' && module.exports) module.exports = H;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));

/* =============================================== top-level orchestrator == */
(function (root) {
  'use strict';
  var H = root.HARVEST || {}; root.HARVEST = H;

  function analyze(trace, opts) {
    opts = opts || {};
    var model = H.buildEndpoints(trace, opts.overrides || {});
    var entryToEndpoint = Object.create(null);
    model.endpoints.forEach(function (ep) {
      ep.entryIdx.forEach(function (i) { entryToEndpoint[i] = ep.key; });
    });
    var nplus1 = H.correlateNPlusOne(trace.entries, entryToEndpoint, {});
    var conc = H.concurrency(trace.entries);
    var f = H.findings(trace, { endpoints: model.endpoints, nplus1: nplus1, concurrency: conc });

    var hosts = Object.create(null);
    trace.entries.forEach(function (e) { hosts[e.host] = (hosts[e.host] || 0) + 1; });
    var hostList = Object.keys(hosts).sort(function (a, b) { return hosts[b] - hosts[a] || (a < b ? -1 : 1); });

    var times = trace.entries.map(function (e) { return e.time; });
    var span = 0;
    trace.entries.forEach(function (e) { span = Math.max(span, e.offsetMs + e.time); });

    return {
      trace: trace,
      endpoints: model.endpoints,
      decisions: model.decisions,
      entryToEndpoint: entryToEndpoint,
      nplus1: nplus1,
      concurrency: conc,
      findings: f.findings,
      jwts: f.jwts,
      hosts: hostList,
      hostCounts: hosts,
      overall: {
        requests: trace.entries.length,
        endpoints: model.endpoints.length,
        hosts: hostList.length,
        spanMs: span,
        peakRps: H.peakRps(trace.entries),
        latency: H.stats(times),
        totalBytes: trace.entries.reduce(function (a, e) { return a + (e.transferSize || 0); }, 0),
        errorRate: trace.entries.length
          ? trace.entries.filter(function (e) { return e.status >= 400; }).length / trace.entries.length : 0
      },
      coverage: trace.coverage
    };
  }
  H.analyze = analyze;

  /** Timeout + retry budget derived from measured percentiles. */
  function budgetFor(op) {
    var s = op.latency;
    if (!s || !s.n) return null;
    var base = s.p99 != null ? s.p99 : s.max;
    var timeout = Math.max(250, Math.ceil((base * 1.5) / 50) * 50);
    var idem = H.isIdempotent(op.method);
    return {
      method: op.method,
      n: s.n,
      p99: s.p99,
      timeoutMs: timeout,
      basis: 'p99 (' + Math.round(s.p99) + ' ms) x 1.5, rounded up to 50 ms' + (s.p99Trustworthy ? '' : ' - n=' + s.n + ', below 100 samples, so treat p99 as "the slowest thing we saw"'),
      retries: idem ? 2 : 0,
      retryOn: idem ? '502, 503, 504, 429 and connect/timeout errors only' : 'nothing',
      retryNote: idem
        ? 'Idempotent, so a retry cannot duplicate work. Use exponential backoff with full jitter and honour Retry-After.'
        : op.method + ' is not idempotent. Retrying it can create duplicate records. Do not retry without an Idempotency-Key that the server deduplicates on.',
      amplification: idem ? (1 + 2) : 1,
      worstCaseMs: idem ? timeout * 3 : timeout
    };
  }
  H.budgetFor = budgetFor;

  if (typeof module !== 'undefined' && module.exports) module.exports = H;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
