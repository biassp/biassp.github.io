/* Saku — sync.js
 * Outbox drain loop, the SIMULATED peer, field-level LWW merge and the chaos
 * injectors.
 *
 * HONESTY NOTE, and it is load-bearing: the "peer" is a second IndexedDB object
 * store in this same origin. There is no server, no request ever leaves the page,
 * and nothing here proves a backend. What it does exercise is real client code:
 * at-least-once delivery, idempotency keys, exponential backoff with jitter,
 * cross-tab claim leases, and a Lamport-ordered field-level merge with genuine
 * conflicts. The peer is deliberately shaped like a request/response endpoint so
 * that client code is the real thing rather than a mock.
 *
 * Scope-agnostic: loadable in the page and in the service worker.
 */
(function (scope) {
  'use strict';

  var S = scope.SakuStore;
  var MAX_BATCH = 8;
  var BACKOFF_CAP_MS = 30000;

  function sleep(ms) {
    return new Promise(function (r) { scope.setTimeout(r, ms); });
  }

  /** Exponential backoff with half-range jitter, capped at 30s. */
  function backoffMs(attempts) {
    var base = Math.min(BACKOFF_CAP_MS, 500 * Math.pow(2, Math.max(0, attempts)));
    return Math.round(base / 2 + Math.random() * (base / 2));
  }

  function fieldsOf(entry) {
    var out = {};
    S.TRACKED.forEach(function (f) { out[f] = entry[f]; });
    return out;
  }

  /* ---------- the simulated peer ---------------------------------------- */

  function peerApplyOne(op) {
    return S.peerGet(op.entryId).then(function (rec) {
      rec = rec || { entryId: op.entryId, fields: {}, fc: {}, clock: 0, seen: [], updatedAt: 0 };
      if (rec.seen.indexOf(op.idem) >= 0) {
        return { entryId: op.entryId, status: 'duplicate-absorbed', peerClock: rec.clock, conflicts: [] };
      }
      var conflicts = [];
      Object.keys(op.fields).forEach(function (f) {
        var mine = op.fields[f];
        var myClock = (op.fc && op.fc[f]) || op.clock || 0;
        var theirClock = rec.fc[f] || 0;
        if (myClock >= theirClock) {
          rec.fields[f] = mine;
          rec.fc[f] = myClock;
        } else if (rec.fields[f] !== mine) {
          conflicts.push({ field: f, mine: mine, theirs: rec.fields[f], myClock: myClock, theirClock: theirClock });
        }
      });
      rec.clock = Math.max(rec.clock || 0, op.clock || 0);
      Object.keys(rec.fc).forEach(function (f) { rec.clock = Math.max(rec.clock, rec.fc[f]); });
      rec.seen.push(op.idem);
      if (rec.seen.length > 50) rec.seen = rec.seen.slice(-50);
      rec.updatedAt = Date.now();
      return S.peerPut(rec).then(function () {
        return {
          entryId: op.entryId,
          status: conflicts.length ? 'conflict' : 'applied',
          peerClock: rec.clock,
          conflicts: conflicts
        };
      });
    });
  }

  function peerDelete(entryId) {
    return S.peerGet(entryId).then(function (rec) {
      if (!rec) return { entryId: entryId, status: 'applied', conflicts: [], peerClock: 0 };
      rec.deleted = true;
      rec.updatedAt = Date.now();
      return S.peerPut(rec).then(function () {
        return { entryId: entryId, status: 'applied', conflicts: [], peerClock: rec.clock };
      });
    });
  }

  /**
   * peerRequest — the network boundary that isn't. Shaped like an HTTP call
   * (latency, 5xx, offline) so the client sees the same failure states it would
   * against a real endpoint.
   */
  function peerRequest(ops, chaos) {
    chaos = chaos || {};
    return sleep(Math.max(0, chaos.latencyMs || 0)).then(function () {
      if (chaos.offline || (scope.navigator && scope.navigator.onLine === false)) {
        var e = new Error('NetworkError: peer unreachable (offline)');
        e.kind = 'offline';
        throw e;
      }
      if (chaos.failRate && Math.random() < chaos.failRate) {
        var e5 = new Error('HTTP 500 from simulated peer');
        e5.kind = 'server';
        throw e5;
      }
      var results = [];
      return ops.reduce(function (p, op) {
        return p.then(function () {
          return (op.op === 'delete' ? peerDelete(op.entryId) : peerApplyOne(op))
            .then(function (r) { results.push(r); });
        });
      }, Promise.resolve()).then(function () {
        return { ok: true, results: results };
      });
    });
  }

  /* ---------- drain ------------------------------------------------------ */

  function drain(options) {
    options = options || {};
    var clientId = options.clientId || 'anon';
    var emit = options.onEvent || function () {};
    var summary = {
      attempted: 0, applied: 0, duplicates: 0, conflicts: 0, failed: 0,
      skippedLeased: 0, startedAt: Date.now(), nextDueAt: null, offline: false
    };

    return S.getChaos().then(function (chaos) {
      return S.outboxAll().then(function (jobs) {
        var now = Date.now();
        var due = jobs.filter(function (j) {
          if (j.nextAt > now) return false;
          if (j.claimedBy && j.claimedBy !== clientId && j.leaseUntil > now) { summary.skippedLeased++; return false; }
          return true;
        }).slice(0, MAX_BATCH);

        return due.reduce(function (p, job) {
          return p.then(function () { return one(job, chaos, clientId, summary, emit); });
        }, Promise.resolve());
      });
    }).then(function () {
      return S.outboxAll();
    }).then(function (jobs) {
      summary.nextDueAt = jobs.length ? Math.min.apply(null, jobs.map(function (j) { return j.nextAt; })) : null;
      summary.depth = jobs.length;
      summary.finishedAt = Date.now();
      emit({ type: 'drain-done', summary: summary });
      return summary;
    });
  }

  function one(job, chaos, clientId, summary, emit) {
    return S.claimJob(job.id, clientId, S.LEASE_MS).then(function (got) {
      if (!got) {
        summary.skippedLeased++;
        emit({ type: 'lost-claim', jobId: job.id });
        return null;
      }
      summary.attempted++;
      return S.getEntry(job.entryId).then(function (entry) {
        if (!entry && job.op !== 'delete') {
          emit({ type: 'orphan-job', jobId: job.id });
          return S.completeJob(job.id, null, 0);
        }
        var op = {
          entryId: job.entryId,
          op: job.op,
          idem: job.idem,
          clock: entry ? entry.clock : 0,
          fc: entry ? entry.fc : {},
          fields: entry ? fieldsOf(entry) : {}
        };
        var ops = [op];
        if (chaos.duplicate) ops.push(op); // at-least-once: the same op delivered twice
        emit({ type: 'send', jobId: job.id, entryId: job.entryId, idem: job.idem, copies: ops.length });

        return peerRequest(ops, chaos).then(function (res) {
          var first = res.results[0];
          var dupes = res.results.slice(1).filter(function (r) { return r.status === 'duplicate-absorbed'; }).length;
          summary.duplicates += dupes;
          if (dupes) emit({ type: 'duplicate-absorbed', entryId: job.entryId, count: dupes });

          if (first.status === 'conflict') {
            summary.conflicts++;
            return S.observeClock(first.peerClock).then(function () {
              return S.conflictPut({
                id: 'cf_' + job.entryId,
                entryId: job.entryId,
                fields: first.conflicts,
                detectedAt: Date.now(),
                peerClock: first.peerClock
              });
            }).then(function () {
              emit({ type: 'conflict', entryId: job.entryId, fields: first.conflicts });
              return S.completeJob(job.id, null, 0);
            });
          }
          summary.applied++;
          emit({ type: 'applied', entryId: job.entryId, peerClock: first.peerClock });
          return S.observeClock(first.peerClock).then(function () {
            return S.completeJob(job.id, job.entryId, first.peerClock);
          });
        }).catch(function (err) {
          summary.failed++;
          if (err && err.kind === 'offline') summary.offline = true;
          var attempts = (job.attempts || 0) + 1;
          var wait = backoffMs(attempts);
          emit({
            type: 'failed', jobId: job.id, entryId: job.entryId, attempts: attempts,
            error: String(err && err.message || err), retryInMs: wait
          });
          return S.releaseJob(job.id, {
            attempts: attempts,
            nextAt: Date.now() + wait,
            lastError: String(err && err.message || err)
          });
        });
      });
    });
  }

  /* ---------- chaos actions --------------------------------------------- */

  /** The peer "receives an edit from another device" — a real divergence that
   *  produces a real conflict the next time you touch that entry locally. */
  function peerDiverge(entryId, patch) {
    return S.peerGet(entryId).then(function (rec) {
      return S.getEntry(entryId).then(function (entry) {
        if (!entry) throw new Error('no such entry');
        rec = rec || { entryId: entryId, fields: fieldsOf(entry), fc: {}, clock: entry.clock || 0, seen: [] };
        var bump = (Math.max(rec.clock || 0, entry.clock || 0)) + 5;
        var p = patch || {
          merchant: (entry.merchant || 'Unknown') + ' (edited on phone B)',
          amount: entry.amount === null ? null : Math.round((entry.amount || 0) * 1.1)
        };
        Object.keys(p).forEach(function (f) {
          rec.fields[f] = p[f];
          rec.fc[f] = bump;
        });
        rec.clock = bump;
        rec.updatedAt = Date.now();
        return S.peerPut(rec).then(function () { return { entryId: entryId, peerClock: bump, patch: p }; });
      });
    });
  }

  /** Resolve a conflict by choosing a value per field. Choosing either side
   *  produces a NEW local write with a clock above the peer's, so the retry is
   *  ordered rather than racing. */
  function resolveConflict(conflictId, choices) {
    return S.conflictAll().then(function (list) {
      var c = list.filter(function (x) { return x.id === conflictId; })[0];
      if (!c) throw new Error('conflict not found');
      return S.observeClock(c.peerClock).then(function () {
        var patch = {};
        var touched = [];
        c.fields.forEach(function (f) {
          patch[f.field] = choices[f.field] === 'theirs' ? f.theirs : f.mine;
          touched.push(f.field);
        });
        // forceFields: keeping YOUR value is still a decision, and it has to
        // carry a clock above the peer's or the merge re-conflicts forever.
        return S.updateEntry(c.entryId, patch, { forceFields: touched });
      }).then(function () {
        return S.conflictDelete(conflictId).then(function () { return c.entryId; });
      });
    });
  }

  scope.SakuSync = {
    drain: drain,
    peerRequest: peerRequest,
    peerDiverge: peerDiverge,
    resolveConflict: resolveConflict,
    backoffMs: backoffMs,
    fieldsOf: fieldsOf,
    MAX_BATCH: MAX_BATCH
  };
})(typeof self !== 'undefined' ? self : this);
