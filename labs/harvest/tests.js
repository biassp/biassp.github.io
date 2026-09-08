/*!
 * HARvest — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* HARvest - tests.js
 * Assertions against the pure engines in analyze.js and edge.js. They run in the
 * page (Tests tab) and under node, from the same source, so what a visitor sees
 * green is the same suite that gates the code.
 *
 * The load-bearing one is "schema merge is order-independent": a lattice join is
 * only a join if it is commutative and associative, and the usual fold-and-
 * intersect implementation is neither.
 */
(function (root) {
  'use strict';
  var H = root.HARVEST || {}; root.HARVEST = H;

  var groups = [];
  function group(name, fn) { groups.push({ name: name, fn: fn }); }

  function makeCtx(results, groupName) {
    function record(ok, name, msg) {
      results.push({ group: groupName, name: name, ok: !!ok, message: ok ? '' : (msg || '') });
    }
    return {
      ok: function (v, name) { record(!!v, name, 'expected truthy, got ' + JSON.stringify(v)); },
      notOk: function (v, name) { record(!v, name, 'expected falsy, got ' + JSON.stringify(v)); },
      eq: function (a, b, name) { record(a === b, name, 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); },
      deep: function (a, b, name) {
        var x = H.canonicalJson(a), y = H.canonicalJson(b);
        record(x === y, name, 'expected ' + y + ', got ' + x);
      }
    };
  }

  /* ------------------------------------------------------------- parsing */

  group('URL and path parsing', function (t) {
    var u = H.parseUrl('https://api.example.com:8443/v1/users/42?a=1&b=two#frag');
    t.eq(u.scheme, 'https', 'scheme parsed');
    t.eq(u.host, 'api.example.com', 'host parsed');
    t.eq(u.hostport, 'api.example.com:8443', 'non-default port kept in hostport');
    t.eq(u.path, '/v1/users/42', 'path excludes query and fragment');
    t.eq(u.params.length, 2, 'two query params');
    t.eq(u.params[1].value, 'two', 'query value decoded');
    t.eq(H.parseUrl('https://a.example:443/x').hostport, 'a.example', 'default https port dropped');
    t.eq(H.parseUrl('http://[2001:db8::1]:8080/x').host, '[2001:db8::1]', 'ipv6 literal host');
    t.deep(H.pathSegments('/a//b/'), ['a', 'b'], 'empty segments dropped');
    t.deep(H.pathSegments('/'), [], 'root has no segments');
    t.eq(H.parseQuery('k=%20sp%26ce')[0].value, ' sp&ce', 'percent-decoding in query');
  });

  group('HAR normalisation', function (t) {
    var har = {
      log: {
        version: '1.2', creator: { name: 'test' }, entries: [{
          startedDateTime: '2026-01-01T00:00:00.000Z', time: 100,
          request: { method: 'get', url: 'https://h.example/a', headers: [{ name: 'X-A', value: '1' }] },
          response: {
            status: 200, headers: [{ name: 'Content-Type', value: 'application/json' }],
            content: { size: 13, mimeType: 'application/json', text: 'eyJvayI6dHJ1ZX0=', encoding: 'base64' },
            bodySize: -1, headersSize: -1
          },
          timings: { blocked: -1, dns: -1, connect: -1, send: 0, wait: 90, receive: 10 }
        }]
      }
    };
    var tr = H.normalise(har, 'x');
    t.eq(tr.entries.length, 1, 'one entry normalised');
    t.eq(tr.entries[0].method, 'GET', 'method upper-cased');
    t.deep(tr.entries[0].bodyJson, { ok: true }, 'base64 content.encoding decoded and parsed');
    t.eq(tr.entries[0].timings.blocked, 0, 'HAR -1 timings clamped to 0');
    t.eq(tr.entries[0].offsetMs, 0, 'first entry is at offset 0');
    var missing = H.normalise({ log: { entries: [{ startedDateTime: '2026-01-01T00:00:00Z', time: 5, request: { method: 'GET', url: 'https://h.example/b' }, response: { status: 200, content: { size: 900, mimeType: 'application/json' } }, timings: {} }] } }, 'y');
    t.ok(missing.entries[0].bodyMissing, 'a declared-but-absent body is flagged, not silently treated as empty');
    t.ok(/no body in the HAR/.test(missing.warnings.join(' ')), 'missing bodies produce a capture warning');
    t.eq(H.normalise({}, 'z').entries.length, 0, 'a non-HAR object degrades to zero entries instead of throwing');
  });

  /* --------------------------------------------------------- templating */

  group('Segment shape classification', function (t) {
    t.eq(H.shapeOf('2f4a9b1c-7d3e-4c8a-9f21-5b6e7c8d9a01').id, 'uuid', 'uuid recognised');
    t.eq(H.shapeOf('01ARZ3NDEKTSV4RRFFQ69G5FAV').id, 'ulid', 'ulid recognised');
    t.eq(H.shapeOf('507f1f77bcf86cd799439011').id, 'objectid', '24-char hex recognised');
    t.eq(H.shapeOf('123456').id, 'numeric', 'digits recognised');
    t.eq(H.shapeOf('2026-02-11').id, 'isodate', 'ISO date recognised');
    t.eq(H.shapeOf('v2').id, 'version', 'version segment recognised');
    t.eq(H.shapeOf('products').id, 'word', 'plain word recognised');
    t.eq(H.shapeOf('my-cool-post').id, 'slug', 'slug recognised');
    t.ok(H.RESERVED['me'] && H.RESERVED['search'], 'reserved route words are registered');
  });

  group('Parameter naming', function (t) {
    t.eq(H.singularise('users'), 'user', 'users -> user');
    t.eq(H.singularise('categories'), 'category', 'categories -> category');
    t.eq(H.singularise('boxes'), 'box', 'boxes -> box');
    t.eq(H.singularise('people'), 'person', 'people -> person');
    t.eq(H.singularise('status'), 'status', 'status is not de-pluralised');
    t.eq(H.singularise('address'), 'address', 'address is not de-pluralised');
  });

  function entriesFor(paths, host) {
    return paths.map(function (p, i) {
      var u = H.parseUrl((host || 'https://api.test') + p);
      return { i: i, method: 'GET', host: u.hostport, path: u.path, segments: H.pathSegments(u.path), query: u.params };
    });
  }

  group('Endpoint recovery (trie + classifier)', function (t) {
    var r = H.templatise(entriesFor([
      '/v1/users/2f4a9b1c-7d3e-4c8a-9f21-5b6e7c8d9a01',
      '/v1/users/8c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
      '/v1/users/me',
      '/v1/users/me/preferences'
    ]), {});
    var tmpl = r.endpoints.map(function (e) { return e.template; }).sort();
    t.deep(tmpl, ['/v1/users/me', '/v1/users/me/preferences', '/v1/users/{userId}'],
      'the /users/me trap: a reserved word stays literal next to UUID siblings');

    var r2 = H.templatise(entriesFor(['/orders/1001', '/orders/1002', '/orders/1003']), {});
    t.deep(r2.endpoints.map(function (e) { return e.template; }), ['/orders/{orderId}'], 'numeric siblings collapse');
    t.eq(r2.decisions.filter(function (d) { return d.kind === 'param'; })[0].confidence, 'high', '3 numeric samples is high confidence');

    var r3 = H.templatise(entriesFor(['/orders/1001']), {});
    t.eq(r3.decisions.filter(function (d) { return d.shapeId === 'numeric'; })[0].confidence, 'low',
      'a single numeric sample collapses but is reported as low confidence');

    var r4 = H.templatise(entriesFor(['/api/orders', '/api/products', '/api/customers', '/api/invoices',
      '/api/shipments', '/api/refunds', '/api/webhooks', '/api/settings', '/api/reports']), {});
    t.eq(r4.endpoints.length, 9, 'nine sibling route words do NOT collapse into a parameter');

    var r5 = H.templatise(entriesFor(['/v1/a', '/v2/a']), {});
    t.deep(r5.endpoints.map(function (e) { return e.template; }).sort(), ['/v1/a', '/v2/a'], 'version segments stay literal');

    var r6 = H.templatise(entriesFor(['/reports/2026-02-10', '/reports/2026-02-11']), {});
    t.deep(r6.endpoints.map(function (e) { return e.template; }), ['/reports/{date}'], 'ISO-date segments become {date}');

    var r7 = H.templatise(entriesFor(['/a/1/b/2', '/a/3/b/4']), {});
    t.deep(r7.endpoints.map(function (e) { return e.template; }), ['/a/{aId}/b/{bId}'], 'nested parameters both named from their parent');

    var r8 = H.templatise(entriesFor(['/hosts/1', '/hosts/2']), 'https://h1.test')
      .endpoints.concat(H.templatise(entriesFor(['/hosts/1'], 'https://h2.test'), {}).endpoints);
    t.ok(r8.length >= 1, 'templating runs per host');
  });

  group('Classifier overrides', function (t) {
    var es = entriesFor(['/orders/1001', '/orders/1002', '/orders/1003']);
    var base = H.templatise(es, {});
    var key = base.decisions.filter(function (d) { return d.kind === 'param'; })[0].key;
    var pinned = H.templatise(es, (function () { var o = {}; o[key] = 'literal'; return o; })());
    t.eq(pinned.endpoints.length, 3, 'pinning a decision to literal splits the endpoint back apart');
    t.ok(pinned.decisions.filter(function (d) { return d.key === key; })[0].overridden, 'the override is reported as such');

    var words = entriesFor(['/api/alpha', '/api/beta']);
    var wBase = H.templatise(words, {});
    var wKey = wBase.decisions.filter(function (d) { return d.shapeId === 'word'; })[0].key;
    var forced = H.templatise(words, (function () { var o = {}; o[wKey] = 'param'; return o; })());
    t.eq(forced.endpoints.length, 1, 'forcing a word segment to a parameter merges the endpoints');
    t.ok(/^\/api\/\{/.test(forced.endpoints[0].template), 'forced parameter appears in the template');
  });

  /* ------------------------------------------------------------ schemas */

  function schemaOf(values) {
    var t = H.emptyType();
    values.forEach(function (v) { H.observe(t, v, 0); });
    return H.toSchema(t, {});
  }

  group('Schema inference', function (t) {
    t.deep(schemaOf([1, 2, 3]).type, 'integer', 'whole numbers infer integer');
    t.deep(schemaOf([1, 2.5]).type, 'number', 'integer widens to number when a fraction appears');
    t.deep(schemaOf(['a', null]).type, ['string', 'null'], 'null becomes a union member, not a separate type');
    t.deep(schemaOf([1, 'a']).type, ['integer', 'string'], 'mixed scalars produce a type union');
    t.eq(schemaOf(['2026-02-11T09:00:00Z', '2025-01-01T00:00:00Z']).format, 'date-time', 'date-time format sniffed');
    t.eq(schemaOf(['a@b.co', 'c@d.io']).format, 'email', 'email format sniffed');
    t.eq(schemaOf(['2f4a9b1c-7d3e-4c8a-9f21-5b6e7c8d9a01', '8c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f']).format, 'uuid', 'uuid format sniffed');
    t.eq(schemaOf(['a@b.co', 'not-an-email']).format, undefined, 'format only when EVERY sample matches');

    var en = schemaOf(['red', 'green', 'red', 'green', 'red', 'green']);
    t.deep(en.enum, ['green', 'red'], 'repeated small vocabulary becomes a sorted enum');
    t.eq(schemaOf(['a', 'b', 'c']).enum, undefined, 'three values seen once each is variety, not an enum');

    var obj = schemaOf([{ a: 1, b: 2 }, { a: 3 }, { a: 4, b: 5 }]);
    t.deep(obj.required, ['a'], 'required = present in every object (k-of-n counting)');
    t.ok(obj.properties.b, 'optional properties are still described');

    var arr = schemaOf([[1, 2], [3]]);
    t.eq(arr.type, 'array', 'arrays typed');
    t.eq(arr.items.type, 'integer', 'array items merged across arrays');

    var deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: { k: { l: { m: 1 } } } } } } } } } } } } };
    var dt = H.emptyType(); H.observe(dt, deep, 0);
    t.ok(H.toSchema(dt, { annotate: true }), 'very deep nesting is capped instead of exploding');

    var wide = {};
    for (var w = 0; w < H.SCHEMA_LIMITS.MAX_PROPS + 10; w++) wide['k' + w] = w;
    var wt = H.emptyType(); H.observe(wt, wide, 0);
    var ws = H.toSchema(wt, {});
    t.ok(ws.additionalProperties && !ws.properties, 'a dictionary-shaped object degrades to additionalProperties');
  });

  function shuffle(arr, seed) {
    var a = arr.slice(), s = seed >>> 0;
    for (var i = a.length - 1; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      var j = s % (i + 1);
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  group('Schema merge is ORDER-INDEPENDENT', function (t) {
    var bodies = [
      { id: 1, name: 'a', tags: ['x'], meta: { v: 1 } },
      { id: 2, name: 'b', tags: [], meta: { v: 2, extra: true } },
      { id: 3, name: null, tags: ['y', 'z'] },
      { id: 4.5, name: 'a', tags: ['x'], meta: { v: null } },
      { id: 5, name: 'b', extra_top: 'q', meta: { v: 3 } },
      { id: 6, name: 'a', tags: ['x'], meta: { v: 4 } }
    ];
    var reference = H.canonicalJson(schemaOf(bodies));
    var allSame = true, firstDiff = '';
    for (var s = 1; s <= 25; s++) {
      var got = H.canonicalJson(schemaOf(shuffle(bodies, s * 7919)));
      if (got !== reference) { allSame = false; firstDiff = got; break; }
    }
    t.ok(allSame, '25 shuffles of the same bodies produce a byte-identical schema' + (allSame ? '' : ' [' + firstDiff + ']'));

    // join() itself, not just the fold: commutative and associative.
    function ty(v) { var x = H.emptyType(); H.observe(x, v, 0); return x; }
    var A = ty({ a: 1 }), B = ty({ a: 'x', b: 2 }), C = ty({ b: null, c: [1] });
    t.eq(H.canonicalJson(H.toSchema(H.joinType(A, B), {})), H.canonicalJson(H.toSchema(H.joinType(B, A), {})), 'join(a,b) === join(b,a)');
    t.eq(
      H.canonicalJson(H.toSchema(H.joinType(H.joinType(A, B), C), {})),
      H.canonicalJson(H.toSchema(H.joinType(A, H.joinType(B, C)), {})),
      'join((a,b),c) === join(a,(b,c))');
    t.eq(H.canonicalJson(H.toSchema(H.joinType(A, H.emptyType()), {})), H.canonicalJson(H.toSchema(A, {})), 'the empty type is the identity element');

    // Overflow caps must also be order-independent.
    var many = [];
    for (var m = 0; m < H.SCHEMA_LIMITS.DISTINCT_CAP + 20; m++) many.push('v' + m);
    t.eq(H.canonicalJson(schemaOf(many)), H.canonicalJson(schemaOf(shuffle(many, 31))), 'the distinct-value cap trips on the union size, not on arrival order');
  });

  group('Whole-pipeline determinism', function (t) {
    var har = H.samples.get('messy');
    var raw = har.log.entries;
    function specOf(list) {
      var tr = H.normalise({ log: { version: '1.2', creator: { name: 't' }, entries: list } }, 'shuffled');
      var res = H.analyze(tr, {});
      return H.buildOpenApi(res, tr, 'api.legacy-shop.io').yaml;
    }
    var ref = specOf(raw);
    var same = true;
    for (var s = 1; s <= 5; s++) if (specOf(shuffle(raw, s * 104729)) !== ref) { same = false; break; }
    t.ok(same, 'the emitted OpenAPI document is byte-identical after 5 shuffles of the HAR entries');

    function findingSet(list) {
      var tr = H.normalise({ log: { version: '1.2', creator: { name: 't' }, entries: list } }, 'shuffled');
      return H.analyze(tr, {}).findings.map(function (f) { return f.severity + '|' + f.family + '|' + f.title; }).sort().join('\n');
    }
    t.eq(findingSet(shuffle(raw, 5551)), findingSet(raw), 'the same findings fire regardless of entry order');
  });

  /* ------------------------------------------------------------- stats */

  group('Percentiles (nearest-rank)', function (t) {
    var v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    t.eq(H.percentile(v, 50), 5, 'p50 of 1..10 is the 5th value');
    t.eq(H.percentile(v, 90), 9, 'p90 of 1..10 is the 9th value');
    t.eq(H.percentile(v, 100), 10, 'p100 is the max');
    t.eq(H.percentile(v, 0), 1, 'p0 clamps to the first rank');
    t.eq(H.percentile([42], 99), 42, 'a single sample is every percentile');
    t.eq(H.percentile([], 50), null, 'no samples yields null, not NaN');
    var s = H.stats([5, 1, 3]);
    t.eq(s.p50, 3, 'stats sorts before ranking');
    t.eq(s.min, 1, 'min');
    t.eq(s.max, 5, 'max');
    t.notOk(s.p99Trustworthy, 'a p99 from 3 samples is flagged as untrustworthy');
    t.ok(H.stats(new Array(120).fill(10)).p99Trustworthy, 'a p99 from 120 samples is not flagged');
  });

  group('Timeout / retry budget', function (t) {
    var get = H.budgetFor({ method: 'GET', latency: H.stats([100, 120, 140, 900]) });
    t.eq(get.retries, 2, 'GET is idempotent, so retries are allowed');
    t.ok(get.timeoutMs >= 900, 'timeout is derived from the measured p99, not a round number');
    t.eq(get.timeoutMs % 50, 0, 'timeout is rounded to a 50 ms step');
    var post = H.budgetFor({ method: 'POST', latency: H.stats([100, 200]) });
    t.eq(post.retries, 0, 'POST is not retried automatically');
    t.ok(/Idempotency-Key/.test(post.retryNote), 'and the reason names the Idempotency-Key requirement');
    t.ok(H.isIdempotent('PUT') && H.isIdempotent('DELETE') && !H.isIdempotent('PATCH'), 'PUT/DELETE idempotent, PATCH is not');
  });

  /* ---------------------------------------------------------- findings */

  group('N+1 correlator', function (t) {
    t.deep(H.extractIdsForTest({ data: [{ customerId: 7 }, { customerId: 8 }] }), ['7', '8'], 'integers are only taken as ids under an id-shaped key');
    t.deep(H.extractIdsForTest({ count: 12 }), [], 'a plain integer under a non-id key is ignored');
    t.deep(H.extractIdsForTest({ x: '2f4a9b1c-7d3e-4c8a-9f21-5b6e7c8d9a01' }), ['2f4a9b1c-7d3e-4c8a-9f21-5b6e7c8d9a01'], 'a UUID is an id wherever it appears');

    var messy = H.analyze(H.normalise(H.samples.get('messy'), 'm'), {});
    var np = messy.nplus1;
    t.ok(np.length >= 1, 'fan-out is detected in the pathological trace');
    t.ok(np[0].children.length >= 10, 'and it reports every child call, not just a count of two');
    t.ok(/customers/.test(np[0].template), 'the fan-out is attributed to the customers endpoint');
    t.ok(typeof np[0].parent === 'number', 'the parent request that caused it is named');

    var clean = H.analyze(H.normalise(H.samples.get('clean'), 'c'), {});
    t.eq(clean.nplus1.length, 0, 'and it stays silent on the well-behaved trace (no false positive)');
  });

  group('Findings rules', function (t) {
    var messy = H.analyze(H.normalise(H.samples.get('messy'), 'm'), {});
    var clean = H.analyze(H.normalise(H.samples.get('clean'), 'c'), {});
    function has(res, id) { return res.findings.some(function (f) { return f.id === id || f.id.indexOf(id + ':') === 0; }); }

    t.ok(has(messy, 'auth-over-http'), 'credentials over http:// fires');
    t.ok(has(messy, 'token-in-query'), 'credential in the query string fires');
    t.ok(has(messy, 'token-cross-host'), 'one token sent to two hosts fires');
    t.ok(has(messy, 'cookie-flags'), 'missing Secure/HttpOnly/SameSite fires');
    t.ok(has(messy, 'jwt-alg-none'), 'alg:none fires');
    t.ok(has(messy, 'error-body-200'), '200-with-error-body fires');
    t.ok(has(messy, 'no-retry-after'), '429/503 without Retry-After fires');
    t.ok(has(messy, 'refetch-uncacheable'), 'uncacheable refetch fires');
    t.ok(has(messy, 'duplicate-requests'), 'repeated identical requests fire');
    t.ok(has(messy, 'uncompressed'), 'large uncompressed payload fires');
    t.ok(has(messy, 'pagination-drift'), 'mixed pagination idioms fire');
    t.ok(has(messy, 'casing-drift'), 'snake_case/camelCase drift fires');
    t.ok(has(messy, 'http1-hol'), 'HTTP/1.1 connection-limit saturation fires');
    t.ok(has(messy, 'n-plus-1'), 'the N+1 finding is emitted');

    t.notOk(has(clean, 'auth-over-http'), 'no plaintext-auth false positive on the clean trace');
    t.notOk(has(clean, 'token-in-query'), 'no query-token false positive');
    t.notOk(has(clean, 'cookie-flags'), 'a properly flagged Set-Cookie does not fire');
    t.notOk(has(clean, 'no-retry-after'), 'a 429 WITH Retry-After does not fire');
    t.notOk(has(clean, 'error-body-200'), 'no error-body false positive');
    t.notOk(has(clean, 'n-plus-1'), 'no N+1 false positive');
    t.notOk(has(clean, 'no-hsts'), 'HSTS present, so no finding');
    t.notOk(has(clean, 'pagination-drift'), 'one consistent pagination idiom does not fire');

    var sevs = messy.findings.map(function (f) { return H.SEV_ORDER[f.severity]; });
    var ordered = sevs.every(function (v, i) { return i === 0 || sevs[i - 1] <= v; });
    t.ok(ordered, 'findings come back ranked by severity');
    t.ok(messy.findings.every(function (f) { return f.why && f.fix; }), 'every finding carries a why and a fix');
  });

  /* ------------------------------------------------------- OpenAPI/YAML */

  group('YAML emitter and $ref hoisting', function (t) {
    var y = H.emitYaml({ a: 1, b: 'plain', c: 'yes', d: '', e: ['x', { f: true }], g: {} }, 0);
    t.ok(/a: 1/.test(y), 'numbers unquoted');
    t.ok(/b: plain/.test(y), 'safe strings unquoted');
    t.ok(/c: "yes"/.test(y), 'YAML 1.1 booleans like "yes" are quoted so they stay strings');
    t.ok(/d: ''/.test(y), 'empty string emitted as two quotes');
    t.ok(/g: \{\}/.test(y), 'empty map emitted inline');
    t.ok(/- x/.test(y) && /- f: true/.test(y), 'sequences of scalars and maps');
    t.ok(/"200":/.test(H.emitYaml({ 200: 'ok' }, 0)), 'numeric keys are quoted (OpenAPI response codes)');

    var tr = H.normalise(H.samples.get('clean'), 'c');
    var res = H.analyze(tr, {});
    var spec = H.buildOpenApi(res, tr, 'api.northwind.dev');
    t.eq(spec.doc.openapi, '3.1.0', 'declares OpenAPI 3.1.0');
    t.ok(spec.coverage.hoisted >= 2, 'structurally identical shapes are hoisted into components/schemas');
    t.ok(/\$ref": "#\/components\/schemas\//.test(spec.json), 'and referenced by $ref');
    t.ok(spec.doc.components.schemas.Product, 'the repeated product shape is named from its endpoint');
    t.notOk((spec.doc.components.schemas.Product.required || []).indexOf('discount_pct') >= 0,
      'a field present in only some samples is NOT marked required');
    t.ok(spec.coverage.pct > 0 && spec.coverage.pct <= 100, 'coverage is reported as a percentage');
    t.ok(/x-harvest-observations/.test(spec.json), 'each operation records how many requests it was inferred from');
  });

  /* -------------------------------------------------------- edge / security */

  group('IPv4 and IPv6 CIDR matching', function (t) {
    t.ok(H.inCidr(H.parseIp('10.1.2.3'), H.parseCidr('10.0.0.0/8')), '10.1.2.3 is inside 10.0.0.0/8');
    t.notOk(H.inCidr(H.parseIp('11.1.2.3'), H.parseCidr('10.0.0.0/8')), '11.1.2.3 is not');
    t.ok(H.inCidr(H.parseIp('192.168.1.255'), H.parseCidr('192.168.1.0/24')), 'broadcast address inside /24');
    t.notOk(H.inCidr(H.parseIp('192.168.2.0'), H.parseCidr('192.168.1.0/24')), 'next /24 is outside');
    t.ok(H.inCidr(H.parseIp('203.0.113.7'), H.parseCidr('203.0.113.7/32')), 'a /32 matches itself');
    t.ok(H.inCidr(H.parseIp('8.8.8.8'), H.parseCidr('0.0.0.0/0')), 'a /0 matches everything in the family');
    t.notOk(H.parseIp('999.1.1.1'), 'octet > 255 rejected');
    t.notOk(H.parseIp('10.0.0'), 'short address rejected');

    t.ok(H.inCidr(H.parseIp('2001:db8::1'), H.parseCidr('2001:db8::/32')), 'IPv6 inside a /32');
    t.notOk(H.inCidr(H.parseIp('2001:db9::1'), H.parseCidr('2001:db8::/32')), 'adjacent IPv6 /32 is outside');
    t.ok(H.inCidr(H.parseIp('fe80::1234:5678:9abc:def0'), H.parseCidr('fe80::/10')), 'link-local /10 (a non-word-aligned prefix)');
    t.notOk(H.inCidr(H.parseIp('fec0::1'), H.parseCidr('fe80::/10')), 'fec0:: is outside fe80::/10');
    t.ok(H.inCidr(H.parseIp('::1'), H.parseCidr('::1/128')), 'loopback /128');
    t.ok(H.inCidr(H.parseIp('::ffff:192.168.0.1'), H.parseCidr('::ffff:192.168.0.0/112')), 'IPv4-mapped IPv6 form parsed');
    t.notOk(H.inCidr(H.parseIp('10.0.0.1'), H.parseCidr('::/0')), 'families never cross-match');
    t.eq(H.ipToString(H.parseIp('2001:0db8:0000:0000:0000:0000:0000:0001')), '2001:db8::1', 'IPv6 round-trips through the compressed form');
    t.eq(H.ipToString(H.parseIp('10.1.2.3')), '10.1.2.3', 'IPv4 round-trips');
    t.notOk(H.parseCidr('10.0.0.0/33'), 'an out-of-range IPv4 prefix length is rejected');
    t.notOk(H.parseCidr('2001:db8::/129'), 'an out-of-range IPv6 prefix length is rejected');
    var m = H.matchIp('10.2.3.4', ['10.0.0.0/8', 'nonsense', '192.168.0.0/16']);
    t.eq(m.matches.length, 1, 'matchIp returns only the matching CIDRs');
    t.eq(m.invalid.length, 1, 'and reports the unparseable ones instead of dropping them');
  });

  group('Sliding-window rate-limit simulation', function (t) {
    function e(i, at, host) { return { i: i, offsetMs: at, host: host || 'a.test', path: '/x', serverIP: '' }; }
    var burst = [];
    for (var i = 0; i < 10; i++) burst.push(e(i, i * 10));
    var r = H.simulateRateLimit(burst, { key: 'host', limit: 5, windowMs: 1000, blockMs: 5000 });
    t.eq(r.allowed, 5, 'exactly the limit is allowed inside the window');
    t.eq(r.blocked, 5, 'the rest are blocked');
    t.eq(r.trips.length, 1, 'one trip, not one per blocked request');

    var spaced = [];
    for (var j = 0; j < 10; j++) spaced.push(e(j, j * 2000));
    var r2 = H.simulateRateLimit(spaced, { key: 'host', limit: 5, windowMs: 1000, blockMs: 5000 });
    t.eq(r2.blocked, 0, 'requests spaced beyond the window never trip');

    var two = [e(0, 0, 'a.test'), e(1, 10, 'a.test'), e(2, 20, 'b.test'), e(3, 30, 'b.test')];
    var r3 = H.simulateRateLimit(two, { key: 'host', limit: 1, windowMs: 1000, blockMs: 100 });
    t.eq(r3.perKey.length, 2, 'counters are per key, not global');
    t.eq(r3.blocked, 2, 'each host trips once');

    var recovery = burst.concat([e(99, 2000)]);
    var r4 = H.simulateRateLimit(recovery, { key: 'host', limit: 5, windowMs: 1000, blockMs: 0 });
    t.eq(r4.results[r4.results.length - 1].action, 'allowed', 'with no mitigation timeout, traffic resumes as soon as the window slides');
    var r5 = H.simulateRateLimit(recovery, { key: 'host', limit: 5, windowMs: 1000, blockMs: 5000 });
    t.eq(r5.results[r5.results.length - 1].action, 'blocked', 'with a 5 s mitigation timeout, the same request is still blocked at t=2000');
  });

  group('JWT decode (local, never verified)', function (t) {
    function b64u(o) {
      var s = JSON.stringify(o);
      var b = (typeof btoa === 'function') ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64');
      return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    var now = Math.floor(Date.now() / 1000);
    var good = H.decodeJwt(b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ sub: 'u1', iat: now, exp: now + 300 }) + '.sig');
    t.eq(good.alg, 'HS256', 'alg read from the header');
    t.eq(good.payload.sub, 'u1', 'payload decoded');
    t.eq(good.signatureVerified, false, 'the signature is NEVER reported as verified');
    t.eq(good.issues.length, 0, 'a short-lived signed token raises nothing');

    var none = H.decodeJwt(b64u({ alg: 'none' }) + '.' + b64u({ sub: 'u1' }) + '.');
    t.ok(none.issues.some(function (x) { return x.id === 'alg-none'; }), 'alg:none is flagged critical');
    t.ok(none.issues.some(function (x) { return x.id === 'no-exp'; }), 'a missing exp is flagged');

    var longLived = H.decodeJwt(b64u({ alg: 'HS256' }) + '.' + b64u({ iat: now, exp: now + 60 * 86400 }) + '.sig');
    t.ok(longLived.issues.some(function (x) { return x.id === 'long-life'; }), 'a 60-day lifetime is flagged');
    t.eq(H.decodeJwt('not.a.jwt'), null, 'non-JWT input returns null rather than throwing');
    t.eq(H.decodeJwt(''), null, 'empty input returns null');
  });

  group('Cache-Control parsing', function (t) {
    var cc = H.parseCacheControl('public, max-age=600, stale-while-revalidate=30');
    t.eq(cc.maxAge, 600, 'max-age parsed');
    t.notOk(cc.noStore, 'no-store absent');
    t.ok(H.parseCacheControl('no-store').noStore, 'no-store parsed');
    t.ok(H.parseCacheControl('private, immutable').immutable, 'immutable parsed');
    t.eq(H.parseCacheControl(null).maxAge, null, 'a missing header does not throw');
  });

  /* -------------------------------------------------------------- runner */

  function run() {
    var results = [];
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      try {
        g.fn(makeCtx(results, g.name));
      } catch (err) {
        results.push({ group: g.name, name: 'group threw', ok: false, message: String(err && err.stack || err) });
      }
    }
    var passed = results.filter(function (r) { return r.ok; }).length;
    return { results: results, passed: passed, failed: results.length - passed, total: results.length };
  }
  H.runTests = run;
  H.testGroups = groups;

  if (typeof module !== 'undefined' && module.exports) module.exports = H;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
