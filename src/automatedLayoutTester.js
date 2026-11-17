/**
 * Automated Spacing & Layout Tester Utility
 * Powered by pdfjs-dist
 *
 * Reads exact text coordinates (X, Y) and operator lists for every page in a generated PDF:
 *  - Calculates bottom gap above footer line in millimeters (mm)
 *  - Flags any content page with a bottom gap > maxGapMm (default: 30 mm)
 *  - Flags lonely orphan lines (e.g. section headings or single isolated lines at page bottom)
 *  - Recognizes full-page graphics/banners so valid visual back covers are not misflagged
 */

const fs = require('fs');
const path = require('path');

const PT_TO_MM = 25.4 / 72; // ~0.352778 mm per PDF point
const FOOTER_Y_THRESHOLD = 38; // Text below Y=38 is footer (support email, copyright, page number)
const HEADER_Y_THRESHOLD = 780; // Text above Y=780 is running header

async function testPdfLayout(pdfPath, options = {}) {
  const maxGapMm = options.maxGapMm !== undefined ? options.maxGapMm : 30; // 30 mm threshold

  if (!fs.existsSync(pdfPath)) {
    throw new Error(`File not found: ${pdfPath}`);
  }

  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const fileBytes = fs.readFileSync(pdfPath);
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(fileBytes) }).promise;

  const totalPages = doc.numPages;
  const pageReports = [];
  const anomalies = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    const content = await page.getTextContent();
    const ops = await page.getOperatorList();

    // Check if the page has significant image/vector drawings
    const hasImagesOrDrawings = ops.fnArray.some(fn =>
      fn === pdfjsLib.OPS.paintImageXObject ||
      fn === pdfjsLib.OPS.paintInlineImageXObject ||
      fn === pdfjsLib.OPS.paintXObject
    );

    const rawItems = content.items.filter(it => it.str && it.str.trim());

    // Front matter pages (Cover P1, Study Plan P2, TOC P3)
    const isFrontMatter = pageNum <= 3;
    // Last page of document (often ends naturally after Question 30 or has back cover graphic)
    const isLastPage = pageNum === totalPages;

    // Filter content items between header and footer
    const contentItems = rawItems
      .filter(it => it.transform[5] > FOOTER_Y_THRESHOLD && it.transform[5] < HEADER_Y_THRESHOLD)
      .map(it => ({
        str: it.str.trim(),
        x: Math.round(it.transform[4]),
        y: Math.round(it.transform[5]),
        height: it.height
      }))
      .sort((a, b) => a.y - b.y); // Lowest Y to highest Y (index 0 is the lowest on the page)

    if (contentItems.length === 0) {
      if (hasImagesOrDrawings) {
        pageReports.push({
          page: pageNum,
          status: 'PASS',
          lowestText: '[Graphic / Image Page]',
          gapAboveFooterMm: 0,
          notes: 'Full-page image/graphic'
        });
      } else if (!isFrontMatter) {
        anomalies.push({
          page: pageNum,
          type: 'EMPTY_CONTENT_PAGE',
          gapMm: Math.round((viewport.height - FOOTER_Y_THRESHOLD) * PT_TO_MM),
          message: `Page ${pageNum} has no content text items.`
        });
        pageReports.push({
          page: pageNum,
          status: 'FAIL',
          lowestText: '[EMPTY]',
          gapAboveFooterMm: Math.round((viewport.height - FOOTER_Y_THRESHOLD) * PT_TO_MM),
          notes: 'Empty page'
        });
      }
      continue;
    }

    const lowestItem = contentItems[0];
    const gapAboveFooterPt = Math.max(0, lowestItem.y - FOOTER_Y_THRESHOLD);
    const gapAboveFooterMm = Math.round(gapAboveFooterPt * PT_TO_MM * 10) / 10;

    // Check for orphan heading at bottom of page (e.g. all-caps title or lone Explanation: with no text below)
    const isOrphanHeading = /^(?:[A-Z\s&]{4,40}|Explanation:|स्पष्टीकरण:)$/.test(lowestItem.str) &&
      (contentItems.length < 2 || (contentItems[1].y - lowestItem.y) > 25);

    let pageStatus = 'PASS';
    let failReason = '';

    if (!isFrontMatter && !isLastPage) {
      if (gapAboveFooterMm > maxGapMm) {
        pageStatus = 'FAIL';
        failReason = `Bottom gap ${gapAboveFooterMm}mm exceeds ${maxGapMm}mm limit`;
        anomalies.push({
          page: pageNum,
          type: 'BOTTOM_GAP_EXCEEDED',
          gapMm: gapAboveFooterMm,
          thresholdMm: maxGapMm,
          lowestText: lowestItem.str.slice(0, 50),
          message: `Page ${pageNum}: Bottom gap is ${gapAboveFooterMm}mm (threshold: ${maxGapMm}mm). Lowest item: "${lowestItem.str.slice(0, 40)}"`
        });
      }

      if (isOrphanHeading) {
        pageStatus = 'FAIL';
        failReason = `Orphan heading ending page: "${lowestItem.str}"`;
        anomalies.push({
          page: pageNum,
          type: 'ORPHAN_HEADING',
          lowestText: lowestItem.str,
          message: `Page ${pageNum}: Ends with an isolated heading: "${lowestItem.str}"`
        });
      }
    }

    pageReports.push({
      page: pageNum,
      status: pageStatus,
      lowestText: lowestItem.str.slice(0, 50),
      gapAboveFooterMm,
      notes: failReason || 'OK'
    });
  }

  const passed = anomalies.length === 0;

  return {
    filePath: pdfPath,
    totalPages,
    passed,
    anomaliesCount: anomalies.length,
    anomalies,
    pageReports
  };
}

// CLI runner: node src/automatedLayoutTester.js [pdfPath] [maxGapMm]
if (require.main === module) {
  const args = process.argv.slice(2);
  const targetPdf = args[0] || 'Generated PDFs/Daily/2026-11-14/Daily_Quiz_14_November_2026_English.pdf';
  const limitMm = args[1] ? parseFloat(args[1]) : 30;

  console.log(`\n🔍 Running Automated PDF Spacing Test on: ${path.basename(targetPdf)}`);
  console.log(`📏 Maximum allowed bottom gap: ${limitMm} mm\n`);

  testPdfLayout(targetPdf, { maxGapMm: limitMm })
    .then(res => {
      console.log('--------------------------------------------------------------------------------------');
      console.log(`Page | Gap (mm) | Status | Lowest Content Line`);
      console.log('--------------------------------------------------------------------------------------');
      res.pageReports.forEach(p => {
        const pNum = String(p.page).padStart(4, ' ');
        const gap = String(p.gapAboveFooterMm).padStart(7, ' ');
        const st = p.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
        const txt = p.lowestText.padEnd(45, ' ').slice(0, 45);
        console.log(`${pNum} | ${gap}  | ${st} | ${txt}`);
      });
      console.log('--------------------------------------------------------------------------------------');
      console.log(`Total Pages: ${res.totalPages} | Result: ${res.passed ? '🎉 ALL PAGES PASSED' : `⚠️ ${res.anomaliesCount} ANOMALY(IES) FOUND`}`);
      if (!res.passed) {
        console.log('\nDetails:');
        res.anomalies.forEach(a => console.log(' • ' + a.message));
      }
      console.log('');
    })
    .catch(err => {
      console.error('Test error:', err.message);
      process.exit(1);
    });
}

module.exports = { testPdfLayout };
