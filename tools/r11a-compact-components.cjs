#!/usr/bin/env node
/**
 * R11A read-only: resolve the two compact-mode screen components and confirm
 * neither imports the chat shell. Prints every definition-shaped occurrence of
 * the identifiers used at the compact root render.
 *
 * Usage: node tools/r11a-compact-components.cjs <root>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/r11a-compact-components.cjs <root>');
  process.exit(2);
}

const REL = 'pc-dist/compact-app-pc.f32c58b63b6f4273a8a4.js';
const t = fs.readFileSync(path.join(root, REL), 'utf8');

// The compact root render lives near @1309090. Print a wide window around it,
// then resolve the component identifiers it references.
const ROOT_AT = 1309090;
console.log('=== compact root render window ===');
console.log(JSON.stringify(t.slice(ROOT_AT - 2600, ROOT_AT + 900)));

console.log('\n=== definitions of St / ct / wt ===');
for (const name of ['St', 'ct', 'wt']) {
  const re = new RegExp(`(?:const|let|var|function)\\s+${name}\\s*[=(]`, 'g');
  let m;
  let shown = 0;
  while ((m = re.exec(t)) !== null && shown < 5) {
    // only report definitions in the compact entry region (module at the end)
    if (m.index < 1250000) continue;
    shown++;
    console.log(`\n--- ${name} @${m.index} ---`);
    console.log(JSON.stringify(t.slice(m.index, m.index + 700)));
  }
  console.log(`(${name}: ${shown} definition(s) after 1.25M)`);
}

console.log('\n=== does the compact entry reference the chat shell? ===');
for (const k of ['_isAlreadyCheckOpenConvRequest', '$zscreencap', 'chatController',
                 'ConversationPrivacy', 'ModalManagerV2', 'addActionsListener']) {
  const n = t.split(k).length - 1;
  console.log(`   ${JSON.stringify(k).padEnd(34)} = ${n}`);
}
