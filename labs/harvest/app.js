/* HARvest - app.js
 * UI only. Every computation lives in analyze.js / edge.js, which is what makes
 * the engines testable in the Tests tab and in node.
 *
 * No inline scripts anywhere on the page, so the CSP can be script-src 'self'
 * with no 'unsafe-inline'.
 */
(function () {
  'use strict';

  var H = window.HARVEST;

  /* ------------------------------------------------------------ storage */
  // localStorage throws outright where site data is blocked. The CV shipped that
  // bug once and it blanked the whole page; nothing here may depend on a read.
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  /* ---------------------------------------------------------- DOM helpers */

  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        if (k === 'class') el.className = props[k];
        else if (k === 'text') el.textContent = props[k];
        else if (k === 'html') el.innerHTML = props[k];      // literals only, never user data
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), props[k]);
        else if (k === 'style') Object.keys(props[k]).forEach(function (s) { el.style[s] = props[k][s]; });
        else if (props[k] === true) el.setAttribute(k, '');
        else if (props[k] !== false && props[k] != null) el.setAttribute(k, props[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x != null && x !== false) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  function $(id) { return document.getElementById(id); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function ms(v) {
    if (v == null) return '—';
    if (v >= 10000) return (v / 1000).toFixed(1) + ' s';
    if (v >= 1000) return (v / 1000).toFixed(2) + ' s';
    if (v >= 100) return Math.round(v) + ' ms';
    return (Math.round(v * 10) / 10) + ' ms';
  }
  function bytes(n) {
    if (!n) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function pct(v) { return Math.round(v * 100) + '%'; }
  // "1 findings" is the kind of thing a reviewer notices before anything else.
  function plural(n, word, pluralWord) { return n + ' ' + (n === 1 ? word : (pluralWord || word + 's')); }

  /* -------------------------------------------------------------- state */

  var state = {
    har: null,
    name: '',
    result: null,
    overrides: load('harvest.overrides', {}) || {},
    redact: load('harvest.redact', true) !== false,
    specHost: null,
    specFormat: 'yaml',
    filter: '',
    traceNote: '',
    openRow: null,
    highlight: null,
    engine: 'pending',
    engineNote: '',
    rate: { key: 'hostTemplate', limit: 5, windowMs: 1000, blockMs: 10000, result: null },
    cidrs: '10.0.0.0/8\n192.168.0.0/16\n203.0.113.0/24\n2001:db8::/32\nfe80::/10',
    ipInput: '203.0.113.77'
  };

  /* ------------------------------------------------------ egress counter */

  function paintNet() {
    var g = window.HARVEST_GUARD;
    var n = g ? g.total() : 0;
    $('netCount').textContent = 'network calls from this page: ' + n;
    $('netBadge').className = 'netbadge' + (n ? ' bad' : '');
  }
  if (window.HARVEST_GUARD) window.HARVEST_GUARD.onchange = paintNet;
  paintNet();

  /* -------------------------------------------------------------- theme */

  function currentTheme() { return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  function paintThemeBtn() { $('themeBtn').textContent = currentTheme() === 'light' ? 'Dark' : 'Light'; }
  $('themeBtn').addEventListener('click', function () {
    var next = currentTheme() === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    // Raw string, NOT save(): save() JSON-encodes, and guard.js (plus the CV's own
    // index.html) reads this key raw. Both keys are written so the preference
    // travels in both directions between the lab and the CV.
    try {
      localStorage.setItem('harvest.theme', next);
      localStorage.setItem('theme', next);
    } catch (e) { /* site data blocked - the toggle still works for this pageview */ }
    paintThemeBtn();
  });
  paintThemeBtn();

  /* --------------------------------------------------------------- tabs */

  var TABS = ['trace', 'endpoints', 'findings', 'latency', 'spec', 'edge', 'tests'];
  var active = 'trace';

  function showTab(name) {
    active = name;
    TABS.forEach(function (t) {
      var btn = $('tab-' + t), panel = $('panel-' + t);
      var on = t === name;
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    });
    render();
  }
  TABS.forEach(function (t, i) {
    var btn = $('tab-' + t);
    btn.addEventListener('click', function () { showTab(t); });
    btn.addEventListener('keydown', function (ev) {
      var d = ev.key === 'ArrowRight' ? 1 : (ev.key === 'ArrowLeft' ? -1 : (ev.key === 'Home' ? -99 : (ev.key === 'End' ? 99 : 0)));
      if (!d) return;
      ev.preventDefault();
      var idx = d === -99 ? 0 : (d === 99 ? TABS.length - 1 : (i + d + TABS.length) % TABS.length);
      showTab(TABS[idx]);
      $('tab-' + TABS[idx]).focus();
    });
  });

  /* ------------------------------------------------------------- worker */

  var worker = null, workerBroken = false, pending = null, seq = 0;

  function workerSource() {
    var base = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
    return 'importScripts(' + JSON.stringify(base + 'analyze.js') + ',' + JSON.stringify(base + 'edge.js') + ');\n' +
      'self.onmessage = function (ev) {\n' +
      '  var d = ev.data;\n' +
      '  try {\n' +
      '    var tr = HARVEST.normalise(d.har, d.name);\n' +
      '    var res = HARVEST.analyze(tr, { overrides: d.overrides });\n' +
      '    self.postMessage({ ok: true, id: d.id, result: res });\n' +
      '  } catch (e) {\n' +
      '    self.postMessage({ ok: false, id: d.id, error: String((e && e.message) || e) });\n' +
      '  }\n' +
      '};\n';
  }

  function ensureWorker() {
    if (worker || workerBroken) return worker;
    try {
      var url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = function (ev) {
        var d = ev.data || {};
        if (!pending || d.id !== pending.id) return;
        var cb = pending; pending = null;
        if (d.ok) { state.engine = 'worker'; state.engineNote = ''; cb.resolve(d.result); }
        else { failWorker('worker error: ' + d.error, cb); }
      };
      worker.onerror = function (ev) {
        var msg = (ev && ev.message) || 'Worker failed to start';
        failWorker(msg, pending);
      };
    } catch (e) {
      workerBroken = true;
      state.engineNote = String(e && e.message || e);
      worker = null;
    }
    return worker;
  }

  function failWorker(msg, cb) {
    workerBroken = true;
    state.engineNote = msg;
    try { if (worker) worker.terminate(); } catch (e) { }
    worker = null;
    pending = null;
    if (cb) cb.reject(msg);
  }

  function analyseMain(har, name) {
    state.engine = 'main';
    var tr = H.normalise(har, name);
    return H.analyze(tr, { overrides: state.overrides });
  }

  function analyse(har, name, done) {
    var w = ensureWorker();
    if (!w) {
      setTimeout(function () { done(analyseMain(har, name)); }, 0);
      return;
    }
    var id = ++seq;
    var timer = setTimeout(function () {
      if (pending && pending.id === id) failWorker('worker did not answer within 20 s', pending);
    }, 20000);
    pending = {
      id: id,
      resolve: function (res) { clearTimeout(timer); done(res); },
      reject: function () { clearTimeout(timer); done(analyseMain(har, name)); }
    };
    try {
      w.postMessage({ id: id, har: har, name: name, overrides: state.overrides });
    } catch (e) {
      failWorker('postMessage failed: ' + (e && e.message), pending);
      done(analyseMain(har, name));
    }
  }

  /* -------------------------------------------------------------- ingest */

  function setStatus(text, isErr) {
    var s = $('status');
    s.textContent = text;
    s.className = 'status' + (isErr ? ' err' : '');
  }

  function loadHar(har, name) {
    state.har = har;
    state.name = name;
    state.openRow = null;
    state.highlight = null;
    state.traceNote = '';
    state.specHost = null;
    state.rate.result = null;
    setStatus('Analysing ' + name + '…');
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    analyse(har, name, function (res) {
      var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
      state.result = res;
      state.specHost = res.hosts[0] || null;
      var where = state.engine === 'worker'
        ? 'analysed in a Web Worker'
        : 'analysed on the main thread' + (state.engineNote ? ' — Worker unavailable: ' + state.engineNote : '');
      setStatus(name + ': ' + plural(res.overall.requests, 'request') + ', ' +
        plural(res.endpoints.length, 'endpoint') + ', ' + plural(res.findings.length, 'finding') +
        ' (' + Math.round(t1 - t0) + ' ms, ' + where + ')');
      render();
    });
  }

  function readFile(file) {
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) {
      setStatus('That file is ' + bytes(file.size) + '. HARvest caps ingest at 40 MB so the tab cannot be wedged — slice the capture and try again.', true);
      return;
    }
    setStatus('Reading ' + file.name + ' (' + bytes(file.size) + ')…');
    var fr = new FileReader();
    fr.onerror = function () { setStatus('Could not read that file.', true); };
    fr.onload = function () {
      var har;
      try { har = JSON.parse(String(fr.result)); }
      catch (e) { setStatus('That file is not valid JSON, so it is not a HAR: ' + (e && e.message), true); return; }
      if (!har || (!har.log && !har.entries)) { setStatus('No log.entries found — this JSON does not look like a HAR.', true); return; }
      loadHar(har, file.name);
    };
    fr.readAsText(file);
  }

  var drop = $('drop'), fileInput = $('file');
  fileInput.addEventListener('change', function () { readFile(fileInput.files && fileInput.files[0]); });
  drop.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach(function (t) {
    drop.addEventListener(t, function (ev) { ev.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    drop.addEventListener(t, function (ev) { ev.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (ev) {
    var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    readFile(f);
  });
  window.addEventListener('dragover', function (ev) { ev.preventDefault(); });
  window.addEventListener('drop', function (ev) { ev.preventDefault(); });

  var sampleBtns = $('sampleBtns');
  H.samples.list.forEach(function (s) {
    sampleBtns.appendChild(h('button', { type: 'button', class: 'btn sample-btn', onclick: function () { loadHar(H.samples.get(s.id), s.label); } },
      h('b', { text: s.label }), h('span', { text: s.note })));
  });

  /* -------------------------------------------------------------- redact */

  var SECRET_HEADER = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|x-auth-token|x-csrf-token|api-key)$/i;
  var SECRET_QUERY = /^(api[_-]?key|apikey|access[_-]?token|auth|token|key|secret|password|signature|sig|jwt|session)$/i;

  function mask(v) {
    var s = String(v == null ? '' : v);
    if (s.length <= 10) return '••••••';
    return s.slice(0, 4) + '…' + s.slice(-3) + ' (' + s.length + ' chars, redacted)';
  }
  function redactHeader(name, value) {
    if (!state.redact) return String(value);
    if (SECRET_HEADER.test(name)) {
      var m = /^(\s*(?:Bearer|Basic|Token|JWT)\s+)(\S+)(.*)$/i.exec(String(value));
      if (m) return m[1] + mask(m[2]) + m[3];
      return mask(value);
    }
    return String(value);
  }
  function redactQuery(name, value) {
    if (!state.redact) return String(value);
    if (SECRET_QUERY.test(name) || H.JWT_RE.test(String(value))) return mask(value);
    return String(value);
  }
  // The full URL is displayed too, and a key in the query string is exactly the
  // thing this tool flags - so it gets the same treatment there.
  function redactUrl(e) {
    if (!state.redact || !e.query.length) return e.url;
    var base = e.url.split('?')[0];
    return base + '?' + e.query.map(function (q) {
      return q.name + '=' + redactQuery(q.name, q.value);
    }).join('&');
  }

  /* ------------------------------------------------------------- copy/dl */

  function copyText(text, btn) {
    function flash(ok) {
      var old = btn.textContent;
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(function () { btn.textContent = old; }, 1400);
    }
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { flash(true); }, function () { flash(legacyCopy(text)); });
      return;
    }
    flash(legacyCopy(text));
  }
  function legacyCopy(text) {
    // The async clipboard API needs a secure context; this is the fallback for
    // everywhere else, so an export is always obtainable.
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }
  function download(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: mime || 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return true;
    } catch (e) { return false; }
  }
  function exportRow(filename, text, mime) {
    var row = h('div', { class: 'copyrow' });
    row.appendChild(h('button', { type: 'button', class: 'btn small', onclick: function (ev) { copyText(text, ev.currentTarget); } }, 'Copy'));
    row.appendChild(h('button', {
      type: 'button', class: 'btn small', onclick: function (ev) {
        if (!download(filename, text, mime)) {
          ev.currentTarget.textContent = 'Download blocked — use Copy';
        }
      }
    }, 'Download ' + filename));
    return row;
  }

  /* ------------------------------------------------------------- summary */

  function renderSummary() {
    var box = $('summary');
    clear(box);
    var r = state.result;
    if (!r) return;
    var o = r.overall;
    function stat(k, v, n) {
      return h('div', { class: 'stat' }, h('div', { class: 'k', text: k }), h('div', { class: 'v', text: v }), n ? h('div', { class: 'n', text: n }) : null);
    }
    box.appendChild(stat('Requests', String(o.requests), o.hosts + ' host' + (o.hosts === 1 ? '' : 's')));
    box.appendChild(stat('Endpoints', String(o.endpoints), 'after templating'));
    box.appendChild(stat('Span', ms(o.spanMs), 'peak ' + o.peakRps + ' req/s'));
    box.appendChild(stat('p50 / p95', ms(o.latency.p50) + ' / ' + ms(o.latency.p95), 'nearest-rank, n=' + o.latency.n));
    box.appendChild(stat('Errors', pct(o.errorRate), '4xx + 5xx'));
    box.appendChild(stat('Transferred', bytes(o.totalBytes), 'from HAR sizes'));
    box.appendChild(stat('Body coverage', r.coverage.pct + '%', r.coverage.jsonBodies + '/' + r.coverage.total + ' JSON bodies'));
    var worst = r.findings.length ? r.findings[0].severity : 'none';
    box.appendChild(stat('Findings', String(r.findings.length), 'worst: ' + worst));
  }

  /* --------------------------------------------------------------- trace */

  var TSEGS = [
    { k: 'blocked', c: 'var(--t-blocked)', label: 'blocked / queued' },
    { k: 'dns', c: 'var(--t-dns)', label: 'DNS' },
    { k: 'connect', c: 'var(--t-connect)', label: 'connect + TLS' },
    { k: 'send', c: 'var(--t-send)', label: 'send' },
    { k: 'wait', c: 'var(--t-wait)', label: 'wait (TTFB)' },
    { k: 'receive', c: 'var(--t-receive)', label: 'receive' }
  ];

  function statusClass(s) { return s >= 500 ? 'st5' : s >= 400 ? 'st4' : s >= 300 ? 'st3' : 'st2'; }

  // Hard cap on rendered rows: a 20k-entry HAR would otherwise build 20k buttons.
  var ROW_CAP = 600;

  // One definition of "does this row match the filter box", shared by renderTrace
  // and jumpTo, so a jump can tell whether the filter is hiding its target.
  function matchesFilter(e, filter) {
    var f = String(filter || '').trim().toLowerCase();
    if (!f) return true;
    return (e.method + ' ' + e.url + ' ' + e.status).toLowerCase().indexOf(f) >= 0;
  }

  function renderTrace(panel) {
    var r = state.result;
    if (!r) { panel.appendChild(h('div', { class: 'empty', text: 'Load a HAR or pick a sample trace.' })); return; }
    var entries = r.trace.entries;
    var span = Math.max(1, r.overall.spanMs);

    var card = h('div', { class: 'card' });
    card.appendChild(h('div', { class: 'row-between' },
      h('h3', { text: 'Request waterfall' }),
      h('div', { class: 'controls', style: { marginBottom: '0' } },
        h('input', {
          type: 'text', id: 'traceFilter', placeholder: 'filter by method, path or status', value: state.filter,
          'aria-label': 'Filter requests',
          // The panel is rebuilt on every keystroke, which destroys this input and
          // builds a fresh one. Without restoring the selection the caret lands at 0
          // and every further character is inserted at the FRONT of the string
          // ("orders" typed one key at a time became "sredro"), and Backspace does
          // nothing because there is no text to its left. So: carry the caret over.
          oninput: function (ev) {
            var start = ev.target.selectionStart, end = ev.target.selectionEnd;
            state.filter = ev.target.value;
            state.traceNote = '';
            renderPanelOnly('trace', function () {
              var el = $('traceFilter');
              if (!el) return;
              try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
              try { el.setSelectionRange(start == null ? el.value.length : start, end == null ? el.value.length : end); }
              catch (err2) { /* some input types refuse setSelectionRange */ }
            });
          }
        }),
        h('label', { class: 'inline' },
          h('input', {
            type: 'checkbox', id: 'redactChk', checked: state.redact,
            onchange: function (ev) { state.redact = ev.target.checked; save('harvest.redact', state.redact); renderPanelOnly('trace'); }
          }),
          'Redact credential values'))));
    card.appendChild(h('p', { class: 'note', text: 'Bars are drawn from the HAR timings, positioned on the trace clock. Click a row for headers, cookies and the response body. Redaction is on by default because a HAR from your own browser contains live session tokens.' }));

    if (state.traceNote) card.appendChild(h('p', { class: 'jump-note', role: 'status', text: state.traceNote }));

    var shown = entries.filter(function (e) { return matchesFilter(e, state.filter); });

    // The display cap keeps a 20k-entry HAR from freezing the tab, but a jump
    // target past row 600 used to fall off the end and silently do nothing, so
    // the window slides to contain whatever we were asked to highlight.
    var pos = -1;
    if (state.highlight != null) {
      for (var p = 0; p < shown.length; p++) { if (shown[p].i === state.highlight) { pos = p; break; } }
    }
    var from = 0;
    if (shown.length > ROW_CAP && pos >= ROW_CAP) from = Math.min(shown.length - ROW_CAP, pos - Math.floor(ROW_CAP / 2));
    var slice = shown.slice(from, from + ROW_CAP);

    var wf = h('div', { class: 'wf' });
    wf.appendChild(timeRuler(span));
    for (var i = 0; i < slice.length; i++) {
      wf.appendChild(traceRow(slice[i], span));
      if (state.openRow === slice[i].i) wf.appendChild(traceDetail(slice[i]));
    }
    card.appendChild(wf);
    if (shown.length > slice.length) {
      card.appendChild(h('p', {
        class: 'hint',
        text: 'Showing rows ' + (from + 1) + '–' + (from + slice.length) + ' of ' + shown.length +
          ' matching requests (' + ROW_CAP + '-row display cap).'
      }));
    }
    if (!shown.length) {
      card.appendChild(h('div', {
        class: 'empty',
        text: !entries.length
          ? 'This HAR contains no entries — there is nothing to draw.'
          : 'No request matches "' + state.filter + '".'
      }));
    }

    var legend = h('div', { class: 'legend' });
    TSEGS.forEach(function (s) {
      legend.appendChild(h('span', {}, h('i', { style: { background: s.c } }), s.label));
    });
    card.appendChild(legend);
    panel.appendChild(card);

    if (r.trace.warnings.length) {
      var warn = h('div', { class: 'card' });
      warn.appendChild(h('h3', { text: 'Capture warnings' }));
      var ul = h('ul', { style: { paddingLeft: '18px', fontSize: '13px', color: 'var(--muted)' } });
      r.trace.warnings.forEach(function (w) { ul.appendChild(h('li', { text: w })); });
      warn.appendChild(ul);
      panel.appendChild(warn);
    }
  }

  function timeRuler(span) {
    var ruler = h('div', { class: 'wf-ruler' }, h('span', { class: 'wf-idx' }), h('span', { class: 'wf-rlabel small', text: 'trace clock' }));
    var axis = h('div', { class: 'wf-axis' });
    // Five labels, and the two quarter marks carry .hideable so the <=860px
    // stylesheet can drop them: six labels crammed into a 110px track rendered
    // as overprinted glyph soup on a phone.
    var ticks = 4;
    for (var i = 0; i <= ticks; i++) {
      var at = (span / ticks) * i;
      var cls = i === 0 ? ' first' : i === ticks ? ' last' : i === ticks / 2 ? ' mid' : ' hideable';
      axis.appendChild(h('span', {
        class: 'wf-tick' + cls,
        style: { left: ((i / ticks) * 100) + '%' },
        text: ms(at)
      }));
    }
    ruler.appendChild(axis);
    ruler.appendChild(h('span', { class: 'wf-rtail' }));
    return ruler;
  }

  function traceRow(e, span) {
    var row = h('button', {
      type: 'button',
      class: 'wf-row' + (state.highlight === e.i ? ' hl' : ''),
      id: 'row-' + e.i,
      'aria-expanded': state.openRow === e.i ? 'true' : 'false',
      onclick: function () {
        state.openRow = state.openRow === e.i ? null : e.i;
        renderPanelOnly('trace', function () { var el = $('row-' + e.i); if (el) el.focus(); });
      }
    });
    row.appendChild(h('span', { class: 'wf-idx', text: '#' + e.i }));
    var name = h('span', { class: 'wf-name' });
    name.appendChild(h('span', { class: 'method ' + e.method, text: e.method }));
    name.appendChild(h('span', { class: 'status-pill ' + statusClass(e.status), text: e.status || '—' }));
    // redactUrl, not e.url: the tooltip is the most-hovered surface on the page and
    // a raw title= would put a live api_key or JWT into the DOM of every row while
    // the checkbox claims the values are redacted.
    name.appendChild(h('span', { class: 'wf-path', text: e.path + (e.query.length ? '?' + e.query.map(function (q) { return q.name; }).join('&') : ''), title: redactUrl(e) }));
    row.appendChild(name);

    var track = h('div', { class: 'wf-track' });
    var left = (e.offsetMs / span) * 100;
    var cursor = e.offsetMs;
    TSEGS.forEach(function (s) {
      var v = e.timings[s.k] || 0;
      if (s.k === 'ssl') return;
      if (v <= 0) return;
      track.appendChild(h('div', {
        class: 'wf-seg',
        style: { left: ((cursor / span) * 100) + '%', width: Math.max(0.25, (v / span) * 100) + '%', background: s.c },
        title: s.label + ': ' + ms(v)
      }));
      cursor += v;
    });
    if (cursor === e.offsetMs) {
      track.appendChild(h('div', { class: 'wf-seg', style: { left: left + '%', width: Math.max(0.25, (e.time / span) * 100) + '%', background: 'var(--t-wait)' } }));
    }
    row.appendChild(track);
    row.appendChild(h('span', { class: 'wf-time', text: ms(e.time) }));
    return row;
  }

  function traceDetail(e) {
    var d = h('div', { class: 'detail' });
    d.appendChild(h('h4', { text: 'Request' }));
    var kv = h('dl', { class: 'kv' });
    function pair(k, v) { kv.appendChild(h('dt', { text: k })); kv.appendChild(h('dd', { text: v })); }
    pair('URL', redactUrl(e));
    pair('Endpoint', state.result.entryToEndpoint[e.i] || '(none)');
    pair('Started at', (e.startedMs ? new Date(e.startedMs).toISOString() : '(no timestamp)') + '  (+' + ms(e.offsetMs) + ' into the trace)');
    pair('HTTP', (e.httpVersion || 'unknown') + (e.serverIP ? '  via ' + e.serverIP : ''));
    d.appendChild(kv);

    if (e.query.length) {
      d.appendChild(h('h4', { text: 'Query parameters' }));
      var qkv = h('dl', { class: 'kv' });
      e.query.forEach(function (q) {
        qkv.appendChild(h('dt', { text: q.name }));
        var red = redactQuery(q.name, q.value);
        qkv.appendChild(h('dd', { class: red !== q.value ? 'redacted' : '', text: red }));
      });
      d.appendChild(qkv);
    }

    ['reqHeaders', 'resHeaders'].forEach(function (side) {
      if (!e[side].length) return;
      d.appendChild(h('h4', { text: side === 'reqHeaders' ? 'Request headers' : 'Response headers' }));
      var hkv = h('dl', { class: 'kv' });
      e[side].forEach(function (hd) {
        hkv.appendChild(h('dt', { text: hd.name.toLowerCase() }));
        var red = redactHeader(hd.name, hd.value);
        hkv.appendChild(h('dd', { class: red !== hd.value ? 'redacted' : '', text: red }));
      });
      d.appendChild(hkv);
    });

    d.appendChild(h('h4', { text: 'Response body' }));
    if (e.bodyJson != null) {
      var txt = JSON.stringify(e.bodyJson, null, 2);
      if (txt.length > 20000) txt = txt.slice(0, 20000) + '\n… truncated for display (' + bytes(e.bodySize) + ' total)';
      d.appendChild(h('pre', { class: 'body', text: txt }));
    } else if (e.bodyText != null) {
      d.appendChild(h('pre', { class: 'body', text: e.bodyText.slice(0, 4000) }));
    } else if (e.bodyMissing) {
      d.appendChild(h('p', { class: 'hint', text: 'The HAR declares ' + bytes(e.bodySize) + ' of body but contains no content.text. That is what a capture without "Save all as HAR with content" looks like — the schema for this endpoint can only be header-level.' }));
    } else {
      d.appendChild(h('p', { class: 'hint', text: 'No body (status ' + e.status + ', ' + (e.mime || 'no content type') + ').' }));
    }
    return d;
  }

  // Every jump affordance in the app routes through here: evidence chips, the JWT
  // "Show request" buttons, rate-limit trip chips and the endpoint table. It used
  // to no-op whenever an active filter or the row cap meant the target row was not
  // in the DOM, so the promise "click one to jump to that request" quietly failed.
  function jumpTo(idx) {
    state.openRow = idx;
    state.highlight = idx;
    state.traceNote = '';

    var r = state.result;
    var target = null;
    if (r) {
      for (var i = 0; i < r.trace.entries.length; i++) {
        if (r.trace.entries[i].i === idx) { target = r.trace.entries[i]; break; }
      }
    }
    if (!target) {
      state.traceNote = 'Request #' + idx + ' is not in this trace.';
    } else if (state.filter.trim() && !matchesFilter(target, state.filter)) {
      state.traceNote = 'Cleared the filter “' + state.filter.trim() + '” so request #' + idx + ' could be shown.';
      state.filter = '';
    }

    showTab('trace');
    setTimeout(function () {
      var el = $('row-' + idx);
      if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); return; }
      // Belt and braces: if it still is not rendered, say so rather than doing nothing.
      state.traceNote = 'Could not show request #' + idx + ' in the waterfall.';
      renderPanelOnly('trace');
    }, 30);
  }

  /* ----------------------------------------------------------- endpoints */

  function tplNode(ep) {
    var span = h('span', { class: 'tpl' });
    span.appendChild(document.createTextNode(ep.host));
    ep.segments.forEach(function (s) {
      span.appendChild(document.createTextNode('/'));
      span.appendChild(s.kind === 'param' ? h('span', { class: 'param', text: s.text }) : document.createTextNode(s.text));
    });
    if (!ep.segments.length) span.appendChild(document.createTextNode('/'));
    return span;
  }

  function renderEndpoints(panel) {
    var r = state.result;
    if (!r) { panel.appendChild(h('div', { class: 'empty', text: 'Load a trace first.' })); return; }

    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: plural(r.endpoints.length, 'recovered endpoint') }));
    card.appendChild(h('p', { class: 'note', text: 'Requests are grouped by a trie over path segments. Each sibling set is classified literal-or-parameter from token shape plus cardinality; the reasoning for every decision is below the table, and every decision can be overridden.' }));

    var tbl = h('table');
    tbl.appendChild(h('thead', {}, h('tr', {},
      h('th', { text: 'Endpoint' }), h('th', { text: 'Methods' }),
      h('th', { class: 'num', text: 'n' }), h('th', { class: 'num', text: 'p50' }),
      h('th', { class: 'num', text: 'p95' }), h('th', { text: 'Statuses' }))));
    var tb = h('tbody');
    r.endpoints.forEach(function (ep) {
      var codes = {};
      ep.methods.forEach(function (m) { Object.keys(ep.ops[m].statuses).forEach(function (c) { codes[c] = (codes[c] || 0) + ep.ops[m].statuses[c].count; }); });
      var jump = ep.entryIdx.length
        ? h('button', {
          type: 'button', class: 'tpl-btn',
          'aria-label': 'Jump to the first request for ' + ep.host + '/' + ep.segments.map(function (s) { return s.text; }).join('/'),
          onclick: function () { jumpTo(ep.entryIdx[0]); }
        }, tplNode(ep))
        : tplNode(ep);
      var tr = h('tr', {},
        h('td', {}, jump),
        h('td', {}, ep.methods.map(function (m) { return h('span', { class: 'method ' + m, text: m, style: { marginRight: '4px' } }); })),
        h('td', { class: 'num', text: String(ep.reqCount) }),
        h('td', { class: 'num', text: ms(ep.latency.p50) }),
        h('td', { class: 'num', text: ms(ep.latency.p95) }),
        h('td', {}, Object.keys(codes).sort().map(function (c) {
          return h('span', { class: 'status-pill ' + statusClass(Number(c)), text: c + '×' + codes[c], style: { marginRight: '4px' } });
        })));
      // The row stays clickable for mice; the button above is the keyboard and
      // screen-reader path (a bare <tr> click handler reaches neither).
      tr.addEventListener('click', function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest('.tpl-btn')) return;
        if (ep.entryIdx.length) jumpTo(ep.entryIdx[0]);
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    card.appendChild(h('div', { class: 'tbl-wrap' }, tbl));
    panel.appendChild(card);

    var dcard = h('div', { class: 'card' });
    dcard.appendChild(h('div', { class: 'row-between' },
      h('h3', { text: 'Classifier decisions' }),
      Object.keys(state.overrides).length
        ? h('button', {
          type: 'button', class: 'btn small', onclick: function () {
            state.overrides = {}; save('harvest.overrides', {}); loadHar(state.har, state.name);
          }
        }, 'Reset ' + Object.keys(state.overrides).length + ' override(s)')
        : null));
    dcard.appendChild(h('p', { class: 'note', text: 'There is no ground truth in a HAR, so these are heuristics — engineered to be inspectable rather than hidden. Pin any of them and the whole analysis re-runs.' }));

    r.decisions.forEach(function (d) {
      var box = h('div', { class: 'decision' });
      var head = h('div', { class: 'head' });
      var lbl = h('div', {},
        h('code', { text: (d.prefix === '/' ? '' : d.prefix) + '/' }),
        h('span', { class: d.kind === 'param' ? 'param' : '', text: d.kind === 'param' ? '{' + (d.name || 'id') + '}' : '‹literal›' }),
        ' ',
        h('span', { class: 'conf ' + d.confidence, text: d.shapeLabel + ' · ' + d.confidence + ' confidence' }),
        d.overridden ? h('span', { class: 'badge', text: 'pinned', style: { marginLeft: '6px' } }) : null);
      head.appendChild(lbl);
      if (d.shapeId !== 'reserved') {
        var btns = h('div', { class: 'controls', style: { marginBottom: '0' } });
        ['literal', 'param'].forEach(function (kind) {
          btns.appendChild(h('button', {
            type: 'button', class: 'btn small', 'aria-pressed': d.kind === kind ? 'true' : 'false',
            onclick: function () {
              if (d.defaultKind === kind) delete state.overrides[d.key];
              else state.overrides[d.key] = kind;
              save('harvest.overrides', state.overrides);
              loadHar(state.har, state.name);
              showTab('endpoints');
            }
          }, kind === 'literal' ? 'Pin literal' : 'Force parameter'));
        });
        head.appendChild(btns);
      }
      box.appendChild(head);
      box.appendChild(h('div', { class: 'why', text: d.reason }));
      box.appendChild(h('div', { class: 'vals', text: 'values seen: ' + d.values.slice(0, 8).join(', ') + (d.values.length > 8 ? ' … (' + d.values.length + ' total)' : '') }));
      dcard.appendChild(box);
    });
    panel.appendChild(dcard);
  }

  /* ------------------------------------------------------------ findings */

  function findingCard(f) {
    var box = h('div', { class: 'finding ' + f.severity });
    var badges = h('div', { class: 'badges' },
      h('span', { class: 'badge ' + f.severity, text: f.severity }),
      h('span', { class: 'badge', text: f.family }),
      f.heuristic ? h('span', { class: 'badge', text: 'heuristic' }) : null);
    box.appendChild(badges);
    box.appendChild(h('h4', { text: f.title }));
    box.appendChild(h('p', { text: f.detail }));
    box.appendChild(h('p', {}, h('span', { class: 'lbl', text: 'why' }), f.why));
    box.appendChild(h('p', {}, h('span', { class: 'lbl', text: 'fix' }), f.fix));
    if (f.evidence.length) {
      var ev = h('div', { class: 'evidence' }, h('span', { class: 'lbl', text: 'evidence' }));
      f.evidence.slice(0, 24).forEach(function (i) {
        ev.appendChild(h('button', { type: 'button', class: 'ev', onclick: function () { jumpTo(i); } }, '#' + i));
      });
      if (f.evidence.length > 24) ev.appendChild(h('span', { class: 'lbl', text: '+' + (f.evidence.length - 24) + ' more' }));
      box.appendChild(ev);
    }
    return box;
  }

  function renderFindings(panel) {
    var r = state.result;
    if (!r) { panel.appendChild(h('div', { class: 'empty', text: 'Load a trace first.' })); return; }
    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: plural(r.findings.length, 'finding') + ', ranked by severity' }));
    card.appendChild(h('p', { class: 'note', text: 'Each finding names the request indices that produced it — click one to jump to that request in the trace. Rules that are judgement calls rather than facts carry a "heuristic" badge.' }));
    panel.appendChild(card);
    if (!r.findings.length) {
      panel.appendChild(h('div', { class: 'empty', text: 'Nothing fired on this trace. That is a real result, not a placeholder: the rules that would have fired are listed in the README.' }));
      return;
    }
    r.findings.forEach(function (f) { panel.appendChild(findingCard(f)); });
  }

  /* ------------------------------------------------------------- latency */

  function renderLatency(panel) {
    var r = state.result;
    if (!r) { panel.appendChild(h('div', { class: 'empty', text: 'Load a trace first.' })); return; }

    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'Per-operation latency' }));
    card.appendChild(h('p', { class: 'note', text: 'Percentiles are nearest-rank: rank = ceil(p/100 × n), 1-indexed into the sorted samples. No interpolation, no smoothing. n is shown for every row because a p99 taken from a handful of samples is just the slowest thing we saw.' }));
    var tbl = h('table');
    tbl.appendChild(h('thead', {}, h('tr', {},
      h('th', { text: 'Operation' }), h('th', { class: 'num', text: 'n' }),
      h('th', { class: 'num', text: 'p50' }), h('th', { class: 'num', text: 'p90' }),
      h('th', { class: 'num', text: 'p95' }), h('th', { class: 'num', text: 'p99' }),
      h('th', { class: 'num', text: 'max' }), h('th', { class: 'num', text: 'errors' }))));
    var tb = h('tbody');
    var ops = [];
    r.endpoints.forEach(function (ep) {
      ep.methods.forEach(function (m) { ops.push({ ep: ep, op: ep.ops[m] }); });
    });
    ops.sort(function (a, b) { return b.op.reqCount - a.op.reqCount || (a.ep.template < b.ep.template ? -1 : 1); });
    ops.forEach(function (x) {
      var s = x.op.latency;
      tb.appendChild(h('tr', {},
        h('td', {}, h('span', { class: 'method ' + x.op.method, text: x.op.method }), ' ', tplNode(x.ep)),
        h('td', { class: 'num' }, String(s.n), s.n < 20 ? h('span', { class: 'warn-inline', text: ' ⚠' }) : null),
        h('td', { class: 'num', text: ms(s.p50) }),
        h('td', { class: 'num', text: ms(s.p90) }),
        h('td', { class: 'num', text: ms(s.p95) }),
        h('td', { class: 'num', text: ms(s.p99) }),
        h('td', { class: 'num', text: ms(s.max) }),
        h('td', { class: 'num', text: x.op.errorCount ? x.op.errorCount + ' (' + pct(x.op.errorRate) + ')' : '0' })));
    });
    tbl.appendChild(tb);
    card.appendChild(h('div', { class: 'tbl-wrap' }, tbl));
    card.appendChild(h('p', { class: 'hint', text: '⚠ marks fewer than 20 samples — treat those percentiles as anecdotes.' }));
    panel.appendChild(card);

    var bcard = h('div', { class: 'card' });
    bcard.appendChild(h('h3', { text: 'Timeout and retry budget' }));
    bcard.appendChild(h('p', { class: 'note', text: 'Derived from the measured percentiles above. Retries are only ever proposed for idempotent methods: retrying a POST without an Idempotency-Key the server deduplicates on is how you get two orders.' }));
    var btbl = h('table');
    btbl.appendChild(h('thead', {}, h('tr', {},
      h('th', { text: 'Operation' }), h('th', { class: 'num', text: 'timeout' }),
      h('th', { class: 'num', text: 'retries' }), h('th', { text: 'retry on' }),
      h('th', { class: 'num', text: 'worst case' }), h('th', { text: 'basis' }))));
    var btb = h('tbody');
    ops.slice(0, 12).forEach(function (x) {
      var b = H.budgetFor(x.op);
      if (!b) return;
      btb.appendChild(h('tr', {},
        h('td', {}, h('span', { class: 'method ' + x.op.method, text: x.op.method }), ' ', tplNode(x.ep)),
        h('td', { class: 'num', text: b.timeoutMs + ' ms' }),
        h('td', { class: 'num', text: String(b.retries) }),
        h('td', { text: b.retryOn }),
        h('td', { class: 'num', text: ms(b.worstCaseMs) }),
        h('td', { style: { whiteSpace: 'normal' } }, b.basis)));
    });
    btbl.appendChild(btb);
    bcard.appendChild(h('div', { class: 'tbl-wrap' }, btbl));

    var nonIdem = ops.filter(function (x) { return !H.isIdempotent(x.op.method); });
    if (nonIdem.length) {
      bcard.appendChild(h('p', { class: 'hint' },
        h('b', { text: 'Non-idempotent operations in this trace: ' }),
        nonIdem.map(function (x) { return x.op.method + ' ' + x.ep.template; }).join(', ') +
        '. HARvest refuses to recommend automatic retries for these. Add an Idempotency-Key header the server deduplicates on, then retry becomes safe.'));
    }

    var conf = r.concurrency;
    bcard.appendChild(h('p', { class: 'hint', text: 'Peak concurrency across the trace: ' + conf.peak + ' in-flight requests. Longest strictly serialised chain: ' + conf.longestChain.length + ' requests totalling ' + ms(conf.longestChainMs) + '.' }));
    panel.appendChild(bcard);
  }

  /* ---------------------------------------------------------------- spec */

  function renderSpec(panel) {
    var r = state.result;
    if (!r) { panel.appendChild(h('div', { class: 'empty', text: 'Load a trace first.' })); return; }
    var host = state.specHost || r.hosts[0];
    if (!host) { panel.appendChild(h('div', { class: 'empty', text: 'No hosts in this trace.' })); return; }

    var spec = H.buildOpenApi(r, r.trace, host);
    var card = h('div', { class: 'card' });
    var head = h('div', { class: 'row-between' }, h('h3', { text: 'OpenAPI 3.1 draft' }), null);
    var ctrl = h('div', { class: 'controls', style: { marginBottom: '0' } });
    if (r.hosts.length > 1) {
      var sel = h('select', {
        'aria-label': 'Host', onchange: function (ev) { state.specHost = ev.target.value; renderPanelOnly('spec'); }
      });
      r.hosts.forEach(function (hh) {
        sel.appendChild(h('option', { value: hh, selected: hh === host, text: hh + ' (' + r.hostCounts[hh] + ')' }));
      });
      ctrl.appendChild(sel);
    }
    ['yaml', 'json'].forEach(function (fmt) {
      ctrl.appendChild(h('button', {
        type: 'button', class: 'btn small', 'aria-pressed': state.specFormat === fmt ? 'true' : 'false',
        onclick: function () { state.specFormat = fmt; renderPanelOnly('spec'); }
      }, fmt.toUpperCase()));
    });
    head.appendChild(ctrl);
    card.appendChild(head);

    card.appendChild(h('p', { class: 'note', text: 'Structurally identical object shapes are hashed and hoisted into components/schemas as $refs. required is computed from present-in-k-of-n counting across every observed body, not from a pairwise intersection. This is a draft to review, not a contract to commit: path templating is heuristic and the schema only describes what this trace happened to contain.' }));

    var cov = spec.coverage;
    card.appendChild(h('div', {}, h('div', { class: 'meter' }, h('i', { style: { width: cov.pct + '%' } }))));
    card.appendChild(h('p', { class: 'hint' },
      h('b', { text: 'Coverage: ' + cov.pct + '% body-derived. ' }),
      cov.bodyDerived + ' of ' + cov.total + ' response shapes came from an actual body; ' + cov.headerOnly +
      ' are header-level only because the HAR had no body for them. ' + cov.hoisted + ' shared schema' +
      (cov.hoisted === 1 ? '' : 's') + ' hoisted into components. ' +
      (cov.pct < 50 ? 'That is low — re-capture with "Save all as HAR with content" for a spec worth reading.' : '').trim()));

    var text = state.specFormat === 'yaml' ? spec.yaml : spec.json;
    card.appendChild(exportRow('openapi-' + host.replace(/[^a-z0-9.-]/gi, '_') + '.' + (state.specFormat === 'yaml' ? 'yaml' : 'json'), text,
      state.specFormat === 'yaml' ? 'application/yaml' : 'application/json'));
    card.appendChild(h('pre', { class: 'body', style: { maxHeight: '520px' }, text: text }));
    panel.appendChild(card);
  }

  /* -------------------------------------------------------- edge/security */

  function renderEdge(panel) {
    var r = state.result;
    if (!r) { panel.appendChild(h('div', { class: 'empty', text: 'Load a trace first.' })); return; }

    panel.appendChild(h('div', { class: 'claim' },
      h('b', { text: 'Why this tab is safe to use with a real capture. ' }),
      'A HAR from your own browser contains live session cookies and bearer tokens. This page carries ',
      h('code', { text: "connect-src 'none'" }),
      ' in its own CSP, so the browser blocks every outbound connection it could make, and the counter in the header shows how many were attempted. JWTs are decoded locally and never verified — verification needs the signing key, which this page does not have and will not ask you for.'));

    var auth = r.findings.filter(function (f) { return f.family === 'auth' || f.family === 'edge'; });
    var acard = h('div', { class: 'card', id: 'edgeAuthCard' });
    acard.appendChild(h('h3', { text: 'Auth and edge hygiene — ' + auth.length + ' finding' + (auth.length === 1 ? '' : 's') }));
    acard.appendChild(h('p', { class: 'note', text: 'Credential placement, cookie flags, cross-host token reuse, transport security and response-header posture.' }));
    panel.appendChild(acard);
    if (!auth.length) panel.appendChild(h('div', { class: 'empty', text: 'No auth or edge findings on this trace.' }));
    auth.forEach(function (f) { panel.appendChild(findingCard(f)); });

    /* JWTs */
    var jcard = h('div', { class: 'card', id: 'edgeJwtCard' });
    jcard.appendChild(h('h3', { text: 'JWT inspector (' + r.jwts.length + ' distinct token' + (r.jwts.length === 1 ? '' : 's') + ')' }));
    jcard.appendChild(h('p', { class: 'note', text: 'Decoded with atob in this tab. Signature NOT verified — that requires the signing key. Treat everything below as "what the token claims", never as "what the server accepted".' }));
    if (!r.jwts.length) {
      jcard.appendChild(h('div', { class: 'empty', text: 'No JWT-shaped credential found in Authorization headers, cookies or query strings.' }));
    } else {
      r.jwts.forEach(function (j) {
        var d = j.jwt;
        var box = h('div', { class: 'decision' });
        box.appendChild(h('div', { class: 'head' },
          h('div', {}, h('code', { text: j.where }), ' ', h('span', { class: 'badge', text: 'alg ' + (d.alg || 'missing') }),
            ' ', h('span', { class: 'badge', text: 'req #' + j.i })),
          h('button', { type: 'button', class: 'btn small', onclick: function () { jumpTo(j.i); } }, 'Show request')));
        var kv = h('dl', { class: 'kv', style: { marginTop: '8px' } });
        function pair(k, v) { kv.appendChild(h('dt', { text: k })); kv.appendChild(h('dd', { text: v })); }
        pair('header', JSON.stringify(d.header));
        Object.keys(d.payload).sort().forEach(function (k) {
          var v = d.payload[k];
          var extra = '';
          if ((k === 'exp' || k === 'iat' || k === 'nbf') && typeof v === 'number') extra = '  (' + new Date(v * 1000).toISOString() + ')';
          pair(k, (typeof v === 'object' ? JSON.stringify(v) : String(v)) + extra);
        });
        if (d.lifetimeSec != null) pair('lifetime', Math.round(d.lifetimeSec / 3600) + ' hours (exp − iat)');
        pair('signature', d.signaturePresent ? 'present, NOT verified (no key)' : 'absent');
        box.appendChild(kv);
        d.issues.forEach(function (is) {
          box.appendChild(h('div', { class: 'why' }, h('span', { class: 'badge ' + is.severity, text: is.severity }), ' ', is.text));
        });
        jcard.appendChild(box);
      });
    }
    panel.appendChild(jcard);

    /* CIDR matcher */
    var ccard = h('div', { class: 'card', id: 'edgeCidrCard' });
    ccard.appendChild(h('h3', { text: 'IP / CIDR matcher' }));
    ccard.appendChild(h('p', { class: 'note', text: 'IPv4 and IPv6, normalised once into four 32-bit words so a prefix test is a few integer compares rather than BigInt arithmetic. :: expansion and IPv4-mapped forms are handled. A HAR records serverIPAddress (the server), not the client address, so the addresses pulled from the trace below are server-side.' }));
    var cidrTa = h('textarea', { rows: 5, 'aria-label': 'CIDR list, one per line', oninput: function (ev) { state.cidrs = ev.target.value; } });
    cidrTa.value = state.cidrs;
    ccard.appendChild(h('label', { class: 'inline', style: { display: 'block', marginBottom: '4px' } }, 'CIDR list (one per line)'));
    ccard.appendChild(cidrTa);

    var ipIn = h('input', { type: 'text', 'aria-label': 'IP address to test', value: state.ipInput, oninput: function (ev) { state.ipInput = ev.target.value; } });
    var out = h('div', { style: { marginTop: '10px' } });
    function runMatch(addr) {
      clear(out);
      var list = state.cidrs.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      var res = H.matchIp(addr, list);
      if (!res.valid) {
        out.appendChild(h('p', { class: 'hint', style: { color: 'var(--sev-high)' }, text: '"' + addr + '" is not a valid IPv4 or IPv6 address.' }));
      } else {
        out.appendChild(h('p', { class: 'hint' },
          h('b', { text: H.ipToString(res.ip) + ' (IPv' + res.ip.family + '): ' }),
          res.matches.length ? 'matches ' + res.matches.join(', ') : 'matches nothing in the list'));
      }
      if (res.invalid.length) out.appendChild(h('p', { class: 'hint', style: { color: 'var(--sev-medium)' }, text: 'unparseable CIDRs ignored: ' + res.invalid.join(', ') }));
    }
    ccard.appendChild(h('div', { class: 'controls', style: { marginTop: '10px' } },
      ipIn,
      h('button', { type: 'button', class: 'btn small primary', onclick: function () { state.ipInput = ipIn.value; runMatch(ipIn.value); } }, 'Test address')));

    var traceIps = {};
    r.trace.entries.forEach(function (e) { if (e.serverIP) traceIps[e.serverIP] = (traceIps[e.serverIP] || 0) + 1; });
    var ipKeys = Object.keys(traceIps).sort();
    if (ipKeys.length) {
      var chips = h('div', { class: 'evidence' }, h('span', { class: 'lbl', text: 'from this trace' }));
      ipKeys.forEach(function (ip) {
        chips.appendChild(h('button', { type: 'button', class: 'ev', onclick: function () { ipIn.value = ip; state.ipInput = ip; runMatch(ip); } }, ip + ' ×' + traceIps[ip]));
      });
      ccard.appendChild(chips);
    }
    ccard.appendChild(out);
    panel.appendChild(ccard);
    runMatch(state.ipInput);

    /* rate limit */
    var rcard = h('div', { class: 'card', id: 'edgeRateCard' });
    rcard.appendChild(h('h3', { text: 'Sliding-window rate-limit simulation' }));
    rcard.appendChild(h('p', { class: 'note', text: 'Replays this trace through a sliding-window counter using its own timestamps. One ordered pass, a ring buffer of in-window timestamps per key, so it is O(n) rather than O(n × windows). Requests inside a mitigation window are rejected without being metered, which is what an edge limiter normally does.' }));

    var ctrls = h('div', { class: 'controls' });
    var keySel = h('select', { 'aria-label': 'Rate limit key' });
    Object.keys(H.RATE_KEYS).forEach(function (k) {
      keySel.appendChild(h('option', { value: k, selected: state.rate.key === k, text: H.RATE_KEYS[k].label }));
    });
    var limitIn = h('input', { type: 'number', min: '1', max: '1000', value: String(state.rate.limit), style: { width: '78px' }, 'aria-label': 'Request limit' });
    var winIn = h('input', { type: 'number', min: '100', step: '100', value: String(state.rate.windowMs), style: { width: '92px' }, 'aria-label': 'Window in milliseconds' });
    var blockIn = h('input', { type: 'number', min: '0', step: '1000', value: String(state.rate.blockMs), style: { width: '92px' }, 'aria-label': 'Mitigation timeout in milliseconds' });
    ctrls.appendChild(h('label', { class: 'inline' }, 'key', keySel));
    ctrls.appendChild(h('label', { class: 'inline' }, 'limit', limitIn));
    ctrls.appendChild(h('label', { class: 'inline' }, 'window (ms)', winIn));
    ctrls.appendChild(h('label', { class: 'inline' }, 'mitigation (ms)', blockIn));
    ctrls.appendChild(h('button', {
      type: 'button', class: 'btn small primary', onclick: function () {
        state.rate.key = keySel.value;
        state.rate.limit = Math.max(1, parseInt(limitIn.value, 10) || 1);
        state.rate.windowMs = Math.max(100, parseInt(winIn.value, 10) || 1000);
        state.rate.blockMs = Math.max(0, parseInt(blockIn.value, 10) || 0);
        state.rate.result = H.simulateRateLimit(r.trace.entries, {
          key: state.rate.key, limit: state.rate.limit, windowMs: state.rate.windowMs,
          blockMs: state.rate.blockMs, entryToEndpoint: r.entryToEndpoint
        });
        renderPanelOnly('edge');
      }
    }, 'Run simulation'));
    rcard.appendChild(ctrls);

    var sim = state.rate.result;
    if (!sim) {
      rcard.appendChild(h('div', { class: 'empty', text: 'Set a limit and press Run simulation.' }));
    } else {
      rcard.appendChild(h('p', { class: 'hint' },
        h('b', { text: sim.blocked + ' of ' + sim.totalRequests + ' requests would have been rejected' }),
        ' at ' + sim.limit + ' per ' + sim.windowMs + ' ms keyed on ' + sim.keyLabel + ', across ' + sim.trips.length + ' trip' + (sim.trips.length === 1 ? '' : 's') + '.'));
      var st = h('table');
      st.appendChild(h('thead', {}, h('tr', {}, h('th', { text: 'key' }), h('th', { class: 'num', text: 'allowed' }), h('th', { class: 'num', text: 'blocked' }), h('th', { class: 'num', text: 'trips' }), h('th', { class: 'num', text: 'peak in window' }))));
      var stb = h('tbody');
      sim.perKey.slice(0, 25).forEach(function (k) {
        stb.appendChild(h('tr', {},
          h('td', {}, h('span', { class: 'tpl', text: k.key })),
          h('td', { class: 'num', text: String(k.allowed) }),
          h('td', { class: 'num', text: String(k.blocked) }),
          h('td', { class: 'num', text: String(k.trips) }),
          h('td', { class: 'num', text: String(k.peakInWindow) })));
      });
      st.appendChild(stb);
      rcard.appendChild(h('div', { class: 'tbl-wrap' }, st));
      if (sim.trips.length) {
        var ev = h('div', { class: 'evidence' }, h('span', { class: 'lbl', text: 'first request of each trip' }));
        sim.trips.slice(0, 20).forEach(function (t) {
          ev.appendChild(h('button', { type: 'button', class: 'ev', onclick: function () { jumpTo(t.i); } }, '#' + t.i + ' @' + Math.round(t.at) + 'ms'));
        });
        rcard.appendChild(ev);
      }
    }
    panel.appendChild(rcard);
  }

  /* --------------------------------------------------------------- tests */

  var testRun = null;

  function renderTests(panel) {
    if (!testRun) {
      try { testRun = H.runTests(); }
      catch (e) { testRun = { results: [{ group: 'runner', name: 'suite threw', ok: false, message: String(e && e.stack || e) }], passed: 0, failed: 1, total: 1 }; }
    }
    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', { text: 'In-page assertions' }));
    card.appendChild(h('p', { class: 'note', text: 'The same suite runs under node from the same file. The headline assertion is that the schema merge is order-independent: the same bodies in a shuffled order must produce a byte-identical schema, and a whole HAR shuffled must produce a byte-identical OpenAPI document. A fold-and-intersect implementation fails that, which is why it is asserted here rather than claimed in prose.' }));

    var sum = h('div', { class: 'test-summary' });
    sum.appendChild(h('span', { class: 'pillbig ' + (testRun.failed ? 'fail' : 'pass'), text: testRun.failed ? testRun.failed + ' FAILING' : testRun.passed + ' PASSING' }));
    sum.appendChild(h('span', { class: 'hint', text: testRun.passed + ' of ' + testRun.total + ' assertions across ' + H.testGroups.length + ' groups.' }));
    sum.appendChild(h('button', { type: 'button', class: 'btn small', onclick: function () { testRun = null; renderPanelOnly('tests'); } }, 'Re-run'));
    card.appendChild(sum);

    var byGroup = {};
    var order = [];
    testRun.results.forEach(function (t) {
      if (!byGroup[t.group]) { byGroup[t.group] = []; order.push(t.group); }
      byGroup[t.group].push(t);
    });
    order.forEach(function (g) {
      var list = byGroup[g];
      var failed = list.filter(function (t) { return !t.ok; }).length;
      var box = h('div', { class: 'tgroup' });
      box.appendChild(h('h4', { text: g + '  ' + (list.length - failed) + '/' + list.length }));
      list.forEach(function (t) {
        box.appendChild(h('div', { class: 'tcase ' + (t.ok ? 'ok' : 'no') },
          h('span', { class: 'mk', text: t.ok ? '✓' : '✗' }),
          h('span', { text: t.name }),
          t.ok ? null : h('span', { class: 'msg', text: t.message })));
      });
      card.appendChild(box);
    });
    panel.appendChild(card);
  }

  /* -------------------------------------------------------------- render */

  var RENDERERS = {
    trace: renderTrace, endpoints: renderEndpoints, findings: renderFindings,
    latency: renderLatency, spec: renderSpec, edge: renderEdge, tests: renderTests
  };

  function renderPanelOnly(name, after) {
    var panel = $('panel-' + name);
    var scroll = window.scrollY;
    clear(panel);
    try { RENDERERS[name](panel); }
    catch (e) {
      panel.appendChild(h('div', { class: 'empty', text: 'This view failed to render: ' + (e && e.message) }));
      if (window.console) console.error(e);
    }
    window.scrollTo(0, scroll);
    if (after) after();
  }

  function render() {
    renderSummary();
    renderPanelOnly(active);
  }

  /* ---------------------------------------------------------------- boot */

  // Alive with zero user input.
  loadHar(H.samples.get('clean'), 'Clean REST API (sample)');
  renderPanelOnly('tests');
})();
