/*!
 * Sepakat — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Sepakat - app.js
 * The only file here that touches the DOM. Everything it renders comes from the
 * engines, the simulator and the property suite unchanged — no numbers are
 * computed for display, so what is on screen is what CI runs.
 *
 * Text from the simulation reaches the page through textContent, never innerHTML.
 * Job titles in this lab are generated, so nothing here is attacker-controlled
 * today; routing them through an escaper anyway costs nothing and means a future
 * change that lets a visitor type a title cannot turn into an injection.
 */
(function () {
  'use strict';
  var S = window.SEPAKAT;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* ------------------------------------------------------------- app state */

  var state = {
    scenarioId: 'lost-update',
    plan: null,
    runs: {},          /* engineId -> simulate() result */
    oracle: null,
    engine: 'crdt',
    frame: 0
  };

  /* ------------------------------------------------------------ egress badge */

  function paintNet() {
    var g = window.SEPAKAT_GUARD;
    if (!g) return;
    var n = g.total();
    $('netCount').textContent = 'network calls from this page: ' + n;
    $('netBadge').className = n > 0 ? 'netbadge hot' : 'netbadge';
  }
  if (window.SEPAKAT_GUARD) window.SEPAKAT_GUARD.onchange = paintNet;

  /* ------------------------------------------------------------------ theme */

  var themeBtn = $('themeBtn');
  function paintTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    themeBtn.textContent = t === 'light' ? 'Dark' : 'Light';
  }
  themeBtn.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('sepakat.theme', next); } catch (e) { /* site data blocked */ }
    paintTheme();
  });
  paintTheme();

  /* ------------------------------------------------------------------- tabs */

  var tabs = Array.prototype.slice.call(document.querySelectorAll('#tabs .tab'));
  function selectTab(id) {
    tabs.forEach(function (t) {
      var on = t.id === id;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (id === 'tab-tests') runSuiteOnce();
  }
  tabs.forEach(function (t) {
    t.addEventListener('click', function () { selectTab(t.id); });
    t.addEventListener('keydown', function (e) {
      var i = tabs.indexOf(t);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        selectTab(next.id);
      }
    });
  });

  /* -------------------------------------------------------------- scenarios */

  function buildScenarioButtons() {
    var wrap = $('scenBtns');
    clear(wrap);
    S.scenarios.forEach(function (sc) {
      var b = el('button', 'scen', sc.name);
      b.type = 'button';
      b.setAttribute('aria-pressed', sc.id === state.scenarioId ? 'true' : 'false');
      b.addEventListener('click', function () { loadScenario(sc.id); });
      wrap.appendChild(b);
    });
  }

  function loadScenario(id) {
    var sc = S.scenario(id);
    if (!sc) return;
    state.scenarioId = id;
    state.plan = sc.build();
    $('seedInput').value = String(state.plan.seed);
    renderBlurb(sc.name, sc.blurb, sc.watch);
    runPlan();
    buildScenarioButtons();
  }

  function loadSeed(seed) {
    state.scenarioId = null;
    state.plan = S.randomPlan(seed, {});
    renderBlurb(
      'Random schedule, seed ' + seed,
      'Four phones, four jobs, about thirty edits, one partition and a duplicate rate of 18%. Nothing here was chosen to make a point — it is whatever this seed produced.',
      'The totals row is the one to read: every engine below is fully converged in most runs, and only one of them is also right.'
    );
    runPlan();
    buildScenarioButtons();
  }

  function renderBlurb(name, blurb, watch) {
    var b = $('blurb');
    clear(b);
    b.appendChild(el('div', 'name', name));
    b.appendChild(el('p', null, blurb));
    b.appendChild(el('p', 'watch', watch));
  }

  function runPlan() {
    state.oracle = S.oracle(state.plan);
    state.runs = {};
    S.engineIds.forEach(function (id) {
      state.runs[id] = S.simulate(id, state.plan, { frames: true });
    });
    state.frame = state.runs[state.engine].frames.length - 1;
    renderVerdicts();
    renderBoards();
    renderTimeline();
    paintNet();
  }

  /* --------------------------------------------------------------- verdicts */

  /* How this engine's totals compare with the sum of every increment in the
     script, for the rows still on the board. Same function the suite uses to
     grade a run — deliberately, so the page cannot flatter an engine the tests
     would fail. */
  function totalsVerdict(engineId) {
    var run = state.runs[engineId];
    if (!run.converged) return { label: 'not comparable', cls: 'bad', note: 'the phones disagree, so there is no single total to check' };
    var got = S.pointsOf(run.reads[0]);
    var low = 0, high = 0, ids = Object.keys(got);
    for (var i = 0; i < ids.length; i++) {
      var want = state.oracle.points[ids[i]] || 0;
      if (got[ids[i]] < want) low++;
      else if (got[ids[i]] > want) high++;
    }
    if (!low && !high) return { label: 'exact', cls: 'good', note: ids.length + ' of ' + ids.length + ' jobs match the sum of every edit' };
    var parts = [];
    if (low) parts.push(low + ' too low');
    if (high) parts.push(high + ' too high');
    return { label: 'wrong', cls: 'bad', note: parts.join(', ') + ' out of ' + ids.length + ' jobs' };
  }

  var ENGINE_BLURB = {
    naive: 'Send the operation, apply it on arrival',
    lww: 'Send state, keep the higher wall-clock stamp',
    crdt: 'Send state, join it — OR-Set, PN-Counter, HLC register'
  };

  function renderVerdicts() {
    var wrap = $('verdicts');
    clear(wrap);
    S.engineIds.forEach(function (id) {
      var run = state.runs[id];
      var card = el('div', 'vcard ' + id);

      var h = el('h3');
      h.appendChild(el('span', 'tagname', id));
      h.appendChild(el('span', null, S.engines[id].label));
      card.appendChild(h);
      card.appendChild(el('div', 'what', ENGINE_BLURB[id]));

      var distinct = {};
      run.hashes.forEach(function (x) { distinct[x] = 1; });
      var n = Object.keys(distinct).length;
      addRow(card, 'Agreement', run.converged ? 'all agree' : n + ' different boards',
        run.converged ? 'good' : 'bad',
        run.converged ? 'every phone serialises identically' : 'and nothing will bring them back together');

      var v = totalsVerdict(id);
      addRow(card, 'Totals', v.label, v.cls, v.note);

      addRow(card, 'Traffic', run.stats.deliveries + ' deliveries', '',
        run.stats.duplicates + ' duplicate, ' + run.stats.reorders + ' overtook an earlier message');
      wrap.appendChild(card);
    });
  }

  function addRow(card, k, v, cls, note) {
    var row = el('div', 'vrow');
    row.appendChild(el('span', 'k', k));
    var val = el('span', 'v' + (cls ? ' ' + cls : ''), v);
    if (note) val.appendChild(el('small', null, note));
    row.appendChild(val);
    card.appendChild(row);
  }

  /* ----------------------------------------------------------------- boards */

  function buildEngineSwitch() {
    var wrap = $('engSwitch');
    clear(wrap);
    S.engineIds.forEach(function (id) {
      var b = el('button', 'eng-btn ' + id, id);
      b.type = 'button';
      b.setAttribute('aria-pressed', id === state.engine ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.engine = id;
        state.frame = state.runs[id].frames.length - 1;
        buildEngineSwitch();
        renderBoards();
        renderTimeline();
      });
      wrap.appendChild(b);
    });
  }

  function renderBoards() {
    buildEngineSwitch();
    var run = state.runs[state.engine];
    renderReplicaGrid($('replicas'), run, run.reads);
    var legend = $('boardLegend');
    clear(legend);
    var b = el('b', null, 'Reading this: ');
    legend.appendChild(b);
    legend.appendChild(document.createTextNode(
      run.converged
        ? 'every phone is showing the same board. Whether that board is CORRECT is the “Totals” row above — converging and being right are different properties, and this is the tab that cannot tell them apart.'
        : 'the phones are showing different boards, and every message has already been delivered. There is no pending state left to fix this.'
    ));
  }

  function renderReplicaGrid(container, run, reads) {
    clear(container);
    var first = S.canonicalJson(reads[0]);
    run.ids.forEach(function (id, i) {
      var odd = S.canonicalJson(reads[i]) !== first;
      var col = el('div', 'rep' + (odd ? ' odd' : ''));

      var head = el('div', 'rep-head');
      head.appendChild(el('span', 'who', id));
      head.appendChild(el('span', 'hash', S.shortHash(reads[i])));
      col.appendChild(head);

      var skew = state.plan.replicas[i].skew;
      if (skew) col.appendChild(el('div', 'skew', 'clock ' + (skew > 0 ? '+' : '') + (skew / 1000).toFixed(1) + ' s'));

      if (!reads[i].tasks.length) col.appendChild(el('div', 'empty', 'no jobs yet'));
      reads[i].tasks.forEach(function (task) { col.appendChild(renderJob(task)); });
      container.appendChild(col);
    });
  }

  function renderJob(task) {
    var j = el('div', 'job');
    var top = el('div', 'jt');
    var left = el('div');
    left.appendChild(el('div', 'jid', task.id));
    left.appendChild(el('div', 'jtitle', task.title || '(no title yet)'));
    top.appendChild(left);
    top.appendChild(el('span', 'pts', task.points));
    j.appendChild(top);

    var meta = el('div', 'meta');
    meta.appendChild(el('span', 'st', task.status));
    task.tags.forEach(function (t) { meta.appendChild(el('span', 'tg', '#' + t)); });
    j.appendChild(meta);
    return j;
  }

  /* --------------------------------------------------------------- timeline */

  function renderTimeline() {
    var run = state.runs[state.engine];
    var frames = run.frames;
    var scrub = $('scrubber');
    scrub.max = String(frames.length - 1);
    if (state.frame > frames.length - 1) state.frame = frames.length - 1;
    scrub.value = String(state.frame);
    paintFrame();
  }

  function paintFrame() {
    var run = state.runs[state.engine];
    var frames = run.frames;
    var f = frames[state.frame];
    $('scrubPos').textContent = state.frame + ' / ' + (frames.length - 1) + '  ·  t=' + f.t + 'ms';
    renderReplicaGrid($('tlReplicas'), run, f.states);

    var log = $('tlLog');
    clear(log);
    /* A window around the cursor rather than the whole log: a random schedule
       runs to a few hundred events and rebuilding all of them on every drag is
       both slow and unreadable. */
    var from = Math.max(0, state.frame - 40), to = Math.min(frames.length - 1, state.frame + 12);
    for (var i = from; i <= to; i++) {
      var fr = frames[i];
      var cls = 'tl-row ' + (fr.kind === 'local' ? 'local' : '') + (fr.dup ? ' dup' : '') + (i === state.frame ? ' now' : '');
      var row = el('div', cls);
      row.appendChild(el('span', 't', fr.t === undefined ? '' : fr.t + 'ms'));
      row.appendChild(el('span', 'who', fr.kind === 'start' ? '—' :
        (fr.kind === 'local' ? fr.at : fr.from + '→' + fr.at)));
      row.appendChild(el('span', 'what', (fr.dup ? 'duplicate · ' : '') + (fr.text || '')));
      log.appendChild(row);
      if (i === state.frame) {
        /* Keep the cursor visible without scrolling the page itself. */
        var top = row.offsetTop - log.clientHeight / 2;
        log.scrollTop = Math.max(0, top);
      }
    }
  }

  $('scrubber').addEventListener('input', function () {
    state.frame = parseInt(this.value, 10) || 0;
    paintFrame();
  });
  $('scrubEnd').addEventListener('click', function () {
    state.frame = state.runs[state.engine].frames.length - 1;
    $('scrubber').value = String(state.frame);
    paintFrame();
  });

  /* ------------------------------------------------------------ text merge */

  var BASE_NOTE = 'Ganti filter, unit masih bising.';
  var textDocs = null;

  function resetText() {
    var base = S.text.newDoc('base', BASE_NOTE);
    textDocs = {
      a: S.text.forkDoc(base, 'a'),
      b: S.text.forkDoc(base, 'b'),
      /* Whole-string last-writer-wins needs a stamp per side. Simulation time
         here is just "who typed most recently", which is the most generous
         reading of LWW available — no skew, no lost message. It still cannot
         keep both edits. */
      stampA: 0, stampB: 0, tick: 0
    };
    $('taA').value = BASE_NOTE;
    $('taB').value = BASE_NOTE;
    paintText();
  }

  function onType(side) {
    var ta = side === 'a' ? $('taA') : $('taB');
    var res = S.text.edit(textDocs[side], ta.value);
    textDocs[side] = res.doc;
    textDocs.tick++;
    if (side === 'a') textDocs.stampA = textDocs.tick; else textDocs.stampB = textDocs.tick;
    paintText(res.edit, side);
  }

  function paintText(lastEdit, side) {
    var merged = S.text.merge(textDocs.a, textDocs.b);
    var rgaText = S.text.read(merged);
    $('outRga').textContent = rgaText || '(empty)';

    var lwwText = textDocs.stampB >= textDocs.stampA ? S.text.read(textDocs.b) : S.text.read(textDocs.a);
    $('outLww').textContent = lwwText || '(empty)';

    var a = S.text.read(textDocs.a), b = S.text.read(textDocs.b);
    var kept = (a !== BASE_NOTE && rgaText.indexOf(diffPart(BASE_NOTE, a)) >= 0) ||
      (b !== BASE_NOTE && rgaText.indexOf(diffPart(BASE_NOTE, b)) >= 0);
    $('whyRga').textContent = (a === b)
      ? 'Both copies are the same, so there is nothing to merge yet.'
      : (kept
        ? 'Both edits are present. The two copies were merged character by character, so neither had to lose.'
        : 'Both copies were merged as sequences; the result is the same on both sides regardless of merge order.');

    $('whyLww').textContent = (a === b)
      ? 'Nothing to choose between yet.'
      : 'One whole copy replaced the other — ' + (textDocs.stampB >= textDocs.stampA ? "Budi's" : "Ari's") +
        ', because it was typed last. Everything the other person wrote is gone, and no clock skew or lost message was needed for that.';

    if (lastEdit) {
      var note = side === 'a' ? $('noteA') : $('noteB');
      note.textContent = 'last edit: ' + (lastEdit.del ? 'deleted ' + lastEdit.del + ' char' + (lastEdit.del === 1 ? '' : 's') : 'no deletion') +
        ' at ' + lastEdit.pos + (lastEdit.ins ? ', inserted ' + JSON.stringify(lastEdit.ins) : '');
    }
  }

  /* The part of `after` that is not in `before`, used only to word the
     explanation under the merged text. */
  function diffPart(before, after) { return S.text.diff(before, after).ins; }

  $('taA').addEventListener('input', function () { onType('a'); });
  $('taB').addEventListener('input', function () { onType('b'); });
  $('textReset').addEventListener('click', resetText);

  /* ------------------------------------------------------------ properties */

  var suiteRan = false;
  function runSuiteOnce() {
    if (suiteRan) return;
    suiteRan = true;
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    var out = S.runTests();
    var ms = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;

    var stats = $('testStats');
    clear(stats);
    stat(stats, out.passed, 'passed', out.failed ? '' : 'ok');
    stat(stats, out.failed, 'failed', out.failed ? 'bad' : '');
    stat(stats, out.properties, 'properties');
    stat(stats, out.executions.toLocaleString('en-US'), 'executions');
    stat(stats, out.negatives, 'negative');
    stat(stats, Math.round(ms) + ' ms', 'to run');

    var groups = $('testGroups');
    clear(groups);
    out.byGroup.forEach(function (g) {
      var row = el('div', 'tgroup' + (g.failed ? ' failed' : ''));
      row.appendChild(el('span', null, g.name));
      row.appendChild(el('span', 'n', g.failed ? g.failed + ' failed of ' + g.total : g.total));
      groups.appendChild(row);
    });

    var fails = $('testFails');
    clear(fails);
    out.results.filter(function (r) { return !r.ok; }).forEach(function (r) {
      var f = el('div', 'fail');
      f.appendChild(el('div', null, r.group + ' → ' + r.name));
      f.appendChild(el('div', 'msg', r.message));
      fails.appendChild(f);
    });
  }

  function stat(wrap, num, lbl, cls) {
    var s = el('div', 'stat' + (cls ? ' ' + cls : ''));
    s.appendChild(el('div', 'num', num));
    s.appendChild(el('div', 'lbl', lbl));
    wrap.appendChild(s);
  }

  /* ------------------------------------------------------------------- boot */

  $('seedGo').addEventListener('click', function () {
    var v = parseInt($('seedInput').value, 10);
    loadSeed(isFinite(v) ? v : 1907);
  });
  $('seedInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $('seedGo').click(); }
  });
  $('seedRandom').addEventListener('click', function () {
    /* Math.random only chooses which reproducible run to show; the run itself is
       a pure function of the seed, and the seed stays in the box. */
    var seed = 1 + Math.floor(Math.random() * 99998);
    $('seedInput').value = String(seed);
    loadSeed(seed);
  });

  buildScenarioButtons();
  loadScenario('lost-update');
  resetText();
  paintNet();
})();
