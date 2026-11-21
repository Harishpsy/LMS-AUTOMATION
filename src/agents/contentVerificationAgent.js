const fs = require('fs');
const path = require('path');
const { extractElementsFromDocx, isSectionHeader } = require('../quizParser');

/**
 * Normalizes text for robust comparison across formatting differences
 */
function normalizeText(str) {
  if (!str) return '';
  return String(str)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'")
    .replace(/[\u201C\u201D"']/g, '"')
    .replace(/[\u2010-\u2015\u2212\-\–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Calculates token similarity between two text snippets (0.0 to 1.0)
 */
function calculateSimilarity(str1, str2) {
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

/**
 * Extracts independent ground truth questions directly from raw DOCX document
 */
function extractSourceGroundTruth(filePath) {
  const extracted = extractElementsFromDocx(filePath);
  if (!extracted || !extracted.lines) {
    return { totalQuestions: 0, questions: [], tableMap: {} };
  }

  const lines = extracted.lines;
  const questions = [];

  // Find all Answer / उत्तर lines in source document
  const ansIndices = [];
  lines.forEach((l, idx) => {
    const clean = l.replace(/\*\*/g, '').trim();
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

    let qStartIdx = -1;
    let firstOptIdx = -1;
    let tablesInQ = [];

    // Scan backwards from Answer line
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
        // Match if continuous numbering matches currentQNum OR if we reached before firstOptIdx
        if (parseInt(qm[1], 10) === currentQNum || (firstOptIdx !== -1 && k < firstOptIdx)) {
          qStartIdx = k;
          break;
        }
      }
    }

    if (qStartIdx === -1) qStartIdx = prevBoundary;
    if (firstOptIdx === -1) firstOptIdx = ansIdx;

    // 1. Question Prompt Text
    const qLines = [];
    for (let k = qStartIdx; k < firstOptIdx; k++) {
      const clean = lines[k].replace(/\*\*/g, '').trim();
      if (clean && !isSectionHeader(clean)) {
        qLines.push(clean.replace(/^(\d{1,3})\.\s*/, ''));
      }
    }

    // 2. Multiple Choice Options (1 to 5)
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

      // Ignore metadata headers
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

    // Extract answer key from source answer line
    const rawAnsLine = lines[ansIdx].replace(/\*\*/g, '').trim();
    const cleanAnsLine = rawAnsLine.replace(/^(?:Answer|उत्तर|आंसर|Ans)\s*[\u2010-\u2015\u2212\-\:–—]\s*/i, '').trim();
    const keyMatch = cleanAnsLine.match(/^([1-5]|[A-E])[).]?\s*(.*)/i);

    questions.push({
      index: a + 1,
      sourceQNum: qMatch ? parseInt(qMatch[1], 10) : a + 1,
      questionText: qMatch ? qMatch[2].trim() : qLine,
      qPrompt: qLines.join(' '),
      rawOptions,
      optionsCount: rawOptions.length,
      answerLine: rawAnsLine,
      sourceAnswerKey: keyMatch ? keyMatch[1] : '',
      sourceAnswerText: keyMatch ? keyMatch[2].trim() : cleanAnsLine,
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

/**
 * Comprehensive Content Verification Agent
 * Verifies that the uploaded DOCX document and the parsed content match 100% across every field
 * @param {string} sourceFilePath - Absolute or relative path to the DOCX file
 * @param {object} parsedQuizData - Parsed quiz data object containing .questions
 * @returns {object} Comprehensive verification report
 */
function verifyDocumentContent(sourceFilePath, parsedQuizData) {
  if (!fs.existsSync(sourceFilePath)) {
    return {
      verified: false,
      score: 0,
      error: `Source document file not found at: ${sourceFilePath}`,
      anomalies: [{ type: 'FILE_NOT_FOUND', message: `File not found: ${sourceFilePath}` }]
    };
  }

  const parsedQuestions = parsedQuizData && Array.isArray(parsedQuizData.questions)
    ? parsedQuizData.questions
    : [];

  const groundTruth = extractSourceGroundTruth(sourceFilePath);
  const anomalies = [];
  const questionDetails = [];

  let totalChecks = 0;
  let passedChecks = 0;

  // 1. Total Question Count Verification
  totalChecks++;
  const countMatch = parsedQuestions.length === groundTruth.totalQuestions;
  if (countMatch) {
    passedChecks++;
  } else {
    anomalies.push({
      type: 'QUESTION_COUNT_MISMATCH',
      message: `Total Question Count Mismatch: Source DOCX has ${groundTruth.totalQuestions} questions, but parsed result has ${parsedQuestions.length} questions.`
    });
  }

  const checkCount = Math.min(parsedQuestions.length, groundTruth.totalQuestions);

  // 2. Deep Question-by-Question Content Verification
  for (let i = 0; i < checkCount; i++) {
    const pQ = parsedQuestions[i];
    const gQ = groundTruth.questions[i];
    const qNum = i + 1;

    const qReport = {
      qNum,
      promptMatched: true,
      optionsMatched: true,
      optionsCount: pQ.options ? pQ.options.length : 0,
      answerMatched: true,
      explanationMatched: true,
      tablesVerified: true,
      issues: []
    };

    // A. Question Prompt Verification
    totalChecks++;
    const pPrompt = pQ.questionText || '';
    const gPrompt = gQ.qPrompt || gQ.questionText || '';
    const promptSim = calculateSimilarity(pPrompt, gPrompt);

    if (promptSim < 0.65) {
      qReport.promptMatched = false;
      const issue = `Question #${qNum} Prompt Mismatch (Similarity: ${(promptSim * 100).toFixed(0)}%)`;
      qReport.issues.push(issue);
      anomalies.push({ type: 'PROMPT_MISMATCH', qNum, message: issue });
    } else {
      passedChecks++;
    }

    // B. Choices / Options Verification (All 5 options)
    totalChecks++;
    const pOptions = Array.isArray(pQ.options) ? pQ.options : [];
    const gOptions = Array.isArray(gQ.rawOptions) ? gQ.rawOptions : [];

    let optionsPass = true;
    if (pOptions.length !== 5) {
      optionsPass = false;
      const issue = `Question #${qNum} Choice Count: Found ${pOptions.length}/5 choices`;
      qReport.issues.push(issue);
      anomalies.push({ type: 'CHOICE_COUNT_MISMATCH', qNum, message: issue });
    }

    // Option Content Check
    const minOpts = Math.min(pOptions.length, gOptions.length);
    for (let optIdx = 0; optIdx < minOpts; optIdx++) {
      const pText = pOptions[optIdx].text || '';
      const gText = gOptions[optIdx].replace(/^[1-5]\s*[\)\]\.]\s*/, '');
      const optSim = calculateSimilarity(pText, gText);
      if (optSim < 0.60) {
        optionsPass = false;
        const issue = `Question #${qNum} Option ${optIdx + 1} Content Altered (Similarity: ${(optSim * 100).toFixed(0)}%)`;
        qReport.issues.push(issue);
        anomalies.push({ type: 'OPTION_CONTENT_MISMATCH', qNum, message: issue });
      }
    }

    if (optionsPass) {
      passedChecks++;
    } else {
      qReport.optionsMatched = false;
    }

    // C. Correct Answer Key Verification
    totalChecks++;
    let answerPass = true;
    const cleanPKey = String(pQ.answerKey || '').trim().toUpperCase();
    const cleanGKey = String(gQ.sourceAnswerKey || '').trim().toUpperCase();

    if (!cleanPKey) {
      answerPass = false;
      const issue = `Question #${qNum} Missing Correct Answer Key`;
      qReport.issues.push(issue);
      anomalies.push({ type: 'ANSWER_KEY_MISSING', qNum, message: issue });
    } else if (cleanGKey && cleanPKey !== cleanGKey) {
      answerPass = false;
      const issue = `Question #${qNum} Answer Key Mismatch: Parsed "${cleanPKey}", Source DOCX has "${cleanGKey}"`;
      qReport.issues.push(issue);
      anomalies.push({ type: 'ANSWER_KEY_MISMATCH', qNum, message: issue });
    }

    if (answerPass) {
      passedChecks++;
    } else {
      qReport.answerMatched = false;
    }

    // D. Solution / Explanation Verification & Sub-Items Preservation
    totalChecks++;
    let explPass = true;
    const pExpl = pQ.explanationText || '';
    const gExpl = gQ.explanation || '';
    const normPExpl = normalizeText(pExpl);

    // Verify sub-items inside explanation (e.g. 1. Point, 2. Point) are not dropped
    if (gQ.subItems && gQ.subItems.length > 0) {
      for (const item of gQ.subItems) {
        const normItem = normalizeText(item);
        if (!normPExpl.includes(normItem.slice(0, 30))) {
          explPass = false;
          const issue = `Question #${qNum} Missing Sub-item in Explanation: "${item.slice(0, 40)}..."`;
          qReport.issues.push(issue);
          anomalies.push({ type: 'EXPLANATION_SUBITEM_DROPPED', qNum, message: issue });
        }
      }
    }

    // Verify explanation was not severely truncated
    if (gExpl.length > 100 && pExpl.length < gExpl.length * 0.65) {
      explPass = false;
      const issue = `Question #${qNum} Explanation Truncated (Parsed ${pExpl.length} chars, Source has ${gExpl.length} chars)`;
      qReport.issues.push(issue);
      anomalies.push({ type: 'EXPLANATION_TRUNCATED', qNum, message: issue });
    }

    if (explPass) {
      passedChecks++;
    } else {
      qReport.explanationMatched = false;
    }

    // E. Table & Media Asset Verification
    if (gQ.tableCount > 0) {
      const hasTables = (pQ.questionTableImages && pQ.questionTableImages.length > 0) ||
                        (pQ.explanationTableImages && pQ.explanationTableImages.length > 0) ||
                        pQ.hasTable;
      if (!hasTables) {
        qReport.tablesVerified = false;
        const issue = `Question #${qNum} Table Screenshot Missing (Source document contains tables)`;
        qReport.issues.push(issue);
        anomalies.push({ type: 'TABLE_ASSET_MISSING', qNum, message: issue });
      }
    }

    qReport.verified = qReport.issues.length === 0;
    questionDetails.push(qReport);
  }

  const score = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0;
  const verified = anomalies.length === 0 && countMatch;

  return {
    verified,
    score,
    totalQuestions: parsedQuestions.length,
    sourceQuestionsCount: groundTruth.totalQuestions,
    matchedQuestions: questionDetails.filter(q => q.verified).length,
    checks: {
      questionCount: { passed: countMatch, source: groundTruth.totalQuestions, parsed: parsedQuestions.length },
      prompts: { passed: questionDetails.every(q => q.promptMatched), matched: questionDetails.filter(q => q.promptMatched).length },
      options: { passed: questionDetails.every(q => q.optionsMatched), allHave5Choices: questionDetails.every(q => q.optionsCount === 5) },
      answers: { passed: questionDetails.every(q => q.answerMatched), matched: questionDetails.filter(q => q.answerMatched).length },
      explanations: { passed: questionDetails.every(q => q.explanationMatched), matched: questionDetails.filter(q => q.explanationMatched).length }
    },
    anomalies,
    questionDetails
  };
}

module.exports = {
  verifyDocumentContent,
  extractSourceGroundTruth,
  calculateSimilarity
};
