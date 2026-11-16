/**
 * Common Quiz Parser & Document Utilities
 * Decoupled parsing engine for CareersCloud daily & monthly quiz source documents.
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { safeWriteFileSync } = require('./docxXmlHelpers');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  PageBreak,
  ShadingType
} = require('docx');

const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'Generated PDFs');

// Ensure output directories exist
fs.mkdirSync(path.join(OUTPUT_DIR, 'Daily'), { recursive: true });
fs.mkdirSync(path.join(OUTPUT_DIR, 'Monthly'), { recursive: true });
fs.mkdirSync(path.join(OUTPUT_DIR, 'Parsed'), { recursive: true });


const SECTION_HEADERS = [
  'NATIONAL AFFAIRS', 'INTERNATIONAL AFFAIRS', 'BANKING AND FINANCE', 'BANKING & FINANCE',
  'ECONOMY AND BUSINESS', 'ECONOMY & BUSINESS', "MoU'S AND AGREEMENTS", 'MoU AND AGREEMENTS',
  'APPOINTMENTS AND RESIGNATIONS', 'APPOINTMENTS & RESIGNATIONS',
  'AWARDS AND RECOGNITIONS', 'AWARDS & RECOGNITIONS',
  'SUMMITS, CONFERENCES', 'SUMMITS AND CONFERENCES', 'COMMITTEE AND MEETING',
  'INDEX', 'ACQUISITION AND MERGERS', 'ACQUISITIONS & MERGERS',
  'DEFENCE', 'SCIENCE AND TECHNOLOGY', 'SCIENCE & TECHNOLOGY',
  'SPORTS', 'BOOKS AND AUTHORS', 'BOOKS & AUTHORS',
  'OBITUARY', 'IMPORTANT DAYS',
  'ENVIRONMENT', 'CURRENT STATIC BANKING', 'CA STATIC GK', 'GOVT SCHEMES',
  'VISITS', 'STATIC', 'STATE NEWS', 'RANKINGS AND REPORTS', 'APP & WEB PORTAL', 'APPS & WEB PORTALS', 'APP AND WEB PORTAL'
];

function isSectionHeader(line) {
  if (!line) return false;
  const clean = String(line)
    .replace(/&amp;/gi, '&')
    .replace(/\*\*/g, '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'")
    .trim();
  const upper = clean.toUpperCase();
  return SECTION_HEADERS.some(h => {
    const hUpper = h.toUpperCase().replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'");
    return upper === hUpper || (upper.startsWith(hUpper) && clean.length <= 45);
  });
}

