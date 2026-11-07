// Syntax/transpile verification only. This does NOT replace npm run typecheck.
// Optional argument selects an already installed TypeScript module read-only.
const fs = require('node:fs');
const ts = require(process.argv[2] || 'typescript');
const paths = ['src/renderer', 'src/shared', 'electron', 'tests']
  .flatMap(root => fs.readdirSync(root, { recursive: true }).map(p => `${root}/${p}`))
  .filter(p => /\.(ts|tsx)$/.test(p) && !p.endsWith('.d.ts'));
paths.push('vite.config.mts', 'playwright.config.ts');
const errors = [];
for (const fileName of paths) {
  const result = ts.transpileModule(fs.readFileSync(fileName, 'utf8'), {
    fileName, reportDiagnostics: true, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX, isolatedModules: true,
    },
  });
  errors.push(...(result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
    .map(d => `${fileName}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`));
}
const output = `TypeScript ${ts.version}: syntax/transpile only, ${paths.length} files, ${errors.length} errors\n${errors.join('\n')}\n`;
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/source-syntax.log', output);
console.log(output);
process.exitCode = errors.length ? 1 : 0;
