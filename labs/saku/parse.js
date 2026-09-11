/*!
 * Saku — part of the biassp.github.io portfolio
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only — copying, modification,
 * re-branding or redistribution is not permitted. See /LICENSE.
 * https://biassp.github.io/
 */
/* Saku — parse.js
 * Deterministic bank-notification parser. No model, no API key, no network:
 * an inspectable rule table over strings, so the UI can show you exactly which
 * rule fired and why it scored what it scored. Loaded by the page AND by the
 * service worker (a shared text arrives while the app may be closed).
 */
(function (scope) {
  'use strict';

  /* ---- number normalisation -------------------------------------------- */

  function normalizeNumber(raw) {
    if (!raw) return null;
    var s = String(raw).replace(/\s/g, '');
    var hasDot = s.indexOf('.') >= 0;
    var hasComma = s.indexOf(',') >= 0;
    if (hasDot && hasComma) {
      // whichever separator comes last is the decimal one (1.250.000,00 vs 1,250,000.00)
      var dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
      var grp = dec === '.' ? ',' : '.';
      s = s.split(grp).join('');
      if (dec === ',') s = s.replace(',', '.');
    } else if (hasComma) {
      // "1,250" is thousands; "1,25" is decimal
      s = /,\d{3}(\D|$)/.test(s + ' ') ? s.split(',').join('') : s.replace(',', '.');
    } else if (hasDot) {
      s = /\.\d{3}(\D|$)/.test(s + ' ') ? s.split('.').join('') : s;
    }
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  /* ---- direction ------------------------------------------------------- */

  var OUT_WORDS = ['debit', 'db', 'dr', 'pembayaran', 'pembelian', 'belanja', 'trf ke',
    'transfer ke', 'payment', 'paid', 'purchase', 'spent', 'withdrawal', 'tarik tunai',
    'bayar', 'sent to', 'charged'];
  var IN_WORDS = ['kredit', 'credit', 'cr', 'kr', 'received', 'refund', 'masuk',
    'terima', 'top up', 'topup', 'deposit', 'salary', 'gaji', 'cashback', 'reversal'];

  function detectDirection(text) {
    var t = ' ' + text.toLowerCase() + ' ';
    var i, w;
    for (i = 0; i < IN_WORDS.length; i++) {
      w = IN_WORDS[i];
      if (t.indexOf(' ' + w + ' ') >= 0 || t.indexOf(' ' + w + ':') >= 0) return { dir: 'in', word: w };
    }
    for (i = 0; i < OUT_WORDS.length; i++) {
      w = OUT_WORDS[i];
      if (t.indexOf(' ' + w + ' ') >= 0 || t.indexOf(' ' + w + ':') >= 0) return { dir: 'out', word: w };
    }
    return { dir: 'out', word: null };
  }

  /* ---- merchant -------------------------------------------------------- */

  var MERCHANT_PATTERNS = [
    /(?:\bdi\b|\bat\b|\bto\b|\bke\b|\bfrom\b|\bdari\b)\s+([A-Z0-9][A-Za-z0-9 .&'\-*]{1,38})/,
    /\bmerchant[:\s]+([A-Za-z0-9 .&'\-*]{2,38})/i,
    /\b([A-Z][A-Z0-9*.\-]{2,}(?:\s+[A-Z0-9*.\-]{2,}){0,3})\b/
  ];
  var MERCHANT_STOP = /\b(?:pada|tgl|tanggal|ref|no|nomor|saldo|bal|balance|sisa|pukul|jam|on|at\b\s*\d)\b.*$/i;
  // trailing noise a bank line always appends after the merchant name
  var MERCHANT_TAIL = /(?:\s+(?:completed|complete|successful|success|approved|berhasil|sukses|selesai|has|was|is|using|via|with|for|from|pending))+$/i;
  var MERCHANT_TRAILING_NUM = /[\s,]+\d{1,4}(?:[\/\-.:]\d{1,4})*$/;

  function cleanMerchant(m) {
    if (!m) return null;
    m = m.replace(MERCHANT_STOP, '').replace(MERCHANT_TAIL, '');
    for (var k = 0; k < 3 && MERCHANT_TRAILING_NUM.test(m); k++) m = m.replace(MERCHANT_TRAILING_NUM, '');
    m = m.replace(/[,.;:\-\s]+$/, '').trim();
    if (!m) return null;
    if (/^\d+$/.test(m)) return null;
    if (m.length < 2 || m.length > 40) return null;
    var junk = ['RP', 'PHP', 'USD', 'IDR', 'DEBIT', 'KREDIT', 'CREDIT', 'TRF', 'INFO', 'BCA', 'THE'];
    if (junk.indexOf(m.toUpperCase()) >= 0) return null;
    return m.replace(/\s{2,}/g, ' ');
  }

  function detectMerchant(text) {
    for (var i = 0; i < MERCHANT_PATTERNS.length; i++) {
      var m = text.match(MERCHANT_PATTERNS[i]);
      if (m) {
        var c = cleanMerchant(m[1]);
        if (c) return { merchant: c, patternIndex: i };
      }
    }
    return { merchant: null, patternIndex: -1 };
  }

  /* ---- date ------------------------------------------------------------ */

  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, mei: 4, jun: 5, jul: 6, aug: 7, agu: 7,
    ags: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11, des: 11 };

  function detectDate(text, now, currency) {
    now = now || Date.now();
    var m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
    if (m) {
      var yr = parseInt(m[3], 10);
      if (yr < 100) yr += 2000;
      var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      // slash dates are ambiguous: USD lines are MM/DD/YY, everything else DD/MM/YY.
      // If one field is > 12 it settles itself.
      var day = a, mon = b, order = 'DD/MM';
      if (a > 12 && b <= 12) { day = a; mon = b; order = 'DD/MM (day > 12)'; }
      else if (b > 12 && a <= 12) { day = b; mon = a; order = 'MM/DD (day > 12)'; }
      else if (currency === 'USD') { day = b; mon = a; order = 'MM/DD (USD)'; }
      // new Date() normalises 31/02 into 03 March rather than failing, so an
      // isNaN guard can never fire. Read the fields back: only a date that
      // survives the round trip is a real calendar date. Anything else falls
      // through, and the signal list then honestly reports no usable date.
      var d = new Date(yr, mon - 1, day);
      if (d.getFullYear() === yr && d.getMonth() === mon - 1 && d.getDate() === day) {
        return { at: d.getTime(), matched: m[0] + ' as ' + order };
      }
    }
    m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{2,4})\b/);
    if (m && typeof MONTHS[m[2].toLowerCase()] === 'number') {
      var y2 = parseInt(m[3], 10);
      if (y2 < 100) y2 += 2000;
      var mo2 = MONTHS[m[2].toLowerCase()], day2 = parseInt(m[1], 10);
      var d2 = new Date(y2, mo2, day2);
      if (d2.getFullYear() === y2 && d2.getMonth() === mo2 && d2.getDate() === day2) {
        return { at: d2.getTime(), matched: m[0] };
      }
    }
    return { at: now, matched: null };
  }

  /* ---- the rule table -------------------------------------------------- */

  var RULES = [
    {
      id: 'idr-rp',
      label: 'Indonesian rupiah alert',
      currency: 'IDR',
      hint: 'Rp / IDR followed by a 1.250.000,00-style amount',
      re: /(?:\bRp\.?|\bIDR)\s*([0-9][0-9.,]*)/i,
      examples: ['BCA: Trf Rp1.250.000,00 ke TOKOPEDIA 12/09/26 Ref 88213']
    },
    {
      id: 'php-peso',
      label: 'Philippine peso alert',
      currency: 'PHP',
      hint: '₱ / PHP / Php followed by a 1,250.00-style amount',
      re: /(?:₱|\bPHP|\bPhp)\s*([0-9][0-9.,]*)/,
      examples: ['GCash: You sent PHP 1,250.00 to JOLLIBEE SM MAKATI. Ref 7712']
    },
    {
      id: 'usd-dollar',
      label: 'US dollar alert',
      currency: 'USD',
      hint: '$ or USD followed by a 1,250.00-style amount',
      re: /(?:\$|\bUSD)\s*([0-9][0-9.,]*)/,
      examples: ['Card debit $42.10 at BLUE BOTTLE COFFEE on 09/12/26']
    },
    {
      id: 'amount-suffix',
      label: 'Trailing currency code',
      currency: null,
      hint: 'amount followed by a currency code, e.g. "1250.00 SGD"',
      re: /\b([0-9][0-9.,]*)\s*(IDR|PHP|USD|SGD|EUR|GBP|MYR|THB|AUD|JPY)\b/i,
      currencyFromGroup: 2,
      examples: ['Payment of 1250.00 SGD to GRAB SINGAPORE completed']
    },
    {
      id: 'bare-number',
      label: 'Bare number fallback',
      currency: null,
      hint: 'last resort: any number with 2+ digits, currency assumed',
      re: /\b([0-9]{2,}[0-9.,]*)\b/,
      lowConfidence: true,
      examples: ['paid 45000 warung nasi']
    }
  ];

  /**
   * parse(text, opts) -> result
   * Returns the matched rule, every extracted field, and a confidence score
   * built from named signals so the UI can show the arithmetic.
   */
  function parse(text, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    var src = String(text || '').replace(/ /g, ' ').trim();
    var out = {
      ok: false, text: src, rule: null, amount: null,
      currency: opts.defaultCurrency || 'IDR',
      merchant: null, direction: 'out', occurredAt: now,
      confidence: 0, signals: []
    };
    if (!src) { out.signals.push({ name: 'empty input', weight: 0 }); return out; }

    var matched = null, m = null, i;
    for (i = 0; i < RULES.length; i++) {
      m = src.match(RULES[i].re);
      if (m) { matched = RULES[i]; break; }
    }
    if (!matched) {
      out.signals.push({ name: 'no rule matched', weight: 0 });
      return out;
    }
    out.rule = { id: matched.id, label: matched.label, hint: matched.hint, matchedText: m[0] };
    out.amount = normalizeNumber(m[1]);
    if (matched.currencyFromGroup && m[matched.currencyFromGroup]) {
      out.currency = m[matched.currencyFromGroup].toUpperCase();
    } else if (matched.currency) {
      out.currency = matched.currency;
    }
    out.ok = out.amount !== null;

    var conf = 0;
    if (out.amount !== null) { conf += matched.lowConfidence ? 0.25 : 0.5;
      out.signals.push({ name: 'amount via ' + matched.id, weight: matched.lowConfidence ? 0.25 : 0.5 }); }
    if (matched.currency || matched.currencyFromGroup) {
      conf += 0.1; out.signals.push({ name: 'explicit currency ' + out.currency, weight: 0.1 });
    } else {
      out.signals.push({ name: 'currency assumed ' + out.currency, weight: 0 });
    }

    var d = detectDirection(src);
    out.direction = d.dir;
    if (d.word) { conf += 0.12; out.signals.push({ name: 'direction keyword "' + d.word + '"', weight: 0.12 }); }
    else out.signals.push({ name: 'no direction keyword, assumed out', weight: 0 });

    var mer = detectMerchant(src);
    if (mer.merchant) {
      out.merchant = mer.merchant;
      var w = mer.patternIndex === 2 ? 0.12 : 0.2;
      conf += w;
      out.signals.push({ name: 'merchant "' + mer.merchant + '" (pattern #' + (mer.patternIndex + 1) + ')', weight: w });
    } else {
      out.signals.push({ name: 'merchant not found', weight: 0 });
    }

    var dt = detectDate(src, now, out.currency);
    out.occurredAt = dt.at;
    if (dt.matched) { conf += 0.08; out.signals.push({ name: 'date "' + dt.matched + '"', weight: 0.08 }); }
    else out.signals.push({ name: 'no date found, using now', weight: 0 });

    out.confidence = Math.max(0, Math.min(1, Math.round(conf * 100) / 100));
    return out;
  }

  var SAMPLES = [
    'BCA: Trf Rp1.250.000,00 ke TOKOPEDIA 12/09/26 Ref 88213 Saldo Rp4.120.500,00',
    'GCash: You sent PHP 1,250.00 to JOLLIBEE SM MAKATI. Ref 7712.',
    'Card debit $42.10 at BLUE BOTTLE COFFEE on 09/12/26',
    'BRI: Kredit Rp7.500.000,00 dari PT GAJI SEJAHTERA 01/09/26 gaji',
    'Payment of 1250.00 SGD to GRAB SINGAPORE completed'
  ];

  scope.SakuParse = {
    parse: parse,
    RULES: RULES,
    SAMPLES: SAMPLES,
    normalizeNumber: normalizeNumber,
    detectDirection: detectDirection,
    detectMerchant: detectMerchant,
    detectDate: detectDate
  };
})(typeof self !== 'undefined' ? self : this);