// ─── CANONICAL SECTION ORDERS ────────────────────────────────────────────────
// DAILY Section Order (15 canonical sections)
const DAILY_SECTION_ORDER = [
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

// MONTHLY Section Order (23 canonical sections, preserving full magazine granularity)
const MONTHLY_SECTION_ORDER = [
  'NATIONAL AFFAIRS',
  'INTERNATIONAL AFFAIRS',
  'GOVT SCHEMES',
  'VISITS',
  'BANKING AND FINANCE',
  'ECONOMY AND BUSINESS',
  "MoU's AND AGREEMENTS",
  'APPOINTMENTS AND RESIGNATIONS',
  'AWARDS AND RECOGNITIONS',
  'SUMMITS, CONFERENCES',
  'COMMITTEE AND MEETING',
  'INDEX',
  'ACQUISITION AND MERGERS',
  'DEFENCE',
  'SCIENCE AND TECHNOLOGY',
  'SPORTS',
  'BOOKS AND AUTHORS',
  'OBITUARY',
  'IMPORTANT DAYS',
  'ENVIRONMENT',
  'APP & WEB PORTAL',
  'CURRENT STATIC BANKING',
  'CA STATIC GK'
];

const CANONICAL_SECTION_ORDER = DAILY_SECTION_ORDER;

/**
 * Normalizes section headers for Daily Quizzes (15 sections)
 */
function normalizeDailySection(rawSection) {
  if (!rawSection) return 'NATIONAL AFFAIRS';
  const clean = String(rawSection).replace(/&amp;/gi, '&').replace(/\*\*/g, '').trim();
  const upper = clean.toUpperCase();

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

/**
 * Normalizes section headers for Monthly Topic-Wise Quizzes (23 sections)
 */
function normalizeMonthlySection(rawSection) {
  if (!rawSection) return 'NATIONAL AFFAIRS';
  const clean = String(rawSection)
    .replace(/&amp;/gi, '&')
    .replace(/\*\*/g, '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'")
    .trim();
  const upper = clean.toUpperCase();

  if (upper.includes('CURRENT STATIC BANKING') || (upper.includes('STATIC') && upper.includes('BANKING'))) {
    return 'CURRENT STATIC BANKING';
  }
  if (upper.includes('CA STATIC GK') || upper.includes('STATIC GK') || upper === 'STATIC') {
    return 'CA STATIC GK';
  }
  if (upper.includes('APP') && (upper.includes('PORTAL') || upper.includes('WEB'))) {
    return 'APP & WEB PORTAL';
  }
  if (upper.includes('GOVT') || upper.includes('SCHEME')) {
    return 'GOVT SCHEMES';
  }
  if (upper.includes('VISIT')) {
    return 'VISITS';
  }
  if (upper.includes('MOU') || upper.includes('AGREEMENT')) {
    return "MoU's AND AGREEMENTS";
  }
  if (upper.includes('COMMITTEE') || upper.includes('MEETING')) {
    return 'COMMITTEE AND MEETING';
  }
  if (upper.includes('SUMMIT') || upper.includes('CONFERENCE')) {
    return 'SUMMITS, CONFERENCES';
  }
  if (upper.includes('ACQUISITION') || upper.includes('MERGER')) {
    return 'ACQUISITION AND MERGERS';
  }
  if (upper.includes('DEFENCE') || upper.includes('DEFENSE')) {
    return 'DEFENCE';
  }
  if (upper.includes('SCIENCE') || (upper.includes('TECH') && !upper.includes('BANKING'))) {
    return 'SCIENCE AND TECHNOLOGY';
  }
  if (upper.includes('INDEX') || upper.includes('RANKING') || upper.includes('REPORT')) {
    return 'INDEX';
  }
  if (upper.includes('BANKING') || upper.includes('FINANCE')) {
    return 'BANKING AND FINANCE';
  }
  if (upper.includes('ECONOMY') || upper.includes('BUSINESS')) {
    return 'ECONOMY AND BUSINESS';
  }
  if (upper.includes('APPOINTMENT') || upper.includes('RESIGNATION')) {
    return 'APPOINTMENTS AND RESIGNATIONS';
  }
  if (upper.includes('AWARD') || upper.includes('RECOGNITION')) {
    return 'AWARDS AND RECOGNITIONS';
  }
  if (upper.includes('ENVIRONMENT')) {
    return 'ENVIRONMENT';
  }
  if (upper.includes('SPORT')) {
    return 'SPORTS';
  }
  if (upper.includes('BOOK') || upper.includes('AUTHOR')) {
    return 'BOOKS AND AUTHORS';
  }
  if (upper.includes('OBITUARY') || upper.includes('DEMISE') || upper.includes('PASSED AWAY')) {
    return 'OBITUARY';
  }
  if (upper.includes('DAY') || upper.includes('WEEK') || upper.includes('YEAR')) {
    return 'IMPORTANT DAYS';
  }
  if (upper.includes('INTERNATIONAL')) {
    return 'INTERNATIONAL AFFAIRS';
  }
  if (upper.includes('NATIONAL') || upper.includes('STATE')) {
    return 'NATIONAL AFFAIRS';
  }

  return upper;
}

function normalizeSection(rawSection, mode = 'daily') {
  if (mode === 'monthly') return normalizeMonthlySection(rawSection);
  return normalizeDailySection(rawSection);
}

function getSectionOrderIndex(sectionTitle, mode = 'daily') {
  if (mode === 'monthly') {
    const norm = normalizeMonthlySection(sectionTitle);
    const idx = MONTHLY_SECTION_ORDER.indexOf(norm);
    return idx !== -1 ? idx : 999;
  }
  const norm = normalizeDailySection(sectionTitle);
  const idx = DAILY_SECTION_ORDER.indexOf(norm);
  return idx !== -1 ? idx : 999;
}

/**
 * Style an OpenXML table to match AffairsCloud standard:
 * - Signature blue header row (#1E73BE) with bold text
 * - Single borders (sz 4)
 * - 100% width (w:w="5000" w:type="pct") with center alignment
 */
function styleAffairsCloudTable(tblXml) {
  const standardBorders = '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders>';

  let styled = tblXml.replace(/<w:tblBorders>[\s\S]*?<\/w:tblBorders>/, standardBorders);
  if (!styled.includes('<w:tblBorders>')) {
    styled = styled.replace(/<w:tblPr>/, `<w:tblPr>${standardBorders}`);
  }

  styled = styled.replace(/<w:tblW[^>]*\/>/, '<w:tblW w:w="5000" w:type="pct"/><w:jc w:val="center"/>');

  const trRegex = /<w:tr(?:\s+[^>]*)?>[\s\S]*?<\/w:tr>/g;
  let rowIndex = 0;
  styled = styled.replace(trRegex, (trXml) => {
    if (rowIndex === 0) {
      // Header row: apply AffairsCloud blue shading #1E73BE and bold text
      const styledTr = trXml.replace(/<w:tc(?:\s+[^>]*)?>[\s\S]*?<\/w:tc>/g, (tcXml) => {
        let styledTc = tcXml;
        if (styledTc.includes('<w:tcPr>')) {
          if (styledTc.includes('<w:shd')) {
            styledTc = styledTc.replace(/<w:shd[^>]*\/>/, '<w:shd w:val="clear" w:color="auto" w:fill="1E73BE"/>');
          } else {
            styledTc = styledTc.replace(/<w:tcPr>/, '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="1E73BE"/>');
          }
        } else {
          styledTc = styledTc.replace(/<w:tc>/, '<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="1E73BE"/></w:tcPr>');
        }
        styledTc = styledTc.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (rPrMatch, inner) => {
          if (!inner.includes('<w:b/>')) {
            return `<w:rPr><w:b/><w:bCs/>${inner}</w:rPr>`;
          }
          return rPrMatch;
        });
        return styledTc;
      });
      rowIndex++;
      return styledTr;
    }
    rowIndex++;
    return trXml;
  });

  return styled;
}

/**
 * Extract body items (paragraphs and tables) from DOCX in document order.
 * - Preserves native Word tables as styled OpenXML <w:tbl> blocks with placeholder markers
 * - Preserves native Word bullets (<w:numPr>) as "● "
 */
function extractElementsFromDocx(filePath) {
  try {
    const zip = new AdmZip(filePath);
    const xml = zip.readAsText('word/document.xml');
    if (!xml) return null;

    // Build hyperlink map from relationships
    const relsXml = zip.readAsText('word/_rels/document.xml.rels') || '';
    const hyperlinkMap = {};
    const relRegex = /<Relationship\s+([^>]+)\/?>/gi;
    let rm;
    while ((rm = relRegex.exec(relsXml)) !== null) {
      const attrs = rm[1];
      const idMatch = attrs.match(/Id="([^"]+)"/i);
      const targetMatch = attrs.match(/Target="([^"]+)"/i);
      const typeMatch = attrs.match(/Type="([^"]+)"/i);
      if (idMatch && targetMatch && typeMatch && typeMatch[1].includes('hyperlink')) {
        hyperlinkMap[idMatch[1]] = targetMatch[1];
      }
    }

    const bodyMatch = xml.match(/<w:body>([\s\S]*?)<\/w:body>/);
    if (!bodyMatch) return null;

    const bodyContent = bodyMatch[1];
    const itemRegex = /<w:(p|tbl)(?:\s+[^>]*)?>[\s\S]*?<\/w:\1>/g;
    let match;
    const lines = [];
    const tableMap = {};
    let tblCount = 0;

    while ((match = itemRegex.exec(bodyContent)) !== null) {
      const tag = match[1];
      const rawXml = match[0];

      if (tag === 'tbl') {
        const tableId = `__TABLE_PLACEHOLDER_${tblCount++}__`;
        tableMap[tableId] = styleAffairsCloudTable(rawXml);
        lines.push(tableId);
        continue;
      }

      // tag === 'p'
      const cleanPXml = rawXml
        .replace(/<w:tab(?:\s+[^>]*)?\/>/gi, ' ')
        .replace(/<w:br\s+[^>]*w:type="page"[^>]*\/>/gi, '') // ONLY page breaks
        .replace(/<w:br(?:\s+[^>]*)?\/>/gi, '<w:t xml:space="preserve">&#10;</w:t>')
        .replace(/<w:cr(?:\s+[^>]*)?\/>/gi, '<w:t xml:space="preserve">&#10;</w:t>');

      const childRegex = /<w:(r|hyperlink)(?:\s+[^>]*)?>[\s\S]*?<\/w:\1>/g;
      let cm;
      let text = '';

      while ((cm = childRegex.exec(cleanPXml)) !== null) {
        const cTag = cm[1];
        const itemXml = cm[0];

        if (cTag === 'hyperlink') {
          const ridMatch = itemXml.match(/r:id="([^"]+)"/i);
          const rid = ridMatch ? ridMatch[1] : '';
          const url = (rid && hyperlinkMap[rid]) ? hyperlinkMap[rid] : '';

          const runs = itemXml.match(/<w:r(?:\s+[^>]*)?>[\s\S]*?<\/w:r>/g) || [];
          let linkText = '';
          let isLinkBold = false;
          for (const r of runs) {
            if (/<w:b(?:\s+[^>]*|\/)?>/.test(r) && !/<w:b\s+w:val="(?:0|false|none)"/i.test(r)) {
              isLinkBold = true;
            }
            const tMatches = r.match(/<w:t(?:\s+[^>]*)?>([^<]*)<\/w:t>/g) || [];
            linkText += tMatches.map(t => t.replace(/<[^>]+>/g, '')).join('');
          }

          if (!linkText.trim()) {
            text += linkText;
            continue;
          }

          linkText = linkText
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#39;/g, "'")
            .replace(/&#10;/g, '\n');

          if (url) {
            text += isLinkBold ? `**[${linkText}](${url})**` : `[${linkText}](${url})`;
          } else {
            text += isLinkBold ? `**${linkText}**` : linkText;
          }
          continue;
        }

        // cTag === 'r'
        const isBold = /<w:b(?:\s+[^>]*|\/)?>/.test(itemXml) && !/<w:b\s+w:val="(?:0|false|none)"/i.test(itemXml);
        const tMatches = itemXml.match(/<w:t(?:\s+[^>]*)?>([^<]*)<\/w:t>/g) || [];
        let rText = tMatches.map(t => t.replace(/<[^>]+>/g, '')).join('');
        if (!rText) continue;

        rText = rText
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&#39;/g, "'")
          .replace(/&#10;/g, '\n');

        if (isBold) {
          const segments = rText.split('\n');
          const bolded = segments.map(s => s.length > 0 ? `**${s}**` : '');
          text += bolded.join('\n');
        } else {
          text += rText;
        }
      }

      if (!text) {
        const textMatches = cleanPXml.match(/<w:t(?:\s+[^>]*)?>([^<]*)<\/w:t>/g) || [];
        const rawText = textMatches.map(t => t.replace(/<[^>]+>/g, '')).join('').trim();
        if (!rawText) continue;

        text = rawText
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&#39;/g, "'")
          .replace(/&#10;/g, '\n');
      }

      if (!text) continue;

      const hasNumPr = rawXml.includes('<w:numPr') || rawXml.includes('w:numId');
      const subLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      for (let sIdx = 0; sIdx < subLines.length; sIdx++) {
        let lText = subLines[sIdx];
        if (hasNumPr && sIdx === 0) {
          const textWithoutBold = lText.replace(/^\*{1,2}/, '').trim();
          if (!/^[\u25CF\u2022\u25AA\u25B6\u2219\-]/.test(textWithoutBold)) {
            if (!/^\d{1,3}[.)]/.test(textWithoutBold) && !/^[A-E][.)]/.test(textWithoutBold)) {
              lText = '● ' + lText;
            }
          }
        }
        lines.push(lText);
      }
    }
    return lines.length > 0 ? { lines, tableMap } : null;
  } catch (err) {
    console.warn(`[extractElementsFromDocx] Could not extract XML lines from ${filePath}:`, err.message);
    return null;
  }
}

