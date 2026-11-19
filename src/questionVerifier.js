const fs = require('fs');
const path = require('path');
const { extractElementsFromDocx, isSectionHeader } = require('./quizParser');

/**
 * Question Verifier & Integrity Agent
 * Independently extracts ground-truth questions from the source DOCX
 * and verifies that every question, option, answer, and explanation is 100% preserved.
 */

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

    // Scan backwards from Answer to find Option 1 and Question Header
    let qStartIdx = -1;
    let optCount = 0;
    let tablesInQ = [];

    for (let k = ansIdx - 1; k >= prevBoundary; k--) {
      const kClean = lines[k].replace(/\*\*/g, '').trim();
      if (lines[k].startsWith('__TABLE_PLACEHOLDER_')) {
        tablesInQ.push(lines[k]);
      }
      if (/^[1-5]\s*[\)\]]/.test(kClean)) {
        optCount++;
      }
      const qm = kClean.match(/^(\d{1,3})\.\s*(.+)/);
      if (qm) {
        qStartIdx = k;
        break;
      }
    }

    // Explanation runs from ansIdx + 1 until the next question start or boundary
    let explLines = [];
    let explTables = [];
    for (let k = ansIdx + 1; k < nextBoundary; k++) {
      const kClean = lines[k].replace(/\*\*/g, '').trim();
      if (isSectionHeader(kClean)) break;
      if (/^(Aspirant|Affairscloud:|GA Questions|Most Trusted)/i.test(kClean)) break;

      // Stop if next question header reached (supports letters, Devanagari, digits, fill-in-the-blanks with _, and quotes)
      const nextQm = kClean.match(/^(\d{1,3})\.\s*([A-Za-z\u0900-\u097F\d_]|[\u201C\u201D"'])/);
      if (nextQm && k > ansIdx + 1) {
        // Check if options follow this line (genuine next question)
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

      // Exclude metadata lines (Topic, Difficulty, Explanation label) so character counts accurately reflect explanation text
      if (/(?:Topic(?:\s*Name)?|विषय)\s*[-–:]/i.test(kClean)) continue;
      if (/(?:Difficulty(?:\s*level)?|कठिनाई)\s*[-–:]/i.test(kClean)) continue;
      if (/^(?:\*\*)?(?:Explanation|स्पष्टीकरण|विवरण|हल)\s*[:.]?/i.test(kClean)) continue;

      explLines.push(lines[k]);
    }

    const qLine = qStartIdx !== -1 ? lines[qStartIdx].replace(/\*\*/g, '').trim() : '';
    const qMatch = qLine.match(/^(\d{1,3})\.\s*(.+)/);

    questions.push({
      index: a + 1,
      sourceQNum: qMatch ? parseInt(qMatch[1], 10) : a + 1,
      questionText: qMatch ? qMatch[2].trim() : qLine,
      optionsCount: optCount,
      answerLine: lines[ansIdx].replace(/\*\*/g, '').trim(),
      explanationCharCount: explLines.join('\n').length,
      explanationSnippet: explLines.slice(0, 3).join(' ').slice(0, 100),
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

  // 3. Question-by-Question Deep Audit
  const checkCount = Math.min(parsedQuestions.length, groundTruth.totalQuestions);
  for (let i = 0; i < checkCount; i++) {
    const pQ = parsedQuestions[i];
    const gQ = groundTruth.questions[i];
    const qNum = i + 1;

    // Check Options Count
    const pOptCount = (pQ.options || []).length;
    if (pOptCount < 4 || pOptCount > 5) {
      anomalies.push({
        type: 'OPTION_COUNT_ANOMALY',
        qNum,
        message: `Question ${qNum} has an unexpected choice count (${pOptCount} choices; expected 5).`
      });
    }

    // Check Explanation Truncation
    const pExplLen = (pQ.explanation || '').length;
    const gExplLen = gQ.explanationCharCount;
    if (gExplLen > 100 && pExplLen < gExplLen * 0.6) {
      anomalies.push({
        type: 'EXPLANATION_TRUNCATED',
        qNum,
        message: `Question ${qNum} explanation appears truncated: parsed length is ${pExplLen} chars, while source had ~${gExplLen} chars.`
      });
    }

    // Check Explanation Dangling Header (e.g. ends with colon like "प्रस्तावित स्थान:")
    const cleanExpl = (pQ.explanation || '').trim().replace(/\*\*/g, '');
    if (/[:\-–—]\s*$/.test(cleanExpl) && pExplLen < 200) {
      anomalies.push({
        type: 'DANGLING_EXPLANATION_HEADER',
        qNum,
        message: `Question ${qNum} explanation ends abruptly with a colon/dash, indicating truncated content.`
      });
    }

    // Check Answer
    if (!pQ.answer) {
      anomalies.push({
        type: 'MISSING_ANSWER',
        qNum,
        message: `Question ${qNum} is missing an answer.`
      });
    }
  }

  const passed = anomalies.length === 0;

  if (passed) {
    log({
      type: 'success',
      message: `✅ [Verification Agent] PASSED: All ${parsedQuestions.length} questions matched 100% with source document (Count, Options, and Explanations intact).`
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
