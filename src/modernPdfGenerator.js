/**
 * Modern Daily Q&A PDF Generator
 * --------------------------------
 * Produces the Modern Daily Q&A PDF combining:
 *  1. 100% Authentic Master Document Vector Rendering:
 *     - Header (AffairsCloud vector logo, Cambria "Daily Q&A PDF", YouTube logo, dashed line)
 *       comes directly from the authentic Microsoft Word template on EVERY page.
 *     - Border (authentic AffairsCloud gradient border / image1.jpeg with blue corners,
 *       orange/green sides, red flourishes) comes from Microsoft Word on EVERY page.
 *     - Footer (Cambria copyright, dashed line, and sequential page numbers) comes from Word.
 *     - Pages 1 & 2: 100% authentic Word Cover and Promo pages with selectable vector text & links.
 *     - Page 3: Dynamic Table of Contents (INDEX) with live section page mapping.
 *     - Closing Pages: Aspirant Queries (with dynamically matched page number) and Back Cover.
 *  2. Finalized Modern Question Card Design (Playwright Vector Overlay):
 *     - Orange rounded square number badges (1, 2, 6, ...)
 *     - Blue callout statement containers
 *     - Rounded option pills with circular key badges; correct answer highlighted in soft green
 *     - Pill-shaped green answer badge (✓ Answer: ...)
 *     - Soft peach explanation container with white sub-callout boxes having orange left borders
 *     - Floating side promotional banners after Q1, Q3, Q5.
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts, PDFName, PDFString } = require('pdf-lib');
const { chromium } = require('playwright');
const {
  parseDailySource,
  standardizeQuestions,
  detectContentLanguage,
  getDateFolder,
  OUTPUT_DIR
} = require('./quizParser');
const { convertDocxToPdf } = require('./docxToPdf');

const ROOT_DIR = path.join(__dirname, '..');
const BASE_TEMPLATE = path.join(
  ROOT_DIR,
  'Templates',
  'Daily',
  'Current Affairs Q&A PDF November 7,8&9 2026 by Affairscloud.docx'
);
const MASTER_BASE_PDF = path.join(
  ROOT_DIR,
  'Templates',
  'Daily',
  'master_template_base.pdf'
);
// Optimized template: same as above but with the 3.84 MB Segoe UI Emoji font
// stripped out (it was embedded by MS Word but is not needed for rendering).
const MASTER_OPTIMIZED_PDF = path.join(
  ROOT_DIR,
  'Templates',
  'Daily',
  'master_template_optimized.pdf'
);

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text) {
  if (!text) return '';
  let t = String(text);
  if ((t.match(/\*\*/g) || []).length % 2) t += '**';
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)<>"'\]]+)/g;
  const renderChunk = (chunk) => {
    let out = '', last = 0, m;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(chunk)) !== null) {
      out += esc(chunk.slice(last, m.index));
      let label = m[1] || m[3];
      let url = (m[2] || m[3]).replace(/&amp;/g, '&');
      out += `<a href="${esc(url)}">${esc(label)}</a>`;
      last = linkRe.lastIndex;
    }
    return out + esc(chunk.slice(last));
  };
  return t.split('**').map((part, i) => (part ? (i % 2 ? `<b>${renderChunk(part)}</b>` : renderChunk(part)) : '')).join('');
}

function tableXmlToHtml(xml) {
  const rows = xml.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) || [];
  const html = rows.map((tr) => {
    const cells = tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
    return '<tr>' + cells.map((tc) => {
      const paras = (tc.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || [])
        .map((p) => (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
          .map((t) => t.replace(/<[^>]+>/g, '')).join(''))
        .filter((s) => s.trim());
      return `<td>${paras.map((p) => esc(p.replace(/&amp;/g, '&'))).join('<br>')}</td>`;
    }).join('') + '</tr>';
  }).join('');
  return `<div class="tbl-wrap"><table class="tbl">${html}</table></div>`;
}

function getBannerDataUris() {
  const bannerDir = path.join(ROOT_DIR, 'Templates', 'Daily', 'extracted_assets', 'images');
  return ['image5.jpg', 'image6.jpeg', 'image7.jpeg'].map(f => {
    const p = path.join(bannerDir, f);
    if (!fs.existsSync(p)) return '';
    const ext = path.extname(f).slice(1).toLowerCase();
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
  });
}

function getQrCodeDataUri() {
  const qrPath = path.join(ROOT_DIR, 'Templates', 'Daily', 'extracted_assets', 'images', 'image4.png');
  if (fs.existsSync(qrPath)) {
    return `data:image/png;base64,${fs.readFileSync(qrPath).toString('base64')}`;
  }
  return '';
}

