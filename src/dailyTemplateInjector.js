/**
 * Template Injector Module
 * Takes the official CareersCloud template DOCX (with borders, headers, footers, logos, images)
 * and replaces ONLY the 30 Q&A questions (and date title), preserving all borders, backgrounds,
 * images, and layout perfectly.
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { buildAnswerXml, buildExplanationXml, buildOptionXml, buildQuestionXml, buildSectionHeaderXml, buildStatementXml, escapeXml, extractBannerParagraphsFromTemplate, extractBannerRunFromParagraph, makeUniqueBannerXml, renderRunsWithBold, safeWriteFileSync } = require('./docxXmlHelpers');

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


// ─── SPACING (twips, 20 = 1pt) ───────────────────────────────────────────────────
// Gaps are real paragraph spacing, NOT empty spacer paragraphs. Empty paragraphs get stranded at
// the top/bottom of a page, can't be suppressed by Word and made the gaps uneven; paragraph spacing
// is dropped by Word at the top of a page and stays identical everywhere else.
const SECTION_SPACE_BEFORE = 360;   // above a topic header (NATIONAL AFFAIRS ...)
const SECTION_SPACE_AFTER  = 280;   // between topic header and its first question
const QUESTION_GAP         = 260;   // between one question block and the next

/**
 * Select question numbers for promotional side banners.
 *
 * Rules:
 *  - Banner 0 (Daily Current Affairs): ALWAYS fixed on Q1.
 *  - Banner 1 & 2 (Handwritten Notes, Learn from Picture): dynamically assigned
 *    via post-generation layout audit in dailyPdfGenerator where exact line clearance is verified.
 */
function selectBannerQuestions(questions, numBanners) {
  if (!questions || questions.length === 0 || numBanners <= 0) return new Map();

  const selectedMap = new Map(); // qNum -> bannerIndex

  // Banner 0: always Q1 (Daily Current Affairs banner goes on the very first question)
  if (numBanners >= 1) {
    selectedMap.set(1, 0);
  }

  // Without a layout audit, do not guess questions for banners 1 & 2 to avoid causing blank gaps.
  // They are placed dynamically and safely during layout audit in dailyPdfGenerator.
  return selectedMap;
}

/**
 * Generate all OpenXML paragraphs for questions in sequential document order (1..N).
 * The source document is already in the correct order; sections are rendered dynamically
 * as they appear in the uploaded document without any topic-based sorting or grouping.
 */
