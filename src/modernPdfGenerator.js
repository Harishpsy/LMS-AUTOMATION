/**
 * Modern Daily Q&A PDF Generator
 * --------------------------------
 * Replaces ONLY the question view design inside the official AffairsCloud master template DOCX,
 * preserving 100% of the base document:
 *  - Cover page, Promo page, Table of Contents, and Achievers page (Pages 1-4)
 *  - Exact authentic AffairsCloud page border (CA PDF BG / image1.jpeg)
 *  - Native headers, footers, page numbering, copyright lines
 *  - Aspirant Queries and Back Cover
 *  - 100% selectable vector text and working clickable hyperlinks across all pages
 *  - Modern styled question view (styled question numbers, statement callout boxes,
 *    styled option keys, green answer pill, orange explanation box, sleek dividers).
 *
 * Converts natively to PDF via Microsoft Word COM engine (convertDocxToPdf).
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const {
  parseDailySource,
  standardizeQuestions,
  detectContentLanguage,
  getDateFolder,
  OUTPUT_DIR
} = require('./quizParser');
const {
  escapeXml,
  renderRunsWithBold,
  extractBannerParagraphsFromTemplate
} = require('./docxXmlHelpers');
const { convertDocxToPdf } = require('./docxToPdf');

const ROOT_DIR = path.join(__dirname, '..');
const TEMPLATES_DAILY = path.join(ROOT_DIR, 'Templates', 'Daily', 'Current Affairs Q&A PDF November 7,8&9 2026 by Affairscloud.docx');
const DEFAULT_DAILY_TEMPLATE_PATH = fs.existsSync(TEMPLATES_DAILY)
  ? TEMPLATES_DAILY
  : path.join(ROOT_DIR, 'Daily PDF', 'Current Affairs Q&A PDF November 7,8&9 2026 by Affairscloud.docx');

class HyperlinkRegistry {
  constructor(initialMaxId = 500) {
    this.currentId = initialMaxId;
    this.links = [];
  }
  initFromRels(relsXml) {
    if (!relsXml) return;
    const ids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map(m => parseInt(m[1], 10));
    if (ids.length > 0) {
      this.currentId = Math.max(this.currentId, ...ids);
    }
  }
  add(url) {
    if (!url) return '';
    const cleanUrl = url.trim();
    const existing = this.links.find(l => l.url === cleanUrl);
    if (existing) return existing.rId;
    this.currentId++;
    const rId = `rId${this.currentId}`;
    this.links.push({ rId, url: cleanUrl });
    return rId;
  }
}

// ─── CANONICAL TOPIC ORDER ────────────────────────────────────────────────────
const CANONICAL_SECTION_ORDER = [
  'NATIONAL AFFAIRS',
  'INTERNATIONAL AFFAIRS',
  'BANKING & FINANCE',
  'ECONOMY & BUSINESS',
  'AWARDS & RECOGNITIONS',
  'APPOINTMENTS & RESIGNATIONS',
  'ACQUISITIONS & MERGERS',
  'SCIENCE & TECHNOLOGY',
  'ENVIRONMENT',
  'SPORTS',
  'OBITUARY',
  'BOOKS & AUTHORS',
  'IMPORTANT DAYS',
  'STATE NEWS',
  'STATIC'
];

function normalizeSection(rawSection) {
  if (!rawSection) return 'NATIONAL AFFAIRS';
  const clean = String(rawSection).replace(/&amp;/gi, '&').replace(/\*\*/g, '');
  const upper = clean.trim().toUpperCase();

  if (upper.includes('STATIC') || upper === 'GK' || upper.endsWith(' GK')) {
    return 'STATIC';
  }
  if (upper.includes('INTERNATIONAL') || upper.includes('SUMMIT') || upper.includes('MOU')) {
    return 'INTERNATIONAL AFFAIRS';
  }
  if (upper.includes('NATIONAL') || upper.includes('GOVT') || upper.includes('SCHEME') || upper.includes('VISIT')) {
    return 'NATIONAL AFFAIRS';
  }
  if (upper.includes('BANKING') || upper.includes('FINANCE')) {
    return 'BANKING & FINANCE';
  }
  if (upper.includes('ECONOMY') || upper.includes('BUSINESS')) {
    return 'ECONOMY & BUSINESS';
  }
  if (upper.includes('AWARD') || upper.includes('RECOGNITION')) {
    return 'AWARDS & RECOGNITIONS';
  }
  if (upper.includes('APPOINTMENT') || upper.includes('RESIGNATION')) {
    return 'APPOINTMENTS & RESIGNATIONS';
  }
  if (upper.includes('ACQUISITION') || upper.includes('MERGER')) {
    return 'ACQUISITIONS & MERGERS';
  }
  if (upper.includes('SCIENCE') || upper.includes('TECHNOLOGY') || upper.includes('DEFENCE')) {
    return 'SCIENCE & TECHNOLOGY';
  }
  if (upper.includes('ENVIRONMENT')) {
    return 'ENVIRONMENT';
  }
  if (upper.includes('SPORT')) {
    return 'SPORTS';
  }
  if (upper.includes('OBITUARY') || upper.includes('PASSED AWAY') || upper.includes('DEMISE')) {
    return 'OBITUARY';
  }
  if (upper.includes('BOOK') || upper.includes('AUTHOR')) {
    return 'BOOKS & AUTHORS';
  }
  if (upper.includes('DAY') || upper.includes('WEEK') || upper.includes('YEAR')) {
    return 'IMPORTANT DAYS';
  }
  if (upper.includes('STATE')) {
    return 'STATE NEWS';
  }

  return upper;
}

