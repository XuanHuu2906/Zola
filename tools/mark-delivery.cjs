const fs = require('node:fs');
const path = require('node:path');

const version = require('../package.json').version;
const file = path.resolve('reports/desktop-artifacts.json');
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const target = `Glass-Messenger-Demo-${version}-x64.exe`;
for (const artifact of report.artifacts) {
  artifact.delivery = path.basename(artifact.file) === target;
}
report.deliveryVersion = version;
fs.writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`Delivery artifact: ${target}`);
