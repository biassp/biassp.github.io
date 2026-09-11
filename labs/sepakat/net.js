/*!
 * Sepakat — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Sepakat - net.js
 * The network the three engines have to survive, as a deterministic discrete-event
 * simulation. Same seed, same run, on any machine — which is what makes a failure
 * here something you can hand to someone else rather than something you saw once.
 *
 * The assumptions are the weakest ones a CRDT actually needs, and no weaker:
 *
 *   - Messages arrive EVENTUALLY. Nothing is dropped for good. A link that is
 *     down defers its traffic to the moment it comes back up rather than
 *     discarding it, because "lost forever" would let a divergence be blamed on
 *     the network instead of on the merge.
 *   - Order is not promised. Latency is drawn per link per message, so a later
 *     message routinely overtakes an earlier one.
 *   - Delivery is at-least-once. A message may be delivered twice, to one peer
 *     and not another.
 *   - Clocks disagree. Each replica carries a fixed skew against simulation time.
 *
 * All three engines run against the SAME generated plan — the same user actions
 * at the same times, the same latencies, the same duplicates, the same partition
 * windows. If one of them ends up worse than another, the network is not the
 * reason, and that is the only way the comparison means anything.
 */
(function (root) {
  'use strict';
  var S = root.SEPAKAT || {}; root.SEPAKAT = S;

  /* --------------------------------------------------------------- links */

  /* Is the link between a and b down at time t? Windows are half-open [from,to)
     so a heal at t=to delivers at t=to. */
  function linkDown(plan, a, b, t) {
    for (var i = 0; i < plan.partitions.length; i++) {
      var p = plan.partitions[i];
      if (t < p.from || t >= p.to) continue;
      if (sideOf(p, a) !== sideOf(p, b)) return p.to;
    }
    return 0;
  }

  function sideOf(p, id) { return p.split[0].indexOf(id) >= 0 ? 0 : 1; }

  /* Earliest moment this message can leave, given every partition window it has
     to sit through. The loop matters: healing into a second window is possible
     and must push the message again rather than let it slip out. */
  function departAt(plan, a, b, t) {
    var at = t;
    for (var guard = 0; guard < 64; guard++) {
      var heal = linkDown(plan, a, b, at);
      if (!heal) return at;
      at = heal;
    }
    return at;
  }

  /* ----------------------------------------------------------- simulation */

  function simulate(engineId, plan, opts) {
    opts = opts || {};
    var engine = S.engines[engineId];
    if (!engine) throw new Error('simulate: unknown engine ' + engineId);

    var rng = S.rng(plan.seed ^ 0x5ca1ab1e);
    var reps = {};
    var ids = [];
    for (var i = 0; i < plan.replicas.length; i++) {
      var r = plan.replicas[i];
      reps[r.id] = S.makeReplica(engine, r.id, r.skew);
      ids.push(r.id);
    }

    var queue = [];
    var seq = 0;
    function push(ev) { ev.seq = seq++; queue.push(ev); }

    for (var j = 0; j < plan.script.length; j++) {
      var a = plan.script[j];
      push({ t: a.at, kind: 'local', to: a.replica, intent: a.intent });
    }

    var log = [];
    var frames = [];
    var stats = { messages: 0, deliveries: 0, duplicates: 0, deferred: 0, reorders: 0 };
    /* Highest sequence number delivered so far per (receiver, sender) pair. A
       message arriving below that watermark was overtaken by a later one from
       the same peer — the reordering the whole exercise assumes, counted rather
       than asserted by hand. */
    var watermark = {};

    function snapshot() {
      var out = [];
      for (var k = 0; k < ids.length; k++) out.push(engine.read(reps[ids[k]]));
      return out;
    }

    if (opts.frames) frames.push({ t: 0, kind: 'start', text: 'initial state', states: snapshot() });

    /* Pop the earliest event; ties broken by insertion order so the run is a
       function of the plan alone. A sorted array is O(n log n) per step and n
       here is in the hundreds — a heap would be faster and harder to read. */
    var steps = 0;
    while (queue.length) {
      if (++steps > 200000) throw new Error('simulate: event budget exhausted');
      queue.sort(function (x, y) { return (x.t - y.t) || (x.seq - y.seq); });
      var ev = queue.shift();
      var rep = reps[ev.to];

      if (ev.kind === 'local') {
        var msg = engine.local(rep, ev.intent, ev.t);
        stats.messages++;
        log.push({ t: ev.t, kind: 'local', at: ev.to, text: describe(ev.intent), intent: ev.intent });

        for (var p = 0; p < ids.length; p++) {
          if (ids[p] === ev.to) continue;
          var leave = departAt(plan, ev.to, ids[p], ev.t);
          if (leave > ev.t) stats.deferred++;
          var lat = rng.range(plan.latency[0], plan.latency[1]);
          push({ t: leave + lat, kind: 'deliver', to: ids[p], from: ev.to, msg: msg });
          /* At-least-once, per peer. One replica seeing a message twice while
             its neighbour sees it once is the whole hazard, so the coin is
             flipped per link and not per message. */
          if (rng.bool(plan.dupRate)) {
            var lat2 = rng.range(plan.latency[0], plan.latency[1] * 2);
            push({ t: departAt(plan, ev.to, ids[p], leave + lat) + lat2, kind: 'deliver', to: ids[p], from: ev.to, msg: msg, dup: true });
          }
        }
      } else {
        engine.deliver(rep, ev.msg, ev.t);
        rep.applied++;
        stats.deliveries++;
        if (ev.dup) stats.duplicates++;
        /* Duplicates are excluded from the count on purpose. A retry of an old
           message trivially arrives "below the watermark", so counting it would
           let a network that never actually reorders anything still report a
           healthy reorder rate — which it did, and hid a fixed-latency mutation
           from this suite until the count was narrowed to first deliveries. */
        if (!ev.dup) {
          var pair = ev.to + '<' + ev.from;
          if (watermark[pair] !== undefined && ev.msg.seq < watermark[pair]) stats.reorders++;
          else watermark[pair] = ev.msg.seq;
        }
        log.push({ t: ev.t, kind: 'deliver', at: ev.to, from: ev.from, dup: !!ev.dup, text: describe(ev.msg.intent || null, ev.msg) });
      }

      if (opts.frames) {
        var last = log[log.length - 1];
        frames.push({ t: ev.t, kind: last.kind, at: last.at, from: last.from, dup: !!last.dup, text: last.text, states: snapshot() });
      }
    }

    var reads = [];
    var hashes = [];
    for (var q = 0; q < ids.length; q++) {
      var rd = engine.read(reps[ids[q]]);
      reads.push(rd);
      hashes.push(S.shortHash(rd));
    }

    var converged = true;
    var first = S.canonicalJson(reads[0]);
    for (var z = 1; z < reads.length; z++) if (S.canonicalJson(reads[z]) !== first) converged = false;

    return {
      engine: engineId, ids: ids, replicas: reps, reads: reads, hashes: hashes,
      converged: converged, log: log, frames: frames, stats: stats
    };
  }

  /* Naming what is actually in a message. An op-log message carries the intent
     and reads for itself; a state message carries a piece of lattice, and
     labelling every one of them "state delta" would make the timeline useless
     for the two engines the lab is mainly about. */
  function describeDelta(delta) {
    if (!delta) return 'state delta';
    var parts = [];
    if (delta.present) {
      var addIds = Object.keys(delta.present.adds || {});
      if (addIds.length) parts.push('opens ' + addIds.join(', '));
      if (Object.keys(delta.present.tomb || {}).length) parts.push('closes a job');
    }
    for (var id in delta.tasks) if (Object.prototype.hasOwnProperty.call(delta.tasks, id)) {
      var f = delta.tasks[id], fields = [];
      if (f.title) fields.push('title');
      if (f.status) fields.push('status');
      if (f.points) fields.push('points');
      if (f.tags && (Object.keys(f.tags.adds || f.tags).length || Object.keys(f.tags.tomb || {}).length)) fields.push('tags');
      if (f.present) fields.push(f.present.v ? 'exists' : 'closed');
      if (fields.length) parts.push(id + ' · ' + fields.join(', '));
    }
    return parts.length ? parts.join(' · ') : 'state delta (nothing new)';
  }

  function describe(intent, msg) {
    if (!intent) return msg ? describeDelta(msg.delta) : 'message';
    switch (intent.k) {
      case 'create': return 'create ' + intent.id + ' “' + intent.title + '” (' + intent.points + ' pts)';
      case 'rename': return 'rename ' + intent.id + ' → “' + intent.title + '”';
      case 'status': return intent.id + ' → ' + intent.status;
      case 'points': return intent.id + ' ' + (intent.delta >= 0 ? '+' : '') + intent.delta + ' pts';
      case 'tag': return (intent.on ? 'tag ' : 'untag ') + intent.id + ' #' + intent.tag;
      case 'delete': return 'close ' + intent.id;
      default: return intent.k;
    }
  }

  /* ------------------------------------------------------------- the oracle
   * What the board WOULD hold if every action had happened one at a time on one
   * machine, for the parts where that question has a single answer regardless of
   * interleaving.
   *
   * Only two such parts exist here, and the restraint is the point. A counter is
   * addition, and addition does not care about order, so the total is knowable
   * and any engine that disagrees with it has lost or invented something. A
   * single-value field under concurrent writes has no such answer — asking for
   * one would be inventing a requirement no design can meet, and then scoring
   * designs against it.
   */
  function oracle(plan) {
    var points = {};
    var created = {};
    var closed = {};
    for (var i = 0; i < plan.script.length; i++) {
      var it = plan.script[i].intent;
      if (it.k === 'create') { created[it.id] = true; points[it.id] = (points[it.id] || 0) + it.points; }
      else if (it.k === 'points') points[it.id] = (points[it.id] || 0) + it.delta;
      else if (it.k === 'delete') closed[it.id] = true;
    }
    return { points: points, created: created, closed: closed };
  }

  /* Total of every point movement the script contains, for the rows still on the
     board. An engine that ships a different number has either dropped somebody's
     work or counted it twice. */
  function pointsOf(read) {
    var m = {};
    for (var i = 0; i < read.tasks.length; i++) m[read.tasks[i].id] = read.tasks[i].points;
    return m;
  }

  /* --------------------------------------------------------- plan builders */

  var TITLES = [
    'AC unit 2F not cooling', 'Replace router at branch', 'Quarterly generator service',
    'CCTV camera 4 offline', 'Water pump pressure low', 'Rewire panel B',
    'POS terminal keeps rebooting', 'Fire alarm panel fault', 'Lift door sensor',
    'Server room temperature alarm'
  ];
  var TAGS = ['urgent', 'parts-needed', 'warranty', 'callback', 'billable'];
  var NAMES = ['ari', 'budi', 'citra', 'dewi'];

  /* Every name, title and tag above is invented for this page, and the seeded
     PRNG below is the only source of "history" in the lab. No customer, job or
     technician here corresponds to anything real. */
  function randomPlan(seed, opts) {
    opts = opts || {};
    var rng = S.rng(seed);
    var n = opts.replicas || 4;
    var replicas = [];
    for (var i = 0; i < n; i++) {
      replicas.push({
        id: NAMES[i % NAMES.length] + (i >= NAMES.length ? String(i) : ''),
        /* One phone is always meaningfully wrong, the rest are ordinary NTP
           drift. A skew of a few seconds is not exotic — it is a phone that has
           been in a basement since breakfast. */
        skew: i === 0 ? (opts.skew === undefined ? 4200 : opts.skew) : rng.range(-400, 400)
      });
    }
    var ids = replicas.map(function (r) { return r.id; });

    var script = [];
    var taskIds = [];
    var t = 0;
    var jobs = opts.jobs || 4;
    for (var j = 0; j < jobs; j++) {
      var tid = 'J' + (101 + j);
      taskIds.push(tid);
      script.push({
        at: t, replica: ids[j % ids.length],
        intent: { k: 'create', id: tid, title: rng.pick(TITLES), status: 'queued', points: rng.range(1, 5) }
      });
      t += rng.range(5, 40);
    }

    var edits = opts.edits || 30;
    for (var e = 0; e < edits; e++) {
      var id = rng.pick(taskIds);
      var who = rng.pick(ids);
      var roll = rng();
      var intent;
      if (roll < 0.34) intent = { k: 'points', id: id, delta: rng.range(1, 6) * (rng.bool(0.2) ? -1 : 1) };
      else if (roll < 0.55) intent = { k: 'tag', id: id, tag: rng.pick(TAGS), on: rng.bool(0.65) };
      else if (roll < 0.75) intent = { k: 'status', id: id, status: rng.pick(S.STATUSES) };
      else if (roll < 0.95) intent = { k: 'rename', id: id, title: rng.pick(TITLES) + ' (' + who + ')' };
      else intent = { k: 'delete', id: id };
      script.push({ at: t, replica: who, intent: intent });
      /* Bursts of near-simultaneous edits are where concurrency lives, so the
         gap is usually small and occasionally long. A uniform gap would mostly
         produce a schedule with no concurrency in it at all. */
      t += rng.bool(0.55) ? rng.range(0, 6) : rng.range(20, 90);
    }

    var partitions = [];
    if (opts.partition !== false && n >= 2) {
      var half = Math.ceil(n / 2);
      var from = Math.floor(t * 0.25);
      partitions.push({
        from: from, to: from + (opts.partitionLen || Math.floor(t * 0.35)),
        split: [ids.slice(0, half), ids.slice(half)]
      });
    }

    return {
      seed: seed,
      replicas: replicas,
      script: script.sort(function (a, b) { return a.at - b.at; }),
      latency: opts.latency || [8, 120],
      dupRate: opts.dupRate === undefined ? 0.18 : opts.dupRate,
      partitions: partitions,
      taskIds: taskIds
    };
  }

  /* --------------------------------------------------------- set pieces
   * Hand-written plans, each one aimed at a single failure that is easy to
   * describe and hard to believe until you watch it. Small on purpose: every
   * event fits on screen, so nothing is hiding in a long log.
   */
  var SCENARIOS = [
    {
      id: 'lost-update',
      name: 'Two technicians, one job, both offline',
      blurb: 'Ari and Budi are both at the same site with no signal. Ari books 3 extra points of labour, Budi books 2. Both come back online. The job started at 5.',
      watch: 'The board should read 10. Watch what each engine makes it.',
      build: function () {
        return {
          seed: 7,
          replicas: [{ id: 'ari', skew: 0 }, { id: 'budi', skew: 0 }, { id: 'citra', skew: 0 }],
          script: [
            { at: 0, replica: 'ari', intent: { k: 'create', id: 'J101', title: 'AC unit 2F not cooling', status: 'queued', points: 5 } },
            { at: 300, replica: 'ari', intent: { k: 'points', id: 'J101', delta: 3 } },
            { at: 310, replica: 'budi', intent: { k: 'points', id: 'J101', delta: 2 } }
          ],
          latency: [20, 60], dupRate: 0,
          partitions: [{ from: 200, to: 600, split: [['ari'], ['budi', 'citra']] }],
          taskIds: ['J101']
        };
      }
    },
    {
      id: 'skew',
      name: 'The phone with the fast clock',
      blurb: "Ari's phone is 4.2 seconds ahead. He renames the job, and a full second later Budi renames it to the correct title — the last edit anyone made.",
      watch: 'Under a wall-clock winner, the newer edit is the one that disappears.',
      build: function () {
        return {
          seed: 11,
          replicas: [{ id: 'ari', skew: 4200 }, { id: 'budi', skew: 0 }, { id: 'citra', skew: -150 }],
          script: [
            { at: 0, replica: 'citra', intent: { k: 'create', id: 'J101', title: 'Job created from call centre', status: 'queued', points: 2 } },
            { at: 400, replica: 'ari', intent: { k: 'rename', id: 'J101', title: 'AC unit — check filter' } },
            { at: 1400, replica: 'budi', intent: { k: 'rename', id: 'J101', title: 'AC unit — compressor replacement' } }
          ],
          latency: [20, 60], dupRate: 0, partitions: [], taskIds: ['J101']
        };
      }
    },
    {
      id: 'duplicate',
      name: 'The message that arrived twice',
      blurb: 'A flaky uplink retries every message. Some peers get a delivery twice, some once. Nobody is offline and no clock is wrong.',
      watch: 'At-least-once delivery is normal. Only one of the three engines is allowed to be bored by it.',
      build: function () {
        return {
          seed: 23,
          replicas: [{ id: 'ari', skew: 0 }, { id: 'budi', skew: 0 }, { id: 'citra', skew: 0 }, { id: 'dewi', skew: 0 }],
          script: [
            { at: 0, replica: 'ari', intent: { k: 'create', id: 'J101', title: 'Water pump pressure low', status: 'queued', points: 4 } },
            { at: 200, replica: 'budi', intent: { k: 'points', id: 'J101', delta: 2 } },
            { at: 260, replica: 'citra', intent: { k: 'points', id: 'J101', delta: 1 } },
            { at: 320, replica: 'dewi', intent: { k: 'points', id: 'J101', delta: 3 } }
          ],
          latency: [10, 90], dupRate: 0.85, partitions: [], taskIds: ['J101']
        };
      }
    },
    {
      id: 'tag-race',
      name: 'Removing a tag someone is adding',
      blurb: 'Citra clears the #urgent flag on a job. At the same moment, on the other side of a dead link, Dewi speaks to the customer and flags it #urgent again. Dewi\u2019s phone is 0.9 s behind.',
      watch: 'Two defensible answers exist here, and picking either one is fine. What is not fine is picking it by whose clock was slow — which is what decides it under a wall-clock winner, and why the later, better-informed edit is the one that vanishes.',
      build: function () {
        return {
          seed: 31,
          replicas: [{ id: 'citra', skew: 0 }, { id: 'dewi', skew: -900 }, { id: 'ari', skew: -200 }],
          script: [
            { at: 0, replica: 'ari', intent: { k: 'create', id: 'J101', title: 'Fire alarm panel fault', status: 'queued', points: 3 } },
            { at: 100, replica: 'ari', intent: { k: 'tag', id: 'J101', tag: 'urgent', on: true } },
            { at: 500, replica: 'citra', intent: { k: 'tag', id: 'J101', tag: 'urgent', on: false } },
            { at: 520, replica: 'dewi', intent: { k: 'tag', id: 'J101', tag: 'urgent', on: true } }
          ],
          latency: [15, 50], dupRate: 0,
          partitions: [{ from: 400, to: 900, split: [['citra'], ['dewi', 'ari']] }],
          taskIds: ['J101']
        };
      }
    },
    {
      id: 'partition',
      name: 'Half the crew in a basement',
      blurb: 'A ten-minute split: two phones on one side, two on the other, both sides working the same three jobs, then everyone back on the network at once.',
      watch: 'The full mess — concurrent edits, a close, a re-tag, duplicates — with nothing hand-picked.',
      build: function () { return randomPlan(1907, { replicas: 4, jobs: 3, edits: 22, dupRate: 0.25, skew: 3000 }); }
    }
  ];

  function scenario(id) {
    for (var i = 0; i < SCENARIOS.length; i++) if (SCENARIOS[i].id === id) return SCENARIOS[i];
    return null;
  }

  S.simulate = simulate;
  S.oracle = oracle;
  S.pointsOf = pointsOf;
  S.randomPlan = randomPlan;
  S.scenarios = SCENARIOS;
  S.scenario = scenario;
  S.describeIntent = describe;
  S.describeDelta = describeDelta;

  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
