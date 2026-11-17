/**
 * Layout Auditor Utility
 * Uses pdf-parse to inspect generated PDF pages and verify text density / layout integrity.
 */

const fs = require('fs');
const { PDFParse } = require('pdf-parse');

async function auditPdfLayout(pdfPath) {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`File not found: ${pdfPath}`);
  }

  const dataBuffer = fs.readFileSync(pdfPath);
  const parser = new PDFParse(new Uint8Array(dataBuffer));
  await parser.load();
  const textResult = await parser.getText();

  const totalPages = textResult.pages.length;
  const pageSummaries = textResult.pages.map((p, idx) => ({
    pageNumber: idx + 1,
    charCount: p.text.trim().length,
    snippet: p.text.trim().slice(0, 100)
  }));

  return {
    filePath: pdfPath,
    totalPages,
    pageSummaries
  };
}

module.exports = { auditPdfLayout };