function isRealQuestionAhead(lines, startIdx) {
  if (startIdx >= lines.length) return false;
  const line = lines[startIdx];
  const clean = line.replace(/\*\*/g, '').replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'").trim();
  // A question in AffairsCloud MUST start with a number and a dot (e.g. "1. " or "1.Which"), NOT an option like "1) "!
  if (/^[1-5]\)\s*/.test(clean)) return false;
  if (!/^(\d{1,3})\.\s*([A-Za-z\u0900-\u097F\d]|[\u201C\u201D"'])/.test(clean)) return false;

  let hasOptions = false;
  let hasAnswer = false;
  const maxLook = Math.min(startIdx + 25, lines.length);

  for (let k = startIdx + 1; k < maxLook; k++) {
    const kClean = lines[k].replace(/\*\*/g, '').trim();
    if (isSectionHeader(kClean)) break;
    if (/^[1-5][).]\s*/.test(kClean)) {
      hasOptions = true;
    }
    if (/^(?:Answer|उत्तर|आंसर|Ans)\s*[\u2010-\u2015\u2212\-\:–—]/i.test(kClean)) {
      hasAnswer = true;
      break;
    }
  }

  return hasOptions && hasAnswer;
}

/**
 * Parse an AffairsCloud Daily Source DOCX into structured questions
 */
async function parseDailySource(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  // Try XML-aware paragraph & table extraction first
  const extracted = extractElementsFromDocx(filePath);
  let lines = extracted ? extracted.lines : null;
  const tableMap = extracted ? extracted.tableMap : {};

  if (!lines || lines.length === 0) {
    const { value: rawText } = await mammoth.extractRawText({ path: filePath });
    lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  }

  const questions = [];
  // Start with empty string; for daily files this gets set by the first red section header.
  // For monthly files that have no red headers (only "Topic Name –" metadata), this ensures
  // the per-question topicFromDoc fallback is used instead of defaulting to NATIONAL AFFAIRS.
  let currentSection = '';
  let lastQNum = 0;
  let i = 0;

  // Extract date string from filename or first few lines
  let dateString = '';
  const dateMatch = path.basename(filePath).match(/(\w+ \d+[,&\s\d]* \d{4})/i) ||
    lines.slice(0, 20).join(' ').match(/(\d+[,&\s\d]* \w+ \d{4})/i);
  if (dateMatch) dateString = dateMatch[1].trim();
  if (!dateString) dateString = path.basename(filePath, path.extname(filePath));

  while (i < lines.length) {
    const line = lines[i];
    const cleanLine = line.replace(/\*\*/g, '').replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'").trim();

    if (i > 30 && isSectionHeader(cleanLine)) {
      currentSection = cleanLine.replace(/&amp;/gi, '&').trim();
      lastQNum = 0; // Reset question counter so topic-wise/monthly files parse all sections
      i++;
      continue;
    }

    // A question in Affairscloud starts with "N. " or "N.[Text]" (with dot), NOT "N) " which is used for options [1-5]).
    let qStartMatch = cleanLine.match(/^(\d{1,3})\.\s*(.+)/);
    if (!qStartMatch && !/^[1-5]\)\s*/i.test(cleanLine)) {
      qStartMatch = cleanLine.match(/^(\d{1,3})\)\s*(.+)/);
    }

    if (qStartMatch && isRealQuestionAhead(lines, i)) {
      const qNum = parseInt(qStartMatch[1], 10);
      lastQNum = qNum;
      const questionText = qStartMatch[2].trim();

      // Collect statements A), B), C)... or embedded tables/descriptive text before options
      const statements = [];
      i++;
      while (i < lines.length) {
        const sLine = lines[i];
        const cleanSLine = sLine.replace(/\*\*/g, '').replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'").trim();
        if (/^[1-5][).]\s*/i.test(cleanSLine)) break; // Reached options
        if (/^(?:Answer|उत्तर|आंसर|Ans)\s*[\u2010-\u2015\u2212\-\:–—]/i.test(cleanSLine)) break;
        if (isSectionHeader(cleanSLine)) break;
        if (statements.length === 0 && isRealQuestionAhead(lines, i)) break;

        // If it's a table placeholder or statement A), B)...
        if (sLine.startsWith('__TABLE_PLACEHOLDER_') || /^[A-E][).]/i.test(cleanSLine)) {
          statements.push(cleanSLine);
          i++;
        } else {
          // Check if upcoming lines have options [1-5])
          let hasOptionsAhead = false;
          for (let look = i; look < Math.min(i + 15, lines.length); look++) {
            const lookClean = lines[look].replace(/\*\*/g, '').trim();
            if (/^[1-5][).]\s*/i.test(lookClean)) {
              hasOptionsAhead = true;
              break;
            }
            if (/^(?:Answer|उत्तर|आंसर|Ans)/i.test(lookClean) || isSectionHeader(lookClean)) break;
          }
          if (hasOptionsAhead) {
            statements.push(cleanSLine);
            i++;
          } else {
            break;
          }
        }
      }

      // Collect options 1) 2) 3) 4) 5)
      // Options sit between question/statements and the Answer line (Answer / उत्तर / Ans).
      // Handles missing option numbers (e.g. unnumbered option 3) gracefully.
      const options = [];
      let expectedOptNum = 1;

      while (i < lines.length) {
        const optLine = lines[i];
        const cleanOptLine = optLine.replace(/\*\*/g, '').replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'").trim();
        if (/^(?:Answer|उत्तर|आंसर|Ans)\s*[\u2010-\u2015\u2212\-\:–—]/i.test(cleanOptLine)) break;
        if (isSectionHeader(cleanOptLine)) break;
        if (options.length >= 4 && isRealQuestionAhead(lines, i)) break;

        const optMatch = cleanOptLine.match(/^([1-5])[).]\s*(.*)/);
        if (optMatch) {
          const num = parseInt(optMatch[1], 10);
          expectedOptNum = num + 1;
          options.push(cleanOptLine);
          i++;
        } else if (options.length > 0 && options.length < 5) {
          // An unnumbered line sitting between options and the Answer line
          if (cleanOptLine) {
            options.push(`${expectedOptNum}) ${cleanOptLine}`);
            expectedOptNum++;
          }
          i++;
        } else {
          break;
        }
      }

      // Collect answer (supports English "Answer", "Ans" and Hindi "उत्तर", "आंसर" with hyphens/dashes)
      let answerLine = '';
      if (i < lines.length && /^(?:\*\*)?(?:Answer|उत्तर|आंसर|Ans)(?:\*\*)?\s*[\u2010-\u2015\u2212\-\:–—]/i.test(lines[i])) {
        answerLine = lines[i].replace(/^(?:\*\*)?(?:Answer|उत्तर|आंसर|Ans)(?:\*\*)?\s*[\u2010-\u2015\u2212\-\:–—]\s*/i, '').replace(/\*\*/g, '').trim();
        i++;
      }

      // Skip "Explanation:" / "स्पष्टीकरण:" label (with or without markdown bold asterisks)
      while (i < lines.length && /^(?:\*\*)?(?:Explanation|स्पष्टीकरण|विवरण|हल)\s*[:.]?\s*(?:\*\*)?\s*[:.]?\s*$/i.test(lines[i])) {
        i++;
      }
      if (i < lines.length && /^(?:\*\*)?(?:Explanation|स्पष्टीकरण|विवरण|हल)\s*[:.]?\s*(?:\*\*)?\s*[:.]?\s*/i.test(lines[i])) {
        const stripped = lines[i].replace(/^(?:\*\*)?(?:Explanation|स्पष्टीकरण|विवरण|हल)\s*[:.]?\s*(?:\*\*)?\s*[:.]?\s*/i, '').trim();
        if (stripped) {
          lines[i] = stripped;
        } else {
          i++;
        }
      }
      // Also skip any standalone colon / delimiter / punctuation line following the label (e.g. "**: **" or ":")
      while (i < lines.length && /^(?:\*\*)?\s*[:.\-–—]\s*(?:\*\*)?$/.test(lines[i])) {
        i++;
      }
      // If the first explanation line starts with a leftover colon or punctuation delimiter, strip it
      if (i < lines.length && /^(?:\*\*)?\s*[:.\-–—]\s*(?:\*\*)?\s*(.+)$/.test(lines[i])) {
        lines[i] = lines[i].replace(/^(?:\*\*)?\s*[:.\-–—]\s*(?:\*\*)?\s*/, '').trim();
      }

      // Collect explanation lines
      const explanationLines = [];
      let topicFromDoc = '';
      let difficultyFromDoc = '';

      while (i < lines.length) {
        const nextLine = lines[i];
        const cleanNext = nextLine.replace(/\*\*/g, '').replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'").trim();
        if (isSectionHeader(cleanNext)) break;
        if (isRealQuestionAhead(lines, i)) break;
        if (/^(Aspirant|Affairscloud:|GA Questions|Most Trusted)/i.test(cleanNext)) break;

        const tm = cleanNext.match(/(?:Topic(?:\s*Name)?|विषय)\s*[-–:]\s*(.+)/i);
        if (tm) {
          topicFromDoc = tm[1].trim();
          i++;
          continue;
        }
        const dm = cleanNext.match(/(?:Difficulty(?:\s*level)?|कठिनाई)\s*[-–:]\s*(.+)/i);
        if (dm) {
          difficultyFromDoc = dm[1].trim();
          i++;
          continue;
        }

        explanationLines.push(nextLine);
        i++;
      }

      // In AffairsCloud daily source documents, questions belong to their preceding
      // red section heading (e.g. NATIONAL AFFAIRS, STATIC, etc.), while Topic Name specifies
      // subtopic metadata (e.g. "Visits", "MoUs & Agreements", "Current Static GK").
      // Section should follow currentSection from the document, only falling back to topicFromDoc if currentSection is missing.
      const finalSection = currentSection || topicFromDoc || 'NATIONAL AFFAIRS';

      questions.push({
        number: questions.length + 1,
        section: finalSection,
        topic: topicFromDoc || finalSection,
        difficulty: difficultyFromDoc || 'Moderate',
        questionText: questionText.trim(),
        statements,
        options,
        answer: answerLine.trim(),
        explanation: explanationLines.join('\n').trim(),
        date: dateString
      });
      continue;
    }

    i++;
  }

  return { questions, dateString, totalQuestions: questions.length, tableMap };
}