function getSectionOrderIndex(sectionTitle) {
  const norm = normalizeSection(sectionTitle);
  const idx = CANONICAL_SECTION_ORDER.indexOf(norm);
  return idx !== -1 ? idx : 999;
}

// ─── MODERN OPENXML GENERATORS ────────────────────────────────────────────────

function buildModernSectionHeaderXml(title) {
  return `<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:keepNext/><w:spacing w:before="380" w:after="160" w:line="276" w:lineRule="auto"/><w:jc w:val="center"/><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="8" w:color="D92525"/></w:pBdr><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="D92525"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="D92525"/></w:rPr><w:t>${escapeXml(title)}</w:t></w:r></w:p>`;
}

function buildModernQuestionXml(num, text, hyperlinkRegistry) {
  const content = renderRunsWithBold(text, true, hyperlinkRegistry);
  return `<w:p><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="120" w:after="40" w:line="276" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:color w:val="0D47A1"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr><w:t xml:space="preserve">${num}.  </w:t></w:r>${content}</w:p>`;
}

function buildModernStatementXml(statement, tableMap, hyperlinkRegistry) {
  if (!statement) return '';
  const trimmed = statement.trim();
  if (trimmed.startsWith('__TABLE_PLACEHOLDER_') && tableMap && tableMap[trimmed]) {
    return tableMap[trimmed];
  }
  const runs = renderRunsWithBold(statement, true, hyperlinkRegistry);
  return `<w:p><w:pPr><w:keepNext/><w:keepLines/><w:pBdr><w:left w:val="single" w:sz="20" w:space="10" w:color="1D3F8F"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F4F7FB"/><w:ind w:left="160" w:right="120"/><w:spacing w:before="30" w:after="30" w:line="260" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:pPr>${runs}</w:p>`;
}

function buildModernOptionXml(option, keepNext = false) {
  const pPrKeep = keepNext ? '<w:keepNext/><w:keepLines/>' : '<w:keepLines/>';
  const m = String(option).match(/^\s*(\d)\s*\)\s*(.*)$/s);
  const key = m ? m[1] + ') ' : '';
  const text = m ? m[2] : option;

  const keyRun = key ? `<w:r><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:color w:val="1565C0"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr><w:t xml:space="preserve">${escapeXml(key)}</w:t></w:r>` : '';
  const textRun = `<w:r><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;

  return `<w:p><w:pPr>${pPrKeep}<w:ind w:left="180"/><w:spacing w:before="20" w:after="20" w:line="276" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:pPr>${keyRun}${textRun}</w:p>`;
}

function buildModernAnswerXml(answer, isHindi = false) {
  const prefix = isHindi ? '✓ सही उत्तर: ' : '✓ Answer: ';
  return `<w:p><w:pPr><w:keepNext/><w:keepLines/><w:pBdr><w:left w:val="single" w:sz="24" w:space="10" w:color="16A34A"/><w:top w:val="single" w:sz="4" w:space="4" w:color="BBF7D0"/><w:bottom w:val="single" w:sz="4" w:space="4" w:color="BBF7D0"/><w:right w:val="single" w:sz="4" w:space="4" w:color="BBF7D0"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F0FDF4"/><w:ind w:left="140" w:right="120"/><w:spacing w:before="70" w:after="50" w:line="260" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:color w:val="15803D"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr><w:t xml:space="preserve">${prefix}</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:color w:val="166534"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr><w:t xml:space="preserve">${escapeXml(answer)}</w:t></w:r></w:p>`;
}

