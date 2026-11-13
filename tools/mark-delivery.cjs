// Flag the artifact for the current host as the delivery one. Windows ships a
// portable .exe; Linux ships an AppImage. The name comes from the same template
// as electron-builder.yml so the two cannot drift.
const fs = require('node:fs');
const path = require('node:path');

const version = require('../package.json').version;
const file = path.resolve('reports/desktop-artifacts.json');
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const extension = process.platform === 'win32' ? 'exe' : process.platform === 'darwin' ? 'dmg' : 'AppImage';
// electron-builder spells the x64 arch "x64" for win/dmg artifacts but "x86_64"
// for AppImages, so both spellings are matched against the produced files.
const names = [`Zola-${version}-x64.${extension}`, `Zola-${version}-x86_64.${extension}`];
const target = names.find(name => report.artifacts.some(artifact => path.basename(artifact.file) === name)) ?? names[0];
for (const artifact of report.artifacts) {
  artifact.delivery = path.basename(artifact.file) === target;
}
report.deliveryVersion = version;
fs.writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`Delivery artifact: ${target}`);
