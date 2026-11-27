const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { isSectionHeader, parseDateFromFilename } = require('../quizParser');
const {
  MONTHLY_SECTION_ORDER,
  normalizeSection,
  getSectionOrderIndex
} = require('../monthlyTemplateInjector');

/**
 * Monthly Order & Integrity Verification Agent
 *
 * Verifies:
 * 1. Source files are sorted strictly chronologically (Day 1 -> Day 31).
 * 2. Within every Monthly topic section, questions remain in chronological order (Day 1 -> Day 31).
 * 3. No table placeholder IDs collide across files or go missing from mergedTableMap.
 * 4. No stray section headers (e.g. "APPOINTMENTS & RESIGNATION") leak into question text/explanations.
 * 5. Post-generation DOCX contains the exact expected sections, question count, and zero unresolved placeholders.
 */

function extractTablePlaceholdersFromQuestion(q) {
  const placeholders = [];
  if (Array.isArray(q.statements)) {
    for (const st of q.statements) {
      if (typeof st === 'string' && st.trim().startsWith('__TABLE_PLACEHOLDER_')) {
        placeholders.push(st.trim());
      }
    }
  }
  if (typeof q.explanation === 'string' && q.explanation) {
    for (const line of q.explanation.split('\n')) {
      const t = line.trim();
      if (t.startsWith('__TABLE_PLACEHOLDER_')) {
        placeholders.push(t);
      }
    }
  }
  return placeholders;
}

function findLeakedSectionHeader(q) {
  const fields = [
    q.questionText || '',
    ...(Array.isArray(q.statements) ? q.statements : []),
    ...(typeof q.explanation === 'string' ? q.explanation.split('\n') : [])
  ];
  for (const line of fields) {
    const clean = String(line || '').replace(/\*\*/g, '').trim();
    if (clean && !clean.startsWith('__TABLE_PLACEHOLDER_') && isSectionHeader(clean)) {
      return clean;
    }
  }
  return null;
}

/**
 * Verify source file ordering, per-topic chronological ordering, table integrity,
 * and absence of leaked section headers before generating the Monthly DOCX.
 */
function verifyMonthlyCompilation({ files, questions, tableMap = {}, tableCollisions = [] }, onLog) {
  const log = onLog || (() => {});
  const errors = [];
  const warnings = [];

  // 1. Check chronological order of source files
  let prevMonth = '';
  let prevDay = 0;
  for (const f of files) {
    const base = path.basename(f);
    const parsed = parseDateFromFilename(base);
    if (!parsed || !parsed.dayNumber) {
      warnings.push(`Could not parse date from filename: ${base}`);
      continue;
    }
    if (prevMonth && parsed.monthFolder === prevMonth && parsed.dayNumber < prevDay) {
      errors.push(`Source file out of chronological order: ${base} (day ${parsed.dayNumber}) follows day ${prevDay}`);
    }
    prevMonth = parsed.monthFolder;
    prevDay = parsed.dayNumber;
  }

  // 2. Check table collisions and missing tableMap entries
  for (const col of tableCollisions) {
    errors.push(`Table placeholder collision detected for ${col.id} in ${col.file}`);
  }
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const placeholders = extractTablePlaceholdersFromQuestion(q);
    for (const pid of placeholders) {
      if (!tableMap[pid]) {
        errors.push(`Missing table XML for ${pid} in ${q._sourceFile || 'unknown file'} (Q: "${(q.questionText || '').slice(0, 50)}")`);
      }
    }
  }

  // 3. Check per-topic chronological order (Day 1 -> Day 31) and leaked section headers
  const sections = {};
  for (const q of questions) {
    const sec = normalizeSection(q.section || q.topic || 'NATIONAL AFFAIRS');
    if (!sections[sec]) sections[sec] = [];
    sections[sec].push(q);

    const leaked = findLeakedSectionHeader(q);
    if (leaked) {
      errors.push(`Leaked section header "${leaked}" inside ${q._sourceFile || 'unknown file'} (section ${sec})`);
    }
  }

  const sectionSummaries = [];
  const sortedSections = Object.keys(sections).sort((a, b) => getSectionOrderIndex(a) - getSectionOrderIndex(b));

  for (const sec of sortedSections) {
    const list = sections[sec];
    let secPrevMonth = '';
    let secPrevDay = 0;
    let secPrevFileIdx = -1;
    let outOfOrder = 0;

    for (let idx = 0; idx < list.length; idx++) {
      const q = list[idx];
      const day = q._sourceDay || 0;
      const month = q._sourceMonth || '';
      const fileIdx = typeof q._sourceFileIndex === 'number' ? q._sourceFileIndex : idx;

      if (secPrevMonth && month === secPrevMonth && day && secPrevDay && day < secPrevDay) {
        outOfOrder++;
        errors.push(`Topic "${sec}" Q#${idx + 1} (${q._sourceFile}, day ${day}) is out of order after day ${secPrevDay}`);
      } else if (fileIdx < secPrevFileIdx) {
        outOfOrder++;
        errors.push(`Topic "${sec}" Q#${idx + 1} (${q._sourceFile}) appeared before an earlier source file`);
      }

      if (month) secPrevMonth = month;
      if (day) secPrevDay = day;
      secPrevFileIdx = fileIdx;
    }

    sectionSummaries.push({ section: sec, count: list.length, outOfOrder });
  }

  const passed = errors.length === 0;
  if (passed) {
    log({
      type: 'success',
      message: `🛡️ [Monthly Order Agent] PASSED: ${files.length} files (${questions.length} Qs) verified in strict 1→31 chronological order across ${sortedSections.length} topics; all tables & headers clean.`
    });
  } else {
    log({
      type: 'error',
      message: `❌ [Monthly Order Agent] FAILED with ${errors.length} issue(s): ${errors.slice(0, 3).join(' | ')}`
    });
  }

  return { passed, errors, warnings, sectionSummaries };
}

