const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const AdmZip = require('adm-zip');
const { renderTableToImage } = require('./tableRenderer');

/**
 * Clean text from HTML tags and normalize whitespace
 */
function cleanText(str) {
  if (!str) return '';
  return str
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect promotional ads, template headers, footers, QR codes, and social media banners
 * embedded in the .docx template so they are never treated as question content
 * @param {AdmZip} zip
 * @returns {Set<string>}
 */
function getPromoImages(zip) {
  const promoImages = new Set();

  try {
    // 1. All images referenced in header or footer relationships
    zip.getEntries().forEach(entry => {
      if (entry.entryName.startsWith('word/_rels/header') || entry.entryName.startsWith('word/_rels/footer')) {
        const xml = zip.readAsText(entry.entryName);
        const matches = xml.matchAll(/Target="media\/([^"]+)"/g);
        for (const m of matches) promoImages.add(m[1]);
      }
    });

    // 2. Images linked to external marketing / ad URLs in document.xml.rels
    const docRelsEntry = zip.getEntry('word/_rels/document.xml.rels');
    if (docRelsEntry) {
      const relsXml = zip.readAsText(docRelsEntry);
      const adRelIds = new Set();
      const hlMatches = relsXml.matchAll(/<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g);
      for (const m of hlMatches) {
        const id = m[1];
        const target = m[2].toLowerCase();
        if (target.includes('youtube') || target.includes('bit.ly') || target.includes('t.me') ||
            target.includes('forms.gle') || target.includes('affairscloud.com') || target.includes('hiring')) {
          adRelIds.add(id);
        }
      }

      const docXmlEntry = zip.getEntry('word/document.xml');
      if (docXmlEntry) {
        const docXml = zip.readAsText(docXmlEntry);
        for (const adId of adRelIds) {
          const hlRegex = new RegExp('<w:hyperlink[^>]+r:id="' + adId + '"[\\s\\S]*?<\\/w:hyperlink>', 'g');
          const hlBlocks = docXml.match(hlRegex) || [];
          for (const block of hlBlocks) {
            const blipMatches = block.matchAll(/r:embed="([^"]+)"/g);
            for (const bm of blipMatches) {
              const relMatch = relsXml.match(new RegExp('<Relationship[^>]+Id="' + bm[1] + '"[^>]+Target="media\\/([^"]+)"'));
              if (relMatch) promoImages.add(relMatch[1]);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Promo Detection Warning]:', err.message);
  }

  // 3. Known template promo filenames standard across all CareersCloud / AffairsCloud docs
  const knownTemplateNames = [
    'image1.jpeg', 'image1.jpg',
    'image2.jpg', 'image2.jpeg',
    'image3.jpeg', 'image3.jpg',
    'image4.png',
    'image5.jpeg', 'image5.jpg',
    'image6.png', 'image6.jpeg',
    'image7.png', 'image7.jpeg',
    'image8.png', 'image8.jpeg',
    'image370.png'
  ];
  knownTemplateNames.forEach(n => promoImages.add(n));

  return promoImages;
}

/**
 * Extract embedded images from .docx media folder (excluding template ads, hiring flyers & banners)
 */
function extractDocxImages(docxPath, outputDir) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const zip = new AdmZip(docxPath);
  const promoSet = getPromoImages(zip);
  const zipEntries = zip.getEntries();
  const imageFiles = [];

  for (const entry of zipEntries) {
    if (entry.entryName.startsWith('word/media/')) {
      const fileName = path.basename(entry.entryName);
      // Skip template branding, promotional ads, YouTube banners, hiring flyers, QR codes
      if (promoSet.has(fileName)) continue;

      const targetPath = path.join(outputDir, fileName);
      fs.writeFileSync(targetPath, entry.getData());
      imageFiles.push({
        fileName,
        path: targetPath,
        originalEntry: entry.entryName
      });
    }
  }
  return imageFiles;
}

/**
 * Parse a Quiz DOCX file into structured questions
 */
async function parseQuizDocx(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const assetsDir = options.assetsDir || path.join(path.dirname(filePath), 'extracted_assets');

  // Purge any old extracted tables/images from past documents so they never bleed into new documents
  if (fs.existsSync(assetsDir)) {
    try {
      fs.rmSync(assetsDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('Could not purge assetsDir:', e.message);
    }
  }
  fs.mkdirSync(path.join(assetsDir, 'tables'), { recursive: true });
  fs.mkdirSync(path.join(assetsDir, 'images'), { recursive: true });

  const docxImages = extractDocxImages(filePath, path.join(assetsDir, 'images'));

  // 1. Extract raw HTML using mammoth
  const { value: rawHtml } = await mammoth.convertToHtml({ path: filePath });

  // 2. Extract title
  let quizTitle = path.basename(filePath, path.extname(filePath));
  const titleMatch = rawHtml.match(/<strong>(DAILY\s+[A-Z\s]+Quiz[^<]*)<\/strong>/i) ||
    rawHtml.match(/<strong>([A-Z0-9\s:â€“-]+QUIZ[^<]*)<\/strong>/i);
  if (titleMatch) {
    quizTitle = cleanText(titleMatch[1]);
  }

  // â”€â”€ TABLE GUARD: Replace all <table>...</table> with safe placeholders â”€â”€â”€â”€â”€â”€
  // This prevents numbers inside table cells (e.g. "97.9" scores) from being
  // misidentified as new question numbers by the splitter regex.
  const tableStore = [];
  const guardedHtml = rawHtml.replace(/<table[\s\S]*?<\/table>/gi, (match) => {
    const idx = tableStore.length;
    tableStore.push(match);
    return `<!--__TABLE_${idx}__-->`;
  });

  // Split into question blocks using regex for paragraph with question number
  // Guard against percentages (e.g. 42.7% or 21.5%) so they are never split as question numbers
  const questionSplitter = /(?=<p>(?:\s*<[^>]+>\s*)*\s*\d{1,3}\.(?!\d+%\s*|\d+%\b))/i;
  const rawBlocks = guardedHtml.split(questionSplitter);

  function blockHasAnswer(html) {
    return /(?:Answer|\u0909\u0924\u094D\u0924\u0930(?!\u093E)[\u0903:]?|\u0906\u0902\u0938\u0930|\bAns\b)(?:<[^>]+>|\s)*(?:[\u2010-\u2015\u2212\-\:\u0903]|&ndash;|&#8211;)?/i.test(html);
  }

  function blockOptionsCount(html) {
    const matches = html.match(/<p>(?:\s*<[^>]+>\s*)*\s*[1-5A-E][).]/gi) || [];
    return matches.length;
  }

  // Merge any rogue blocks (e.g. an option accidentally formatted as "3. Name" inside question 22,
  // or decimal/percentage text inside an explanation like "42.7% ho gaya")
  const blocks = [];
  let lastValidQNum = 0;
  for (let b = 0; b < rawBlocks.length; b++) {
    let rawBlock = rawBlocks[b];

    // If block starts with a percentage (e.g. 42.7%), it is definitely not a question
    if (/^<p>(?:\s*<[^>]+>\s*)*\s*\d+(?:\.\d+)?\s*%/i.test(rawBlock)) {
      if (blocks.length > 0) blocks[blocks.length - 1] += rawBlock;
      else blocks.push(rawBlock);
      continue;
    }

    const m = rawBlock.match(/^<p>(?:\s*<[^>]+>\s*)*\s*(\d{1,3})\.\s*/i);
    if (!m) {
      if (blocks.length > 0) blocks[blocks.length - 1] += rawBlock;
      else blocks.push(rawBlock);
      continue;
    }

    const qNum = parseInt(m[1], 10);

    // Re-attach option lines formatted with "." (e.g. "2. Option") that were split from this question before its Answer line
    while (!blockHasAnswer(rawBlock) && b + 1 < rawBlocks.length) {
      const nextBlock = rawBlocks[b + 1];
      const nextMatch = nextBlock.match(/^<p>(?:\s*<[^>]+>\s*)*\s*(\d{1,3})\.\s*/i);
      if (!nextMatch) break;
      const nextQNum = parseInt(nextMatch[1], 10);
      const currOpts = blockOptionsCount(rawBlock);
      const nextOpts = blockOptionsCount(nextBlock);
      const isOptionNumber = nextQNum >= 1 && nextQNum <= 5;
      const isSeparateFullQuestions = currOpts >= 3 && nextOpts >= 3;
      if (isOptionNumber && !isSeparateFullQuestions && (nextQNum !== qNum + 1 || currOpts >= 1)) {
        rawBlock += nextBlock;
        b++;
      } else {
        break;
      }
    }

    const hasAns = blockHasAnswer(rawBlock);
    const opts = blockOptionsCount(rawBlock);

    // If candidate has no answer and no options, it cannot be a standalone question
    // (it is trailing explanation or metadata belonging to previous question)
    if (!hasAns && opts < 2) {
      if (blocks.length > 0) blocks[blocks.length - 1] += rawBlock;
      else blocks.push(rawBlock);
      continue;
    }

    // Sequence check: in a quiz, question number cannot jump wildly (e.g. from 1 to 42)
    if (lastValidQNum > 0 && qNum > lastValidQNum + 5) {
      if (blocks.length > 0) blocks[blocks.length - 1] += rawBlock;
      else blocks.push(rawBlock);
      continue;
    }

    // If block number is <= lastValidQNum, check if it's a new section restart (qNum === 1) or an option like "3. "
    if (qNum <= lastValidQNum) {
      if (qNum === 1 && hasAns && opts >= 3) {
        lastValidQNum = 1;
        blocks.push(rawBlock);
      } else {
        blocks[blocks.length - 1] += rawBlock;
      }
    } else {
      lastValidQNum = qNum;
      blocks.push(rawBlock);
    }
  }

  const questions = [];

  for (let i = 0; i < blocks.length; i++) {
    // Restore any table placeholders in this block before processing
    const block = blocks[i].replace(/<!--__TABLE_(\d+)__-->/g, (_, idx) => tableStore[parseInt(idx, 10)] || '').trim();

    const qNumMatch = block.match(/^<p>(?:\s*<[^>]+>\s*)*\s*(\d{1,3})\.\s*([\s\S]*?)(?:<\/[^>]+>\s*)*<\/p>/i);
    if (!qNumMatch) continue;

    const qNum = parseInt(qNumMatch[1], 10);

    // Skip blocks whose "question number" is unreasonably high (table-data leak guard)
    // Valid questions are typically 1â€“200
    if (qNum > 300) continue;

    // -- Normalize <br> / <br/> tags into paragraph breaks --
    // Some documents place multiple items on one line separated by <br/> instead of
    // separate <p> tags.  e.g.  "<p>5) Inevitably<br /> Answer: <strong>3) Staled</strong></p>"
    // We split ALL <br> into </p><p> so that every option, the Answer line, and the
    // Explanation line each sit in their own paragraph for reliable regex matching.
    const block_normalized = block.replace(/<br\s*\/?>/gi, '</p><p>');

    // Look for Answer / उत्तर / आंसर line to divide Question/Options from Answer/Explanation
    // Use paragraph/start boundary and negative lookahead so Hindi words like Uttarakhand don't match
    const ansMatchBoundary = block_normalized.match(/(?:^|<p>)\s*(?:\s*<[^>]+>\s*)*(?:Answer|\u0909\u0924\u094D\u0924\u0930(?!\u093E)[\u0903:]?|\u0906\u0902\u0938\u0930|\bAns\b)(?:<[^>]+>|\s)*(?:[\u2010-\u2015\u2212\-\:\u0903]|&ndash;|&#8211;)?/i);
    let questionAndOptions = block_normalized;
    let answerAndExplanation = '';

    if (ansMatchBoundary) {
      questionAndOptions = block_normalized.substring(0, ansMatchBoundary.index);
      answerAndExplanation = block_normalized.substring(ansMatchBoundary.index);
    }

    // Now analyze Options in questionAndOptions
    // Table contents must NEVER be treated as multiple-choice options!
    // Strip <table>...</table> contents before looking for options
    let searchAreaNoTables = questionAndOptions.replace(/<table[\s\S]*?<\/table>/gi, '');

    // IMPORTANT: Skip the question header line itself so "1. Question Title..." is never treated as option "1)"!
    const headerLineMatch = searchAreaNoTables.match(/^<p>(?:\s*<[^>]+>\s*)*\s*\d{1,3}\.\s*[\s\S]*?(?:<\/[^>]+>\s*)*<\/p>/i);
    const headerOffset = headerLineMatch ? headerLineMatch[0].length : 0;
    const optionsSearchArea = searchAreaNoTables.substring(headerOffset);

    const numberedOptMatches = [...optionsSearchArea.matchAll(/<p>(?:\s*<[^>]+>\s*)*\s*([1-5])[).]\s*([\s\S]*?)(?:<\/[^>]+>\s*)*<\/p>/gi)];
    const letterOptMatches = [...optionsSearchArea.matchAll(/<p>(?:\s*<[^>]+>\s*)*\s*([A-E])[).]\s*([\s\S]*?)(?:<\/[^>]+>\s*)*<\/p>/gi)];
    let optionsList = [];
    let questionHtml = '';

    if (numberedOptMatches.length >= 3) {
      // Find the first option in the original questionAndOptions that is outside tables (and after header)
      const firstOptSnippet = numberedOptMatches[0][0];
      const tableEndIndex = questionAndOptions.lastIndexOf('</table>');
      let searchStartIndex = headerOffset;
      if (tableEndIndex !== -1 && tableEndIndex > headerOffset) {
        searchStartIndex = tableEndIndex;
      }
      const firstOptIndex = questionAndOptions.indexOf(firstOptSnippet, searchStartIndex);

      questionHtml = firstOptIndex !== -1 ? questionAndOptions.substring(0, firstOptIndex) : questionAndOptions;
      optionsList = numberedOptMatches.map(m => ({
        label: m[1],
        text: cleanText(m[2])
      }));
    } else if (letterOptMatches.length >= 3) {
      const firstOptSnippet = letterOptMatches[0][0];
      const tableEndIndex = questionAndOptions.lastIndexOf('</table>');
      let searchStartIndex = headerOffset;
      if (tableEndIndex !== -1 && tableEndIndex > headerOffset) {
        searchStartIndex = tableEndIndex;
      }
      const firstOptIndex = questionAndOptions.indexOf(firstOptSnippet, searchStartIndex);

      questionHtml = firstOptIndex !== -1 ? questionAndOptions.substring(0, firstOptIndex) : questionAndOptions;
      optionsList = letterOptMatches.map(m => ({
        label: m[1],
        text: cleanText(m[2])
      }));
    } else {
      questionHtml = questionAndOptions;
    }

    // Strip leading question number (e.g. "2. ") from questionHtml so LMS does not get duplicate number prefixes,
    // while preserving opening inline formatting tags (such as <strong>)
    questionHtml = questionHtml
      .replace(/^(\s*(?:<[^>]+>\s*)*)\d{1,3}\s*[\.\)\:\-]\s*(?:&nbsp;|\u00a0)?\s*/i, '$1')
      .replace(/^(\s*(?:<p[^>]*>\s*)?)<(strong|b|em|i|span)>\s*<\/\2>\s*/i, '$1')
      .trim();

    // Also strip any trailing <table>...</table> tags from questionHtml so table headers do not leak into question text
    let cleanQHtml = questionHtml.replace(/<table[\s\S]*?<\/table>/gi, '');

    const questionText = cleanText(cleanQHtml).replace(/^\d{1,3}\s*[\.\)\:\-]\s*/, '');

    // Extract Answer Key & Answer Text (bilingual: English "Answer" & Hindi "à¤‰à¤¤à¥à¤¤à¤°")
    let answerKey = '';
    let answerText = '';
    const ansMatch = answerAndExplanation.match(/(?:Answer|\u0909\u0924\u094D\u0924\u0930[\u0903:]?|\u0906\u0902\u0938\u0930|\bAns\b)(?:<[^>]+>|\s)*(?:[\u2010-\u2015\u2212\-\:\u0903]|&ndash;|&#8211;)?(?:<[^>]+>|\s)*([1-5A-E])\s*(?:<[^>]+>|\))*(.*?)(?=<p>|<\/p>|<br|Explanation|\u0938\u094D\u092A\u0937\u094D\u091F\u0940\u0915\u0930\u0923|\u0935\u093F\u0935\u0930\u0923|\u0939\u0932|$)/i);
    if (ansMatch) {
      answerKey = ansMatch[1].trim();
      answerText = cleanText(ansMatch[2]);
    }

    // Extract Explanation / स्पष्टीकरण
    let explanationHtml = '';
    const expMatch = answerAndExplanation.match(/<p>(?:<strong>)?\s*(?:Explanation|\u0938\u094D\u092A\u0937\u094D\u091F\u0940\u0915\u0930\u0923|\u0935\u093F\u0935\u0930\u0923|\u0939\u0932)(?:<[^>]+>|\s)*:[\s\S]*?<\/p>/i) ||
                     answerAndExplanation.match(/(?:Explanation|\u0938\u094D\u092A\u0937\u094D\u091F\u0940\u0915\u0930\u0923|\u0935\u093F\u0935\u0930\u0923|\u0939\u0932)(?:<[^>]+>|\s)*:(?:<\/strong>)?(?:\s*<\/p>)?/i);
    if (expMatch) {
      const expStart = expMatch.index + expMatch[0].length;
      let expSub = answerAndExplanation.substring(expStart);
      const expEndMatch = expSub.match(/<p>(?:<strong>)?\s*(?:Topic(?:\s*Name)?|Difficulty(?:\s*level)?|\u0935\u093F\u0937\u092F|\u0915\u0920\u093F\u0928\u093E\u0908)/i);
      if (expEndMatch) {
        expSub = expSub.substring(0, expEndMatch.index);
      }
      explanationHtml = expSub.trim();
    }
    const explanationText = cleanText(explanationHtml);

    // Extract Topic (bilingual: "Topic Name" or "विषय")
    let topic = 'National Affairs'; // default fallback
    const topicMatch = block.match(/(?:Topic(?:\s*Name)?|\u0935\u093F\u0937\u092F(?:\s*\u0915\u093E\s*\u0928\u093E\u092E)?)(?:<[^>]+>|\s)*(?:[\u2010-\u2015\u2212\-\:]|&ndash;|&#8211;)\s*([^<\n\r]+)/i);
    if (topicMatch) {
      topic = cleanText(topicMatch[1]);
    }

    // Extract Difficulty (bilingual: "Difficulty level" or "कठिनाई स्तर")
    let difficulty = 'Easy';
    const diffMatch = block.match(/(?:Difficulty(?:\s*level)?|\u0915\u0920\u093F\u0928\u093E\u0908(?:\s*\u0938\u094D\u0924\u0930)?)(?:<[^>]+>|\s)*(?:[\u2010-\u2015\u2212\-\:]|&ndash;|&#8211;)\s*([^<\n\r]+)/i);
    if (diffMatch) {
      difficulty = cleanText(diffMatch[1]);
    }

    // â”€â”€ ZONE-AWARE TABLE RENDERING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Zone 1: Tables inside the question body (before Answer line)
    //         â†’ will be appended to the Question CKEditor field
    const qTableMatches = questionAndOptions.match(/<table[\s\S]*?<\/table>/gi) || [];
    const questionTableImages = [];
    for (let t = 0; t < qTableMatches.length; t++) {
      const tableImgPath = path.join(assetsDir, 'tables', `q${qNum}_qtable_${t + 1}.png`);
      await renderTableToImage(qTableMatches[t], tableImgPath);
      questionTableImages.push(tableImgPath);
    }

    // Zone 2: Tables inside the explanation/solution (after Answer line)
    //         â†’ will be appended to the Solution/Explanation CKEditor field
    const expTableMatches = answerAndExplanation.match(/<table[\s\S]*?<\/table>/gi) || [];
    const explanationTableImages = [];
    for (let t = 0; t < expTableMatches.length; t++) {
      const tableImgPath = path.join(assetsDir, 'tables', `q${qNum}_etable_${t + 1}.png`);
      await renderTableToImage(expTableMatches[t], tableImgPath);
      explanationTableImages.push(tableImgPath);
    }

    // Legacy combined array (still available for gallery / backward compat)
    const tableImages = [...questionTableImages, ...explanationTableImages];

    questions.push({
      number: qNum,
      type: 'single',
      questionText,
      questionHtml: questionHtml.trim(),
      options: optionsList,
      answerKey,
      answerText,
      explanationHtml: explanationHtml.trim(),
      explanationText,
      topic,
      difficulty,
      // Zone-split image arrays
      questionTableImages,   // tables/charts that belong under the question
      explanationTableImages, // tables/charts that belong under the explanation
      tableImages,           // all combined (for gallery preview)
      hasTable: tableImages.length > 0
    });

  }

  return {
    quizTitle,
    totalQuestions: questions.length,
    questions,
    embeddedImages: docxImages
  };
}

if (require.main === module) {
  const testFile = path.join(__dirname, '..', 'Quiz Document', 'Daily Quiz - 23rd Oct.docx');
  parseQuizDocx(testFile).then(async data => {
    console.log('Quiz Title:', data.quizTitle);
    console.log('Total Questions Parsed:', data.totalQuestions);
    console.log('\n--- Q2 Details (verifying statements vs options):');
    console.log('Question text:', data.questions[1].questionText);
    console.log('Options count:', data.questions[1].options.length);
    console.log('Options:', data.questions[1].options);
    console.log('Answer Key:', data.questions[1].answerKey, '-', data.questions[1].answerText);

    const { closeBrowser } = require('./tableRenderer');
    await closeBrowser();
  }).catch(err => console.error(err));
}

module.exports = { parseQuizDocx, cleanText };