/**
 * Standardize questions array whether coming from parseDailySource or parseQuizDocx
 * Supports both Daily (15 sections) and Monthly (23 sections) modes.
 */
function standardizeQuestions(rawQuestions, defaultDate = '', mode = 'daily') {
  return rawQuestions.map((q, idx) => {
    // Format options as string array "1) Text"
    let options = [];
    if (Array.isArray(q.options)) {
      options = q.options.map(opt => {
        if (typeof opt === 'string') return opt;
        return `${opt.label || ''}) ${opt.text || ''}`.trim();
      });
    }

    // Format answer
    let answer = q.answer || '';
    if (!answer && q.answerKey) {
      answer = `${q.answerKey}) ${q.answerText || ''}`.trim();
    }

    const rawSec = q.section || q.topic || 'NATIONAL AFFAIRS';
    const section = mode === 'monthly'
      ? normalizeMonthlySection(rawSec)
      : normalizeDailySection(rawSec);

    return {
      number: q.number || idx + 1,
      section,
      topic: q.topic || section,
      difficulty: q.difficulty || 'Moderate',
      questionText: q.questionText || '',
      statements: q.statements || [],
      options,
      answer,
      explanation: q.explanation || q.explanationText || '',
      date: q.date || defaultDate
    };
  });
}

