const AdmZip = require('adm-zip');
const fs = require('fs');

function searchFolder(folder) {
  if (!fs.existsSync(folder)) return;
  const items = fs.readdirSync(folder);
  for (const item of items) {
    const full = folder + '/' + item;
    if (fs.statSync(full).isDirectory()) {
      searchFolder(full);
    } else if (item.endsWith('.docx')) {
      try {
        const zip = new AdmZip(full);
        const xml = zip.readAsText('word/document.xml');
        if (xml.includes('Insurance Limit')) {
          console.log('FOUND Insurance Limit in:', full);
        }
      } catch (e) {}
    }
  }
}

searchFolder('./Quiz Document');
searchFolder('./Daily PDF');
searchFolder('./Generated PDFs');
