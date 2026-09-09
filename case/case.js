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