function standardizeDailyQuestions(rawQuestions, defaultDate = '') {
  return standardizeQuestions(rawQuestions, defaultDate, 'daily');
}

function standardizeMonthlyQuestions(rawQuestions, defaultDate = '') {
  return standardizeQuestions(rawQuestions, defaultDate, 'monthly');
}

// ─── HTML BUILDER FOR PDF RENDERING ──────────────────────────────────────────


/**
 * Render HTML string into an authentic PDF file via Chromium
 */

function makeHeading(text, level = 1) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, color: BRAND_COLOR, size: level === 1 ? 32 : 24 })],
    heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
    alignment: AlignmentType.CENTER,
    spacing: { after: 200, before: 200 }
  });
}

function makeSectionHeader(text) {
  return new Paragraph({
    children: [new TextRun({ text: `  ${text}  `, bold: true, color: 'ffffff', size: 22 })],
    alignment: AlignmentType.CENTER,
    shading: { type: ShadingType.SOLID, color: BRAND_COLOR },
    spacing: { before: 280, after: 140 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BRAND_COLOR } }
  });
}

function questionsToDocxParagraphs(questions, startNumber = 1) {
  const paragraphs = [];
  let num = startNumber;
  const isHindi = detectContentLanguage(questions) === 'hi';
  const ansLabel = isHindi ? 'उत्तर – ' : 'Answer: ';
  const expLabel = isHindi ? 'स्पष्टीकरण:' : 'Explanation:';

  for (const q of questions) {
    paragraphs.push(new Paragraph({
      children: [
        new TextRun({ text: `${num++}. `, bold: true, color: BRAND_COLOR, size: 21 }),
        new TextRun({ text: q.questionText, color: QUESTION_COLOR, size: 21 })
      ],
      spacing: { before: 240, after: 60 }
    }));

    if (q.statements && q.statements.length > 0) {
      for (const s of q.statements) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: `    ${s}`, color: QUESTION_COLOR, size: 19 })],
          spacing: { before: 30, after: 30 },
          indent: { left: 400 }
        }));
      }
    }

    if (q.options && q.options.length > 0) {
      for (const o of q.options) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: `    ${o}`, color: '374151', size: 19 })],
          spacing: { before: 30, after: 30 },
          indent: { left: 400 }
        }));
      }
    }

    if (q.answer) {
      paragraphs.push(new Paragraph({
        children: [
          new TextRun({ text: ansLabel, bold: true, color: ANSWER_COLOR, size: 20 }),
          new TextRun({ text: q.answer, bold: true, color: ANSWER_COLOR, size: 20 })
        ],
        spacing: { before: 80, after: 50 }
      }));
    }

    if (q.explanation && q.explanation.trim()) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: expLabel, bold: true, color: '6b7280', size: 18 })],
        spacing: { before: 50, after: 30 }
      }));
      const lines = q.explanation.split('\n').filter(l => l.trim());
      for (const l of lines) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: l, color: '4b5563', size: 18, italics: true })],
          spacing: { before: 20, after: 20 },
          indent: { left: 300 }
        }));
      }
    }

    paragraphs.push(new Paragraph({
      children: [],
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: 'e2e8f0' } },
      spacing: { before: 80, after: 80 }
    }));
  }

  return paragraphs;
}