function buildModernExplanationXml(explanation, isHindi = false, tableMap = {}, hyperlinkRegistry = null) {
  if (!explanation || !explanation.trim()) return '';

  const label = isHindi ? '💡 स्पष्टीकरण' : '💡 EXPLANATION';
  let xml = `<w:p><w:pPr><w:keepNext/><w:pBdr><w:left w:val="single" w:sz="24" w:space="10" w:color="EA580C"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="FFF7ED"/><w:ind w:left="140" w:right="120"/><w:spacing w:before="60" w:after="20" w:line="260" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:color w:val="C2410C"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:color w:val="C2410C"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${label}</w:t></w:r></w:p>`;

  const lines = explanation.split('\n').map(l => l.trim()).filter(Boolean);
  while (lines.length > 0 && (
    /^(?:\*\*)?(?:Explanation|स्पष्टीकरण|विवरण|हल)\s*[:.]?\s*(?:\*\*)?\s*[:.]?\s*$/i.test(lines[0]) ||
    /^(?:\*\*)?\s*[:.\-–—]\s*(?:\*\*)?$/.test(lines[0])
  )) {
    lines.shift();
  }
  if (lines.length > 0 && /^(?:\*\*)?(?:Explanation|स्पष्टीकरण|विवरण|हल)\s*[:.]?\s*(?:\*\*)?\s*[:.]?\s*/i.test(lines[0])) {
    const stripped = lines[0].replace(/^(?:\*\*)?(?:Explanation|स्पष्टीकरण|विवरण|हल)\s*[:.]?\s*(?:\*\*)?\s*[:.]?\s*/i, '').trim();
    if (stripped) lines[0] = stripped;
    else lines.shift();
  }
  while (lines.length > 0 && /^(?:\*\*)?\s*[:.\-–—]\s*(?:\*\*)?$/.test(lines[0])) {
    lines.shift();
  }
  if (lines.length > 0 && /^(?:\*\*)?\s*[:.\-–—]\s*(?:\*\*)?\s*(.+)$/.test(lines[0])) {
    lines[0] = lines[0].replace(/^(?:\*\*)?\s*[:.\-–—]\s*(?:\*\*)?\s*/, '').trim();
  }

  for (const line of lines) {
    if (line.startsWith('__TABLE_PLACEHOLDER_') && tableMap && tableMap[line]) {
      xml += tableMap[line];
      continue;
    }

    const isBullet = /^(?:●|•|▪|▶|∙|-(?!\*))\s*/.test(line);
    const isAboutHeading = /^(?:\*\*)?(?:About\s+[^:\n]+|[^:\n]+\s+के\s+बारे\s+में)\s*:(?:\*\*)?$/i.test(line);

    if (isAboutHeading) {
      const cleanHeading = line.replace(/\*\*/g, '').trim();
      xml += `<w:p><w:pPr><w:keepNext/><w:spacing w:before="60" w:after="20" w:line="250" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:u w:val="single"/><w:color w:val="0D47A1"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:u w:val="single"/><w:color w:val="0D47A1"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr><w:t xml:space="preserve">${escapeXml(cleanHeading)}</w:t></w:r></w:p>`;
      continue;
    }

    if (isBullet) {
      const cleanContent = line.replace(/^(?:●|•|▪|▶|∙|-(?!\*))\s*/, '').trim();
      const pPr = `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr><w:spacing w:before="20" w:after="30" w:line="276" w:lineRule="auto"/><w:ind w:left="720" w:hanging="360"/><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:pPr>`;
      const prefixMatch = cleanContent.match(/^(\*{0,2}[^:\n]{1,70}:(?:\s*\*{2})?\s*)(.*)$/);

      if (prefixMatch) {
        const prefix = prefixMatch[1].replace(/\*\*/g, '').trim();
        const rest = prefixMatch[2].trim();
        const prefixRun = `<w:r><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr><w:t xml:space="preserve">${escapeXml(prefix)} </w:t></w:r>`;
        const restRuns = renderRunsWithBold(rest, false, hyperlinkRegistry);
        xml += `<w:p>${pPr}${prefixRun}${restRuns}</w:p>`;
      } else {
        const contentRuns = renderRunsWithBold(cleanContent, false, hyperlinkRegistry);
        xml += `<w:p>${pPr}${contentRuns}</w:p>`;
      }
    } else {
      const isKeyValue = /^(\*{0,2}[A-Za-z\u0900-\u097F\s()]{1,40}\s*[-–—:]\*{0,2}\s*)(.+)$/.test(line.replace(/\*\*/g, ''));
      const spacingBefore = isKeyValue ? "0" : "20";
      const spacingAfter = isKeyValue ? "20" : "40";
      const lineRuleVal = isKeyValue ? "240" : "276";

      const runs = renderRunsWithBold(line, false, hyperlinkRegistry);
      xml += `<w:p><w:pPr><w:spacing w:before="${spacingBefore}" w:after="${spacingAfter}" w:line="${lineRuleVal}" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:pPr>${runs}</w:p>`;
    }
  }

  // Divider line after question
  xml += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="8" w:color="E2E8F0"/></w:pBdr><w:spacing w:before="60" w:after="80" w:line="200" w:lineRule="auto"/><w:rPr><w:sz w:val="12"/></w:rPr></w:pPr></w:p>';

  return xml;
}

