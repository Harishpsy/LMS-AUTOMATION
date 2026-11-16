/**
 * Template Injector Module
 * Takes the official CareersCloud template DOCX (with borders, headers, footers, logos, images)
 * and replaces ONLY the 30 Q&A questions (and date title), preserving all borders, backgrounds,
 * images, and layout perfectly.
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { buildAnswerXml, buildExplanationXml, buildOptionXml, buildQuestionXml, buildSectionHeaderXml, buildStatementXml, escapeXml, extractBannerParagraphsFromTemplate, makeUniqueBannerXml, renderRunsWithBold, safeWriteFileSync } = require('./docxXmlHelpers');

const ROOT_DIR = path.join(__dirname, '..');
const TEMPLATES_DAILY = path.join(ROOT_DIR, 'Templates', 'Daily', 'Current Affairs Q&A PDF November 7,8&9 2026 by Affairscloud.docx');
const DEFAULT_DAILY_TEMPLATE_PATH = fs.existsSync(TEMPLATES_DAILY) ? TEMPLATES_DAILY : path.join(ROOT_DIR, 'Daily PDF', 'Current Affairs Q&A PDF November 7,8&9 2026 by Affairscloud.docx');


class HyperlinkRegistry {
  constructor(initialMaxId = 500) {
    this.currentId = initialMaxId;
    this.links = []; // { rId, url }
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

  // Check STATIC / GK first so it never gets falsely caught by other rules
  if (upper.includes('STATIC') || upper === 'GK' || upper.endsWith(' GK')) {
    return 'STATIC';
  }

  // Check INTERNATIONAL before NATIONAL because 'INTERNATIONAL' contains 'NATIONAL'!
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


/**
 * Generate all OpenXML paragraphs for a given list of questions grouped by section
 * in the STRICT Canonical Order:
 *  1. NATIONAL AFFAIRS
 *  2. INTERNATIONAL AFFAIRS
 *  3. BANKING & FINANCE
 *  4. ECONOMY & BUSINESS
 *  5. AWARDS & RECOGNITIONS
 *  6. APPOINTMENTS & RESIGNATIONS
 *  7. ACQUISITIONS & MERGERS
 *  8. SCIENCE & TECHNOLOGY
 *  9. ENVIRONMENT
 *  10. SPORTS
 *  11. OBITUARY
 *  12. BOOKS & AUTHORS
 *  13. IMPORTANT DAYS
 *  14. STATE NEWS
 */
function buildQuestionsFragmentXml(questions, isTopicWise = false, isHindi = false, tableMap = {}, bannerParagraphXmls = [], hyperlinkRegistry = null) {
  const sections = {};
  questions.forEach(q => {
    // For Daily Quizzes, q.section represents the actual section header from the document.
    // Only fall back to q.topic if q.section is not provided.
    const rawSec = q.section || q.topic || 'NATIONAL AFFAIRS';
    const sec = normalizeSection(rawSec);
    if (!sections[sec]) sections[sec] = [];
    sections[sec].push(q);
  });

  // Sort sections strictly by the requested canonical order
  const sortedSectionTitles = Object.keys(sections).sort((a, b) => {
    return getSectionOrderIndex(a) - getSectionOrderIndex(b);
  });

  let xml = '';
  let globalNum = 1;

  for (const sectionTitle of sortedSectionTitles) {
    const qs = sections[sectionTitle];
    if (!qs || qs.length === 0) continue;

    xml += buildSectionHeaderXml(sectionTitle);
    // Explicit blank line space below the topic header before the first question starts
    xml += '<w:p><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0" w:line="220" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:pPr></w:p>';

    qs.forEach((q, qIndex) => {
      // Clean single blank line separator between consecutive questions within a section
      if (qIndex > 0) {
        xml += '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="220" w:lineRule="auto"/><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:pPr></w:p>';
      }

      const qNum = isTopicWise ? (qs.indexOf(q) + 1) : globalNum++;
      xml += buildQuestionXml(qNum, q.questionText, hyperlinkRegistry);

      if (q.statements && q.statements.length > 0) {
        for (const st of q.statements) {
          xml += buildStatementXml(st, tableMap, hyperlinkRegistry);
        }
      }

      if (q.options && q.options.length > 0) {
        q.options.forEach((opt, optIdx) => {
          const keepNext = optIdx < q.options.length - 1;
          xml += buildOptionXml(opt, keepNext);
        });
      }

      if (q.answer) {
        xml += buildAnswerXml(q.answer, isHindi);
      }

      if (q.explanation) {
        xml += buildExplanationXml(q.explanation, isHindi, tableMap, hyperlinkRegistry);
      }

      // Insert promotional banner only once, matching the master template:
      // Banner 0 -> after Question 1
      // Banner 1 -> after Question 3
      // Banner 2 -> after Question 5
      const currentQNum = globalNum - 1;
      if (bannerParagraphXmls && bannerParagraphXmls.length > 0) {
        if (currentQNum === 1 && bannerParagraphXmls[0]) {
          xml += bannerParagraphXmls[0];
        } else if (currentQNum === 3 && bannerParagraphXmls[1]) {
          xml += bannerParagraphXmls[1];
        } else if (currentQNum === 5 && bannerParagraphXmls[2]) {
          xml += bannerParagraphXmls[2];
        }
      }
    });
  }

  return xml;
}