// ─── HIGH-LEVEL GENERATION METHODS ────────────────────────────────────────────

/**
 * Automatically detect whether content is Hindi or English based on Devanagari character frequency
 */
function detectContentLanguage(questions = [], rawText = '') {
  let combined = rawText;
  if (!combined && Array.isArray(questions)) {
    combined = questions.slice(0, 5).map(q => `${q.questionText || ''} ${q.explanation || ''}`).join(' ');
  }
  const hindiMatches = combined.match(/[\u0900-\u097F]/g);
  const hindiCount = hindiMatches ? hindiMatches.length : 0;
  return hindiCount > 40 ? 'hi' : 'en';
}

/**
 * Generate Daily Quiz DOCX matching the EXACT language of the source document
 */

async function buildDocxFile({ title, subtitle, questions, isTopicWise = false, outputPath }) {
  const topicMap = {};
  questions.forEach(q => {
    const sec = q.section || 'NATIONAL AFFAIRS';
    if (!topicMap[sec]) topicMap[sec] = [];
    topicMap[sec].push(q);
  });

  const bodyChildren = [];
  bodyChildren.push(makeHeading(title, 1));
  if (subtitle) {
    bodyChildren.push(new Paragraph({
      children: [new TextRun({ text: subtitle, bold: true, color: '64748b', size: 20 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 }
    }));
  }

  if (isTopicWise) {
    bodyChildren.push(makeHeading('Table of Contents', 2));
    for (const [topic, qs] of Object.entries(topicMap)) {
      bodyChildren.push(new Paragraph({
        children: [
          new TextRun({ text: `${topic}`, bold: true, color: BRAND_COLOR, size: 20 }),
          new TextRun({ text: `  —  ${qs.length} questions`, color: '64748b', size: 20 })
        ],
        spacing: { before: 50, after: 50 }
      }));
    }
    bodyChildren.push(new Paragraph({ children: [new PageBreak()] }));
  }

  let globalNum = 1;
  for (const [topic, qs] of Object.entries(topicMap)) {
    bodyChildren.push(makeSectionHeader(topic));
    const paras = questionsToDocxParagraphs(qs, isTopicWise ? 1 : globalNum);
    globalNum += qs.length;
    bodyChildren.push(...paras);
    if (isTopicWise) {
      bodyChildren.push(new Paragraph({ children: [new PageBreak()] }));
    }
  }

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
      children: bodyChildren
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  return safeWriteFileSync(outputPath, buffer);
}

/**
 * Date folder helpers for date-wise organization
 */
function getDateFolder(dateString) {
  if (dateString) {
    const d = new Date(dateString);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    const m = dateString.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/) || dateString.match(/([A-Za-z]+)\s+(\d{1,2})[,\s]+(\d{4})/);
    if (m) {
      const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
      const monthName = (m[2].match(/^[A-Za-z]+$/) ? m[2] : m[1]).slice(0, 3).toLowerCase();
      const day = (m[1].match(/^\d+$/) ? m[1] : m[2]).padStart(2, '0');
      const year = m[3];
      const month = months[monthName] || '01';
      return `${year}-${month}-${day}`;
    }
  }
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getMonthFolder(monthLabel) {
  if (monthLabel) {
    const trimmed = String(monthLabel).trim();
    if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed;
    const m = trimmed.match(/([A-Za-z]+)\s+(\d{4})/) || trimmed.match(/(\d{4})[-_\s]+([A-Za-z]+)/);
    if (m) {
      const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
      const monthName = (m[1].match(/^[A-Za-z]+$/) ? m[1] : m[2]).slice(0, 3).toLowerCase();
      const year = m[1].match(/^\d{4}$/) ? m[1] : m[2];
      const mm = months[monthName] || '01';
      return `${year}-${mm}`;
    }
  }
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/**
 * List files helper
 */
function listSourceFiles(folderPath) {
  if (!fs.existsSync(folderPath)) return [];
  return fs.readdirSync(folderPath)
    .filter(f => f.endsWith('.docx') && !f.startsWith('~$'))
    .map(f => ({ name: f, path: path.join(folderPath, f), folder: path.basename(folderPath) }));
}

function listGeneratedFiles() {
  const result = { daily: [], monthly: [], parsed: [] };
  const dailyDir = path.join(OUTPUT_DIR, 'Daily');
  const monthlyDir = path.join(OUTPUT_DIR, 'Monthly');
  const parsedDir = path.join(OUTPUT_DIR, 'Parsed');

  const getFiles = (dir) => {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const allFiles = [];

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.docx') && !entry.name.startsWith('~$')) {
        const fp = path.join(dir, entry.name);
        const pdfFp = fp.replace(/\.docx$/i, '.pdf');
        const hasPdf = fs.existsSync(pdfFp) && fs.statSync(pdfFp).size > 0;
        const stat = fs.statSync(fp);
        allFiles.push({
          name: entry.name,
          dateFolder: '',
          displayName: entry.name,
          path: fp,
          ext: 'docx',
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          hasPdf,
          pdfPath: hasPdf ? pdfFp : null,
          pdfSize: hasPdf ? fs.statSync(pdfFp).size : null
        });
      } else if (entry.isDirectory()) {
        const subDir = path.join(dir, entry.name);
        const subFiles = fs.readdirSync(subDir)
          .filter(f => f.endsWith('.docx') && !f.startsWith('~$'))
          .map(f => {
            const fp = path.join(subDir, f);
            const pdfFp = fp.replace(/\.docx$/i, '.pdf');
            const hasPdf = fs.existsSync(pdfFp) && fs.statSync(pdfFp).size > 0;
            const stat = fs.statSync(fp);
            return {
              name: f,
              dateFolder: entry.name,
              displayName: `${entry.name} / ${f}`,
              path: fp,
              ext: 'docx',
              size: stat.size,
              mtimeMs: stat.mtimeMs,
              hasPdf,
              pdfPath: hasPdf ? pdfFp : null,
              pdfSize: hasPdf ? fs.statSync(pdfFp).size : null
            };
          });
        allFiles.push(...subFiles);
      }
    }

    return allFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  };

  result.daily = getFiles(dailyDir);
  result.monthly = getFiles(monthlyDir);
  result.parsed = getFiles(parsedDir);

  return result;
}

module.exports = {
  parseDailySource,
  standardizeQuestions,
  standardizeDailyQuestions,
  standardizeMonthlyQuestions,
  detectContentLanguage,
  normalizeSection,
  normalizeDailySection,
  normalizeMonthlySection,
  DAILY_SECTION_ORDER,
  MONTHLY_SECTION_ORDER,
  CANONICAL_SECTION_ORDER,
  isSectionHeader,
  getSectionOrderIndex,
  buildDocxFile,
  listSourceFiles,
  listGeneratedFiles,
  getDateFolder,
  getMonthFolder,
  OUTPUT_DIR
};

module.exports.extractElementsFromDocx = extractElementsFromDocx;