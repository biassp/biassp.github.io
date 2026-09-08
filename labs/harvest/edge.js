/* HARvest - edge.js
 * Edge / security engine. Salvaged from the cancelled "WAF Workbench" design:
 * IPv4+IPv6 CIDR matching, and a sliding-window rate-limit simulation driven by
 * the HAR's own timestamps. Pure functions, no DOM, no network.
 *
 * Addresses are normalised once into four 32-bit words so a prefix match is a
 * handful of integer compares - no BigInt in the inner loop, which is what makes
 * an IPv6 match affordable per request.
 */
(function (root) {
  'use strict';
  var H = root.HARVEST || {}; root.HARVEST = H;

  /* ------------------------------------------------------- IP normalising */

  function parseIpv4(s) {
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s).trim());
    if (!m) return null;
    var v = 0;
    for (var i = 1; i <= 4; i++) {
      var o = Number(m[i]);
      if (!(o >= 0 && o <= 255)) return null;
      if (m[i].length > 1 && m[i].charAt(0) === '0') return null; // reject 010 style
      v = ((v << 8) | o) >>> 0;
    }
    return { family: 4, w: [0, 0, 0, v >>> 0] };
  }

  function parseIpv6(s) {
    var str = String(s).trim();
    if (str.charAt(0) === '[' && str.charAt(str.length - 1) === ']') str = str.slice(1, -1);
    if (str.indexOf(':') < 0) return null;
    if (/%/.test(str)) str = str.split('%')[0];

    var tail4 = null;
    var lastColon = str.lastIndexOf(':');
    var afterLast = str.slice(lastColon + 1);
    if (afterLast.indexOf('.') >= 0) {
      var v4 = parseIpv4(afterLast);
      if (!v4) return null;
      tail4 = v4.w[3];
      str = str.slice(0, lastColon + 1) + '0:0';
    }

    var halves = str.split('::');
    if (halves.length > 2) return null;
    function toGroups(part) {
      if (part === '') return [];
      var gs = part.split(':');
      var out = [];
      for (var i = 0; i < gs.length; i++) {
        if (gs[i] === '') return null;
        if (!/^[0-9a-fA-F]{1,4}$/.test(gs[i])) return null;
        out.push(parseInt(gs[i], 16));
      }
      return out;
    }
    var head = toGroups(halves[0]);
    var tail = halves.length === 2 ? toGroups(halves[1]) : [];
    if (head === null || tail === null) return null;
    var groups;
    if (halves.length === 2) {
      var fill = 8 - head.length - tail.length;
      if (fill < 0) return null;
      groups = head.concat(new Array(fill).fill(0)).concat(tail);
    } else {
      groups = head;
      if (groups.length !== 8) return null;
    }
    if (groups.length !== 8) return null;
    if (tail4 !== null) {
      groups[6] = (tail4 >>> 16) & 0xffff;
      groups[7] = tail4 & 0xffff;
    }
    var w = [];
    for (var g = 0; g < 8; g += 2) w.push((((groups[g] << 16) >>> 0) + groups[g + 1]) >>> 0);
    return { family: 6, w: w };
  }

  function parseIp(s) {
    if (s == null) return null;
    var t = String(s).trim();
    if (!t) return null;
    return t.indexOf(':') >= 0 ? parseIpv6(t) : parseIpv4(t);
  }
  H.parseIp = parseIp;

  function parseCidr(s) {
    var str = String(s == null ? '' : s).trim();
    if (!str) return null;
    var slash = str.lastIndexOf('/');
    var addrPart = slash < 0 ? str : str.slice(0, slash);
    var ip = parseIp(addrPart);
    if (!ip) return null;
    var maxBits = ip.family === 4 ? 32 : 128;
    var bits = maxBits;
    if (slash >= 0) {
      var b = str.slice(slash + 1);
      if (!/^\d{1,3}$/.test(b)) return null;
      bits = Number(b);
      if (bits < 0 || bits > maxBits) return null;
    }
    return { family: ip.family, w: ip.w, bits: bits, text: str };
  }
  H.parseCidr = parseCidr;

  function inCidr(ip, cidr) {
    if (!ip || !cidr) return false;
    if (ip.family !== cidr.family) return false;
    var bits = cidr.bits;
    var startWord = cidr.family === 4 ? 3 : 0;
    var remaining = bits;
    for (var i = startWord; i < 4; i++) {
      if (remaining <= 0) return true;
      var take = remaining >= 32 ? 32 : remaining;
      var mask = take === 32 ? 0xffffffff : (~((1 << (32 - take)) - 1)) >>> 0;
      if (((ip.w[i] ^ cidr.w[i]) & mask) >>> 0) return false;
      remaining -= take;
    }
    return true;
  }
  H.inCidr = inCidr;

  function ipToString(ip) {
    if (!ip) return '';
    if (ip.family === 4) {
      var v = ip.w[3];
      return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.');
    }
    var groups = [];
    for (var i = 0; i < 4; i++) { groups.push((ip.w[i] >>> 16) & 0xffff); groups.push(ip.w[i] & 0xffff); }
    // longest run of zeroes gets compressed
    var bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
    for (var g = 0; g < 8; g++) {
      if (groups[g] === 0) { if (curStart < 0) curStart = g; curLen++; if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; } }
      else { curStart = -1; curLen = 0; }
    }
    var parts = [];
    for (var j = 0; j < 8; j++) {
      if (bestLen > 1 && j === bestStart) { parts.push(''); j += bestLen - 1; continue; }
      parts.push(groups[j].toString(16));
    }
    var s = parts.join(':');
    if (bestLen > 1) {
      if (bestStart === 0) s = ':' + s;
      if (bestStart + bestLen === 8) s = s + ':';
    }
    return s.replace(/:{3,}/, '::');
  }
  H.ipToString = ipToString;

  /**
   * Match one address against a list of CIDR strings.
   * Returns { ip, matches:[cidrText], invalid:[bad cidr strings] }.
   */
  function matchIp(addr, cidrTexts) {
    var ip = parseIp(addr);
    var res = { input: String(addr == null ? '' : addr), ip: ip, valid: !!ip, matches: [], invalid: [] };
    for (var i = 0; i < cidrTexts.length; i++) {
      var c = parseCidr(cidrTexts[i]);
      if (!c) { res.invalid.push(cidrTexts[i]); continue; }
      if (ip && inCidr(ip, c)) res.matches.push(c.text);
    }
    return res;
  }
  H.matchIp = matchIp;

  /* -------------------------------------------- sliding-window rate limit ==
   * One ordered pass over the trace. Each key keeps a ring buffer of the
   * timestamps still inside the window plus a "blocked until" mark, so the whole
   * simulation is O(n) rather than O(n * windows).
   */

  function makeRing(cap) { return { buf: new Array(cap), head: 0, len: 0, cap: cap }; }
  function ringPush(r, v) {
    if (r.len === r.cap) {           // grow: the limit itself bounds this, so it is rare
      var nb = new Array(r.cap * 2);
      for (var i = 0; i < r.len; i++) nb[i] = r.buf[(r.head + i) % r.cap];
      r.buf = nb; r.head = 0; r.cap = r.cap * 2;
    }
    r.buf[(r.head + r.len) % r.cap] = v;
    r.len++;
  }
  function ringEvict(r, cutoff) {
    while (r.len > 0 && r.buf[r.head] <= cutoff) { r.head = (r.head + 1) % r.cap; r.len--; }
  }

  var KEYS = {
    host: { label: 'host', of: function (e) { return e.host; } },
    hostPath: { label: 'host + path', of: function (e) { return e.host + ' ' + e.path; } },
    hostTemplate: { label: 'host + endpoint template', of: function (e, ctx) { return ctx.entryToEndpoint[e.i] || (e.host + ' ' + e.path); } },
    serverIp: { label: 'server IP address', of: function (e) { return e.serverIP || '(no serverIPAddress in HAR)'; } }
  };
  H.RATE_KEYS = KEYS;

  /**
   * simulateRateLimit(entries, opts)
   *   opts: { key:'host'|'hostPath'|'hostTemplate'|'serverIp', limit, windowMs,
   *           blockMs, entryToEndpoint }
   * Blocked requests do NOT count towards the window (the common mitigation
   * behaviour: once you are in penalty, further requests are rejected at the
   * edge without being metered). That choice is stated in the UI.
   */
  function simulateRateLimit(entries, opts) {
    opts = opts || {};
    var keyDef = KEYS[opts.key] || KEYS.host;
    var limit = Math.max(1, opts.limit || 10);
    var windowMs = Math.max(100, opts.windowMs || 1000);
    var blockMs = Math.max(0, opts.blockMs == null ? 10000 : opts.blockMs);
    var ctx = { entryToEndpoint: opts.entryToEndpoint || {} };

    var ordered = entries.slice().sort(function (a, b) { return a.offsetMs - b.offsetMs || a.i - b.i; });
    var state = Object.create(null);
    var results = [], trips = [];
    var blockedCount = 0;

    for (var i = 0; i < ordered.length; i++) {
      var e = ordered[i];
      var k = keyDef.of(e, ctx);
      var st = state[k] || (state[k] = { ring: makeRing(Math.max(8, limit + 4)), blockedUntil: -1, allowed: 0, blocked: 0, trips: 0, first: e.offsetMs, peak: 0 });
      var t = e.offsetMs;
      if (st.blockedUntil > t) {
        st.blocked++; blockedCount++;
        results.push({ i: e.i, key: k, at: t, action: 'blocked', reason: 'inside mitigation window until ' + Math.round(st.blockedUntil) + ' ms' });
        continue;
      }
      ringEvict(st.ring, t - windowMs);
      if (st.ring.len + 1 > limit) {
        st.blockedUntil = t + blockMs;
        st.trips++; st.blocked++; blockedCount++;
        trips.push({ key: k, at: t, i: e.i, until: st.blockedUntil, observed: st.ring.len + 1 });
        results.push({ i: e.i, key: k, at: t, action: 'tripped', reason: (st.ring.len + 1) + ' requests inside a ' + windowMs + ' ms window (limit ' + limit + ')' });
        continue;
      }
      ringPush(st.ring, t);
      if (st.ring.len > st.peak) st.peak = st.ring.len;
      st.allowed++;
      results.push({ i: e.i, key: k, at: t, action: 'allowed', reason: st.ring.len + '/' + limit + ' in window' });
    }

    var keys = Object.keys(state).sort(function (a, b) { return state[b].blocked - state[a].blocked || (a < b ? -1 : 1); });
    return {
      keyLabel: keyDef.label, limit: limit, windowMs: windowMs, blockMs: blockMs,
      totalRequests: ordered.length, blocked: blockedCount, trips: trips,
      allowed: ordered.length - blockedCount,
      perKey: keys.map(function (k) {
        return { key: k, allowed: state[k].allowed, blocked: state[k].blocked, trips: state[k].trips, peakInWindow: state[k].peak };
      }),
      results: results
    };
  }
  H.simulateRateLimit = simulateRateLimit;

  if (typeof module !== 'undefined' && module.exports) module.exports = H;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
