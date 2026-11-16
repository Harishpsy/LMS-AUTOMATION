/**
 * Safe project cleanup.  Default = DRY RUN (only prints what it would do).
 *   node tools/cleanup_project.js            -> report
 *   node tools/cleanup_project.js --apply    -> MOVES the items into _cleanup_backup/<timestamp>/ (nothing is deleted)
 * Restore anything by moving it back.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP = path.join(ROOT, '_cleanup_backup', stamp);
const fmt = (b) => (b / 1048576).toFixed(1) + ' MB';

function dirSize(p) {
  let t = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name);
    t += e.isDirectory() ? dirSize(f) : fs.statSync(f).size;
  }
  return t;
}
function walk(p, out = []) {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (['node_modules', '.git', '_cleanup_backup'].includes(e.name)) continue;
    const f = path.join(p, e.name);
    e.isDirectory() ? walk(f, out) : out.push(f);
  }
  return out;
}

const targets = [];
// 1. old sub-projects that nothing references (own node_modules, empty src)
for (const d of ['lms-uploader', 'pdf-generator']) {
  const p = path.join(ROOT, d);
  if (fs.existsSync(p)) targets.push({ p, why: 'old sub-project, not referenced anywhere', size: dirSize(p) });
}
// 2. modules that no file requires
for (const f of ['src/pdfGenerator.js', 'src/templateInjector.js']) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) targets.push({ p, why: 'unused module (nothing requires it)', size: fs.statSync(p).size });
}
const files = walk(ROOT);
// 3. Word lock files
for (const f of files) if (path.basename(f).startsWith('~$')) targets.push({ p: f, why: 'Word lock/temp file', size: fs.statSync(f).size });

console.log(APPLY ? '== APPLY ==' : '== DRY RUN (add --apply to move these) ==');
let total = 0;
for (const t of targets) {
  total += t.size;
  console.log(` - ${path.relative(ROOT, t.p)}  (${fmt(t.size)})  ${t.why}`);
  if (APPLY) {
    const dest = path.join(BACKUP, path.relative(ROOT, t.p));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(t.p, dest);
  }
}
console.log(`Reclaimable: ${fmt(total)}${APPLY ? `  (moved to ${path.relative(ROOT, BACKUP)})` : ''}`);

// 4. report only: identical .docx files
const byHash = {};
for (const f of files.filter((x) => x.toLowerCase().endsWith('.docx'))) {
  const h = crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
  (byHash[h] = byHash[h] || []).push(f);
}
const dups = Object.values(byHash).filter((g) => g.length > 1);
if (dups.length) {
  const waste = dups.reduce((s, g) => s + fs.statSync(g[0]).size * (g.length - 1), 0);
  console.log(`\nIdentical .docx copies (report only): ${dups.length} groups, ~${fmt(waste)} duplicated`);
  dups.slice(0, 8).forEach((g) => console.log('   ' + g.map((x) => path.relative(ROOT, x)).join('  ==  ')));
}
// 5. report only: generated output
const gen = path.join(ROOT, 'Generated PDFs');
if (fs.existsSync(gen)) console.log(`\n"Generated PDFs" is ${fmt(dirSize(gen))} - archive old dates when not needed.`);
