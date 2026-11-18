/**
 * Daily PDF & DOCX Generator Module
 * Dedicated solely to generating Daily Current Affairs Quizzes (30 Qs, sequential 1..30 numbering).
 * Fully decoupled from monthly generation to ensure stability and isolation.
 */

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const { convertDocxToPdf } = require('./docxToPdf');
const {
  injectQuestionsIntoTemplate,
  DEFAULT_DAILY_TEMPLATE_PATH
} = require('./dailyTemplateInjector');
const {
  parseDailySource,
  standardizeQuestions,
  detectContentLanguage,
  buildDocxFile,
  getDateFolder,
  OUTPUT_DIR
} = require('./quizParser');

/**
 * Generate Daily Quiz (English or Hindi based on source document detection)
 */
async function generateDailyQuiz(sourceFilePath, onLog) {
  const log = onLog || console.log;
  log({ type: 'info', message: `📄 Parsing Daily Quiz: ${path.basename(sourceFilePath)}` });

  const rawParsed = await parseDailySource(sourceFilePath);
  const questions = standardizeQuestions(rawParsed.questions, rawParsed.dateString, 'daily');
  log({ type: 'info', message: `✅ Parsed ${questions.length} questions from ${rawParsed.dateString}` });

  // Detect language of source document
  const sampleText = questions.slice(0, 5).map(q => `${q.questionText} ${q.explanation}`).join(' ');
  const lang = detectContentLanguage(questions, sampleText);
  const isHindi = lang === 'hi';
  const langLabel = isHindi ? 'Hindi' : 'English';

  log({ type: 'info', message: `🌐 Detected Source Language: ${langLabel}` });

  const dateTag = rawParsed.dateString.replace(/[,&\s]+/g, '_').replace(/_+/g, '_');
  const dateFolder = getDateFolder(rawParsed.dateString);
  const dailyDir = path.join(OUTPUT_DIR, 'Daily', dateFolder);
  if (!fs.existsSync(dailyDir)) fs.mkdirSync(dailyDir, { recursive: true });

  const docxFilename = `Daily_Quiz_${dateTag}_${langLabel}.docx`;
  const docxPath = path.join(dailyDir, docxFilename);

  log({ type: 'info', message: `📝 Injecting questions into CareersCloud daily template (preserving borders & graphics)...` });

  try {
    injectQuestionsIntoTemplate({
      templatePath: DEFAULT_DAILY_TEMPLATE_PATH,
      questions,
      dateString: rawParsed.dateString,
      outputPath: docxPath,
      isTopicWise: false,
      isHindi,
      tableMap: rawParsed.tableMap || {},
      bannerAssignments: { 1: 0 } // Pass 1: Banner 0 (Daily CA) on Q1 only
    });
    log({ type: 'success', message: `✅ Daily Template preserved & updated: ${docxFilename}` });
  } catch (err) {
    log({ type: 'warn', message: `⚠️ Fallback to standard docx builder: ${err.message}` });
    const title = isHindi
      ? `करेंट अफेयर्स Q&A – ${rawParsed.dateString}`
      : `Current Affairs Q&A – ${rawParsed.dateString}`;

    await buildDocxFile({
      title,
      subtitle: isHindi ? 'दैनिक प्रश्नोत्तरी संकलन' : 'Daily Quiz Compilation',
      questions,
      isTopicWise: false,
      outputPath: docxPath
    });
    log({ type: 'success', message: `✅ Generated Fallback DOCX: ${docxFilename}` });
  }

  // Generate native PDF with Word engine
  const pdfPath = docxPath.replace(/\.docx$/i, '.pdf');
  try {
    log({ type: 'info', message: `📄 Generating native Daily PDF with Word engine...` });
    await convertDocxToPdf(docxPath, pdfPath);
    log({ type: 'success', message: `✅ Daily PDF created: ${path.basename(pdfPath)}` });

    // Layout audit: inspect actual Word layout from generated PDF
    try {
      const dataBuffer = fs.readFileSync(pdfPath);
      const parser = new PDFParse(new Uint8Array(dataBuffer));
      await parser.load();
      const textResult = await parser.getText();

      // 1. Sequentially identify questions and check their page position
      let expectedQ = 1;
      const safeCandidates = [];
      for (let p = 3; p < textResult.pages.length; p++) {
        const pageText = textResult.pages[p].text;
        if (pageText.includes('Aspirant Queries')) break;
        const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean);
        lines.forEach((l, lIdx) => {
          const m = l.match(/^(\d{1,2})\.\s*/);
          if (m) {
            const qNum = parseInt(m[1], 10);
            if (qNum === expectedQ) {
              const posRatio = (lIdx + 1) / lines.length;
              const remainingLines = lines.length - (lIdx + 1);
              // Safe candidate: starts in top 28% of page with at least 26 lines remaining
              if (qNum > 1 && qNum < questions.length && (posRatio <= 0.28 || remainingLines >= 26)) {
                safeCandidates.push({ qNum, page: p + 1, posRatio, remainingLines });
              }
              expectedQ++;
            }
          }
        });
      }

      // 2. Select candidates for Banner 1 (mid-quiz) and Banner 2 (late-quiz)
      const midBoundary = Math.floor(questions.length * 0.55);
      const midCandidates = safeCandidates.filter(c => c.qNum >= 3 && c.qNum <= midBoundary);
      const lateCandidates = safeCandidates.filter(c => c.qNum > midBoundary && c.qNum < questions.length);

      const midPick = midCandidates.length > 0
        ? midCandidates[Math.floor(Math.random() * midCandidates.length)].qNum
        : null;
      const latePick = lateCandidates.length > 0
        ? lateCandidates[Math.floor(Math.random() * lateCandidates.length)].qNum
        : null;

      const bannerAssignments = { 1: 0 };
      if (midPick) bannerAssignments[midPick] = 1;
      if (latePick) bannerAssignments[latePick] = 2;

      // 3. Inspect bottom banner clearance before Aspirant Queries
      const aspIdx = textResult.pages.findIndex(p => p.text.includes('Aspirant Queries'));
      let includeBottomBanner = true;
      if (aspIdx > 0) {
        const pageBeforeAsp = textResult.pages[aspIdx - 1];
        if (pageBeforeAsp.text.trim().length < 250) {
          includeBottomBanner = false;
          log({ type: 'info', message: 'ℹ️ Insufficient space for bottom banner; skipping banner to eliminate extra blank page.' });
        } else {
          log({ type: 'info', message: '✅ Bottom banner embedded cleanly in available space.' });
        }
      }

      // 4. Pass 2: Re-inject with layout-verified banner assignments if mid/late banner or bottom banner adjusted
      if (midPick || latePick || !includeBottomBanner) {
        log({
          type: 'info',
          message: `🎯 Applying safe banner placement: ${Object.entries(bannerAssignments).map(([q, b]) => `Banner ${b} on Q${q}`).join(', ')}`
        });
        injectQuestionsIntoTemplate({
          templatePath: DEFAULT_DAILY_TEMPLATE_PATH,
          questions,
          dateString: rawParsed.dateString,
          outputPath: docxPath,
          isTopicWise: false,
          isHindi,
          tableMap: rawParsed.tableMap || {},
          includeBottomBanner,
          bannerAssignments
        });
        await convertDocxToPdf(docxPath, pdfPath);
        log({ type: 'success', message: `✅ Daily PDF verified and updated with safe banner placement: ${path.basename(pdfPath)}` });
      }
    } catch (auditErr) {
      log({ type: 'warn', message: `⚠️ Layout audit note: ${auditErr.message}` });
    }
  } catch (pdfErr) {
    log({ type: 'warn', message: `⚠️ Note: PDF will be generated on download (${pdfErr.message})` });
  }

  return [docxPath];
}

