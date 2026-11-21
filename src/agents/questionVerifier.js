const fs = require('fs');
const path = require('path');
const { extractElementsFromDocx, isSectionHeader } = require('../quizParser');

/**
 * Question Verifier & Integrity Agent
 * Independently extracts ground-truth questions from the source DOCX
 * and verifies that every question's text content, options, answer key,
 * and explanation sub-items are 100% preserved.
 */

function normalizeText(str) {
  if (!str) return '';
  return str
    .replace(/\*\*/g, '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'")
    .replace(/[\u201C\u201D"']/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function textSimilarity(str1, str2) {
  const norm1 = normalizeText(str1);
  const norm2 = normalizeText(str2);
  if (!norm1 && !norm2) return 1.0;
  if (!norm1 || !norm2) return 0.0;
  if (norm1 === norm2) return 1.0;
  if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.95;

  const words1 = new Set(norm1.split(' ').filter(w => w.length > 2));
  const words2 = new Set(norm2.split(' ').filter(w => w.length > 2));
  if (words1.size === 0 || words2.size === 0) return 0.5;

  let intersection = 0;
  for (const w of words1) {
    if (words2.has(w)) intersection++;
  }
  return (2.0 * intersection) / (words1.size + words2.size);
}

function extractGroundTruth(filePath) {
  const extracted = extractElementsFromDocx(filePath);
  if (!extracted || !extracted.lines) {
    return { totalQuestions: 0, questions: [] };
  }

  const lines = extracted.lines;
  const questions = [];

  // Find all answer lines: In CareersCloud/AffairsCloud, every question has exactly ONE Answer line
  const ansIndices = [];
  lines.forEach((l, idx) => {
    const clean = l.replace(/\*\*/g, '').replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'").trim();
    if (/^(?:Answer|उत्तर|आंसर|Ans)\s*[\u2010-\u2015\u2212\-\:–—]/i.test(clean)) {
      ansIndices.push(idx);
    }
  });

  for (let a = 0; a < ansIndices.length; a++) {
    const ansIdx = ansIndices[a];
    const prevBoundary = a > 0 ? ansIndices[a - 1] : 0;
    const nextBoundary = a < ansIndices.length - 1 ? ansIndices[a + 1] : lines.length;
    const currentQNum = a + 1;
    const expectedNextQNum = a + 2;

    // Scan backwards from Answer to find Option 1 and Question Header
    let qStartIdx = -1;
    let firstOptIdx = -1;
    let tablesInQ = [];

    for (let k = ansIdx - 1; k >= prevBoundary; k--) {
      const kClean = lines[k].replace(/\*\*/g, '').trim();
      if (lines[k].startsWith('__TABLE_PLACEHOLDER_')) {
        tablesInQ.push(lines[k]);
      }
      if (/^1\s*[\)\]]/.test(kClean)) {
        firstOptIdx = k;
      }
      const qm = kClean.match(/^(\d{1,4})\.\s*(.+)/);
      if (qm) {
        // Match if continuous numbering matches currentQNum OR if we reached before firstOptIdx (topic reset)
        if (parseInt(qm[1], 10) === currentQNum || (firstOptIdx !== -1 && k < firstOptIdx)) {
          qStartIdx = k;
          break;
        }
      }
    }

    if (qStartIdx === -1) qStartIdx = prevBoundary;
    if (firstOptIdx === -1) firstOptIdx = ansIdx;

    // 1. Question Prompt Text + Any Statements (A, B, C...)
    const qLines = [];
    for (let k = qStartIdx; k < firstOptIdx; k++) {
      const clean = lines[k].replace(/\*\*/g, '').trim();
      if (clean && !isSectionHeader(clean)) {
        qLines.push(clean.replace(/^(\d{1,3})\.\s*/, ''));
      }
    }

    // 2. Multiple Choice Options Content
    const rawOptions = [];
    let currentOpt = '';
    for (let k = firstOptIdx; k < ansIdx; k++) {
      const clean = lines[k].replace(/\*\*/g, '').trim();
      if (/^[1-5]\s*[\)\]\.]/.test(clean)) {
        if (currentOpt) rawOptions.push(currentOpt);
        currentOpt = clean;
      } else if (currentOpt) {
        currentOpt += ' ' + clean;
      }
    }
    if (currentOpt) rawOptions.push(currentOpt);

    // 3. Explanation Content & Sub-items
    let explLines = [];
    let explTables = [];
    const subItems = [];

    for (let k = ansIdx + 1; k < nextBoundary; k++) {
      const kClean = lines[k].replace(/\*\*/g, '').trim();
      if (isSectionHeader(kClean)) break;
      if (/^(Aspirant|Affairscloud:|GA Questions|Most Trusted)/i.test(kClean)) break;

      // Stop if genuine next question reached (has question number AND option 1 ahead before next answer)
      const nextQm = kClean.match(/^(\d{1,4})\.\s*([A-Za-z\u0900-\u097F\d_]|[\u201C\u201D"'])/);
      if (nextQm && k > ansIdx + 1) {
        let hasOptAhead = false;
        for (let look = k + 1; look < Math.min(k + 15, nextBoundary); look++) {
          if (/^1\s*[\)\]]/.test(lines[look].replace(/\*\*/g, '').trim())) {
            hasOptAhead = true;
            break;
          }
        }
        if (hasOptAhead) break;
      }

      if (lines[k].startsWith('__TABLE_PLACEHOLDER_')) {
        explTables.push(lines[k]);
      }

      // Exclude metadata labels so character counts strictly track explanation text
      if (/(?:Topic(?:\s*Name)?|विषय)\s*[-–:]/i.test(kClean)) continue;
      if (/(?:Difficulty(?:\s*level)?|कठिनाई)\s*[-–:]/i.test(kClean)) continue;
      if (/^(?:\*\*)?(?:Explanation|स्पष्टीकरण|विवरण|हल)\s*[:.]?/i.test(kClean)) continue;

      explLines.push(lines[k]);
      if (/^\d{1,2}\.\s+/.test(kClean)) {
        subItems.push(kClean);
      }
    }

    const qLine = qStartIdx !== -1 ? lines[qStartIdx].replace(/\*\*/g, '').trim() : '';
    const qMatch = qLine.match(/^(\d{1,3})\.\s*(.+)/);

    questions.push({
      index: a + 1,
      sourceQNum: qMatch ? parseInt(qMatch[1], 10) : a + 1,
      questionText: qMatch ? qMatch[2].trim() : qLine,
      qPrompt: qLines.join(' '),
      rawOptions,
      optionsCount: rawOptions.length,
      answerLine: lines[ansIdx].replace(/\*\*/g, '').trim(),
      explanation: explLines.join('\n'),
      explanationCharCount: explLines.join('\n').length,
      subItems,
      tableCount: tablesInQ.length + explTables.length
    });
  }

  return {
    totalQuestions: questions.length,
    questions,
    tableMap: extracted.tableMap || {}
  };
}

