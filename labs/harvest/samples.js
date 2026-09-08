/*!
 * HARvest — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* HARvest - samples.js
 * Two embedded HAR traces so the page is fully alive with zero user input.
 *
 * Both are SYNTHETIC and hand-authored. They contain no real credentials, no
 * real hosts and no personal data: the "tokens" below are structurally valid but
 * were minted here, in this file, for the demo.
 *
 * They are declared as JavaScript objects rather than fetched as .har files on
 * purpose - a fetch would be an outbound request, and this page's CSP forbids
 * those. Nothing here touches the network.
 */
(function (root) {
  'use strict';
  var H = root.HARVEST || {}; root.HARVEST = H;

  function b64url(s) {
    var b;
    if (typeof btoa === 'function') b = btoa(unescape(encodeURIComponent(s)));
    else b = Buffer.from(s, 'utf8').toString('base64');
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function jwt(header, payload, sig) {
    return b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload)) + '.' + (sig === undefined ? 'ZmFrZS1zaWduYXR1cmUtZm9yLWEtZGVtby10cmFjZQ' : sig);
  }

  // Deterministic pseudo-random latencies (LCG). Same numbers on every open, so
  // the percentile table is stable and screenshots match.
  function rng(seed) {
    var s = seed >>> 0;
    return function (lo, hi) {
      s = (s * 1664525 + 1013904223) >>> 0;
      return lo + Math.floor((s / 4294967296) * (hi - lo + 1));
    };
  }

  function hdr(o) {
    return Object.keys(o).map(function (k) { return { name: k, value: String(o[k]) }; });
  }
  function qs(url) {
    var qi = url.indexOf('?');
    if (qi < 0) return [];
    return url.slice(qi + 1).split('&').filter(Boolean).map(function (p) {
      var eq = p.indexOf('=');
      return eq < 0 ? { name: decodeURIComponent(p), value: '' }
        : { name: decodeURIComponent(p.slice(0, eq)), value: decodeURIComponent(p.slice(eq + 1)) };
    });
  }

  function Builder(startIso) {
    this.t = Date.parse(startIso);
    this.entries = [];
  }
  Builder.prototype.add = function (spec) {
    var start = spec.at != null ? this.t + spec.at : this.t;
    var wait = spec.wait == null ? 40 : spec.wait;
    var receive = spec.receive == null ? 6 : spec.receive;
    var blocked = spec.blocked == null ? 1 : spec.blocked;
    var connect = spec.connect == null ? 0 : spec.connect;
    var dns = spec.dns == null ? 0 : spec.dns;
    var send = spec.send == null ? 0 : spec.send;
    var total = blocked + dns + connect + send + wait + receive;
    var bodyText = spec.body === undefined ? null : (typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body));
    var size = bodyText == null ? 0 : bodyText.length;
    var reqHeaders = hdr(spec.reqHeaders || {});
    var resHeaders = hdr(spec.resHeaders || {});
    var e = {
      startedDateTime: new Date(start).toISOString(),
      time: total,
      request: {
        method: spec.method || 'GET',
        url: spec.url,
        httpVersion: spec.httpVersion || 'HTTP/2',
        headers: reqHeaders,
        queryString: qs(spec.url),
        cookies: [],
        headersSize: 320,
        bodySize: spec.postBody ? JSON.stringify(spec.postBody).length : 0
      },
      response: {
        status: spec.status == null ? 200 : spec.status,
        statusText: spec.statusText || '',
        httpVersion: spec.httpVersion || 'HTTP/2',
        headers: resHeaders,
        cookies: [],
        content: { size: size, mimeType: spec.mime || 'application/json', text: bodyText === null ? undefined : bodyText },
        redirectURL: '',
        headersSize: 280,
        bodySize: size
      },
      cache: {},
      timings: { blocked: blocked, dns: dns, connect: connect, ssl: -1, send: send, wait: wait, receive: receive },
      serverIPAddress: spec.ip || '203.0.113.10',
      connection: spec.conn || '443'
    };
    if (spec.postBody) {
      e.request.postData = { mimeType: 'application/json', text: JSON.stringify(spec.postBody) };
    }
    if (spec.at == null) this.t += total + (spec.gap == null ? 12 : spec.gap);
    this.entries.push(e);
    return e;
  };
  Builder.prototype.har = function (creator) {
    return { log: { version: '1.2', creator: { name: creator, version: '1.0' }, pages: [], entries: this.entries } };
  };

  /* ================================================= trace 1: clean REST == */

  function cleanTrace() {
    var r = rng(20260211);
    var b = new Builder('2026-02-11T09:14:02.000Z');
    var HOST = 'https://api.northwind.dev';
    var TOK = jwt({ alg: 'HS256', typ: 'JWT' }, { sub: 'usr_88f1', aud: 'api.northwind.dev', iat: 1770800000, exp: 1770800900, scope: 'catalog:read orders:write' });

    var goodRes = function (extra) {
      var base = {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, max-age=60',
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
        'x-content-type-options': 'nosniff',
        'server': 'nginx/1.25.3',
        'vary': 'Accept-Encoding, Authorization',
        'content-encoding': 'br'
      };
      Object.keys(extra || {}).forEach(function (k) { base[k] = extra[k]; });
      return base;
    };
    var auth = { 'accept': 'application/json', 'authorization': 'Bearer ' + TOK, 'user-agent': 'northwind-web/3.2.0' };

    var PRODUCT_IDS = [
      '2f4a9b1c-7d3e-4c8a-9f21-5b6e7c8d9a01',
      '8c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
      'b7e6d5c4-3a2b-41c9-9d8e-7f6a5b4c3d2e',
      'd41a9c77-2b3e-4f0a-8c5d-6e7f8a9b0c1d',
      'f0e1d2c3-b4a5-4968-8776-655443322110'
    ];
    // Deep-linked product pages. Deliberately NOT ids returned by any list call in
    // this trace, so the N+1 correlator has nothing to correlate and stays quiet.
    var DEEP_IDS = [
      '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d',
      '0f1e2d3c-4b5a-4968-8776-6f5e4d3c2b1a',
      'aa11bb22-cc33-4dd4-8ee5-ff6600117722',
      '31415926-5358-4979-8323-846264338327',
      '77665544-3322-4110-8fee-ddccbbaa9988',
      '13579246-8ace-4bdf-9013-57924 68ace13'.replace(' ', '')
    ];
    var CATEGORIES = ['tools', 'garden', 'kitchen'];

    function product(idx, withDiscount, idOverride) {
      var p = {
        id: idOverride || PRODUCT_IDS[idx % PRODUCT_IDS.length],
        sku: 'NW-' + (1000 + idx),
        name: ['Bench plane', 'Dovetail saw', 'Pruning shears', 'Cast pan', 'Mortar and pestle'][idx % 5],
        description: 'Catalogue item ' + idx,
        price: 24.5 + idx * 7.25,
        currency: 'USD',
        stock: 3 + idx,
        active: idx % 4 !== 3,
        category: CATEGORIES[idx % CATEGORIES.length],
        tags: ['workshop', 'restock'],
        created_at: '2025-11-0' + ((idx % 8) + 1) + 'T10:00:00Z',
        updated_at: '2026-01-1' + (idx % 9) + 'T08:31:00Z'
      };
      if (withDiscount) p.discount_pct = 10 + idx;   // present in some, not all -> not required
      return p;
    }
    function order(idx, status) {
      return {
        id: ['a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', '11112222-3333-4444-5555-666677778888', 'aaaabbbb-cccc-4ddd-8eee-ffff00001111'][idx % 3],
        number: 'NW-ORD-' + (44100 + idx),
        status: status || ['pending', 'shipped', 'delivered'][idx % 3],
        total: 128.4 + idx * 11,
        currency: 'USD',
        customer_id: 'c0ffee00-1111-4222-8333-44445555666' + (idx % 10),
        item_count: 2 + (idx % 3),
        placed_at: '2026-02-0' + ((idx % 8) + 1) + 'T14:22:00Z'
      };
    }

    // A browser trace is not a queue: the SPA fans out on load. The phases below
    // mirror that, which is also why the serialised-chain finding does not fire
    // on this trace and does fire on the pathological one.
    var BASE = Date.parse('2026-02-11T09:14:02.000Z');
    function phase(ms) { b.t = BASE + ms; }

    phase(0);
    b.add({ url: HOST + '/health', wait: r(8, 18), reqHeaders: { accept: 'application/json' }, resHeaders: goodRes({ 'cache-control': 'no-store' }), body: { status: 'ok', version: '2.4.1', uptime_s: 918233 } });

    b.add({
      method: 'POST', url: HOST + '/v1/auth/login', wait: r(120, 190),
      reqHeaders: { 'content-type': 'application/json', accept: 'application/json' },
      postBody: { email: 'demo@northwind.dev', password: '********' },
      resHeaders: goodRes({
        'cache-control': 'no-store',
        'set-cookie': 'nw_sid=6f1b9a2c4d8e; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=900'
      }),
      status: 200,
      body: { access_token: TOK, token_type: 'bearer', expires_in: 900, scope: 'catalog:read orders:write' }
    });

    // Burst 1: everything the dashboard needs, in parallel.
    phase(400);
    b.add({ at: 0, url: HOST + '/v1/users/me', wait: r(28, 55), reqHeaders: auth, resHeaders: goodRes({ etag: '"u-88f1-3"' }), body: { id: 'usr_88f1', email: 'demo@northwind.dev', display_name: 'Demo Operator', role: 'operator', locale: 'en-GB', created_at: '2024-05-02T09:00:00Z' } });
    b.add({ at: 3, url: HOST + '/v1/users/me/preferences', wait: r(18, 40), reqHeaders: auth, resHeaders: goodRes({ etag: '"pref-9"' }), body: { theme: 'dark', density: 'compact', notifications: { email: true, push: false } } });
    b.add({ at: 6, url: HOST + '/v1/categories', wait: r(20, 45), reqHeaders: auth, resHeaders: goodRes({ 'cache-control': 'public, max-age=3600', etag: '"cat-4"' }), body: { data: CATEGORIES.map(function (c, k) { return { id: 'cat_' + c, slug: c, name: c.charAt(0).toUpperCase() + c.slice(1), product_count: 40 + k }; }) } });
    b.add({ at: 9, url: HOST + '/v1/products?page=1&per_page=20', wait: r(60, 120), reqHeaders: auth, resHeaders: goodRes({ etag: '"prod-p1-17"' }), body: { data: [product(0, true), product(1), product(2), product(3, true), product(4)], page: 1, per_page: 20, total: 148 } });
    b.add({ at: 12, url: HOST + '/v1/orders?page=1&per_page=20', wait: r(90, 160), reqHeaders: auth, resHeaders: goodRes({ 'cache-control': 'no-store' }), body: { data: [order(0), order(1), order(2)], page: 1, per_page: 20, total: 3 } });

    // Burst 2: the team panel. Three real user records next to /users/me - this is
    // the trap the reserved-word guard exists for.
    phase(760);
    ['4d6f8a90-1b2c-4d3e-8f4a-5b6c7d8e9f00', '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d', 'c3d4e5f6-a7b8-49c0-8d1e-2f3a4b5c6d7e'].forEach(function (uid, k) {
      b.add({ at: k * 4, url: HOST + '/v1/users/' + uid, wait: r(22, 60), reqHeaders: auth, resHeaders: goodRes({ etag: '"u-' + k + '"' }), body: { id: uid, email: 'teammate' + k + '@northwind.dev', display_name: 'Teammate ' + k, role: k === 0 ? 'admin' : 'operator', locale: 'en-GB', created_at: '2025-0' + (k + 1) + '-14T11:20:00Z' } });
    });
    b.add({ at: 14, url: HOST + '/v1/products?page=2&per_page=20', wait: r(58, 118), reqHeaders: auth, resHeaders: goodRes({ etag: '"prod-p2-17"' }), body: { data: [product(5), product(6, true), product(7), product(8)], page: 2, per_page: 20, total: 148 } });
    b.add({ at: 18, url: HOST + '/v1/products/search?q=plane&per_page=10', wait: r(70, 140), reqHeaders: auth, resHeaders: goodRes({ 'cache-control': 'no-store' }), body: { data: [product(0), product(5)], query: 'plane', took_ms: 12 } });

    // Burst 3: five product pages opened from bookmarks (deep links), so these ids
    // do not come from any response in this trace and the N+1 correlator correctly
    // stays silent. Plus one conditional revalidation that returns 304.
    phase(1400);
    DEEP_IDS.forEach(function (pid, k) {
      b.add({ at: k * 5, url: HOST + '/v1/products/' + pid, wait: r(20, 70), reqHeaders: auth, resHeaders: goodRes({ etag: '"p-' + k + '-9"' }), body: product(k, k % 2 === 0, pid) });
    });
    b.add({ at: 28, url: HOST + '/v1/products/' + DEEP_IDS[0], status: 304, statusText: 'Not Modified', wait: r(12, 30), receive: 0, reqHeaders: { accept: 'application/json', authorization: 'Bearer ' + TOK, 'if-none-match': '"p-0-9"' }, resHeaders: goodRes({ etag: '"p-0-9"' }), body: undefined, mime: '' });

    // Burst 4: placing an order. POST carries an Idempotency-Key, which is what
    // makes the retry budget for this endpoint honest.
    phase(2100);
    b.add({ method: 'POST', url: HOST + '/v1/orders', status: 201, statusText: 'Created', wait: r(150, 260), reqHeaders: { accept: 'application/json', authorization: 'Bearer ' + TOK, 'content-type': 'application/json', 'idempotency-key': '7f2c1e90-3b44-4a55-9c66-0d1e2f3a4b5c' }, postBody: { customer_id: 'c0ffee00-1111-4222-8333-444455556660', items: [{ sku: 'NW-1000', qty: 1 }, { sku: 'NW-1003', qty: 2 }], currency: 'USD' }, resHeaders: goodRes({ 'cache-control': 'no-store', location: '/v1/orders/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }), body: order(0, 'pending') });
    phase(2500);
    b.add({ at: 0, url: HOST + '/v1/orders/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', wait: r(30, 80), reqHeaders: auth, resHeaders: goodRes({ 'cache-control': 'no-store', etag: '"o-1"' }), body: order(0, 'pending') });
    b.add({ at: 4, url: HOST + '/v1/orders/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/items', wait: r(35, 90), reqHeaders: auth, resHeaders: goodRes({ 'cache-control': 'no-store' }), body: { data: [{ id: 'itm_1', sku: 'NW-1000', qty: 1, unit_price: 24.5, line_total: 24.5 }, { id: 'itm_2', sku: 'NW-1003', qty: 2, unit_price: 46.25, line_total: 92.5 }] } });
    b.add({ at: 8, url: HOST + '/v1/orders/11112222-3333-4444-5555-666677778888', status: 404, statusText: 'Not Found', wait: r(18, 40), reqHeaders: auth, resHeaders: goodRes({ 'cache-control': 'no-store', 'content-type': 'application/problem+json' }), mime: 'application/problem+json', body: { type: 'https://api.northwind.dev/problems/not-found', title: 'Order not found', status: 404, detail: 'No order with that id is visible to this account.', instance: '/v1/orders/11112222-3333-4444-5555-666677778888' } });

    phase(2900);
    b.add({ at: 0, method: 'PATCH', url: HOST + '/v1/orders/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', wait: r(110, 200), reqHeaders: { accept: 'application/json', authorization: 'Bearer ' + TOK, 'content-type': 'application/json' }, postBody: { status: 'shipped', tracking_code: 'NL9938271' }, resHeaders: goodRes({ 'cache-control': 'no-store' }), body: order(0, 'shipped') });
    b.add({ at: 5, method: 'DELETE', url: HOST + '/v1/orders/aaaabbbb-cccc-4ddd-8eee-ffff00001111', status: 204, statusText: 'No Content', wait: r(60, 120), receive: 0, reqHeaders: auth, resHeaders: goodRes({ 'cache-control': 'no-store' }), body: undefined, mime: '' });

    // A throttle that behaves correctly - Retry-After is present, so the
    // "429 without Retry-After" rule stays silent here and fires on trace 2.
    phase(3300);
    b.add({ at: 0, url: HOST + '/v1/reports/daily', status: 429, statusText: 'Too Many Requests', wait: r(10, 25), reqHeaders: auth, resHeaders: goodRes({ 'retry-after': '30', 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '30', 'cache-control': 'no-store' }), body: { type: 'https://api.northwind.dev/problems/rate-limited', title: 'Too many requests', status: 429, detail: 'Daily report generation is limited to 60/hour.' } });
    phase(4200);
    b.add({ at: 0, url: HOST + '/v1/reports/daily', wait: r(800, 1400), reqHeaders: auth, resHeaders: goodRes({ 'cache-control': 'private, max-age=300', etag: '"rep-2026-02-11"' }), body: { generated_at: '2026-02-11T09:20:11Z', rows: 1840, revenue_total: 91238.44, currency: 'USD' } });

    return b.har('HARvest sample - clean REST API');
  }

  /* ============================================ trace 2: pathological == */

  function messyTrace() {
    var r = rng(777);
    var b = new Builder('2026-02-11T14:02:00.000Z');
    var API = 'http://api.legacy-shop.io';     // deliberately plaintext
    var CDN = 'https://assets.legacy-shop.io';

    // Underscores in the body are deliberate: they keep the sk_live_ prefix that
    // analyze.js's SECRETY_VALUE rule looks for, while breaking Stripe's own
    // [0-9a-zA-Z]{24,} key charset. A realistic-looking fake key here trips GitHub
    // push protection and every downstream scanner that clones this repo. Do not
    // "improve" this into something that looks real.
    var LEAKY_KEY = 'sk_live_EXAMPLE_not_a_real_key_do_not_use';
    var LONG_TOKEN = jwt({ alg: 'HS256', typ: 'JWT' }, { sub: '48812', iat: 1767225600, exp: 1767225600 + 60 * 86400, role: 'admin' });
    var NONE_TOKEN = jwt({ alg: 'none', typ: 'JWT' }, { sub: '48812', admin: true }, '');

    var badRes = function (extra) {
      var base = {
        'content-type': 'application/json',
        'server': 'Apache/2.4.29 (Ubuntu)',
        'x-powered-by': 'PHP/7.2.24'
      };
      Object.keys(extra || {}).forEach(function (k) { base[k] = extra[k]; });
      return base;
    };
    var creds = { accept: '*/*', authorization: 'Bearer ' + LONG_TOKEN, cookie: 'PHPSESSID=8f2a91c0d4e5; tracking=abc123', 'user-agent': 'shop-admin/1.0' };

    b.add({
      url: API + '/api/v2/session?api_key=' + LEAKY_KEY, httpVersion: 'HTTP/1.1', wait: r(90, 160),
      reqHeaders: { accept: '*/*', 'user-agent': 'shop-admin/1.0' },
      resHeaders: badRes({ 'set-cookie': 'PHPSESSID=8f2a91c0d4e5; Path=/' }),
      body: { success: true, data: { userId: 48812, displayName: 'Ops Admin', role: 'admin', token: LONG_TOKEN } },
      ip: '198.51.100.24', conn: '80'
    });

    b.add({
      url: API + '/api/v2/legacy/impersonate?token=' + NONE_TOKEN, httpVersion: 'HTTP/1.1', wait: r(60, 120),
      reqHeaders: creds, resHeaders: badRes({}),
      body: { success: true, data: { impersonating: 48999 } }, ip: '198.51.100.24', conn: '80'
    });

    // The parent call whose ids fan out below.
    var orders = [];
    for (var o = 0; o < 12; o++) {
      orders.push({
        order_id: 90100 + o,
        customerId: 501 + o,
        orderTotal: 44.5 + o * 13.25,
        currency: 'EUR',
        placed_at: '2026-02-1' + (o % 9) + 'T09:12:00Z',
        status: ['new', 'paid', 'shipped'][o % 3]
      });
    }
    b.add({
      url: API + '/api/v2/orders?limit=25&offset=0', httpVersion: 'HTTP/1.1', wait: r(180, 320),
      reqHeaders: creds, resHeaders: badRes({}),
      body: { success: true, data: orders, meta: { limit: 25, offset: 0, total: 12 } },
      ip: '198.51.100.24', conn: '80'
    });

    // N+1: one request per customer id that came back in the payload above,
    // all in flight at once against an HTTP/1.1 origin.
    var fanBase = 30;
    for (var c = 0; c < 12; c++) {
      b.add({
        at: (b.t - Date.parse('2026-02-11T14:02:00.000Z')) + fanBase + c * 4,
        url: API + '/api/v2/customers/' + (501 + c), httpVersion: 'HTTP/1.1',
        wait: r(120, 260), blocked: c < 6 ? 1 : 40 + c * 6,
        reqHeaders: creds, resHeaders: badRes({}),
        body: { success: true, data: { customerId: 501 + c, fullName: 'Customer ' + (501 + c), email: 'c' + (501 + c) + '@example.org', lifetimeValue: 120.5 + c * 9, segment: c % 3 === 0 ? 'vip' : 'standard' } },
        ip: '198.51.100.24', conn: '80'
      });
    }
    b.t += 620;

    // Three different pagination idioms on one API.
    b.add({ url: API + '/api/v2/products?page=1&per_page=50', httpVersion: 'HTTP/1.1', wait: r(150, 260), reqHeaders: creds, resHeaders: badRes({}), body: { success: true, data: [{ productId: 1, productName: 'Widget', unitPrice: 9.99, in_stock: true }, { productId: 2, productName: 'Sprocket', unitPrice: 14.5, in_stock: false }], page: 1, per_page: 50 }, ip: '198.51.100.24', conn: '80' });
    b.add({ url: API + '/api/v2/feed?cursor=eyJvIjoxMjB9&size=20', httpVersion: 'HTTP/1.1', wait: r(120, 200), reqHeaders: creds, resHeaders: badRes({}), body: { success: true, data: [{ event_id: 'evt_1', kind: 'order.paid' }, { event_id: 'evt_2', kind: 'order.shipped' }], next_cursor: 'eyJvIjoxNDB9' }, ip: '198.51.100.24', conn: '80' });

    // The same uncacheable URL, four times, in one session.
    for (var d = 0; d < 4; d++) {
      b.add({ url: API + '/api/v2/products/1', httpVersion: 'HTTP/1.1', wait: r(70, 150), reqHeaders: creds, resHeaders: badRes({}), body: { success: true, data: { productId: 1, productName: 'Widget', unitPrice: 9.99, in_stock: true, description: 'A widget. '.repeat(60) } }, ip: '198.51.100.24', conn: '80' });
    }

    // 200 that means "it failed".
    b.add({ url: API + '/api/v2/inventory', httpVersion: 'HTTP/1.1', wait: r(200, 400), reqHeaders: creds, resHeaders: badRes({}), body: { success: false, error: 'inventory service unavailable', code: 'INV_503', data: null }, ip: '198.51.100.24', conn: '80' });

    // Throttled and unavailable, with no backoff hint either time.
    b.add({ url: API + '/api/v2/reports/heavy', status: 429, statusText: 'Too Many Requests', httpVersion: 'HTTP/1.1', wait: r(15, 35), reqHeaders: creds, resHeaders: badRes({}), body: { success: false, error: 'rate limited' }, ip: '198.51.100.24', conn: '80' });
    b.add({ url: API + '/api/v2/reports/heavy', status: 503, statusText: 'Service Unavailable', httpVersion: 'HTTP/1.1', wait: r(15, 35), reqHeaders: creds, resHeaders: badRes({}), body: { success: false, error: 'upstream unavailable' }, ip: '198.51.100.24', conn: '80' });
    b.add({ url: API + '/api/v2/reports/heavy', status: 500, statusText: 'Internal Server Error', httpVersion: 'HTTP/1.1', wait: r(900, 1600), reqHeaders: creds, resHeaders: badRes({}), body: { success: false, error: 'Fatal error: Allowed memory size exhausted', trace_id: 'a3f9c1' }, ip: '198.51.100.24', conn: '80' });

    // A read done as POST.
    b.add({ method: 'POST', url: API + '/api/v2/search', httpVersion: 'HTTP/1.1', wait: r(180, 340), reqHeaders: { accept: '*/*', authorization: 'Bearer ' + LONG_TOKEN, cookie: 'PHPSESSID=8f2a91c0d4e5', 'content-type': 'application/json' }, postBody: { q: 'widget' }, resHeaders: badRes({}), body: { success: true, data: [{ productId: 1, productName: 'Widget' }] }, ip: '198.51.100.24', conn: '80' });

    // A genuinely large uncompressed payload (built here, so the size is real).
    var dump = [];
    for (var k = 0; k < 420; k++) {
      dump.push({ productId: 1000 + k, productName: 'Catalogue item ' + k, unitPrice: 5 + (k % 90), currency: 'EUR', in_stock: k % 5 !== 0, warehouse_code: 'WH-' + (k % 12), description: 'Long-form marketing copy that nobody reads but everybody ships. Item ' + k + '.' });
    }
    b.add({ url: API + '/api/v2/catalog/dump', httpVersion: 'HTTP/1.1', wait: r(700, 1200), receive: 340, reqHeaders: creds, resHeaders: badRes({}), body: { success: true, data: dump, count: dump.length }, ip: '198.51.100.24', conn: '80' });

    // The same bearer token handed to a second host.
    b.add({ url: CDN + '/private/invoices/2026-02.pdf', wait: r(200, 380), reqHeaders: { accept: '*/*', authorization: 'Bearer ' + LONG_TOKEN }, resHeaders: { 'content-type': 'application/pdf', 'server': 'nginx/1.14.0', 'cache-control': 'no-store' }, mime: 'application/pdf', body: undefined, ip: '203.0.113.77' });
    b.add({ url: CDN + '/app/main.9f2c11ab8e.js', wait: r(40, 90), reqHeaders: { accept: '*/*' }, resHeaders: { 'content-type': 'application/javascript', 'cache-control': 'no-store', 'server': 'nginx/1.14.0' }, mime: 'application/javascript', body: '/* bundle */', ip: '203.0.113.77' });
    b.add({ url: CDN + '/dashboard', wait: r(60, 140), reqHeaders: { accept: 'text/html' }, resHeaders: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'server': 'nginx/1.14.0', 'vary': '*' }, mime: 'text/html', body: '<!doctype html><title>Legacy dashboard</title>', ip: '203.0.113.77' });

    return b.har('HARvest sample - pathological trace');
  }

  var cached = {};
  H.samples = {
    list: [
      { id: 'clean', label: 'Clean REST API', note: '27 requests, well-behaved: ETags, HSTS, Retry-After, one idempotency key.' },
      { id: 'messy', label: 'Pathological trace', note: '30 requests: N+1 fan-out, key in the URL, plaintext auth, 200-with-error-body.' }
    ],
    get: function (id) {
      if (!cached[id]) cached[id] = (id === 'messy' ? messyTrace() : cleanTrace());
      return cached[id];
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = H;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
