const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/**
 * Converts a .docx file to a native .pdf using Microsoft Word COM via PowerShell
 * Preserves all layouts, graphics, borders, and margins exactly as rendered in Word.
 * 
 * @param {string} docxPath - Absolute or relative path to the .docx file
 * @param {string} [customPdfPath] - Optional custom destination path for the .pdf
 * @returns {Promise<string>} - Resolves with the absolute path of the converted .pdf
 */
async function convertDocxToPdf(docxPath, customPdfPath = null) {
  const resolvedDocx = path.resolve(docxPath);
  if (!fs.existsSync(resolvedDocx)) {
    throw new Error(`Source DOCX not found: ${resolvedDocx}`);
  }

  const resolvedPdf = customPdfPath
    ? path.resolve(customPdfPath)
    : resolvedDocx.replace(/\.docx$/i, '.pdf');

  // If PDF already exists and is newer than DOCX, we can return it directly
  if (fs.existsSync(resolvedPdf)) {
    const docxStat = fs.statSync(resolvedDocx);
    const pdfStat = fs.statSync(resolvedPdf);
    if (pdfStat.mtimeMs >= docxStat.mtimeMs && pdfStat.size > 0) {
      return resolvedPdf;
    }
  }

  const scriptPath = path.join(__dirname, 'convert_to_pdf.ps1');
  const args = [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    '-DocxPath', resolvedDocx,
    '-PdfPath', resolvedPdf
  ];

  return new Promise((resolve, reject) => {
    execFile('powershell.exe', args, { windowsHide: true, timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`PDF Conversion Error: ${stderr || error.message || stdout}`));
      }

      if (fs.existsSync(resolvedPdf) && fs.statSync(resolvedPdf).size > 0) {
        resolve(resolvedPdf);
      } else {
        reject(new Error(`PDF file was not created or is empty. Output: ${stdout}`));
      }
    });
  });
}

module.exports = {
  convertDocxToPdf
};
