// Run npm via Node (no shell interpolation) and retain complete local evidence.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const [label, ...args] = process.argv.slice(2);
if (!label || !/^[a-z0-9-]+$/.test(label) || !args.length) throw new Error('Usage: node tools/run-npm.cjs <label> <npm args...>');
const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
fs.mkdirSync('reports/executed', { recursive: true });
const log = fs.createWriteStream(`reports/executed/${label}.log`);
const started = new Date().toISOString();
const child = spawn(process.execPath, [npmCli, ...args], { cwd: path.resolve('.'), windowsHide: true, env: process.env });
child.stdout.on('data', data => { process.stdout.write(data); log.write(data); });
child.stderr.on('data', data => { process.stderr.write(data); log.write(data); });
child.on('error', error => { log.write(error.stack + '\n'); console.error(error); });
child.on('close', (code, signal) => {
  log.end();
  fs.writeFileSync(`reports/executed/${label}.json`, JSON.stringify({ command: ['npm', ...args], started, finished: new Date().toISOString(), exitCode: code, signal }, null, 2));
  process.exitCode = code ?? 1;
});
