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
const { verifyQuizIntegrity } = require('./questionVerifier');

function selectDailySideBanners(questionsCount, textResult) {
  let expectedQ = 1;
  const candidates = [];
  for (let p = 2; p < textResult.pages.length; p++) {
    const pageText = textResult.pages[p].text;
    if (pageText.includes('Aspirant Queries')) break;
    const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean);
    lines.forEach((l, lIdx) => {
      const m = l.match(/^(\d{1,2})\.\s*/);
      if (m) {
        const qNum = parseInt(m[1], 10);
        if (qNum === expectedQ) {
          const lookahead = lines.slice(lIdx + 1, lIdx + 20).join('\n');
          const isRealQ = /1\)/.test(lookahead) || /(?:Answer|उत्तर|आंसर|Ans)/i.test(lookahead);
          if (isRealQ) {
            const posRatio = (lIdx + 1) / lines.length;
            const remainingLines = lines.length - (lIdx + 1);
            if (qNum > 1 && qNum < questionsCount) {
              if (posRatio <= 0.18 && remainingLines >= 34) {
                candidates.push({ qNum, page: p + 1, posRatio, remainingLines, tier: 1 });
              } else if (posRatio <= 0.30 && remainingLines >= 30) {
                candidates.push({ qNum, page: p + 1, posRatio, remainingLines, tier: 2 });
              }
            }
            expectedQ++;
          }
        }
      }
    });
  }

  const midBoundary = Math.floor(questionsCount * 0.55);
  const midTier1 = candidates.filter(c => c.qNum >= 3 && c.qNum <= midBoundary && c.tier === 1);
  const lateTier1 = candidates.filter(c => c.qNum > midBoundary && c.qNum < questionsCount && c.tier === 1);
  const midTier2 = candidates.filter(c => c.qNum >= 3 && c.qNum <= midBoundary && c.tier === 2);
  const lateTier2 = candidates.filter(c => c.qNum > midBoundary && c.qNum < questionsCount && c.tier === 2);

  let midPick = midTier1.length > 0
    ? midTier1[Math.floor(Math.random() * midTier1.length)].qNum
    : (midTier2.length > 0 ? midTier2[Math.floor(Math.random() * midTier2.length)].qNum : null);

  let latePick = lateTier1.length > 0
    ? lateTier1[Math.floor(Math.random() * lateTier1.length)].qNum
    : (lateTier2.length > 0 ? lateTier2[Math.floor(Math.random() * lateTier2.length)].qNum : null);

  if (!latePick && midPick) {
    const midPage = candidates.find(c => c.qNum === midPick)?.page || 0;
    const alt = candidates.find(c => c.qNum !== midPick && Math.abs(c.page - midPage) >= 2);
    if (alt) latePick = alt.qNum;
  }
  if (!midPick && latePick) {
    const latePage = candidates.find(c => c.qNum === latePick)?.page || 0;
    const alt = candidates.find(c => c.qNum !== latePick && Math.abs(c.page - latePage) >= 2);
    if (alt) midPick = alt.qNum;
  }
  if (midPick && latePick && midPick > latePick) {
    const temp = midPick;
    midPick = latePick;
    latePick = temp;
  }

  const bannerAssignments = { 1: 0 };
  if (midPick) bannerAssignments[midPick] = 1;
  if (latePick) bannerAssignments[latePick] = 2;

  return { midPick, latePick, bannerAssignments };
}

/**
 * Generate Daily Quiz (English or Hindi based on source document detection)
 */
async function generateDailyQuiz(sourceFilePath, onLog) {
  const log = onLog || console.log;
  log({ type: 'info', message: `📄 Parsing Daily Quiz: ${path.basename(sourceFilePath)}` });

  const rawParsed = await parseDailySource(sourceFilePath);
  const questions = standardizeQuestions(rawParsed.questions, rawParsed.dateString, 'daily');
  log({ type: 'info', message: `✅ Parsed ${questions.length} questions from ${rawParsed.dateString}` });

  // 1-to-1 Ground-Truth Verification against original document
  const auditReport = verifyQuizIntegrity(sourceFilePath, questions, log);
  if (!auditReport.passed) {
    log({
      type: 'warn',
      message: `⚠️ Integrity Alert: ${auditReport.anomalies.length} question anomalies detected against original source document!`
    });
  }

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
      ? `Current Affairs Hindi Q&A – ${rawParsed.dateString}`
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

      // 1. Identify optimal question candidates and assign Banner 1 & Banner 2
      const { midPick, latePick, bannerAssignments } = selectDailySideBanners(questions.length, textResult);

      // 4. Pass 2: Re-inject with layout-verified banner assignments (bottom promotional banner always included)
      if (midPick || latePick) {
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
          includeBottomBanner: true,
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

      const { midPick, latePick, bannerAssignments } = selectDailySideBanners(questions.length, textResult);

      if (midPick || latePick) {
        injectQuestionsIntoTemplate({
          templatePath: DEFAULT_DAILY_TEMPLATE_PATH,
          questions,
          dateString: title,
          outputPath: docxPath,
          isTopicWise: false,
          isHindi,
          tableMap: quizData.tableMap || {},
          includeBottomBanner: true,
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
