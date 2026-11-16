/* Fills framed A4 pages with quiz-card pieces, measured in the browser before printing.
   A card that does not fit continues on the next page (like the classic layout). */
(function () {
  var START = 5; // first quiz page number (pages 1-4 are the cover pages)

  function atomsOf(src) {
    var atoms = [], qid = 0;
    Array.prototype.forEach.call(src.children, function (el) {
      var c = el.classList;
      if (c.contains('sect')) { atoms.push({ t: 'head', h: el.outerHTML, sect: el.textContent.trim(), keep: true }); return; }
      if (c.contains('ttl')) { atoms.push({ t: 'head', h: el.outerHTML, keep: true }); return; }
      if (!c.contains('q')) { atoms.push({ t: 'free', h: el.outerHTML }); return; }
      qid++;
      Array.prototype.forEach.call(el.children, function (ch) {
        var cc = ch.classList;
        if (cc.contains('qh')) atoms.push({ t: 'qh', h: ch.outerHTML, q: qid, keep: true });
        else if (cc.contains('stmt') || cc.contains('tbl-wrap')) atoms.push({ t: 'raw', h: ch.outerHTML, q: qid });
        else if (cc.contains('opts')) Array.prototype.forEach.call(ch.children, function (li) { atoms.push({ t: 'opt', h: li.outerHTML, q: qid }); });
        else if (cc.contains('sol')) Array.prototype.forEach.call(ch.children, function (s) {
          if (s.classList.contains('ans')) atoms.push({ t: 'ans', h: s.outerHTML, q: qid });
          else if (s.classList.contains('exp')) Array.prototype.forEach.call(s.children, function (e) {
            if (e.tagName === 'H4') atoms.push({ t: 'exph', h: e.outerHTML, q: qid, keep: true });
            else if (e.tagName === 'IMG') atoms[atoms.length - 1].h += e.outerHTML;
            else if (e.tagName === 'UL') Array.prototype.forEach.call(e.children, function (li) { atoms.push({ t: 'li', h: li.outerHTML, q: qid }); });
            else atoms.push({ t: 'p', h: e.outerHTML, q: qid });
          });
        });
      });
    });
    return atoms;
  }

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }
  function frag(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }

  function paginate() {
    var out = document.getElementById('pages'); out.innerHTML = '';
    var atoms = atomsOf(document.getElementById('src'));
    var n = START, pb, S, started = {}, sectionPageMap = {};

    function newPage() {
      var page = el('div', 'page'), pin = el('div', 'pin');
      var h = el('div'); h.innerHTML = document.getElementById('hd').innerHTML;
      pb = el('div', 'pb');
      var ft = el('div', 'ft', '<span>Report Errors in the PDF - <a href="mailto:support@careerscloud.in" style="color:inherit; text-decoration:none;"><b>support@careerscloud.in</b></a></span><a href="https://affairscloud.com/" target="_blank" style="color:inherit; text-decoration:none;">Copyright 2014-2026 @ AffairsCloud.com</a><span class="pn">' + n + '</span>');
      pin.appendChild(h.firstElementChild); pin.appendChild(pb); pin.appendChild(ft); page.appendChild(pin); out.appendChild(page);
      n++; S = { card: null, opts: null, sol: null, exp: null, expUl: null, q: 0 };
    }
    function overflow() { return pb.scrollHeight > pb.clientHeight + 1; }

    function place(a) { // returns undo()
      var snap = {}, created = [], k;
      for (k in S) snap[k] = S[k];
      function add(parent, node) { parent.appendChild(node); created.push(node); return node; }
      if (a.t === 'head' || a.t === 'free') {
        add(pb, frag(a.h));
        S.card = null;
        if (a.sect && !sectionPageMap[a.sect]) {
          sectionPageMap[a.sect] = (n - 1);
        }
      }
      else {
        if (!S.card || S.q !== a.q) {
          var card = el('div', 'q' + (started[a.q] ? ' cont' : '')); card.setAttribute('data-q', a.q);
          add(pb, card); S = { card: card, opts: null, sol: null, exp: null, expUl: null, q: a.q }; started[a.q] = true;
        }
        var C = S.card;
        if (a.t === 'qh' || a.t === 'raw') add(C, frag(a.h));
        else if (a.t === 'opt') { if (!S.opts) S.opts = add(C, el('ul', 'opts')); add(S.opts, frag(a.h)); }
        else {
          if (!S.sol) S.sol = add(C, el('div', 'sol'));
          if (a.t === 'ans') add(S.sol, frag(a.h));
          else {
            if (!S.exp) { S.exp = add(S.sol, el('div', 'exp')); S.expUl = null; }
            if (a.t === 'exph') { var d = el('div'); d.innerHTML = a.h; while (d.firstChild) add(S.exp, d.firstChild); }
            else if (a.t === 'li') { if (!S.expUl) S.expUl = add(S.exp, el('ul')); add(S.expUl, frag(a.h)); }
            else { add(S.exp, frag(a.h)); S.expUl = null; }
          }
        }
      }
      return function undo() {
        for (var i = created.length - 1; i >= 0; i--) if (created[i].parentNode) created[i].parentNode.removeChild(created[i]);
        S = snap;
      };
    }

    newPage();
    var i = 0;
    while (i < atoms.length) {
      var grp = [atoms[i]];
      while (atoms[i + grp.length - 1].keep && i + grp.length < atoms.length) grp.push(atoms[i + grp.length]);
      i += grp.length;
      var undos = grp.map(place);
      if (overflow()) {
        for (var u = undos.length - 1; u >= 0; u--) undos[u]();
        if (pb.children.length) newPage();
        grp.forEach(place);
      }
    }
    // mark cards that continue on the next page
    var pages = out.querySelectorAll('.page');
    for (var p = 0; p < pages.length - 1; p++) {
      var last = pages[p].querySelector('.pb').lastElementChild, nextFirst = pages[p + 1].querySelector('.pb').firstElementChild;
      if (last && nextFirst && last.getAttribute('data-q') && last.getAttribute('data-q') === nextFirst.getAttribute('data-q')) last.classList.add('more');
    }

    // update dynamic TOC section page numbers on Page 3
    Object.keys(sectionPageMap).forEach(function (sec) {
      var row = document.querySelector('.toc-row[data-section="' + sec.replace(/"/g, '\\"') + '"] .toc-pn');
      if (row) row.textContent = sectionPageMap[sec];
    });
    // update Aspirant Queries footer page number
    var aspPn = document.getElementById('aspirant-pn');
    if (aspPn) aspPn.textContent = n;
  }

  function go() { try { paginate(); } finally { window.__modernReady = true; } }
  window.addEventListener('load', function () {
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () { setTimeout(go, 150); });
  });
})();
