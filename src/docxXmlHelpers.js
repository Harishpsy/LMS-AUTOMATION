/**
 * Shared DOCX/XML helpers used by the daily and monthly template injectors and the quiz parser.
 * (Moved here from three files that each had an identical copy - behaviour is unchanged.)
 */

const fs = require('fs');
const path = require('path');

function getFontFamily(isHindi = false) {
  return isHindi ? 'Nirmala UI' : 'Cambria';
}

function getRPrBase(isHindi = false) {
  const font = getFontFamily(isHindi);
  return `<w:rFonts w:ascii="${font}" w:eastAsia="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:sz w:val="23"/><w:szCs w:val="23"/>`;
}

function getRPrBold(isHindi = false) {
  const font = getFontFamily(isHindi);
  return `<w:rFonts w:ascii="${font}" w:eastAsia="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:b/><w:bCs/><w:sz w:val="23"/><w:szCs w:val="23"/>`;
}

/**
 * Build OpenXML for Answer line (Answer- [bold key])
 */
function buildAnswerXml(answer, isHindi = false) {
  const prefix = isHindi ? 'उत्तर – ' : 'Answer- ';
  return `<w:p><w:pPr><w:spacing w:before="60" w:after="30" w:line="276" w:lineRule="auto"/><w:rPr>${getRPrBase(isHindi)}</w:rPr></w:pPr><w:r><w:rPr>${getRPrBase(isHindi)}</w:rPr><w:t xml:space="preserve">${prefix}</w:t></w:r><w:r><w:rPr>${getRPrBold(isHindi)}</w:rPr><w:t xml:space="preserve">${escapeXml(answer)}</w:t></w:r></w:p>`;
}

/**
 * Build OpenXML for Explanation paragraphs and tables
 * Formats bullet lines using genuine Word list numbering (<w:numPr>) with proper hanging indent
 */