function buildModernQuestionsFragmentXml(questions, isTopicWise, isHindi, tableMap, sideBanners, hyperlinkRegistry) {
  const sections = {};
  questions.forEach(q => {
    const rawSec = q.section || q.topic || 'NATIONAL AFFAIRS';
    const sec = normalizeSection(rawSec);
    if (!sections[sec]) sections[sec] = [];
    sections[sec].push(q);
  });

  const sortedSectionTitles = Object.keys(sections).sort((a, b) => {
    return getSectionOrderIndex(a) - getSectionOrderIndex(b);
  });

  let xml = '';
  let globalNum = 1;

  for (const sectionTitle of sortedSectionTitles) {
    const qs = sections[sectionTitle];
    if (!qs || qs.length === 0) continue;

    xml += buildModernSectionHeaderXml(sectionTitle);
    xml += '<w:p><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0" w:line="220" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:pPr></w:p>';

    qs.forEach((q, qIndex) => {
      const qNum = isTopicWise ? (qs.indexOf(q) + 1) : globalNum++;
      xml += buildModernQuestionXml(qNum, q.questionText, hyperlinkRegistry);

      if (q.statements && q.statements.length > 0) {
        for (const st of q.statements) {
          xml += buildModernStatementXml(st, tableMap, hyperlinkRegistry);
        }
      }

      if (q.options && q.options.length > 0) {
        q.options.forEach((opt, optIdx) => {
          const keepNext = optIdx < q.options.length - 1;
          xml += buildModernOptionXml(opt, keepNext);
        });
      }

      if (q.answer) {
        xml += buildModernAnswerXml(q.answer, isHindi);
      }

      if (q.explanation) {
        xml += buildModernExplanationXml(q.explanation, isHindi, tableMap, hyperlinkRegistry);
      }

      const currentQNum = globalNum - 1;
      if (sideBanners && sideBanners.length > 0) {
        if (currentQNum === 1 && sideBanners[0]) {
          xml += sideBanners[0];
        } else if (currentQNum === 3 && sideBanners[1]) {
          xml += sideBanners[1];
        } else if (currentQNum === 5 && sideBanners[2]) {
          xml += sideBanners[2];
        }
      }
    });
  }

  return xml;
}

/**
 * Inject questions with modern card layout into the official template DOCX.
 * Preserves 100% of cover pages, promo, TOC, achievers, borders, headers, footers,
 * and aspirant queries.
 */
