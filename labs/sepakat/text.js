/*!
 * Sepakat — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Sepakat - text.js
 * Turning "the textarea says something different now" into edits an RGA can hold.
 *
 * A textarea gives you the WHOLE new string and nothing about how it got there,
 * which is exactly the information a sequence CRDT needs. Recovering it is a
 * diff, and the one here is the cheap one: strip the common prefix, strip the
 * common suffix, and treat everything between as one deletion followed by one
 * insertion.
 *
 * That is stated rather than glossed because it is a real limitation. For typing,
 * pasting and backspacing — what a person actually does to a line of text — it
 * recovers the true edit. For a change that moves a word from the start of the
 * line to the end it does not: it reports the whole line as replaced, and two
 * replicas doing that concurrently will merge into something neither typed.
 * A minimal diff would narrow that window and not close it; the honest fix is to
 * capture edits at the keystroke, which a textarea will not give you.
 *
 * Everything below is deterministic and DOM-free, so the property suite can
 * check the round-trip rather than take my word for it.
 */
(function (root) {
  'use strict';
  var S = root.SEPAKAT || {}; root.SEPAKAT = S;
  var C = S.crdt;

  /* The single splice between two strings. `pos` is a visible offset, `del` a
     count of characters removed there, `ins` the string put in their place. */
  function diff(before, after) {
    var limit = Math.min(before.length, after.length);
    var p = 0;
    while (p < limit && before.charAt(p) === after.charAt(p)) p++;
    var s = 0;
    while (s < limit - p && before.charAt(before.length - 1 - s) === after.charAt(after.length - 1 - s)) s++;
    return { pos: p, del: before.length - p - s, ins: after.slice(p, after.length - s) };
  }

  function applyDiff(before, d) {
    return before.slice(0, d.pos) + d.ins + before.slice(d.pos + d.del);
  }

  function newDoc(replicaId, base) {
    var d = { rga: C.rgaNew(), counter: 0, id: replicaId };
    if (base) {
      var r = C.rgaTypeAt(d.rga, 0, base, replicaId, d.counter);
      d.rga = r.rga; d.counter = r.counter;
    }
    return d;
  }

  function forkDoc(doc, replicaId) {
    /* A fork shares every node — same ids, same tree — and only differs in who
       will mint the NEXT id. That is what makes two replicas' later edits
       mergeable instead of merely concatenable. */
    return { rga: C.rgaClone(doc.rga), counter: doc.counter, id: replicaId };
  }

  /* Edit a replica's document towards `after`, from whatever it reads now. */
  function edit(doc, after) {
    var before = C.rgaText(doc.rga);
    var d = diff(before, after);
    var rga = doc.rga;
    if (d.del > 0) rga = C.rgaDeleteRange(rga, d.pos, d.del);
    var counter = doc.counter;
    if (d.ins) {
      var r = C.rgaTypeAt(rga, d.pos, d.ins, doc.id, counter);
      rga = r.rga; counter = r.counter;
    }
    return { doc: { rga: rga, counter: counter, id: doc.id }, edit: d };
  }

  function merge(a, b) {
    return { rga: C.rgaMerge(a.rga, b.rga), counter: Math.max(a.counter, b.counter), id: a.id };
  }

  function read(doc) { return C.rgaText(doc.rga); }

  S.text = { diff: diff, applyDiff: applyDiff, newDoc: newDoc, forkDoc: forkDoc, edit: edit, merge: merge, read: read };

  if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