function buildExplanationXml(explanation, isHindi = false, tableMap = {}, hyperlinkRegistry = null, bannerRunXml = '') {
  if (!explanation || !explanation.trim()) return '';

  const label = isHindi ? 'स्पष्टीकरण:' : 'Explanation:';

  const lines = explanation.split('\n').map(l => l.trim()).filter(Boolean);
  // Strip any redundant leading "Explanation:" / "स्पष्टीकरण:" line or lone punctuation line so it never duplicates
  while (lines.length > 0 && (
    /^(?:\*\*)?(?:Explanation|स्पष्टीकरण|विवरण|हल)\s*[:.]?\s*(?:\*\*)?\s*[:.]?\s*$/i.test(lines[0]) ||
    /^(?:\*\*)?\s*[:.\-–—]\s*(?:\*\*)?$/.test(lines[0])
  )) {
    lines.shift();
  }
  if (lines.length > 0 && /^(?:\*\*)?(?:Explanation|स्पष्टीकरण|विवरण|हल)\s*[:.]?\s*(?:\*\*)?\s*[:.]?\s*/i.test(lines[0])) {
    const stripped = lines[0].replace(/^(?:\*\*)?(?:Explanation|स्पष्टीकरण|विवरण|हल)\s*[:.]?\s*(?:\*\*)?\s*[:.]?\s*/i, '').trim();
    if (stripped) {
      lines[0] = stripped;
    } else {
      lines.shift();
    }
  }
  // Strip any remaining lone colon / delimiter / punctuation line
  while (lines.length > 0 && /^(?:\*\*)?\s*[:.\-–—]\s*(?:\*\*)?$/.test(lines[0])) {
    lines.shift();
  }
  // If the first explanation line still starts with a leftover colon or punctuation delimiter, strip it
  if (lines.length > 0 && /^(?:\*\*)?\s*[:.\-–—]\s*(?:\*\*)?\s*(.+)$/.test(lines[0])) {
    lines[0] = lines[0].replace(/^(?:\*\*)?\s*[:.\-–—]\s*(?:\*\*)?\s*/, '').trim();
  }

  // Check if first content line is a regular paragraph
  const firstLineIsNormal = lines.length > 0 &&
    !lines[0].startsWith('__TABLE_PLACEHOLDER_') &&
    !/^(?:●|•|▪|▶|∙|-(?!\*))\s*/.test(lines[0]) &&
    !/^(?:\*\*)?(?:About\s+[^:\n]+|[^:\n]+\s+के\s+बारे\s+में)\s*:(?:\*\*)?$/i.test(lines[0]);

  let xml = '';
  let attachLabelToFirst = false;

  if (firstLineIsNormal) {
    attachLabelToFirst = true;
  } else {
    // If first item is a bullet or table, output Explanation: as its own paragraph with keepNext
    xml += `<w:p><w:pPr><w:keepNext/><w:spacing w:before="60" w:after="30" w:line="276" w:lineRule="auto"/><w:rPr>${getRPrBold(isHindi)}</w:rPr></w:pPr><w:r><w:rPr>${getRPrBold(isHindi)}</w:rPr><w:t xml:space="preserve">${label} </w:t></w:r>${bannerRunXml || ''}</w:p>`;
  }

  for (const line of lines) {
    // Check if line is an embedded table placeholder
    if (line.startsWith('__TABLE_PLACEHOLDER_') && tableMap && tableMap[line]) {
      xml += tableMap[line];
      continue;
    }

    // Check if the line is a bullet item (starts with ●, •, -, or similar bullet symbol, not markdown **bold**)
    const isBullet = /^(?:●|•|▪|▶|∙|-(?!\*))\s*/.test(line);

    // Check if line is an "About ..." sub-heading (bold + single underline)
    const isAboutHeading = /^(?:\*\*)?(?:About\s+[^:\n]+|[^:\n]+\s+के\s+बारे\s+में)\s*:(?:\*\*)?$/i.test(line);
    if (isAboutHeading) {
      const cleanHeading = line.replace(/\*\*/g, '').trim();
      xml += `<w:p><w:pPr><w:keepNext/><w:spacing w:before="60" w:after="20" w:line="250" w:lineRule="auto"/><w:rPr>${getRPrBold(isHindi)}<w:u w:val="single"/></w:rPr></w:pPr><w:r><w:rPr>${getRPrBold(isHindi)}<w:u w:val="single"/></w:rPr><w:t xml:space="preserve">${escapeXml(cleanHeading)}</w:t></w:r></w:p>`;
      continue;
    }

    // Check if line is an indented numbered sub-list item (e.g. "1. Item", "2. Item")
    const isNumberedItem = /^\d{1,2}\.\s+/.test(line.replace(/\*\*/g, '').trim());
    if (isNumberedItem) {
      const runs = renderRunsWithBold(line, false, hyperlinkRegistry, isHindi);
      xml += `<w:p><w:pPr><w:spacing w:before="20" w:after="20" w:line="276" w:lineRule="auto"/><w:ind w:left="720"/><w:rPr>${getRPrBase(isHindi)}</w:rPr></w:pPr>${runs}</w:p>`;
      continue;
    }

    if (isBullet) {
      // Strip the raw bullet character – use native Word <w:numPr> for the ● dot
      // (numbering.xml is patched separately to set dot size to 9.5pt)
      const cleanContent = line.replace(/^(?:●|•|▪|▶|∙|-(?!\*))\s*/, '').trim();

      // Native Word bullet paragraph – standard 720/360 indent matching original template
      const pPr = `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr><w:spacing w:before="20" w:after="30" w:line="276" w:lineRule="auto"/><w:ind w:left="720" w:hanging="360"/><w:rPr>${getRPrBase(isHindi)}</w:rPr></w:pPr>`;

      // Check if there is a bold heading prefix before a colon (e.g. "Heading: rest")
      // Crucial: The prefix before the colon MUST NOT contain any asterisks (*).
      // If the line already has markdown bold formatting (like "**Heading:**" or "**Heading: sub**"),
      // renderRunsWithBold handles it natively without splitting across asterisk boundaries.
      const prefixMatch = cleanContent.match(/^([^*:\n]{1,70}:)\s*(.*)$/);

      if (prefixMatch) {
        const prefix = prefixMatch[1].trim();
        const rest = prefixMatch[2].trim();
        const prefixRun = `<w:r><w:rPr>${getRPrBold(isHindi)}</w:rPr><w:t xml:space="preserve">${escapeXml(prefix)} </w:t></w:r>`;
        const restRuns = renderRunsWithBold(rest, false, hyperlinkRegistry, isHindi);
        xml += `<w:p>${pPr}${prefixRun}${restRuns}</w:p>`;
      } else {
        const contentRuns = renderRunsWithBold(cleanContent, false, hyperlinkRegistry, isHindi);
        xml += `<w:p>${pPr}${contentRuns}</w:p>`;
      }
    } else {
      // Key-value metadata lines (e.g., President –, Headquarters –, Established –)
      const isKeyValue = /^(\*{0,2}[A-Za-z\u0900-\u097F\s()]{1,40}\s*[-–—:]\*{0,2}\s*)(.+)$/.test(line.replace(/\*\*/g, ''));
      const spacingBefore = isKeyValue ? "0" : "20";
      const spacingAfter = isKeyValue ? "20" : "40";
      const lineRuleVal = isKeyValue ? "240" : "276";

      // Normal paragraph
      const runs = renderRunsWithBold(line, false, hyperlinkRegistry, isHindi);
      if (attachLabelToFirst) {
        const labelRun = `<w:r><w:rPr>${getRPrBold(isHindi)}</w:rPr><w:t xml:space="preserve">${label}</w:t><w:br/></w:r>`;
        xml += `<w:p><w:pPr><w:spacing w:before="60" w:after="${spacingAfter}" w:line="${lineRuleVal}" w:lineRule="auto"/><w:rPr>${getRPrBase(isHindi)}</w:rPr></w:pPr>${labelRun}${runs}${bannerRunXml || ''}</w:p>`;
        attachLabelToFirst = false;
      } else {
        xml += `<w:p><w:pPr><w:spacing w:before="${spacingBefore}" w:after="${spacingAfter}" w:line="${lineRuleVal}" w:lineRule="auto"/><w:rPr>${getRPrBase(isHindi)}</w:rPr></w:pPr>${runs}</w:p>`;
      }
    }
  }

  return xml;
}

