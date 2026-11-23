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
const { verifyQuizIntegrity } = require('./agents/questionVerifier');

function selectDailySideBanners(questionsCount, textResult) {
  // Flatten lines across all pages with page and line tracking
  const allLines = [];
  for (let p = 2; p < textResult.pages.length; p++) {
    const pageText = textResult.pages[p].text;
    if (pageText.includes('Aspirant Queries')) break;
    const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean);
    lines.forEach((l, lIdx) => {
      allLines.push({
        page: p + 1,
        lineIdx: lIdx,
        totalPageLines: lines.length,
        text: l
      });
    });
  }

  let expectedQ = 1;
  const candidates = [];
  for (let i = 0; i < allLines.length; i++) {
    const item = allLines[i];
    const m = item.text.match(/^(\d{1,2})\.\s*/);
    if (m) {
      const qNum = parseInt(m[1], 10);
      if (qNum === expectedQ) {
        // Cross-page lookahead (up to 30 lines ahead across page boundaries)
        const lookahead = allLines.slice(i + 1, i + 30).map(x => x.text).join('\n');
        const isRealQ = /1\)/.test(lookahead) || /(?:Answer|उत्तर|आंसर|Ans)/i.test(lookahead);
        if (isRealQ) {
          const posRatio = (item.lineIdx + 1) / item.totalPageLines;
          const remainingLines = item.totalPageLines - (item.lineIdx + 1);
          if (qNum > 1 && qNum < questionsCount) {
            if (posRatio <= 0.18 && remainingLines >= 32) {
              candidates.push({ qNum, page: item.page, posRatio, remainingLines, tier: 1 });
            } else if (posRatio <= 0.30 && remainingLines >= 26) {
              candidates.push({ qNum, page: item.page, posRatio, remainingLines, tier: 2 });
            } else if (posRatio <= 0.45 && remainingLines >= 18) {
              candidates.push({ qNum, page: item.page, posRatio, remainingLines, tier: 3 });
            } else {
              candidates.push({ qNum, page: item.page, posRatio, remainingLines, tier: 4 });
            }
          }
          expectedQ++;
        }
      }
    }
  }

  const midBoundary = Math.floor(questionsCount * 0.55);
  const midTier1 = candidates.filter(c => c.qNum >= 3 && c.qNum <= midBoundary && c.tier === 1);
  const lateTier1 = candidates.filter(c => c.qNum > midBoundary && c.qNum < questionsCount && c.tier === 1);
  const midTier2 = candidates.filter(c => c.qNum >= 3 && c.qNum <= midBoundary && c.tier === 2);
  const lateTier2 = candidates.filter(c => c.qNum > midBoundary && c.qNum < questionsCount && c.tier === 2);
  const midTier3 = candidates.filter(c => c.qNum >= 3 && c.qNum <= midBoundary && c.tier === 3);
  const lateTier3 = candidates.filter(c => c.qNum > midBoundary && c.qNum < questionsCount && c.tier === 3);
  const midTier4 = candidates.filter(c => c.qNum >= 3 && c.qNum <= midBoundary);
  const lateTier4 = candidates.filter(c => c.qNum > midBoundary && c.qNum < questionsCount);

  let midPick = midTier1.length > 0
    ? midTier1[Math.floor(Math.random() * midTier1.length)].qNum
    : (midTier2.length > 0 ? midTier2[Math.floor(Math.random() * midTier2.length)].qNum
    : (midTier3.length > 0 ? midTier3[Math.floor(Math.random() * midTier3.length)].qNum
    : (midTier4.length > 0 ? midTier4[0].qNum : null)));

  let latePick = lateTier1.length > 0
    ? lateTier1[Math.floor(Math.random() * lateTier1.length)].qNum
    : (lateTier2.length > 0 ? lateTier2[Math.floor(Math.random() * lateTier2.length)].qNum
    : (lateTier3.length > 0 ? lateTier3[Math.floor(Math.random() * lateTier3.length)].qNum
    : (lateTier4.length > 0 ? lateTier4[0].qNum : null)));

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

  // Guaranteed fallback: never let midPick or latePick be empty
  if (!midPick) {
    midPick = Math.max(3, Math.round(questionsCount * 0.38));
  }
  if (!latePick || latePick === midPick) {
    latePick = Math.min(questionsCount - 1, Math.round(questionsCount * 0.72));
  }
  if (midPick && latePick && midPick > latePick) {
    const temp = midPick;
    midPick = latePick;
    latePick = temp;
  }

  const bannerAssignments = { 1: 0 };
  bannerAssignments[midPick] = 1;
  bannerAssignments[latePick] = 2;

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
    // Guarantee that DOCX has all promotional banners even if PDF engine was skipped
    try {
      const defaultBanners = {
        1: 0,
        [Math.max(3, Math.round(questions.length * 0.38))]: 1,
        [Math.min(questions.length - 1, Math.round(questions.length * 0.72))]: 2
      };
      injectQuestionsIntoTemplate({
        templatePath: DEFAULT_DAILY_TEMPLATE_PATH,
        questions,
        dateString: rawParsed.dateString,
        outputPath: docxPath,
        isTopicWise: false,
        isHindi,
        tableMap: rawParsed.tableMap || {},
        includeBottomBanner: true,
        bannerAssignments: defaultBanners
      });
    } catch (_) {}
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
    // Guarantee that DOCX has all promotional banners even if PDF engine was skipped
    try {
      const defaultBanners = {
        1: 0,
        [Math.max(3, Math.round(questions.length * 0.38))]: 1,
        [Math.min(questions.length - 1, Math.round(questions.length * 0.72))]: 2
      };
      injectQuestionsIntoTemplate({
        templatePath: DEFAULT_DAILY_TEMPLATE_PATH,
        questions,
        dateString: title,
        outputPath: docxPath,
        isTopicWise: false,
        isHindi,
        tableMap: quizData.tableMap || {},
        includeBottomBanner: true,
        bannerAssignments: defaultBanners
      });
    } catch (_) {}
  }

  return [docxPath];
}

module.exports = {
  generateDailyQuiz,
  generateFromParsedQuiz,
  parseDailySource,
  DEFAULT_DAILY_TEMPLATE_PATH
};