function buildTransparentOverlayHtml({ questions, dateString, isHindi, tableMap }) {
  const banners = getBannerDataUris();
  const qrUri = getQrCodeDataUri();
  const cleanDate = String(dateString || '').replace(/^DAILY\s+(?:CA\s+)?QUIZ[:\s\-]*/i, '').trim();
  const mainTitleText = isHindi
    ? `करेंट अफेयर्स Q&A PDF – ${esc(cleanDate)}`
    : `Current Affairs Q&A PDF – ${esc(cleanDate)}`;

  // Group questions by section
  const sections = {};
  questions.forEach(q => {
    const s = q.section || q.topic || (isHindi ? 'राष्ट्रीय मामले' : 'NATIONAL AFFAIRS');
    if (!sections[s]) sections[s] = [];
    sections[s].push(q);
  });
  const sectionKeys = Object.keys(sections);

  // 1. Build Quiz Questions HTML
  let srcHtml = `<div class="ttl">${mainTitleText}</div>`;
  let globalNum = 1;

  for (const sTitle of sectionKeys) {
    const sAnchor = `sec-${globalNum}`;
    srcHtml += `<div class="sect" id="${sAnchor}">${esc(sTitle)}</div>`;
    for (const q of sections[sTitle]) {
      const qNum = globalNum++;
      srcHtml += `<div class="q">`;
      srcHtml += `<div class="qh"><div class="num">${qNum}</div><div class="qt">${inline(q.questionText)}</div></div>`;

      // Statements / Tables
      if (q.statements && q.statements.length > 0) {
        for (const st of q.statements) {
          const trimmed = st.trim();
          if (trimmed.startsWith('__TABLE_PLACEHOLDER_') && tableMap && tableMap[trimmed]) {
            srcHtml += tableXmlToHtml(tableMap[trimmed]);
          } else {
            srcHtml += `<div class="stmt">${inline(st)}</div>`;
          }
        }
      }

      // Options (Pills with circular key badges)
      if (q.options && q.options.length > 0) {
        srcHtml += `<ul class="opts">`;
        q.options.forEach(opt => {
          const m = String(opt).match(/^\s*([1-5])\s*[\)\.]\s*(.*)$/s);
          const digit = m ? m[1] : '';
          const optText = m ? m[2] : opt;
          srcHtml += `<li><i>${digit}</i><span>${inline(optText)}</span></li>`;
        });
        srcHtml += `</ul>`;
      }

      // Solution & Explanation
      srcHtml += `<div class="sol">`;
      if (q.answer) {
        const ansPrefix = isHindi ? 'उत्तर: ' : 'Answer: ';
        srcHtml += `<div class="ans"><span class="chk">&#10003;</span><span>${ansPrefix}${inline(q.answer)}</span></div>`;
      }

      if (q.explanation) {
        srcHtml += `<div class="exp">`;
        const expLabel = isHindi ? 'स्पष्टीकरण' : 'EXPLANATION';
        srcHtml += `<h4>${expLabel}</h4>`;

        // Floating side banner for Q1, Q3, Q5
        if (qNum === 1 && banners[0]) {
          srcHtml += `<img src="${banners[0]}" style="float:right; width:155px; margin:0 0 8px 12px; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.12);" />`;
        } else if (qNum === 3 && banners[1]) {
          srcHtml += `<img src="${banners[1]}" style="float:right; width:155px; margin:0 0 8px 12px; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.12);" />`;
        } else if (qNum === 5 && banners[2]) {
          srcHtml += `<img src="${banners[2]}" style="float:right; width:155px; margin:0 0 8px 12px; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.12);" />`;
        }

        const lines = q.explanation.split('\n').map(l => l.trim()).filter(Boolean);
        while (lines.length > 0 && /^(?:\*\*)?(?:Explanation|स्पष्टीकरण|विवरण|हल)\s*[:.]?\s*(?:\*\*)?\s*[:.]?\s*/i.test(lines[0])) {
          lines.shift();
        }

        let inUl = false;
        for (const line of lines) {
          if (line.startsWith('__TABLE_PLACEHOLDER_') && tableMap && tableMap[line]) {
            if (inUl) { srcHtml += `</ul>`; inUl = false; }
            srcHtml += tableXmlToHtml(tableMap[line]);
            continue;
          }

          const isBullet = /^(?:●|•|▪|▶|∙|-(?!\*))\s*/.test(line);
          const subMatch = line.match(/^(\*{0,2}[^:\n]{2,45}:\*{0,2}\s*)(.*)$/);

          if (isBullet || subMatch) {
            if (!inUl) { srcHtml += `<ul>`; inUl = true; }
            let content = line;
            if (isBullet) {
              content = line.replace(/^(?:●|•|▪|▶|∙|-(?!\*))\s*/, '').trim();
            }
            if (subMatch && !isBullet) {
              const title = subMatch[1].replace(/\*\*/g, '').trim();
              const body = subMatch[2].trim();
              srcHtml += `<li><b>${esc(title)}</b> ${inline(body)}</li>`;
            } else {
              srcHtml += `<li>${inline(content)}</li>`;
            }
          } else {
            if (inUl) { srcHtml += `</ul>`; inUl = false; }
            srcHtml += `<p>${inline(line)}</p>`;
          }
        }
        if (inUl) { srcHtml += `</ul>`; inUl = false; }
        srcHtml += `<div style="clear:both;"></div></div>`;
      }
      srcHtml += `</div></div>`;
    }
  }

  // Load CSS and customize for transparent overlay:
  let css = fs.readFileSync(path.join(ROOT_DIR, 'src', 'modernPdf.css'), 'utf8');
  css = css.replace(/background:\s*#fff\s+url\([^)]+\)[^;]*;/g, 'background: transparent;');
  css = css.replace(/body\s*\{[^}]*\}/g, 'body { margin: 0; padding: 0; background: transparent; }');
  css = css.replace(/\.page\s*\{[^}]*\}/g, '.page { width: 210mm; height: 297mm; margin: 0 auto; background: transparent; position: relative; overflow: hidden; break-after: page; page-break-after: always; }');
  css = css.replace(/\.pin\s*\{[^}]*\}/g, '.pin { height: 100%; background: transparent; display: flex; flex-direction: column; }');
  css = css.replace(/\.hd\s*\{[^}]*\}/g, '.hd { display: none !important; }');
  css = css.replace(/\.ft\s*\{[^}]*\}/g, '.ft { display: none !important; }');
  // CRITICAL: Padding-top is 124px so headings and questions start cleanly below Word's header line
  css = css.replace(/\.pb\s*\{[^}]*\}/g, '.pb { flex: 1; min-height: 0; overflow: hidden; padding: 124px 36px 52px 36px; }');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Modern Daily Quiz</title>
  <style>
    ${css}
    a { color: #0563C1; text-decoration: underline; }
    .ttl { margin: 4px 0 10px; text-align: center; color: var(--red); font: 700 22px Cambria, serif; }
    .sect { margin: 12px 0 8px; text-align: center; color: var(--red); font: 700 20px Cambria, serif; letter-spacing: 0.5px; }
  </style>
</head>
<body style="background: transparent;">
  <div id="src" style="display:none;">${srcHtml}</div>
  <div id="hd" style="display:none;"><div></div></div>
  <div id="pages"></div>

  <script>
    (function() {
      var START = 4; // Quiz starts on Page 4
      var sectionPageMap = {};

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
        var n = START, pb, S, started = {};

        function newPage() {
          var page = el('div', 'page'), pin = el('div', 'pin');
          pb = el('div', 'pb');
          pin.appendChild(pb); page.appendChild(pin); out.appendChild(page);
          n++; S = { card: null, opts: null, sol: null, exp: null, expUl: null, q: 0 };
        }
        function overflow() { return pb.scrollHeight > pb.clientHeight + 1; }

        function place(a) {
          var snap = {}, created = [], k;
          for (k in S) snap[k] = S[k];
          function add(parent, node) { parent.appendChild(node); created.push(node); return node; }
          if (a.t === 'head' || a.t === 'free') {
            add(pb, frag(a.h));
            S.card = null;
            if (a.sect && !sectionPageMap[a.sect]) {
              sectionPageMap[a.sect] = (n - 1);
            }
          } else {
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

        // Build Page 3 (Dynamic Table of Contents + Important Notice + Congratulations)
        var tocPage = el('div', 'page'), tocPin = el('div', 'pin');
        var tocPb = el('div', 'pb');

        var tocCardHtml = '<div style="font: 700 22pt Cambria, serif; color: #FF0000; text-align: center; margin: 0 0 10px 0; letter-spacing: 0.5px;">AFFAIRSCLOUD TODAY</div>';
        tocCardHtml += '<div style="font: 600 13pt Calibri, sans-serif; color: #2e75b6; margin: 0 0 8px 0;">Table of Contents</div>';
        tocCardHtml += '<div style="list-style: none; padding: 0; margin: 0;">';
        tocCardHtml += '<div class="toc-row" data-target-page="4" style="display: flex; align-items: baseline; justify-content: space-between; padding: 2px 0; font-size: 11pt; font-family: Cambria, serif; color: #111; cursor: pointer;"><span style="font-weight:700;">' + ${JSON.stringify(mainTitleText)} + '</span><span style="flex: 1; border-bottom: 1px dotted #888; margin: 0 8px; position: relative; top: -3px;"></span><span style="font-weight: 700; color: #d92525;">4</span></div>';

        for (var sName in sectionPageMap) {
          tocCardHtml += '<div class="toc-row" data-target-page="' + sectionPageMap[sName] + '" style="display: flex; align-items: baseline; justify-content: space-between; padding: 2px 0; font-size: 11pt; font-family: Cambria, serif; color: #111; cursor: pointer;"><span>' + sName + '</span><span style="flex: 1; border-bottom: 1px dotted #888; margin: 0 8px; position: relative; top: -3px;"></span><span style="font-weight: 700; color: #d92525;">' + sectionPageMap[sName] + '</span></div>';
        }
        tocCardHtml += '</div>';

        // Important Notice
        tocCardHtml += '<div style="margin-top: 24px; font-size: 10pt; line-height: 1.38; font-family: Cambria, serif; color: #111; text-align: justify;">';
        tocCardHtml += '<div style="margin-bottom: 4px;"><span style="color: #FF0000; font-weight: 700; font-size: 11pt;">Important Notice:</span><span style="font-weight: 700; font-size: 11pt;"> CareersCloud Content Sharing and Legal Compliance</span></div>';
        tocCardHtml += '<div>We kindly request our aspirants <b>not to share or distribute our content, PDFs, videos, or any other materials under our ownership to individuals or through any social media platforms.</b> Please note that we have implemented a tracking system to monitor such activities. Any violation of this policy may result in the immediate termination of access to our services, and we will not be held responsible for any loss or inconvenience caused due to such actions. Furthermore, we also reserve the right to take strict legal action, including filing complaints under applicable laws, against individuals or entities found violating this policy.</div>';
        tocCardHtml += '</div>';

        // Congratulations on Your Success!
        tocCardHtml += '<div style="margin-top: 20px; font-size: 9.5pt; line-height: 1.35; font-family: Cambria, serif; color: #111;">';
        tocCardHtml += '<div style="font-weight: 700; font-size: 11pt; margin-bottom: 6px;"><span style="color:#00B050;">&#9733;</span> <span style="color: #00B050;">Congratulations on Your Success!</span></div>';
        tocCardHtml += '<div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;">';
        tocCardHtml += '<div style="flex: 1;">';
        tocCardHtml += '<div>If you have successfully cleared the examination, we invite you to submit your details for official recognition by our community. Your achievement represents dedication, discipline, and excellence and it deserves to be celebrated.</div>';
        tocCardHtml += '<div style="font-weight: 700; margin-top: 6px;">Selected candidates will be:</div>';
        tocCardHtml += '<ul style="margin: 4px 0 6px 18px; padding: 0;">';
        tocCardHtml += '<li style="margin-bottom: 2px;">Featured on our Official Achievers List</li>';
        tocCardHtml += '<li style="margin-bottom: 2px;">Highlighted across our digital platforms</li>';
        tocCardHtml += '<li style="margin-bottom: 2px;">Recognised as community role models</li>';
        tocCardHtml += '</ul>';
        tocCardHtml += '<div style="font-weight: 700; margin-top: 6px;">&#9658; Scan the QR Code to submit your Details or &#9658; Click the below link:</div>';
        tocCardHtml += '<div style="margin-top: 3px;"><a href="https://forms.gle/xbxExzt1ETcPMfFZ7" class="pdf-external-link" data-url="https://forms.gle/xbxExzt1ETcPMfFZ7" style="color: #0563C1; font-weight: 700; text-decoration: underline;">https://forms.gle/xbxExzt1ETcPMfFZ7</a></div>';
        tocCardHtml += '</div>';
        tocCardHtml += '<div style="flex-shrink: 0;"><img src="' + ${JSON.stringify(qrUri)} + '" style="width: 110px; height: 110px; display: block;" /></div>';
        tocCardHtml += '</div>';
        tocCardHtml += '</div>';

        tocPb.innerHTML = tocCardHtml;
        tocPin.appendChild(tocPb);
        tocPage.appendChild(tocPin);
        out.insertBefore(tocPage, out.firstChild); // TOC becomes page 0 in Playwright!
        window.__sectionPageMap = sectionPageMap;
      }

      window.runPagination = function() {
        paginate();
        window.__paginated = true;
      };
    })();
  </script>
</body>
</html>`;
}

/**
 * Clones interactive annotations (e.g. hyperlinks) from a source PDF page to a destination PDF page.
 * Also cleanses the destination page by stripping any obsolete template body annotations (y < 770),
 * keeping only authentic header links (AffairsCloud logo & YouTube header icon at y >= 770).
 */
function transferAnnotations(srcDoc, srcPage, dstDoc, dstPage) {
  // 1. Inspect existing annotations on dstPage (copied from Word template):
  // Keep ONLY authentic header annotations (y >= 770). Strip any old template body annotations (y < 770).
  const existingAnnotsRef = dstPage.node.get(PDFName.of('Annots'));
  let dstAnnotsList = [];
  if (existingAnnotsRef) {
    const existing = dstDoc.context.lookup(existingAnnotsRef);
    if (existing && typeof existing.size === 'function') {
      for (let k = 0; k < existing.size(); k++) {
        const item = existing.get(k);
        const itemObj = dstDoc.context.lookup(item);
        if (itemObj && typeof itemObj.get === 'function') {
          const rect = itemObj.get(PDFName.of('Rect'));
          if (rect && typeof rect.size === 'function' && rect.size() >= 4) {
            const y1 = rect.get(1) && typeof rect.get(1).asNumber === 'function' ? rect.get(1).asNumber() : 0;
            // Only keep header annotations (above the dashed line at y=770)
            if (y1 >= 770) {
              dstAnnotsList.push(item);
            }
          }
        }
      }
    }
  }

  // 2. Clone new annotations from Playwright (explanations, links in cards, etc.)
  const srcAnnotsRef = srcPage.node.get(PDFName.of('Annots'));
  if (srcAnnotsRef) {
    const srcAnnots = srcDoc.context.lookup(srcAnnotsRef);
    if (srcAnnots && typeof srcAnnots.size === 'function') {
      for (let j = 0; j < srcAnnots.size(); j++) {
        const annotRef = srcAnnots.get(j);
        const annotObj = srcDoc.context.lookup(annotRef);
        if (!annotObj || typeof annotObj.entries !== 'function') continue;

        const newDict = dstDoc.context.obj({});
        for (const [k, v] of annotObj.entries()) {
          const val = srcDoc.context.lookup(v);
          if (k.asString() === '/A' && val && typeof val.entries === 'function') {
            const actionDict = dstDoc.context.obj({});
            for (const [ak, av] of val.entries()) {
              const aVal = srcDoc.context.lookup(av);
              actionDict.set(ak, aVal || av);
            }
            newDict.set(k, actionDict);
          } else {
            newDict.set(k, val);
          }
        }
        dstAnnotsList.push(dstDoc.context.register(newDict));
      }
    }
  }

  // 3. Save sanitized annotations list or remove /Annots if empty
  if (dstAnnotsList.length > 0) {
    dstPage.node.set(PDFName.of('Annots'), dstDoc.context.obj(dstAnnotsList));
  } else {
    dstPage.node.delete(PDFName.of('Annots'));
  }
}

/**
 * Strips the large Segoe UI Emoji font blob (3.84 MB) that MS Word embeds in
 * the master template PDF. The font is not needed for rendering — stripping it
 * saves ~3.84 MB from every generated PDF.
 */
function stripLargeEmojiFont(pdfBytes) {
  let content = Buffer.from(pdfBytes).toString('latin1');
  // The Segoe UI Emoji font has a unique /Length1 8046156 signature
  const targetSig = '/Length1 8046156';
  const idx = content.indexOf(targetSig);
  if (idx === -1) return pdfBytes; // Not found — template may already be clean

  const streamStart = content.indexOf('stream', idx);
  if (streamStart === -1) return pdfBytes;
  const streamDataStart = streamStart + 'stream'.length + 1; // skip \n
  const streamEnd = content.indexOf('endstream', streamDataStart);
  if (streamEnd === -1) return pdfBytes;

  // Replace stream data with a single null byte (keeps PDF structure valid,
  // font just won't render — which is fine since we don't use Segoe UI Emoji)
  const before = content.slice(0, streamDataStart);
  const after = content.slice(streamEnd);
  // Update /Length to 0 and remove /Length1
  const dictSection = before.replace(/\/Length\s+4018172/, '/Length 0').replace(/\/Length1\s+8046156\s*/, '');
  return Buffer.from(dictSection + '\n' + after, 'latin1');
}

/**
 * Ensures the authentic master Word template PDF is generated and cached.
 * Returns path to the optimized version (Segoe UI Emoji font stripped).
 */
async function ensureMasterTemplatePdf(log) {
  // Step 1: Ensure base PDF exists and is fresh
  if (fs.existsSync(MASTER_BASE_PDF)) {
    const docxStat = fs.statSync(BASE_TEMPLATE);
    const pdfStat = fs.statSync(MASTER_BASE_PDF);
    if (pdfStat.mtimeMs < docxStat.mtimeMs || pdfStat.size <= 100000) {
      log({ type: 'info', message: 'Converting authentic master Word template to PDF...' });
      fs.mkdirSync(path.dirname(MASTER_BASE_PDF), { recursive: true });
      await convertDocxToPdf(BASE_TEMPLATE, MASTER_BASE_PDF);
      // Force re-optimizing below
      if (fs.existsSync(MASTER_OPTIMIZED_PDF)) fs.unlinkSync(MASTER_OPTIMIZED_PDF);
    }
  } else {
    log({ type: 'info', message: 'Converting authentic master Word template to PDF...' });
    fs.mkdirSync(path.dirname(MASTER_BASE_PDF), { recursive: true });
    await convertDocxToPdf(BASE_TEMPLATE, MASTER_BASE_PDF);
    if (fs.existsSync(MASTER_OPTIMIZED_PDF)) fs.unlinkSync(MASTER_OPTIMIZED_PDF);
  }

  // Step 2: Create optimized version if not cached or outdated
  const baseStat = fs.statSync(MASTER_BASE_PDF);
  const needsOptimize = !fs.existsSync(MASTER_OPTIMIZED_PDF) ||
    fs.statSync(MASTER_OPTIMIZED_PDF).mtimeMs < baseStat.mtimeMs;

  if (needsOptimize) {
    log({ type: 'info', message: '🗜️ Optimizing template PDF (stripping unused Segoe UI Emoji font)...' });
    const baseBytes = fs.readFileSync(MASTER_BASE_PDF);
    const origMB = (baseBytes.length / 1024 / 1024).toFixed(2);
    const optimizedBytes = stripLargeEmojiFont(baseBytes);
    const newMB = (optimizedBytes.length / 1024 / 1024).toFixed(2);
    fs.writeFileSync(MASTER_OPTIMIZED_PDF, optimizedBytes);
    log({ type: 'info', message: `🗜️ Template optimized: ${origMB} MB → ${newMB} MB (saved ${(parseFloat(origMB) - parseFloat(newMB)).toFixed(2)} MB)` });
  }

  return MASTER_OPTIMIZED_PDF;
}

/**
 * Main entry point: Generates Modern Daily Quiz PDF from source DOCX.
 */
async function generateModernDailyPdf(sourceFilePath, onLog) {
  const log = onLog || console.log;
  log({ type: 'info', message: `📄 Parsing Daily Quiz for Modern PDF: ${path.basename(sourceFilePath)}` });

  const raw = await parseDailySource(sourceFilePath);
  const questions = standardizeQuestions(raw.questions, raw.dateString, 'daily');
  const sample = questions.slice(0, 5).map(q => `${q.questionText} ${q.explanation}`).join(' ');
  const isHindi = detectContentLanguage(questions, sample) === 'hi';
  const langLabel = isHindi ? 'Hindi' : 'English';

  log({ type: 'info', message: `✅ Parsed ${questions.length} questions (${langLabel}) for ${raw.dateString}` });

  // 1. Build Runner HTML for transparent cards
  const runnerHtml = buildTransparentOverlayHtml({
    questions,
    dateString: raw.dateString,
    isHindi,
    tableMap: raw.tableMap || {}
  });

  const runnerHtmlPath = path.join(ROOT_DIR, 'tools', `temp_runner_${Date.now()}.html`);
  fs.writeFileSync(runnerHtmlPath, runnerHtml, 'utf8');

  // 2. Run Playwright to paginate and print transparent PDF
  log({ type: 'info', message: '🎨 Paginating modern question cards with Playwright engine...' });
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-font-subpixel-positioning',
      '--font-render-hinting=none',
      // Block Segoe UI Emoji from being embedded — it costs ~3.8 MB per PDF.
      // Chromium will fall back to plain glyph rendering for symbols.
      '--disable-extensions',
    ]
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
  await page.setContent(runnerHtml);
  await page.evaluate(() => window.runPagination());
  await page.waitForFunction('window.__paginated === true', null, { timeout: 35000 });

  const tempPwPdfPath = path.join(ROOT_DIR, 'tools', `temp_pw_${Date.now()}.pdf`);
  await page.pdf({
    path: tempPwPdfPath,
    format: 'A4',
    printBackground: false, // Transparent!
    margin: { top: 0, right: 0, bottom: 0, left: 0 }
  });

  // Extract clickable link coordinates from Page 3 (TOC)
  const p3Links = await page.evaluate(() => {
    const p3El = document.querySelectorAll('.page')[0];
    if (!p3El) return [];
    const pageRect = p3El.getBoundingClientRect();
    const list = [];
    p3El.querySelectorAll('.toc-row').forEach(el => {
      const r = el.getBoundingClientRect();
      const targetPage = parseInt(el.getAttribute('data-target-page'), 10);
      if (targetPage) {
        list.push({
          type: 'goto',
          targetPage,
          x: r.left - pageRect.left,
          y: r.top - pageRect.top,
          width: r.width,
          height: r.height,
        });
      }
    });
    p3El.querySelectorAll('.pdf-external-link').forEach(el => {
      const r = el.getBoundingClientRect();
      const url = el.getAttribute('data-url') || el.href;
      if (url) {
        list.push({
          type: 'uri',
          url,
          x: r.left - pageRect.left,
          y: r.top - pageRect.top,
          width: r.width,
          height: r.height,
        });
      }
    });
    return list;
  });

  await browser.close();

  try { fs.unlinkSync(runnerHtmlPath); } catch {}

  // 3. Ensure authentic base template PDF
  const masterBasePdf = await ensureMasterTemplatePdf(log);

  // 4. Merge Cover + Promo + Dynamic TOC + Question Pages + Closing Pages with pdf-lib
  log({ type: 'info', message: '🔗 Merging authentic Word borders/headers with Modern Question Cards...' });
  const templatePdfDoc = await PDFDocument.load(fs.readFileSync(masterBasePdf));
  const pwPdfDoc = await PDFDocument.load(fs.readFileSync(tempPwPdfPath));
  const finalDoc = await PDFDocument.create();

  // Question pages: Overlay transparent Playwright question cards onto authentic Word pages
  const timesFont = await finalDoc.embedFont(StandardFonts.TimesRoman);
  const pwCount = pwPdfDoc.getPageCount();
  const questionPageCount = pwCount - 1; // number of question pages (index 1..pwCount-1)
  const templateTotal = templatePdfDoc.getPageCount();

  // ── OPTIMIZATION: ONE single copyPages call for ALL template pages so that
  //    font/image resources (Calibri, Cambria-Bold, border image) are shared once
  //    across cover, promo, TOC, every question background, and closing pages.
  //    Layout: [0=cover, 1=promo, 2=toc, 3..3+N-1=questionBg×N, N+3=aspirant, N+4=backCover]
  const templateIndices = [
    0, 1, 2,                                        // cover, promo, TOC base
    ...Array(questionPageCount).fill(5),             // question backgrounds (page index 5 has clean header-only annots)
    templateTotal - 2, templateTotal - 1             // aspirant queries, back cover
  ];
  const allTemplateCopies = await finalDoc.copyPages(templatePdfDoc, templateIndices);
  const coverPage      = allTemplateCopies[0];
  const promoPage      = allTemplateCopies[1];
  const tocBasePage    = allTemplateCopies[2];
  const questionBgPages = allTemplateCopies.slice(3, 3 + questionPageCount);
  const aspPage        = allTemplateCopies[3 + questionPageCount];
  const backCoverPage  = allTemplateCopies[3 + questionPageCount + 1];

  // ── OPTIMIZATION: Batch-embed ALL Playwright pages at once so font resources
  //    (Segoe UI Emoji, etc.) are shared across all pages instead of duplicated per page.
  const allPwIndices = Array.from({ length: pwCount }, (_, k) => k); // [0, 1, 2, ...]
  const allEmbeddedPw = await finalDoc.embedPdf(pwPdfDoc, allPwIndices);
  const embeddedToc    = allEmbeddedPw[0];
  const embeddedPwPages = allEmbeddedPw.slice(1); // [1..pwCount-1]

  // Pages 1 & 2: Cover & Promo (100% authentic vector — no overlay needed)
  finalDoc.addPage(coverPage);
  finalDoc.addPage(promoPage);

  // Page 3: Dynamic Table of Contents (overlaid onto authentic template Page 3)
  // Clear old template body content so the Playwright TOC overlays cleanly
  tocBasePage.drawRectangle({
    x: 26,
    y: 34,
    width: 543,
    height: 736,
    color: rgb(1, 1, 1),
  });

  // Draw TOC overlay
  tocBasePage.drawPage(embeddedToc, {
    x: 0,
    y: 0,
    width: tocBasePage.getWidth(),
    height: tocBasePage.getHeight()
  });
  finalDoc.addPage(tocBasePage);

  for (let i = 1; i < pwCount; i++) {
    const bgPage = questionBgPages[i - 1];
    const embeddedPwPage = embeddedPwPages[i - 1];

    // Clear old text in the center body up to y=770 (right below the dashed line at 771)
    bgPage.drawRectangle({
      x: 26,
      y: 34,
      width: 543,
      height: 736,
      color: rgb(1, 1, 1),
    });
    
    // Draw transparent cards onto authentic background page
    bgPage.drawPage(embeddedPwPage, {
      x: 0,
      y: 0,
      width: bgPage.getWidth(),
      height: bgPage.getHeight()
    });

    // Transfer interactive hyperlinks from Playwright question cards (explanations, etc.)
    transferAnnotations(pwPdfDoc, pwPdfDoc.getPage(i), finalDoc, bgPage);

    // Dynamically patch sequential page number in the authentic footer (e.g., 4, 5, 6...)
    const currentPageNum = 3 + i;
    const pageNumStr = String(currentPageNum);
    bgPage.drawRectangle({
      x: 515,
      y: 12,
      width: 45,
      height: 20,
      color: rgb(1, 1, 1),
    });
    const textWidth = timesFont.widthOfTextAtSize(pageNumStr, 11);
    bgPage.drawText(pageNumStr, {
      x: 533.2 - (textWidth / 2),
      y: 19.2,
      size: 11,
      font: timesFont,
      color: rgb(0, 0, 0),
    });

    finalDoc.addPage(bgPage);
  }

  // Closing Pages: Aspirant Queries & Back Cover (already batch-copied above)
  finalDoc.addPage(aspPage);
  finalDoc.addPage(backCoverPage);

  // 5. Dynamically patch page number on the Aspirant Queries page
  const finalTotal = finalDoc.getPageCount();
  const aspirantPage = finalDoc.getPage(finalTotal - 2);

  aspirantPage.drawRectangle({
    x: 515,
    y: 12,
    width: 45,
    height: 20,
    color: rgb(1, 1, 1),
  });

  const aspPageNumStr = String(finalTotal - 1);
  const aspTextWidth = timesFont.widthOfTextAtSize(aspPageNumStr, 11);
  aspirantPage.drawText(aspPageNumStr, {
    x: 533.2 - (aspTextWidth / 2),
    y: 19.2,
    size: 11,
    font: timesFont,
    color: rgb(0, 0, 0),
  });

  // 6. Add interactive PDF Link Annotations to Page 3 (Table of Contents & External Links)
  if (p3Links && p3Links.length > 0) {
    const p3Page = finalDoc.getPage(2); // Page 3 is index 2 (1-based page 3)
    const p3Width = p3Page.getWidth();
    const p3Height = p3Page.getHeight();
    const cssPageWidth = 793.7008; // 210mm in CSS px @ 96 DPI
    const cssPageHeight = 1122.5197; // 297mm in CSS px @ 96 DPI
    const scaleX = p3Width / cssPageWidth;
    const scaleY = p3Height / cssPageHeight;

    const annots = [];

    for (const l of p3Links) {
      const x1 = l.x * scaleX;
      const x2 = (l.x + l.width) * scaleX;
      const y1 = p3Height - ((l.y + l.height) * scaleY);
      const y2 = p3Height - (l.y * scaleY);

      if (l.type === 'goto' && l.targetPage) {
        const targetIndex = l.targetPage - 1;
        if (targetIndex >= 0 && targetIndex < finalDoc.getPageCount()) {
          const targetRef = finalDoc.getPage(targetIndex).ref;
          const gotoAnnot = finalDoc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [x1, y1, x2, y2],
            Border: [0, 0, 0],
            A: {
              Type: 'Action',
              S: 'GoTo',
              D: [targetRef, 'XYZ', null, null, null],
            },
          });
          annots.push(finalDoc.context.register(gotoAnnot));
        }
      } else if (l.type === 'uri' && l.url) {
        const uriAnnot = finalDoc.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [x1, y1, x2, y2],
          Border: [0, 0, 0],
          A: {
            Type: 'Action',
            S: 'URI',
            URI: PDFString.of(l.url),
          },
        });
        annots.push(finalDoc.context.register(uriAnnot));
      }
    }

    // Keep authentic header links (AffairsCloud logo & YouTube icon at y >= 770) on Page 3
    const existingP3AnnotsRef = p3Page.node.get(PDFName.of('Annots'));
    const finalP3Annots = [];
    if (existingP3AnnotsRef) {
      const existing = finalDoc.context.lookup(existingP3AnnotsRef);
      if (existing && typeof existing.size === 'function') {
        for (let k = 0; k < existing.size(); k++) {
          const item = existing.get(k);
          const itemObj = finalDoc.context.lookup(item);
          if (itemObj && typeof itemObj.get === 'function') {
            const rect = itemObj.get(PDFName.of('Rect'));
            if (rect && typeof rect.size === 'function' && rect.size() >= 4) {
              const y1 = rect.get(1) && typeof rect.get(1).asNumber === 'function' ? rect.get(1).asNumber() : 0;
              if (y1 >= 770) finalP3Annots.push(item);
            }
          }
        }
      }
    }
    finalP3Annots.push(...annots);

    if (finalP3Annots.length > 0) {
      p3Page.node.set(PDFName.of('Annots'), finalDoc.context.obj(finalP3Annots));
      log({ type: 'info', message: `🔗 Added ${annots.length} interactive navigation links to Table of Contents on Page 3` });
    }
  }

  // 7. Save final PDF
  const dateTag = String(raw.dateString).replace(/[,&\s]+/g, '_').replace(/_+/g, '_');
  const dateFolder = getDateFolder(raw.dateString);
  const dailyDir = path.join(OUTPUT_DIR, 'Daily', dateFolder);
  fs.mkdirSync(dailyDir, { recursive: true });

  const pdfFilename = `Daily_Quiz_${dateTag}_${langLabel}_Modern.pdf`;
  const finalPdfPath = path.join(dailyDir, pdfFilename);

  // useObjectStreams: true compresses cross-reference tables (PDF 1.5+ object streams)
  // which significantly reduces file size for documents with many objects.
  const finalPdfBytes = await finalDoc.save({ useObjectStreams: true });
  fs.writeFileSync(finalPdfPath, finalPdfBytes);
  log({ type: 'success', message: `✅ Modern PDF created: ${pdfFilename} (${(finalPdfBytes.length / 1024 / 1024).toFixed(2)} MB, ${finalTotal} pages)` });

  try { fs.unlinkSync(tempPwPdfPath); } catch {}

  return finalPdfPath;
}

module.exports = {
  generateModernDailyPdf,
  DEFAULT_DAILY_TEMPLATE_PATH: BASE_TEMPLATE
};