function injectModernQuestionsIntoTemplate({
  templatePath = DEFAULT_DAILY_TEMPLATE_PATH,
  questions,
  dateString,
  outputPath,
  isTopicWise = false,
  isHindi = false,
  tableMap = {}
}) {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template DOCX not found at: ${templatePath}`);
  }

  const zip = new AdmZip(templatePath);
  let xml = zip.readAsText('word/document.xml');

  // Replace Title in both the TOC and Heading 1 Banner
  if (dateString) {
    const cleanDate = dateString.replace(/^DAILY\s+(?:CA\s+)?QUIZ[:\s\-]*/i, '').trim();
    const newTitle = isHindi
      ? `करेंट अफेयर्स Q&amp;A PDF – ${escapeXml(cleanDate)}`
      : `Current Affairs Q&amp;A PDF – ${escapeXml(cleanDate)}`;

    xml = xml.replace(
      /<w:instrText xml:space="preserve">\s*TOC[^\<]*<\/w:instrText>/,
      '<w:instrText xml:space="preserve"> TOC \\t "Heading 2,1" \\h \\z \\u </w:instrText>'
    );

    const tocHeadingText = isHindi ? 'विषय-सूची (INDEX)' : 'INDEX (Table of Contents)';
    xml = xml.replace(
      /(<w:pStyle w:val="TOCHeading"[\s\S]*?<w:t>)[^<]*(<\/w:t>)/,
      `$1${tocHeadingText}$2`
    );

    xml = xml.replace(/(<w:pStyle w:val="TOC1"[\s\S]*?<w:t>)[^<]*(<\/w:t>)/g, (match, p1, p2) => {
      return p1 + newTitle + p2;
    });

    const heading1Regex = /(<w:p[^>]*><w:pPr><w:pStyle w:val="Heading1"[\s\S]*?<\/w:pPr>)([\s\S]*?)(<\/w:p>)/;
    xml = xml.replace(heading1Regex, (match, pPr, body, close) => {
      const bStart = (body.match(/<w:bookmarkStart[^>]*\/>/g) || []).join('');
      const bEnd = (body.match(/<w:bookmarkEnd[^>]*\/>/g) || []).join('');
      const newRun = `<w:r w:rsidRPr="001A3FD1"><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/><w:b/><w:bCs/><w:color w:val="FF0000"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr><w:lastRenderedPageBreak/><w:t>${newTitle}</w:t></w:r>`;
      return pPr + bStart + newRun + bEnd + close;
    });
  }

  // Find question boundaries
  const pRegex = /<w:p(?:\s+[^>]*)?>[\s\S]*?<\/w:p>/g;
  let match;
  const paragraphs = [];
  while ((match = pRegex.exec(xml)) !== null) {
    const pXml = match[0];
    const textMatches = pXml.match(/<w:t(?:\s+[^>]*)?>([^<]*)<\/w:t>/g) || [];
    const text = textMatches.map(t => t.replace(/<[^>]+>/g, '')).join('').trim();
    paragraphs.push({
      index: paragraphs.length,
      start: match.index,
      end: match.index + pXml.length,
      text,
      xml: pXml
    });
  }

  let startP = paragraphs.find((p, i) => i >= 35 && /^(NATIONAL AFFAIRS|1\.\s)/i.test(p.text));
  if (!startP) startP = paragraphs.find(p => /^1\.\s/i.test(p.text));
  let endP = paragraphs.find(p => /Aspirant Queries/i.test(p.text));

  if (!startP) {
    throw new Error('Could not locate start of questions region in template DOCX');
  }

  const startOffset = startP.start;
  const endOffset = endP ? endP.start : paragraphs[paragraphs.length - 1].start;

  const startIdx = paragraphs.indexOf(startP);
  const endIdx = endP ? paragraphs.indexOf(endP) : paragraphs.length - 1;
  const allBanners = extractBannerParagraphsFromTemplate(xml, startIdx, endIdx);
  const sideBanners = allBanners.filter(b => !b.includes('wrapTopAndBottom') && !b.includes('align="center"'));
  const bottomBanner = allBanners.find(b => b.includes('wrapTopAndBottom') || b.includes('align="center"')) || '';

  const hyperlinkRegistry = new HyperlinkRegistry();
  const relsXml = zip.readAsText('word/_rels/document.xml.rels') || '';
  hyperlinkRegistry.initFromRels(relsXml);

  const pageBreakBeforeAspirantXml = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>';
  const newQuestionsXml = buildModernQuestionsFragmentXml(questions, isTopicWise, isHindi, tableMap, sideBanners, hyperlinkRegistry) + (bottomBanner ? bottomBanner : '') + pageBreakBeforeAspirantXml;

  const newDocXml = xml.slice(0, startOffset) + newQuestionsXml + xml.slice(endOffset);
  zip.updateFile('word/document.xml', Buffer.from(newDocXml, 'utf-8'));

  // Patch numbering.xml
  try {
    let numXml = zip.readAsText('word/numbering.xml');
    if (numXml) {
      const targetBulletsRegex = /(<w:lvl\s+w:ilvl="0">[\s\S]*?<w:numFmt\s+w:val="bullet"\/>)[\s\S]*?(<\/w:lvl>)/g;
      numXml = numXml.replace(
        targetBulletsRegex,
        `$1<w:lvlText w:val="&#xF0B7;"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>$2`
      );
      zip.updateFile('word/numbering.xml', Buffer.from(numXml, 'utf-8'));
    }
  } catch (e) {
    console.warn('[modernPdfGenerator] Could not patch numbering.xml:', e.message);
  }

  // Patch styles.xml
  try {
    let stylesXml = zip.readAsText('word/styles.xml');
    if (stylesXml) {
      stylesXml = stylesXml.replace(/<w:tab\s+w:val="left"\s+w:pos="1560"\/>/g, '');
      zip.updateFile('word/styles.xml', Buffer.from(stylesXml, 'utf-8'));
    }
  } catch (e) {
    console.warn('[modernPdfGenerator] Could not patch styles.xml:', e.message);
  }

  // Patch rels for hyperlinks
  if (hyperlinkRegistry && hyperlinkRegistry.links.length > 0) {
    try {
      let rXml = zip.readAsText('word/_rels/document.xml.rels');
      if (rXml) {
        let relEntries = '';
        for (const l of hyperlinkRegistry.links) {
          const safeUrl = escapeXml(l.url);
          relEntries += `<Relationship Id="${l.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${safeUrl}" TargetMode="External"/>`;
        }
        rXml = rXml.replace('</Relationships>', `${relEntries}</Relationships>`);
        zip.updateFile('word/_rels/document.xml.rels', Buffer.from(rXml, 'utf-8'));
      }
    } catch (e) {
      console.warn('[modernPdfGenerator] Could not patch rels:', e.message);
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  zip.writeZip(outputPath);
  return outputPath;
}

/**
 * Main entry point: Generates Modern Daily Quiz (DOCX and PDF) from any uploaded source docx file.
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

  const dateTag = String(raw.dateString).replace(/[,&\s]+/g, '_').replace(/_+/g, '_');
  const dateFolder = getDateFolder(raw.dateString);
  const dailyDir = path.join(OUTPUT_DIR, 'Daily', dateFolder);
  fs.mkdirSync(dailyDir, { recursive: true });

  const docxFilename = `Daily_Quiz_${dateTag}_${langLabel}_Modern.docx`;
  const docxPath = path.join(dailyDir, docxFilename);
  const pdfPath = docxPath.replace(/\.docx$/i, '.pdf');

  log({ type: 'info', message: `🎨 Injecting modern question view into base template (preserving cover, TOC, border)...` });
  injectModernQuestionsIntoTemplate({
    templatePath: DEFAULT_DAILY_TEMPLATE_PATH,
    questions,
    dateString: raw.dateString,
    outputPath: docxPath,
    isTopicWise: false,
    isHindi,
    tableMap: raw.tableMap || {}
  });

  log({ type: 'info', message: `📄 Converting Modern DOCX to native PDF with Word engine...` });
  await convertDocxToPdf(docxPath, pdfPath);
  log({ type: 'success', message: `✅ Modern PDF created: ${path.basename(pdfPath)}` });

  return pdfPath;
}

module.exports = {
  generateModernDailyPdf,
  injectModernQuestionsIntoTemplate,
  buildModernQuestionsFragmentXml,
  DEFAULT_DAILY_TEMPLATE_PATH
};