/**
 * Build OpenXML for an Option paragraph (1), 2), 3)...
 * Supports attaching a floating promotional banner run directly into Choice 1.
 */
function buildOptionXml(option, keepNext = false, bannerRunXml = '', isHindi = false) {
  const pPrKeep = keepNext ? '<w:keepNext/><w:keepLines/>' : '';
  const banner = bannerRunXml || '';
  return `<w:p><w:pPr>${pPrKeep}<w:spacing w:before="20" w:after="20" w:line="276" w:lineRule="auto"/><w:rPr>${getRPrBase(isHindi)}</w:rPr></w:pPr><w:r><w:rPr>${getRPrBase(isHindi)}</w:rPr><w:t xml:space="preserve">${escapeXml(option)}</w:t></w:r>${banner}</w:p>`;
}

/**
 * Build OpenXML for a Question paragraph (Bold Cambria/Nirmala UI 11.5pt)
 * spaceBefore (twips) = gap above the question. The daily injector uses it instead of blank spacer paragraphs.
 */
function buildQuestionXml(num, text, hyperlinkRegistry = null, spaceBefore = 40, isHindi = false) {
  const content = renderRunsWithBold(text, true, hyperlinkRegistry, isHindi);
  return `<w:p><w:pPr><w:keepNext/><w:spacing w:before="${spaceBefore}" w:after="30" w:line="276" w:lineRule="auto"/><w:rPr>${getRPrBold(isHindi)}</w:rPr></w:pPr><w:r><w:rPr>${getRPrBold(isHindi)}</w:rPr><w:t xml:space="preserve">${num}.  </w:t></w:r>${content}</w:p>`;
}

/**
 * Build OpenXML for a Section Header (Red, bold, centered Cambria, Heading 2 for TOC indexing)
 * @param {string} title - Section title text
 * @param {number} spaceBefore - Space before paragraph in twips
 * @param {number} spaceAfter - Space after paragraph in twips
 * @param {number} fontSizeHalfPts - Font size in half-points (28 = 14pt, 44 = 22pt)
 */