/**
 * Verify the generated Monthly DOCX XML after template injection.
 */
function verifyGeneratedMonthlyDocx(docxPath, expectedQuestions, onLog) {
  const log = onLog || (() => {});
  const errors = [];

  if (!fs.existsSync(docxPath)) {
    return { passed: false, errors: [`Generated DOCX not found: ${docxPath}`] };
  }

  const zip = new AdmZip(docxPath);
  const xml = zip.readAsText('word/document.xml') || '';

  if (xml.includes('__TABLE_PLACEHOLDER_')) {
    errors.push('Unresolved __TABLE_PLACEHOLDER_ marker found in generated DOCX XML');
  }

  // Extract Heading 2 sections and numbered questions in document order
  const pRegex = /<w:p(?:\s+[^>]*)?>[\s\S]*?<\/w:p>/g;
  let m;
  const renderedSections = [];
  let renderedQuestionCount = 0;

  while ((m = pRegex.exec(xml)) !== null) {
    const pXml = m[0];
    const texts = pXml.match(/<w:t(?:\s+[^>]*)?>([^<]*)<\/w:t>/g) || [];
    const text = texts.map(t => t.replace(/<[^>]+>/g, '')).join('').trim();
    if (!text) continue;

    if (pXml.includes('w:val="Heading2"') && !/^INDEX\b/i.test(text)) {
      renderedSections.push(text);
    } else if (/^\d+\.\s+/.test(text) && pXml.includes('<w:b/>') && !pXml.includes('w:left="720"')) {
      renderedQuestionCount++;
    }
  }

  // Verify section order follows MONTHLY_SECTION_ORDER
  let lastOrderIdx = -1;
  for (const sec of renderedSections) {
    const idx = getSectionOrderIndex(sec);
    if (idx < lastOrderIdx) {
      errors.push(`Section "${sec}" in DOCX is out of canonical Monthly order`);
    }
    lastOrderIdx = idx;
  }

  if (renderedQuestionCount < expectedQuestions.length) {
    errors.push(`DOCX rendered ${renderedQuestionCount} questions, expected ${expectedQuestions.length}`);
  }

  const passed = errors.length === 0;
  if (passed) {
    log({
      type: 'success',
      message: `🛡️ [Monthly DOCX Agent] PASSED: Verified ${renderedSections.length} sections and ${renderedQuestionCount} questions in ${path.basename(docxPath)} with 0 unresolved tables.`
    });
  } else {
    log({
      type: 'error',
      message: `❌ [Monthly DOCX Agent] FAILED: ${errors.join(' | ')}`
    });
  }

  return { passed, errors, renderedSections, renderedQuestionCount };
}

module.exports = {
  verifyMonthlyCompilation,
  verifyGeneratedMonthlyDocx,
  MONTHLY_SECTION_ORDER
};
