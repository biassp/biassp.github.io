/*!
 * Case studies — theme toggle
 * Copyright (c) 2026 Bias Satrio Putra. All rights reserved.
 * Not open source. Readable for evaluation only. See /LICENSE.
 */
(function () {
    var root = document.documentElement;
    var btn = document.getElementById('tema');
    if (!btn) return;

    // localStorage throws outright when a browser blocks site data; an
    // unguarded read here would kill the rest of this script.
    var saved = null;
    try { saved = localStorage.getItem('theme'); } catch (err) { }
    if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);

    function render() {
        var light = root.getAttribute('data-theme') === 'light';
        var id = root.getAttribute('lang') === 'id';
        // Button offers the OTHER theme; label follows the current language.
        btn.textContent = light ? (id ? 'Gelap' : 'Dark') : (id ? 'Terang' : 'Light');
        btn.setAttribute('aria-pressed', light ? 'true' : 'false');
    }
    render();
    // Let the language toggle re-label this button when it flips languages.
    window.__renderThemeLabel = render;

    btn.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        root.setAttribute('data-theme', next);
        try { localStorage.setItem('theme', next); } catch (err) { }
        render();
    });
})();

/* Site-wide EN/ID toggle. English is the default and the no-JS fallback; this
   only activates on pages that opt in by shipping both a #langToggle button and
   a window.PAGE_I18N dictionary, so untranslated case pages are left untouched.
   Every localStorage call is guarded — an unguarded one previously blanked the
   site when a browser blocked site data. */
(function () {
    var root = document.documentElement;
    var btn = document.getElementById('langToggle');
    var dict = window.PAGE_I18N;
    if (!btn || !dict) return;

    function setMeta(sel, value) {
        var el = document.querySelector(sel);
        if (el) el.setAttribute('content', value);
    }

    function pick(entry, lang) {
        if (!entry) return null;
        return entry[lang] != null ? entry[lang] : entry.en;
    }

    function applyLang(lang) {
        root.setAttribute('lang', lang);

        var texts = document.querySelectorAll('[data-i18n]');
        for (var i = 0; i < texts.length; i++) {
            var v = pick(dict[texts[i].getAttribute('data-i18n')], lang);
            if (v != null) texts[i].textContent = v;
        }
        var htmls = document.querySelectorAll('[data-i18n-html]');
        for (var j = 0; j < htmls.length; j++) {
            var h = pick(dict[htmls[j].getAttribute('data-i18n-html')], lang);
            if (h != null) htmls[j].innerHTML = h;
        }

        if (dict.meta_title) document.title = pick(dict.meta_title, lang);
        if (dict.meta_desc) setMeta('meta[name="description"]', pick(dict.meta_desc, lang));
        if (dict.meta_ogtitle) setMeta('meta[property="og:title"]', pick(dict.meta_ogtitle, lang));
        if (dict.meta_ogdesc) setMeta('meta[property="og:description"]', pick(dict.meta_ogdesc, lang));

        btn.textContent = lang === 'en' ? 'ID' : 'EN';
        if (window.__renderThemeLabel) window.__renderThemeLabel();
        try { localStorage.setItem('cv_lang', lang); } catch (err) { }
    }

    var start = 'en';
    try {
        var saved = localStorage.getItem('cv_lang');
        if (saved === 'en' || saved === 'id') start = saved;
    } catch (err) { }
    applyLang(start);

    btn.addEventListener('click', function () {
        applyLang(root.getAttribute('lang') === 'id' ? 'en' : 'id');
    });
})();

/* A figure marked data-optional disappears cleanly when its image is not in the
   repo yet, rather than rendering a broken-image icon on a live CV. Drop the
   file in and it appears on the next load with no code change. */
(function () {
    var imgs = document.querySelectorAll('img[data-optional]');
    for (var i = 0; i < imgs.length; i++) {
        (function (img) {
            function hide() {
                var fig = img.closest ? img.closest('figure') : null;
                if (fig) fig.hidden = true;
            }
            img.addEventListener('error', hide);
            if (img.complete && img.naturalWidth === 0) hide();
        })(imgs[i]);
    }
})();
