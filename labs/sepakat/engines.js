/*!
 * Sepakat — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Sepakat - engines.js
 * Three ways to sync the same board, behind one interface, so the simulator can
 * run all three against a single schedule and the difference between them is the
 * only variable.
 *
 * The board is a field-service job list: four technicians' phones, each holding
 * a full copy, each editing offline, gossiping directly to the others when they
 * have signal. No server, no leader, no lock.
 *
 *   naive  Ships the operation and applies it on arrival. What sync looks like
 *          when it is written in an afternoon. Arrival order is the order, and a
 *          message that arrives twice happens twice.
 *
 *   lww    Ships state, keeps the write with the higher wall-clock stamp. Every
 *          replica ends up identical — this one really does converge — and the
 *          state they agree on is missing writes nobody was told about. Which
 *          write survives is decided by whose phone clock was fast.
 *
 *   crdt   Ships state, merges by join. OR-Set for what exists, PN-Counter for
 *          the numbers, HLC-stamped registers for the single-value fields.
 *          Converges, and the numbers are the numbers.
 *
 * The interface is deliberately identical, including the intents: the schedule
 * that drives them is one array of user actions, and none of the three gets to
 * see a different one.
 *
 * Honest scope, stated once and repeated in the UI: `crdt` uses a register for
 * the title, so two technicians renaming one job concurrently still resolves to
 * one title — deterministically, by HLC, rather than by clock skew. Merging text
 * character by character is a different type (RGA), which this lab implements
 * and demonstrates on its own tab. A board field is not text just because it
 * holds a string.
 */
