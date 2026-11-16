# Modern Daily Q&A PDF (redesigned cards)

New button on the PDF Generator page: **✨ Generate Modern PDF**
(pick the source .docx in the same dropdown as "Generate Daily Quiz (DOCX)").

Output: `Generated PDFs/Modern/<date>/Daily_Quiz_<date>_<Language>_Modern.pdf`

## What was added / changed
| File | Change |
|---|---|
| `src/modernPdfGenerator.js` | NEW - builds the HTML design from the parsed questions and prints it with Playwright |
| `src/modernPdf.css` | NEW - page frame, header/footer, question / choice / solution card styles |
| `src/modernPdfPaginate.js` | NEW - fills framed A4 pages; a card that doesn't fit continues on the next page |
| `public/assets/modern/page_frame.png` | NEW - the original blue/yellow/green/red page frame |
| `src/server.js` | + `POST /api/pdf-gen/generate-daily-modern` (and 1 `require`) |
| `public/generator.html` | + "Generate Modern PDF" button |
| `public/modules/pdfGenUI.js` | + button wiring and `onGenerateModernPdf()` |

The existing DOCX / Word-engine pipeline is untouched.

## Page structure
cover pages 1-4 (`public/assets/template/page_1..4`) -> quiz pages (auto) -> Aspirant Queries -> back cover.
Banners after Q1 / Q3 / Q5 and the closing "post your doubt" banner come from `Templates/Daily/extracted_assets/images`.

## Notes
* Needs Playwright's Chromium (already used by this project).
* Set `MODERN_PDF_CHROME=<path to chrome>` only if you want to use a specific browser.
* Page 3 (index) is the template image, so its page numbers are static - same as the template.

## Optimization pass
* Cover/back pages now use optimized JPEG copies (`public/assets/template/page_*.jpg`, 5.4 MB -> 1.4 MB); the PNGs are kept as fallback. Modern PDF: ~9.2 MB -> ~3.4 MB.
* `.gitignore` fixed: it ignored every `*.png` and the whole `Templates/` folder, so required assets/templates were not committed.
* `node tools/cleanup_project.js` = dry-run report of dead weight; `--apply` MOVES it to `_cleanup_backup/` (nothing deleted):
  old `lms-uploader/` and `pdf-generator/` sub-projects (~74 MB, referenced nowhere), unused `src/pdfGenerator.js` and `src/templateInjector.js`, Word lock files.

## Code cleanup (verified)
* 11 identical helper functions that were copy-pasted in `dailyTemplateInjector.js`, `monthlyTemplateInjector.js` and `quizParser.js`
  now live once in `src/docxXmlHelpers.js` (about 260 lines of duplication removed).
* Removed the unused `src/pdfGenerator.js` and `src/templateInjector.js`.
* Verified: the Word output (daily, monthly, Hindi labels) and the parsed questions are byte-identical to before the change.
* Still duplicated on purpose: `buildQuestionsFragmentXml`, `injectQuestionsIntoTemplate`, `normalizeSection`, `getSectionOrderIndex` differ between daily and monthly, so they were not merged.