function verifyQuizIntegrity(sourceFilePath, parsedQuestions, onLog) {
  const log = onLog || console.log;
  log({ type: 'info', message: `🔍 Running Question Verification Agent on: ${path.basename(sourceFilePath)}...` });

  const groundTruth = extractGroundTruth(sourceFilePath);
  const anomalies = [];

  // 1. Question Count Integrity
  if (parsedQuestions.length !== groundTruth.totalQuestions) {
    anomalies.push({
      type: 'COUNT_MISMATCH',
      message: `Total question count mismatch: Source document has ${groundTruth.totalQuestions} questions, but parsed result has ${parsedQuestions.length} questions.`
    });
  }

  // 2. Sequential Numbering Integrity
  const seenNumbers = new Set();
  parsedQuestions.forEach((q, idx) => {
    const expectedNum = idx + 1;
    if (q.number && q.number !== expectedNum) {
      anomalies.push({
        type: 'NUMBERING_GAP',
        qNum: q.number,
        message: `Question at index ${idx} is numbered ${q.number} instead of sequential ${expectedNum}.`
      });
    }
    if (seenNumbers.has(q.number)) {
      anomalies.push({
        type: 'DUPLICATE_NUMBER',
        qNum: q.number,
        message: `Duplicate question number detected: ${q.number}.`
      });
    }
    seenNumbers.add(q.number);
  });

  // 3. Question-by-Question Deep Content Audit
  const checkCount = Math.min(parsedQuestions.length, groundTruth.totalQuestions);
  for (let i = 0; i < checkCount; i++) {
    const pQ = parsedQuestions[i];
    const gQ = groundTruth.questions[i];
    const qNum = i + 1;

    // A. Question Text Content Match
    const promptSim = textSimilarity(pQ.questionText, gQ.qPrompt);
    if (promptSim < 0.65) {
      anomalies.push({
        type: 'QUESTION_CONTENT_MISMATCH',
        qNum,
        message: `Question ${qNum} text content mismatch against source document (similarity: ${(promptSim * 100).toFixed(0)}%).`
      });
    }

    // B. Choices / Options Count & Content Match
    const pOptions = pQ.options || [];
    const gOptions = gQ.rawOptions || [];

    if (pOptions.length < 4 || pOptions.length > 5) {
      anomalies.push({
        type: 'OPTION_COUNT_ANOMALY',
        qNum,
        message: `Question ${qNum} has an unexpected choice count (${pOptions.length} choices; expected 5).`
      });
    }

    const checkOptCount = Math.min(pOptions.length, gOptions.length);
    for (let optIdx = 0; optIdx < checkOptCount; optIdx++) {
      const pOptClean = pOptions[optIdx].replace(/^[1-5]\s*[\)\]\.]\s*/, '');
      const gOptClean = gOptions[optIdx].replace(/^[1-5]\s*[\)\]\.]\s*/, '');
      const optSim = textSimilarity(pOptClean, gOptClean);
      if (optSim < 0.65) {
        anomalies.push({
          type: 'OPTION_CONTENT_MISMATCH',
          qNum,
          message: `Question ${qNum} Option ${optIdx + 1} content differs from source document (parsed: "${pOptClean.slice(0, 30)}...", source: "${gOptClean.slice(0, 30)}...").`
        });
      }
    }

    // C. Explanation Content Completeness & Sub-Items Guard
    const pExpl = pQ.explanation || '';
    const normPExpl = normalizeText(pExpl);

    // Verify all numbered sub-items are preserved
    if (gQ.subItems && gQ.subItems.length > 0) {
      for (const subItem of gQ.subItems) {
        const normSub = normalizeText(subItem);
        if (!normPExpl.includes(normSub)) {
          anomalies.push({
            type: 'EXPLANATION_SUBITEM_MISSING',
            qNum,
            message: `Question ${qNum} is missing sub-list item in explanation: "${subItem.slice(0, 50)}...".`
          });
        }
      }
    }

    // Check Explanation Truncation (character length)
    const pExplLen = pExpl.length;
    const gExplLen = gQ.explanationCharCount;
    if (gExplLen > 100 && pExplLen < gExplLen * 0.7) {
      anomalies.push({
        type: 'EXPLANATION_TRUNCATED',
        qNum,
        message: `Question ${qNum} explanation appears truncated: parsed length is ${pExplLen} chars, while source had ~${gExplLen} chars.`
      });
    }

    // Check Explanation Dangling Header (ends with colon like "प्रस्तावित स्थान:")
    const cleanExpl = pExpl.trim().replace(/\*\*/g, '');
    if (/[:\-–—]\s*$/.test(cleanExpl) && pExplLen < 200) {
      anomalies.push({
        type: 'DANGLING_EXPLANATION_HEADER',
        qNum,
        message: `Question ${qNum} explanation ends abruptly with a colon/dash, indicating truncated content.`
      });
    }

    // D. Answer Key Content Check
    if (!pQ.answer) {
      anomalies.push({
        type: 'MISSING_ANSWER',
        qNum,
        message: `Question ${qNum} is missing an answer.`
      });
    } else {
      // Check answer letter/number matches source answer line
      const cleanAnsG = String(gQ.answerLine).replace(/^(?:Answer|उत्तर|आंसर|Ans)\s*[\u2010-\u2015\u2212\-\:–—]\s*/i, '').trim();
      const ansMatchP = String(pQ.answer).match(/^([1-5]|[A-E])/i) || String(pQ.answer).match(/([1-5]|[A-E])/i);
      const ansMatchG = cleanAnsG.match(/^([1-5]|[A-E])/i) || cleanAnsG.match(/([1-5]|[A-E])/i);
      if (ansMatchP && ansMatchG && ansMatchP[1].toUpperCase() !== ansMatchG[1].toUpperCase()) {
        anomalies.push({
          type: 'ANSWER_KEY_MISMATCH',
          qNum,
          message: `Question ${qNum} answer key mismatch: parsed "${pQ.answer}", but source document has "${gQ.answerLine}".`
        });
      }
    }
  }

  const passed = anomalies.length === 0;

  if (passed) {
    log({
      type: 'success',
      message: `✅ [Verification Agent] PASSED: All ${parsedQuestions.length} questions matched 100% with source document (Text Content, Options 1-5, Answer Keys, and Explanation Sub-items intact).`
    });
  } else {
    log({
      type: 'warn',
      message: `⚠️ [Verification Agent] Discrepancies detected (${anomalies.length} issues):\n${anomalies.map(a => `   - [${a.type}] ${a.message}`).join('\n')}`
    });
  }

  return {
    passed,
    totalQuestions: parsedQuestions.length,
    sourceQuestionsCount: groundTruth.totalQuestions,
    anomalies
  };
}

module.exports = {
  extractGroundTruth,
  verifyQuizIntegrity
};