(function (root) {
  'use strict';
  var S = root.SEPAKAT || {}; root.SEPAKAT = S;
  var C = S.crdt;

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function sortedKeys(o) { return Object.keys(o).sort(); }

  var STATUSES = ['queued', 'travelling', 'on-site', 'done'];

  /* Local stamp for the wall-clock engine. `now` is simulation time; skew is
     this device's error against it. The max() keeps a single device's own
     stamps strictly increasing, which every real implementation does and which
     is what makes a stamp unique — it does nothing about the skew BETWEEN
     devices, and the skew is the part that decides who wins. */
  function wallStamp(rep, now) {
    var ts = Math.max(rep.lastTs + 1, now + rep.skew);
    rep.lastTs = ts;
    return { ts: ts, id: rep.id };
  }

  function hlcStamp(rep, now) {
    rep.hlc = S.hlcLocal(rep.hlc, now + rep.skew);
    return { wall: rep.hlc.wall, count: rep.hlc.count, id: rep.hlc.id };
  }

  function nextTag(rep) { rep.seq++; return rep.id + ':' + rep.seq; }

  /* ================================================================== naive */

  var naive = {
    id: 'naive',
    label: 'Operation log',
    newState: function () { return { tasks: {} }; },

    local: function (rep, intent, now) {
      rep.seq++;
      var msg = { from: rep.id, seq: rep.seq, at: now, intent: intent };
      naive.applyIntent(rep, intent);
      return msg;
    },

    deliver: function (rep, msg) { naive.applyIntent(rep, msg.intent); },

    /* No dedupe, no ordering, no causality. Everything this engine gets wrong,
       it gets wrong here, and all of it looks reasonable line by line. */
    applyIntent: function (rep, it) {
      var t = rep.state.tasks;
      if (it.k === 'create') {
        t[it.id] = { title: it.title, status: it.status, points: it.points, tags: {} };
      } else if (it.k === 'delete') {
        delete t[it.id];
      } else if (t[it.id]) {
        if (it.k === 'rename') t[it.id].title = it.title;
        else if (it.k === 'status') t[it.id].status = it.status;
        else if (it.k === 'points') t[it.id].points += it.delta;
        else if (it.k === 'tag') {
          if (it.on) t[it.id].tags[it.tag] = 1; else delete t[it.id].tags[it.tag];
        }
      }
      /* An edit for a task this replica has not heard of yet is dropped on the
         floor. Not a shortcut: it is what happens when there is nothing to
         attach the edit to and no buffer to hold it in. */
    },

    read: function (rep) {
      var out = [];
      var ids = sortedKeys(rep.state.tasks);
      for (var i = 0; i < ids.length; i++) {
        var t = rep.state.tasks[ids[i]];
        out.push({ id: ids[i], title: t.title, status: t.status, points: t.points, tags: sortedKeys(t.tags) });
      }
      return { tasks: out };
    }
  };

  /* ==================================================================== lww */

  function lwwField(v, s) { return { v: v, s: s }; }

  var lww = {
    id: 'lww',
    label: 'Last writer wins',
    newState: function () { return { tasks: {} }; },

    local: function (rep, intent, now) {
      var st = wallStamp(rep, now);
      var delta = lww.deltaFor(rep, intent, st);
      lww.mergeInto(rep.state, delta);
      return { from: rep.id, seq: ++rep.seq, at: now, delta: delta };
    },

    /* Every intent becomes a small piece of state stamped with this device's
       idea of the time. `points` is the one to look at: a relative "+3" has to
       be read, added and written back as an absolute number, because an
       absolute number is all a register can hold. Two devices doing that
       concurrently both write 8 over a 5, and one of the +3s is gone. Nothing
       in the message says so. */
    deltaFor: function (rep, it, st) {
      var d = { tasks: {} };
      var cur = rep.state.tasks[it.id];
      var f = d.tasks[it.id] = {};
      if (it.k === 'create') {
        f.present = lwwField(true, st);
        f.title = lwwField(it.title, st);
        f.status = lwwField(it.status, st);
        f.points = lwwField(it.points, st);
        f.tags = {};
      } else if (it.k === 'delete') {
        f.present = lwwField(false, st);
      } else if (it.k === 'rename') {
        f.title = lwwField(it.title, st);
      } else if (it.k === 'status') {
        f.status = lwwField(it.status, st);
      } else if (it.k === 'points') {
        var base = (cur && cur.points) ? cur.points.v : 0;
        f.points = lwwField(base + it.delta, st);
      } else if (it.k === 'tag') {
        f.tags = {};
        f.tags[it.tag] = lwwField(!!it.on, st);
      }
      return d;
    },

    deliver: function (rep, msg) { lww.mergeInto(rep.state, msg.delta); },

    mergeInto: function (state, delta) {
      for (var id in delta.tasks) if (has(delta.tasks, id)) {
        var src = delta.tasks[id];
        var dst = state.tasks[id] || (state.tasks[id] = { tags: {} });
        ['present', 'title', 'status', 'points'].forEach(function (k) {
          if (!src[k]) return;
          dst[k] = dst[k] ? C.lwwMerge(dst[k], src[k], S.stampCompare) : src[k];
        });
        if (src.tags) {
          for (var tg in src.tags) if (has(src.tags, tg)) {
            dst.tags[tg] = dst.tags[tg] ? C.lwwMerge(dst.tags[tg], src.tags[tg], S.stampCompare) : src.tags[tg];
          }
        }
      }
    },

    read: function (rep) {
      var out = [];
      var ids = sortedKeys(rep.state.tasks);
      for (var i = 0; i < ids.length; i++) {
        var t = rep.state.tasks[ids[i]];
        if (!t.present || t.present.v !== true) continue;
        var tags = [];
        var tg = sortedKeys(t.tags);
        for (var j = 0; j < tg.length; j++) if (t.tags[tg[j]].v === true) tags.push(tg[j]);
        out.push({
          id: ids[i],
          title: t.title ? t.title.v : '',
          status: t.status ? t.status.v : 'queued',
          points: t.points ? t.points.v : 0,
          tags: tags
        });
      }
      return { tasks: out };
    }
  };

  /* =================================================================== crdt */

  var crdt = {
    id: 'crdt',
    label: 'CRDT join',
    newState: function () { return { present: C.orNew(), tasks: {} }; },

    local: function (rep, intent, now) {
      var st = hlcStamp(rep, now);
      var delta = crdt.deltaFor(rep, intent, st);
      crdt.mergeInto(rep.state, delta);
      return { from: rep.id, seq: ++rep.seq, at: now, delta: delta };
    },

    deltaFor: function (rep, it, st) {
      var d = { present: C.orNew(), tasks: {} };
      var f = d.tasks[it.id] = {};
      if (it.k === 'create') {
        d.present = C.orAdd(C.orNew(), it.id, nextTag(rep));
        f.title = { v: it.title, s: st };
        f.status = { v: it.status, s: st };
        f.points = ownCounter(rep, it.id, it.points);
        f.tags = C.orNew();
      } else if (it.k === 'delete') {
        /* Bury only the add-tags this replica has actually observed. A create
           it has never seen is not buried, and survives the delete on purpose:
           you cannot remove what you have not seen. */
        d.present = C.orRemove(observedPresence(rep, it.id), it.id);
      } else if (it.k === 'rename') {
        f.title = { v: it.title, s: st };
      } else if (it.k === 'status') {
        f.status = { v: it.status, s: st };
      } else if (it.k === 'points') {
        f.points = ownCounter(rep, it.id, it.delta);
      } else if (it.k === 'tag') {
        var tags = (rep.state.tasks[it.id] && rep.state.tasks[it.id].tags) || C.orNew();
        f.tags = it.on
          ? C.orAdd(C.orNew(), it.tag, nextTag(rep))
          : C.orRemove(observedTag(tags, it.tag), it.tag);
      }
      return d;
    },

    /* Advancing the clock on RECEIPT is what separates a hybrid logical clock
       from a wall clock with extra fields. A replica that has seen your write
       stamps its next write above yours, whatever its own hardware clock says,
       so an edit made in reply to another edit can never be ordered before it.
       Skew stops deciding anything the moment causality has an opinion.

       Where there is no causality — two replicas that genuinely never heard
       from each other — the HLC has nothing to work with and falls back to the
       physical component, id-broken. That is a tie-break, not a truth, and the
       register still keeps one write and drops the other. */
    deliver: function (rep, msg, now) {
      var stamps = stampsIn(msg.delta);
      for (var i = 0; i < stamps.length; i++) rep.hlc = S.hlcReceive(rep.hlc, stamps[i], now + rep.skew);
      crdt.mergeInto(rep.state, msg.delta);
    },

    mergeInto: function (state, delta) {
      state.present = C.orMerge(state.present, delta.present || C.orNew());
      for (var id in delta.tasks) if (has(delta.tasks, id)) {
        var src = delta.tasks[id];
        var dst = state.tasks[id] || (state.tasks[id] = { points: C.pnNew(), tags: C.orNew() });
        if (src.title) dst.title = dst.title ? C.lwwMerge(dst.title, src.title, S.hlcCompare) : src.title;
        if (src.status) dst.status = dst.status ? C.lwwMerge(dst.status, src.status, S.hlcCompare) : src.status;
        if (src.points) dst.points = C.pnMerge(dst.points, src.points);
        if (src.tags) dst.tags = C.orMerge(dst.tags, src.tags);
      }
    },

    read: function (rep) {
      var out = [];
      var ids = C.orValues(rep.state.present);
      for (var i = 0; i < ids.length; i++) {
        var t = rep.state.tasks[ids[i]];
        /* Present in the set but no field state yet: the create's presence
           delta arrived and its field delta did not. Shown as an empty row
           rather than skipped, because skipping it would hide a real
           intermediate state the network can produce. */
        out.push({
          id: ids[i],
          title: (t && t.title) ? t.title.v : '',
          status: (t && t.status) ? t.status.v : 'queued',
          points: t ? C.pnValue(t.points) : 0,
          tags: t ? C.orValues(t.tags) : []
        });
      }
      return { tasks: out };
    }
  };

  /* A state-based counter merges by MAX, so a message carrying "+3" is not a
     delta of it — merging 3 into a component already at 5 is a no-op, and the
     increment is silently gone. The join-irreducible piece is this replica's own
     component AFTER the increment: a cumulative number only this replica ever
     writes, which max() can absorb any number of times.
     This was a live bug in this file before the property suite existed, and it
     failed in the most flattering way possible: every replica converged, and
     they converged on a total that was too small. */
  function ownCounter(rep, taskId, delta) {
    var cur = (rep.state.tasks[taskId] && rep.state.tasks[taskId].points) || C.pnNew();
    var next = C.pnAdd(cur, rep.id, delta);
    var out = { p: {}, n: {} };
    if (next.p[rep.id] !== undefined) out.p[rep.id] = next.p[rep.id];
    if (next.n[rep.id] !== undefined) out.n[rep.id] = next.n[rep.id];
    return out;
  }

  /* Every HLC stamp inside a delta, so the receiving clock can be pushed past
     all of them in one pass. */
  function stampsIn(delta) {
    var out = [];
    for (var id in delta.tasks) if (has(delta.tasks, id)) {
      var f = delta.tasks[id];
      if (f.title) out.push(f.title.s);
      if (f.status) out.push(f.status.s);
    }
    return out;
  }

  /* The subset of the presence set this replica can see for one element — the
     input an observed-remove needs. Passing the whole set would also work; this
     keeps the delta small and makes the "observed" in observed-remove literal. */
  function observedPresence(rep, id) {
    var out = C.orNew();
    var tags = rep.state.present.adds[id];
    if (tags) { out.adds[id] = {}; for (var t in tags) if (has(tags, t)) out.adds[id][t] = 1; }
    for (var b in rep.state.present.tomb) if (has(rep.state.present.tomb, b)) out.tomb[b] = 1;
    return out;
  }

  function observedTag(set, el) {
    var out = C.orNew();
    var tags = set.adds[el];
    if (tags) { out.adds[el] = {}; for (var t in tags) if (has(tags, t)) out.adds[el][t] = 1; }
    for (var b in set.tomb) if (has(set.tomb, b)) out.tomb[b] = 1;
    return out;
  }

  /* ============================================================== replicas */

  function makeReplica(engine, id, skew) {
    return {
      id: id,
      skew: skew || 0,
      seq: 0,
      lastTs: 0,
      hlc: S.hlcNew(id),
      state: engine.newState(),
      inbox: 0,
      applied: 0
    };
  }

  var ENGINES = { naive: naive, lww: lww, crdt: crdt };
  var ENGINE_IDS = ['naive', 'lww', 'crdt'];

  S.engines = ENGINES;
  S.engineIds = ENGINE_IDS;
  S.makeReplica = makeReplica;
  S.STATUSES = STATUSES;

  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