function buildSectionHeaderXml(title, spaceBefore = 360, spaceAfter = 160, fontSizeHalfPts = 28) {
  return `<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:keepNext/><w:spacing w:before="${spaceBefore}" w:after="${spaceAfter}" w:line="276" w:lineRule="auto"/><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:sz w:val="${fontSizeHalfPts}"/><w:szCs w:val="${fontSizeHalfPts}"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Cambria" w:eastAsia="Cambria" w:hAnsi="Cambria" w:cs="Cambria"/><w:b/><w:bCs/><w:color w:val="FF0000"/><w:sz w:val="${fontSizeHalfPts}"/><w:szCs w:val="${fontSizeHalfPts}"/></w:rPr><w:t>${escapeXml(title)}</w:t></w:r></w:p>`;
}

/**
 * Build OpenXML for a Statement paragraph (A, B, C...) or embedded table
 */
function buildStatementXml(statement, tableMap = {}, hyperlinkRegistry = null, keepNext = false, isHindi = false) {
  if (!statement) return '';
  const trimmed = statement.trim();
  if (trimmed.startsWith('__TABLE_PLACEHOLDER_') && tableMap && tableMap[trimmed]) {
    return tableMap[trimmed];
  }
  const runs = renderRunsWithBold(statement, true, hyperlinkRegistry, isHindi);
  const pPrKeep = keepNext ? '<w:keepNext/><w:keepLines/>' : '';
  return `<w:p><w:pPr>${pPrKeep}<w:spacing w:before="30" w:after="30" w:line="276" w:lineRule="auto"/><w:rPr>${getRPrBold(isHindi)}</w:rPr></w:pPr>${runs}</w:p>`;
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/g, '&') // Prevent double-escaping of XML entities
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Extract promotion banner paragraphs (paragraphs with <w:drawing>) from the
 * questions region of the template. These are inline promo ad images that should
 * be re-distributed across the generated question content.
 *
 * @param {string} bodyContent - Full body XML of the template
 * @param {number} qStartIdx   - Paragraph index where questions begin
 * @param {number} qEndIdx     - Paragraph index where questions end (Aspirant Queries)
 * @returns {string[]} Array of banner paragraph XML strings from within questions region
 */
function extractBannerParagraphsFromTemplate(bodyContent, qStartIdx, qEndIdx) {
  const pRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let pIdx = 0;
  let pm;
  const banners = [];

  while ((pm = pRegex.exec(bodyContent)) !== null) {
    if (pIdx > qStartIdx && pIdx < qEndIdx) {
      if (pm[0].includes('<w:drawing>') && pm[0].includes('r:embed=')) {
        // Extract ONLY the run containing the drawing, preventing stray text (like duplicate 'Explanation:')
        const runs = pm[0].match(/<w:r(?:\s+[^>]*)?>[\s\S]*?<\/w:r>/g) || [];
        for (const r of runs) {
          if (r.includes('<w:drawing>') && r.includes('r:embed=')) {
            let cleanedRun = r;
            if (cleanedRun.includes('<wp:wrapSquare')) {
              // Normalize side banners from relativeFrom="page" with fixed posOffset (which collides with
              // tables and pushes the next question to the next page) to relativeFrom="paragraph" with posOffset=0
              cleanedRun = cleanedRun.replace(/(<wp:positionV\s+relativeFrom=")(?:page)("><wp:posOffset>)\d+(<\/wp:posOffset><\/wp:positionV>)/g, '$1paragraph$20$3');
            }
            banners.push(`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>${cleanedRun}</w:p>`);
            break;
          }
        }
      }
    }
    pIdx++;
  }
  return banners;
}

function makeUniqueBannerXml(bannerXml, instanceIndex) {
  return bannerXml.replace(/<wp:docPr\s+id="(\d+)"/g, (match, origId) => {
    const newId = parseInt(origId, 10) + (instanceIndex + 1) * 1000 + 7;
    return `<wp:docPr id="${newId}"`;
  });
}

