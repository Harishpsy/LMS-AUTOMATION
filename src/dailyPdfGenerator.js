/**
 * Daily PDF & DOCX Generator Module
 * Dedicated solely to generating Daily Current Affairs Quizzes (30 Qs, sequential 1..30 numbering).
 * Fully decoupled from monthly generation to ensure stability and isolation.
 */

const fs = require('fs');
const path = require('path');
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
      tableMap: rawParsed.tableMap || {}
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
      tableMap: quizData.tableMap || {}
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