function buildQuestionsFragmentXml(questions, isTopicWise = false, isHindi = false, tableMap = {}, bannerParagraphXmls = [], hyperlinkRegistry = null, bannerAssignments = null) {
  let xml = '';
  let lastSection = null;

  // Banner assignments: if explicit map provided, use it; otherwise fallback to safe selection
  let bannerMap;
  if (bannerAssignments instanceof Map) {
    bannerMap = bannerAssignments;
  } else if (bannerAssignments && typeof bannerAssignments === 'object') {
    bannerMap = new Map(Object.entries(bannerAssignments).map(([k, v]) => [parseInt(k, 10), v]));
  } else {
    bannerMap = selectBannerQuestions(questions, bannerParagraphXmls ? bannerParagraphXmls.length : 0);
  }

  questions.forEach((q, qIndex) => {
    const qNum = isTopicWise ? (q.number || qIndex + 1) : (qIndex + 1);
    const currentSection = (q.section || 'NATIONAL AFFAIRS').toUpperCase();

    // Output section header whenever section changes
    const isNewSection = currentSection !== lastSection;
    if (isNewSection) {
      xml += buildSectionHeaderXml(currentSection, SECTION_SPACE_BEFORE, SECTION_SPACE_AFTER);
      lastSection = currentSection;
    }

    // First question sits right under its topic header (header's own spacing-after); the rest get the standard gap
    xml += buildQuestionXml(qNum, q.questionText, hyperlinkRegistry, isNewSection ? 0 : QUESTION_GAP, isHindi);

    if (q.statements && q.statements.length > 0) {
      for (let stIdx = 0; stIdx < q.statements.length; stIdx++) {
        const st = q.statements[stIdx];
        // The last statement before choices has keepNext = true so it never gets orphaned from Choice 1
        const isLastStatement = stIdx === q.statements.length - 1;
        xml += buildStatementXml(st, tableMap, hyperlinkRegistry, isLastStatement, isHindi);
      }
    }

    // Promotion banner placement:
    // Attach banner starting at Choice 1 because choices have empty space on the right,
    // allowing question statements to stay full-width and options to wrap neatly around the banner.
    // If a question has no choices, fall back to starting at Explanation.
    let bannerRunForThisQ = '';
    if (bannerParagraphXmls && bannerParagraphXmls.length > 0 && bannerMap.has(qNum)) {
      const bannerIdx = bannerMap.get(qNum);
      if (bannerParagraphXmls[bannerIdx]) {
        bannerRunForThisQ = extractBannerRunFromParagraph(bannerParagraphXmls[bannerIdx]);
      }
    }

    if (q.options && q.options.length > 0) {
      q.options.forEach((opt, optIdx) => {
        // Choice 1 receives the banner run if assigned to this question
        const bannerForOpt = (optIdx === 0 && bannerRunForThisQ) ? bannerRunForThisQ : '';
        xml += buildOptionXml(opt, false, bannerForOpt, isHindi);
      });
      // Once consumed by Choice 1, clear so explanation does not duplicate it
      if (bannerRunForThisQ) bannerRunForThisQ = '';
    }

    if (q.answer) {
      xml += buildAnswerXml(q.answer, isHindi);
    }

    if (q.explanation) {
      // If question had no choices, attach banner to Explanation
      xml += buildExplanationXml(q.explanation, isHindi, tableMap, hyperlinkRegistry, bannerRunForThisQ);
    }
  });

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
  tableMap = {},
  includeBottomBanner = true,
  bannerAssignments = null
}) {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template DOCX not found at: ${templatePath}`);
  }

  const zip = new AdmZip(templatePath);
  let xml = zip.readAsText('word/document.xml');

  // Strip Segoe UI Emoji font refs and emojis to prevent Word from embedding the 4MB font
  xml = xml.replace(/"Segoe UI Emoji"/g, '"Cambria"');
  xml = xml.replace(/[\u{1F300}-\u{1FAFF}]/gu, '');

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
      ? `Current Affairs Hindi Q&amp;A PDF – ${escapeXml(cleanDate)}`
      : `Current Affairs Q&amp;A PDF – ${escapeXml(cleanDate)}`;

    // A. Configure Table of Contents to dynamically index all Topic sections (Heading 2)
    xml = xml.replace(
      /<w:instrText xml:space="preserve">\s*TOC[^\<]*<\/w:instrText>/,
      '<w:instrText xml:space="preserve"> TOC \\t "Heading 2,1" \\h \\z \\u </w:instrText>'
    );

    // B. Set TOC Heading label (Index / Table of Contents) - Always English per requirements
    const tocHeadingText = 'INDEX (Table of Contents)';
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

    // D2. The template keeps an empty paragraph under the Heading 1 title. It is not part of the
    //     questions region, so it survived and added a big dead gap between the title and the first
    //     topic header. Remove empty paragraphs directly after the title (stops at the first real one).
    {
      const h1Pos = xml.search(/<w:pStyle w:val="Heading1"/);
      if (h1Pos !== -1) {
        let cursor = xml.indexOf('</w:p>', h1Pos) + '</w:p>'.length;
        const emptyP = /^<w:p(?:\s[^>]*)?>(?:(?!<w:t[ >]|<w:drawing|<w:pict|<w:br|<w:fld|<w:sectPr|<w:hyperlink|<w:bookmarkStart)[\s\S])*?<\/w:p>/;
        let guard = 0;
        while (guard++ < 5) {
          const m2 = emptyP.exec(xml.slice(cursor));
          if (!m2) break;
          xml = xml.slice(0, cursor) + xml.slice(cursor + m2[0].length);
        }
      }
    }

    // E. Remove redundant empty paragraphs between TOC and Congratulations on Page 3
    // so that TOC, Important Notice, and Congratulations fit neatly on Page 3,
    // allowing Page 4 to start cleanly with Title and Question 1 with zero wasted blank space!
    const tocIdx = xml.indexOf('Table of Contents');
    const congrIdx = xml.indexOf('Congratulations on Your Success!');
    if (tocIdx !== -1 && congrIdx !== -1) {
      const sectionBefore = xml.slice(0, tocIdx);
      let middle = xml.slice(tocIdx, congrIdx);
      const sectionAfter = xml.slice(congrIdx);
      middle = middle.replace(/<w:p[ >](?:(?!<w:t|<w:drawing|<w:fldSimple|<w:fldChar).)*?<\/w:p>/g, '');
      xml = sectionBefore + middle + sectionAfter;
    }

    // F. Give comfortable breathing space before "Congratulations on Your Success!"
    const congrIdxAfter = xml.indexOf('Congratulations on Your Success!');
    if (congrIdxAfter !== -1) {
      const pStart = xml.lastIndexOf('<w:p', congrIdxAfter);
      if (pStart !== -1) {
        const pPrEnd = xml.indexOf('</w:pPr>', pStart);
        if (pPrEnd !== -1 && pPrEnd < congrIdxAfter) {
          const pPr = xml.slice(pStart, pPrEnd);
          const updatedPPr = /<w:spacing\b/.test(pPr)
            ? pPr.replace(/<w:spacing\b[^>]*\/>/, '<w:spacing w:before="480" w:after="80" w:line="276" w:lineRule="auto"/>')
            : pPr.replace('<w:pPr>', '<w:pPr><w:spacing w:before="480" w:after="80" w:line="276" w:lineRule="auto"/>');
          xml = xml.slice(0, pStart) + updatedPPr + xml.slice(pPrEnd);
        }
      }
    }
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

  // 6. Generate the new questions OpenXML snippet with banners
  const hyperlinkRegistry = new HyperlinkRegistry();
  const relsXml = zip.readAsText('word/_rels/document.xml.rels') || '';
  hyperlinkRegistry.initFromRels(relsXml);

  const newQuestionsXml = buildQuestionsFragmentXml(questions, isTopicWise, isHindi, tableMap, sideBanners, hyperlinkRegistry, bannerAssignments) + (includeBottomBanner && bottomBanner ? bottomBanner : '');

  // 7. Ensure Aspirant Queries paragraph starts at the top of its own dedicated page
  // using <w:pageBreakBefore/> on the paragraph itself (Aspirant Queries must always be on a separate page).
  const aspirantPart = xml.slice(endOffset).replace(
    /^(\s*<w:p[^>]*><w:pPr>)/,
    '$1<w:pageBreakBefore/>'
  );

  // Replace ONLY the questions portion between startOffset and endOffset!
  let newDocXml = xml.slice(0, startOffset) + newQuestionsXml + aspirantPart;

  // Sanitize any remaining Segoe UI Emoji or emoji characters in injected content
  newDocXml = newDocXml.replace(/"Segoe UI Emoji"/g, '"Cambria"');
  newDocXml = newDocXml.replace(/[\u{1F300}-\u{1FAFF}]/gu, '');

  // 7c. Update document.xml inside the zip
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

  // 9b. Patch fontTable.xml – remove Segoe UI Emoji definition so Word does not embed the 4MB font
  try {
    let fontXml = zip.readAsText('word/fontTable.xml');
    if (fontXml && fontXml.includes('Segoe UI Emoji')) {
      fontXml = fontXml.replace(/"Segoe UI Emoji"/g, '"Cambria"');
      zip.updateFile('word/fontTable.xml', Buffer.from(fontXml, 'utf-8'));
    }
  } catch (e) {
    console.warn('[templateInjector] Could not patch fontTable.xml:', e.message);
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