/**
 * Generate DOCX directly from the currently parsed questions in UI (matching language)
 */
async function generateFromParsedQuiz(quizData, onLog) {
  const log = onLog || console.log;
  const questions = standardizeQuestions(quizData.questions || []);
  const title = quizData.quizTitle || 'Daily Quiz';
  const cleanTitle = title.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 40);

  const sampleText = questions.slice(0, 5).map(q => `${q.questionText} ${q.explanation}`).join(' ');
  const lang = detectContentLanguage(questions, sampleText);
  const isHindi = lang === 'hi';
  const langLabel = isHindi ? 'Hindi' : 'English';

  log({ type: 'info', message: `📄 Generating ${langLabel} DOCX for parsed quiz: ${title} (${questions.length} Qs)...` });

  const dateFolder = getDateFolder(title);
  const parsedDir = path.join(OUTPUT_DIR, 'Parsed', dateFolder);
  if (!fs.existsSync(parsedDir)) fs.mkdirSync(parsedDir, { recursive: true });

  const docxFilename = `${cleanTitle}_${langLabel}.docx`;
  const docxPath = path.join(parsedDir, docxFilename);

  log({ type: 'info', message: `📝 Injecting questions into CareersCloud daily template...` });

  try {
    injectQuestionsIntoTemplate({
      templatePath: DEFAULT_DAILY_TEMPLATE_PATH,
      questions,
      dateString: title,
      outputPath: docxPath,
      isTopicWise: false,
      isHindi,
      tableMap: quizData.tableMap || {},
      includeBottomBanner: true,
      bannerAssignments: { 1: 0 }
    });
    log({ type: 'success', message: `✅ Daily Template preserved & updated: ${docxFilename}` });
  } catch (err) {
    log({ type: 'warn', message: `⚠️ Fallback to standard docx builder: ${err.message}` });
    await buildDocxFile({
      title,
      subtitle: isHindi ? 'दैनिक प्रश्नोत्तरी संकलन' : 'Daily Quiz Compilation',
      questions,
      isTopicWise: false,
      outputPath: docxPath
    });
    log({ type: 'success', message: `✅ Generated Fallback DOCX: ${docxFilename}` });
  }

  const pdfPath = docxPath.replace(/\.docx$/i, '.pdf');
  try {
    log({ type: 'info', message: `📄 Generating native Daily PDF...` });
    await convertDocxToPdf(docxPath, pdfPath);
    log({ type: 'success', message: `✅ Daily PDF created: ${path.basename(pdfPath)}` });

    // Layout audit
    try {
      const dataBuffer = fs.readFileSync(pdfPath);
      const parser = new PDFParse(new Uint8Array(dataBuffer));
      await parser.load();
      const textResult = await parser.getText();

      let expectedQ = 1;
      const safeCandidates = [];
      for (let p = 3; p < textResult.pages.length; p++) {
        const pageText = textResult.pages[p].text;
        if (pageText.includes('Aspirant Queries')) break;
        const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean);
        lines.forEach((l, lIdx) => {
          const m = l.match(/^(\d{1,2})\.\s*/);
          if (m) {
            const qNum = parseInt(m[1], 10);
            if (qNum === expectedQ) {
              const posRatio = (lIdx + 1) / lines.length;
              const remainingLines = lines.length - (lIdx + 1);
              if (qNum > 1 && qNum < questions.length && (posRatio <= 0.28 || remainingLines >= 26)) {
                safeCandidates.push({ qNum, page: p + 1, posRatio, remainingLines });
              }
              expectedQ++;
            }
          }
        });
      }

      const midBoundary = Math.floor(questions.length * 0.55);
      const midCandidates = safeCandidates.filter(c => c.qNum >= 3 && c.qNum <= midBoundary);
      const lateCandidates = safeCandidates.filter(c => c.qNum > midBoundary && c.qNum < questions.length);

      const midPick = midCandidates.length > 0
        ? midCandidates[Math.floor(Math.random() * midCandidates.length)].qNum
        : null;
      const latePick = lateCandidates.length > 0
        ? lateCandidates[Math.floor(Math.random() * lateCandidates.length)].qNum
        : null;

      const bannerAssignments = { 1: 0 };
      if (midPick) bannerAssignments[midPick] = 1;
      if (latePick) bannerAssignments[latePick] = 2;

      const aspIdx = textResult.pages.findIndex(p => p.text.includes('Aspirant Queries'));
      let includeBottomBanner = true;
      if (aspIdx > 0) {
        const pageBeforeAsp = textResult.pages[aspIdx - 1];
        if (pageBeforeAsp.text.trim().length < 250) {
          includeBottomBanner = false;
        }
      }

      if (midPick || latePick || !includeBottomBanner) {
        injectQuestionsIntoTemplate({
          templatePath: DEFAULT_DAILY_TEMPLATE_PATH,
          questions,
          dateString: title,
          outputPath: docxPath,
          isTopicWise: false,
          isHindi,
          tableMap: quizData.tableMap || {},
          includeBottomBanner,
          bannerAssignments
        });
        await convertDocxToPdf(docxPath, pdfPath);
      }
    } catch (auditErr) {
      // Keep existing PDF
    }
  } catch (pdfErr) {
    log({ type: 'warn', message: `⚠️ Note: PDF will be generated on download (${pdfErr.message})` });
  }

  return [docxPath];
}

module.exports = {
  generateDailyQuiz,
  generateFromParsedQuiz,
  parseDailySource,
  DEFAULT_DAILY_TEMPLATE_PATH
};
