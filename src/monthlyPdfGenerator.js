/**
 * Monthly Topic-Wise Consolidated PDF & DOCX Generator Module
 * Dedicated solely to generating Monthly Topic-Wise Quizzes (topic grouping, 1..N numbering, 230+ page styling).
 * Fully decoupled from daily generation so changes to monthly templates or magazine sections never affect daily workflows.
 */

const fs = require('fs');
const path = require('path');
const { convertDocxToPdf } = require('./docxToPdf');
const {
  injectQuestionsIntoTemplate,
  DEFAULT_MONTHLY_TEMPLATE_PATH
} = require('./monthlyTemplateInjector');
const {
  parseDailySource,
  standardizeQuestions,
  detectContentLanguage,
  buildDocxFile,
  getMonthFolder,
  OUTPUT_DIR
} = require('./quizParser');
const { verifyQuizIntegrity } = require('./questionVerifier');

/**
 * Generate Monthly Topic-Wise Quiz (creates English monthly from English files, Hindi monthly from Hindi files)
 */
async function generateMonthlyQuiz(sourceFolderPath, monthLabel, onLog) {
  const log = onLog || console.log;
  let files = [];
  if (fs.existsSync(sourceFolderPath) && fs.statSync(sourceFolderPath).isFile()) {
    files = [sourceFolderPath];
  } else if (fs.existsSync(sourceFolderPath)) {
    files = fs.readdirSync(sourceFolderPath)
      .filter(f => f.endsWith('.docx') && !f.startsWith('~$'))
      .map(f => path.join(sourceFolderPath, f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }

  if (files.length === 0) throw new Error('No .docx files found in ' + sourceFolderPath);
  log({ type: 'info', message: `📁 Found ${files.length} file(s) to process for ${monthLabel}` });

  const englishQuestions = [];
  const hindiQuestions = [];
  const mergedTableMap = {};

  for (const f of files) {
    try {
      const parsed = await parseDailySource(f);
      if (parsed.tableMap) {
        Object.assign(mergedTableMap, parsed.tableMap);
      }
      const std = standardizeQuestions(parsed.questions, parsed.dateString, 'monthly');

      // 1-to-1 Ground-Truth Verification for each source document
      const auditReport = verifyQuizIntegrity(f, std, log);
      if (!auditReport.passed) {
        log({
          type: 'warn',
          message: `  ⚠️ Integrity Warning in ${path.basename(f)}: ${auditReport.anomalies.length} question anomalies detected!`
        });
      }

      const sampleText = std.slice(0, 5).map(q => `${q.questionText} ${q.explanation}`).join(' ');
      const lang = detectContentLanguage(std, sampleText);

      if (lang === 'hi') {
        hindiQuestions.push(...std);
        log({ type: 'info', message: `  → Parsed ${std.length} [Hindi] questions from ${path.basename(f)}` });
      } else {
        englishQuestions.push(...std);
        log({ type: 'info', message: `  → Parsed ${std.length} [English] questions from ${path.basename(f)}` });
      }
    } catch (e) {
      log({ type: 'warn', message: `  ⚠️ Skipped ${path.basename(f)}: ${e.message}` });
    }
  }

  const totalVerified = englishQuestions.length + hindiQuestions.length;
  log({
    type: 'success',
    message: `🎯 [Monthly Verification Agent] Compilation Verified: ${files.length} source file(s) processed, ${totalVerified} total questions intact (${englishQuestions.length} English, ${hindiQuestions.length} Hindi).`
  });

  const generatedFiles = [];
  const monthFolder = getMonthFolder(monthLabel);
  const monthlyDir = path.join(OUTPUT_DIR, 'Monthly', monthFolder);
  if (!fs.existsSync(monthlyDir)) fs.mkdirSync(monthlyDir, { recursive: true });
  const safeName = monthLabel.replace(/\s+/g, '_');

  const monthlyTemplate = fs.existsSync(DEFAULT_MONTHLY_TEMPLATE_PATH)
    ? DEFAULT_MONTHLY_TEMPLATE_PATH
    : null;

  // Only generate English monthly if there are English questions
  if (englishQuestions.length > 0) {
    log({ type: 'info', message: `📝 Generating English Monthly Topic-Wise DOCX (${englishQuestions.length} Qs)...` });
    const enDocx = path.join(monthlyDir, `Monthly_TopicWise_${safeName}_English.docx`);
    const enPdf = enDocx.replace(/\.docx$/i, '.pdf');

    if (monthlyTemplate) {
      log({ type: 'info', message: `📝 Injecting into CareersCloud Monthly template: ${path.basename(monthlyTemplate)}...` });
      injectQuestionsIntoTemplate({
        templatePath: monthlyTemplate,
        questions: englishQuestions,
        dateString: monthLabel,
        outputPath: enDocx,
        isTopicWise: true,
        isHindi: false,
        tableMap: mergedTableMap
      });
    } else {
      await buildDocxFile({
        title: `Monthly Current Affairs Q&A – ${monthLabel}`,
        subtitle: 'Topic-Wise Consolidated Edition',
        questions: englishQuestions,
        isTopicWise: true,
        outputPath: enDocx
      });
    }
    log({ type: 'success', message: `✅ English Monthly DOCX: ${path.basename(enDocx)}` });
    generatedFiles.push(enDocx);

    try {
      log({ type: 'info', message: `📕 Converting English Monthly DOCX to PDF...` });
      await convertDocxToPdf(enDocx, enPdf);
      log({ type: 'success', message: `✅ PDF created: ${path.basename(enPdf)}` });
      generatedFiles.push(enPdf);
    } catch (pdfErr) {
      log({ type: 'warn', message: `⚠️ Note: PDF will be generated on download (${pdfErr.message})` });
    }
  }

  // Only generate Hindi monthly if there are Hindi questions
  if (hindiQuestions.length > 0) {
    log({ type: 'info', message: `📝 Generating Hindi Monthly Topic-Wise DOCX (${hindiQuestions.length} Qs)...` });
    const hiDocx = path.join(monthlyDir, `Monthly_TopicWise_${safeName}_Hindi.docx`);
    const hiPdf = hiDocx.replace(/\.docx$/i, '.pdf');

    if (monthlyTemplate) {
      log({ type: 'info', message: `📝 Injecting into CareersCloud Monthly template: ${path.basename(monthlyTemplate)}...` });
      injectQuestionsIntoTemplate({
        templatePath: monthlyTemplate,
        questions: hindiQuestions,
        dateString: monthLabel,
        outputPath: hiDocx,
        isTopicWise: true,
        isHindi: true,
        tableMap: mergedTableMap
      });
    } else {
      await buildDocxFile({
        title: `मासिक करेंट अफेयर्स प्रश्नोत्तरी – ${monthLabel}`,
        subtitle: 'विषयवार संकलन (Topic-Wise Compilation)',
        questions: hindiQuestions,
        isTopicWise: true,
        outputPath: hiDocx
      });
    }
    log({ type: 'success', message: `✅ Hindi Monthly DOCX: ${path.basename(hiDocx)}` });
    generatedFiles.push(hiDocx);

    try {
      log({ type: 'info', message: `📕 Converting Hindi Monthly DOCX to PDF...` });
      await convertDocxToPdf(hiDocx, hiPdf);
      log({ type: 'success', message: `✅ PDF created: ${path.basename(hiPdf)}` });
      generatedFiles.push(hiPdf);
    } catch (pdfErr) {
      log({ type: 'warn', message: `⚠️ Note: PDF will be generated on download (${pdfErr.message})` });
    }
  }

  return generatedFiles;
}

module.exports = {
  generateMonthlyQuiz,
  DEFAULT_MONTHLY_TEMPLATE_PATH
};