/**
 * Inject questions into the DOCX template, replacing ONLY the questions region.
 * Preserves all template borders, cover graphics, footer, headers, and Aspirant Queries section.
 *
 * @param {object} params
 * @param {string} params.templatePath - Path to the template DOCX
 * @param {Array}  params.questions    - List of standardized questions
 * @param {string} params.dateString   - Title date (e.g. "31 October 2026")
 * @param {string} params.outputPath   - Destination file path
 * @param {boolean} params.isTopicWise - Whether this is a topic-wise monthly file
 * @param {boolean} params.isHindi     - Whether the content is Hindi
 * @param {object} params.tableMap     - Map of table placeholders to styled OpenXML tables
 */
function injectQuestionsIntoTemplate({
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

  // 1. Locate all <w:p> blocks in document.xml
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

  // 2. Replace the Title in both the TOC and the Heading 1 Banner
  if (dateString) {
    const cleanDate = dateString.replace(/^DAILY\s+(?:CA\s+)?QUIZ[:\s\-]*/i, '').trim();
    const newTitle = isHindi
      ? `करेंट अफेयर्स Q&amp;A PDF – ${escapeXml(cleanDate)}`
      : `Current Affairs Q&amp;A PDF – ${escapeXml(cleanDate)}`;

    // A. Configure Table of Contents to dynamically index all Topic sections (Heading 2)
    xml = xml.replace(
      /<w:instrText xml:space="preserve">\s*TOC[^\<]*<\/w:instrText>/,
      '<w:instrText xml:space="preserve"> TOC \\t "Heading 2,1" \\h \\z \\u </w:instrText>'
    );

    // B. Set TOC Heading label (Index / Table of Contents)
    const tocHeadingText = isHindi ? 'विषय-सूची (INDEX)' : 'INDEX (Table of Contents)';
    xml = xml.replace(
      /(<w:pStyle w:val="TOCHeading"[\s\S]*?<w:t>)[^<]*(<\/w:t>)/,
      `$1${tocHeadingText}$2`
    );

    // C. Replace Title in Table of Contents (pStyle="TOC1")
    xml = xml.replace(/(<w:pStyle w:val="TOC1"[\s\S]*?<w:t>)[^<]*(<\/w:t>)/g, (match, p1, p2) => {
      return p1 + newTitle + p2;
    });

    // D. Replace the Main Heading 1 Title Banner (pStyle="Heading1")
    const heading1Regex = /(<w:p[^>]*><w:pPr><w:pStyle w:val="Heading1"[\s\S]*?<\/w:pPr>)([\s\S]*?)(<\/w:p>)/;
    xml = xml.replace(heading1Regex, (match, pPr, body, close) => {
      const bStart = (body.match(/<w:bookmarkStart[^>]*\/>/g) || []).join('');
      const bEnd = (body.match(/<w:bookmarkEnd[^>]*\/>/g) || []).join('');
      const newRun = `<w:r w:rsidRPr="001A3FD1"><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/><w:b/><w:bCs/><w:color w:val="FF0000"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr><w:lastRenderedPageBreak/><w:t>${newTitle}</w:t></w:r>`;
      return pPr + bStart + newRun + bEnd + close;
    });
  }

  // 3. Re-index paragraphs to find question boundaries accurately
  paragraphs.length = 0;
  pRegex.lastIndex = 0;
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

  // 4. Find the Question region boundaries:
  // Starts right before the first section header or Q1 (e.g. "NATIONAL AFFAIRS" or "1. ")
  let startP = paragraphs.find((p, i) => i >= 35 && /^(NATIONAL AFFAIRS|1\.\s)/i.test(p.text));
  if (!startP) {
    startP = paragraphs.find(p => /^1\.\s/i.test(p.text));
  }

  // Ends right before "Aspirant Queries"
  let endP = paragraphs.find(p => /Aspirant Queries/i.test(p.text));

  if (!startP) {
    throw new Error('Could not locate start of questions region in template DOCX');
  }

  const startOffset = startP.start;
  const endOffset = endP ? endP.start : paragraphs[paragraphs.length - 1].start;

  // 5. Promotional banner images from the template:
  // Extract and re-distribute official promotional banners from the template
  const startIdx = paragraphs.indexOf(startP);
  const endIdx = endP ? paragraphs.indexOf(endP) : paragraphs.length - 1;
  const allBanners = extractBannerParagraphsFromTemplate(xml, startIdx, endIdx);
  const sideBanners = allBanners.filter(b => !b.includes('wrapTopAndBottom') && !b.includes('align="center"'));
  const bottomBanner = allBanners.find(b => b.includes('wrapTopAndBottom') || b.includes('align="center"')) || '';

  // 6. Generate the new questions OpenXML snippet with banners re-inserted every N questions
  const hyperlinkRegistry = new HyperlinkRegistry();
  const relsXml = zip.readAsText('word/_rels/document.xml.rels') || '';
  hyperlinkRegistry.initFromRels(relsXml);

  const pageBreakBeforeAspirantXml = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>';
  const newQuestionsXml = buildQuestionsFragmentXml(questions, isTopicWise, isHindi, tableMap, sideBanners, hyperlinkRegistry) + (bottomBanner ? bottomBanner : '') + pageBreakBeforeAspirantXml;

  // 7. Replace ONLY the questions portion between startOffset and endOffset!
  const newDocXml = xml.slice(0, startOffset) + newQuestionsXml + xml.slice(endOffset);

  // 7. Update document.xml inside the zip
  zip.updateFile('word/document.xml', Buffer.from(newDocXml, 'utf-8'));

  // 8. Patch numbering.xml – ensure bullets use canonical Word Symbol font (&#xF0B7;) at 10pt (w:val="20")
  //    with standard 0.5 inch (720 twips) indent, exactly matching original AffairsCloud documents
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
    console.warn('[templateInjector] Could not patch numbering.xml:', e.message);
  }

  // 9. Patch styles.xml – remove intermediate tab stop (pos="1560") from TOC1 so all topic entries
  //    (including short titles like SPORTS, OBITUARY, STATIC, ENVIRONMENT) align dot leaders uniformly to the right margin
  try {
    let stylesXml = zip.readAsText('word/styles.xml');
    if (stylesXml) {
      stylesXml = stylesXml.replace(/<w:tab\s+w:val="left"\s+w:pos="1560"\/>/g, '');
      zip.updateFile('word/styles.xml', Buffer.from(stylesXml, 'utf-8'));
    }
  } catch (e) {
    console.warn('[templateInjector] Could not patch styles.xml:', e.message);
  }

  // 10. Patch document.xml.rels – register newly added hyperlinks as external relationships
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
      console.warn('[templateInjector] Could not patch document.xml.rels:', e.message);
    }
  }

  // 11. Write to output file safely
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const finalPath = safeWriteFileSync(outputPath, zip.toBuffer());
  return finalPath;
}

module.exports = {
  injectQuestionsIntoTemplate,
  DEFAULT_DAILY_TEMPLATE_PATH,
  DEFAULT_TEMPLATE_PATH: DEFAULT_DAILY_TEMPLATE_PATH
};