/**
 * Render runs of text within a paragraph, parsing **bold** markdown tokens into bold <w:r> runs
 * and preserving markdown [text](url) or bare URLs as genuine Word <w:hyperlink> elements
 */
function renderRunsWithBold(text, defaultBold = false, hyperlinkRegistry = null, isHindi = false) {
  if (!text) return '';
  const font = getFontFamily(isHindi);
  const rPrBase = getRPrBase(isHindi);
  const rPrBold = getRPrBold(isHindi);

  function renderChunkWithLinks(chunk, isBold) {
    if (!chunk) return '';
    const rPr = isBold ? rPrBold : rPrBase;

    // Pattern for markdown links [text](url) OR bare URLs https?://...
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)|(https?:\/\/[^\s\)\<\>\"\'\]]+)/g;
    let lastIdx = 0;
    let match;
    let out = '';

    while ((match = linkRegex.exec(chunk)) !== null) {
      const beforeText = chunk.substring(lastIdx, match.index);
      if (beforeText) {
        out += `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${escapeXml(beforeText)}</w:t></w:r>`;
      }

      const linkText = match[1] || match[3];
      const linkUrl = match[2] || match[3];
      const rId = hyperlinkRegistry ? hyperlinkRegistry.add(linkUrl) : '';

      if (rId) {
        out += `<w:hyperlink r:id="${rId}" w:history="1"><w:r><w:rPr><w:rFonts w:ascii="${font}" w:eastAsia="${font}" w:hAnsi="${font}" w:cs="${font}"/>${isBold ? '<w:b/><w:bCs/>' : ''}<w:color w:val="0563C1"/><w:u w:val="single"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr><w:t xml:space="preserve">${escapeXml(linkText)}</w:t></w:r></w:hyperlink>`;
      } else {
        out += `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${escapeXml(linkText)}</w:t></w:r>`;
      }

      lastIdx = linkRegex.lastIndex;
    }

    const restText = chunk.substring(lastIdx);
    if (restText) {
      out += `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${escapeXml(restText)}</w:t></w:r>`;
    }
    return out;
  }

  if (defaultBold) {
    const clean = text.replace(/\*\*/g, '');
    return renderChunkWithLinks(clean, true);
  }

  // Ensure unclosed / stray ** never turns the whole paragraph bold
  let safeText = text;
  const starCount = (safeText.match(/\*\*/g) || []).length;
  if (starCount % 2 !== 0) {
    // If there is an odd count, close it at the end
    safeText += '**';
  }

  if (!safeText.includes('**')) {
    return renderChunkWithLinks(safeText, false);
  }

  const parts = safeText.split('**');
  let xml = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const isBold = (i % 2 === 1);
    xml += renderChunkWithLinks(part, isBold);
  }
  return xml;
}

function safeWriteFileSync(filePath, buffer) {
  try {
    fs.writeFileSync(filePath, buffer);
    return filePath;
  } catch (err) {
    if (err.code === 'EBUSY') {
      const ext = path.extname(filePath);
      const dir = path.dirname(filePath);
      const base = path.basename(filePath, ext);
      const fallbackPath = path.join(dir, `${base}_${Date.now().toString().slice(-4)}${ext}`);
      fs.writeFileSync(fallbackPath, buffer);
      return fallbackPath;
    }
    throw err;
  }
}

/**
 * Extract the drawing run (<w:r> containing <w:drawing>) from a banner paragraph XML
 * so it can be directly embedded into Choice 1 or Explanation
 */
function extractBannerRunFromParagraph(pXml) {
  if (!pXml) return '';
  const m = pXml.match(/<w:r(?:\s+[^>]*)?>[\s\S]*?<w:drawing>[\s\S]*?<\/w:drawing>[\s\S]*?<\/w:r>/);
  return m ? m[0] : '';
}

module.exports = {
  buildAnswerXml,
  buildExplanationXml,
  buildOptionXml,
  buildQuestionXml,
  buildSectionHeaderXml,
  buildStatementXml,
  escapeXml,
  extractBannerParagraphsFromTemplate,
  extractBannerRunFromParagraph,
  makeUniqueBannerXml,
  renderRunsWithBold,
  safeWriteFileSync
};
