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
        btn.textContent = light ? 'Gelap' : 'Terang';
        btn.setAttribute('aria-pressed', light ? 'true' : 'false');
    }
    render();

    btn.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        root.setAttribute('data-theme', next);
        try { localStorage.setItem('theme', next); } catch (err) { }
        render();
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
