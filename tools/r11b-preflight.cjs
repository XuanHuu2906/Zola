#!/usr/bin/env node
/**
 * R11B read-only preflight — no PII involved, safe to run before the user
 * supplies any test conversation.
 *
 * Answers the questions that do NOT require a phone number:
 *   - is the zalo:// scheme actually registered for this user, and with which
 *     command line (proves B.2 step 1 at run time, not just in R11A's snapshot);
 *   - which Zalo processes exist right now (count + exe path + pid), so the PoC
 *     can tell "a second instance appeared" from "nothing happened";
 *   - SHA-256 of app.asar (AC4 baseline: the file must be unchanged after).
 *
 * Output is JSON on stdout AND a copy in reports/executed/. It contains no
 * message content, no phone numbers, no user names, no tokens.
 *
 * Usage: node tools/r11b-preflight.cjs <extracted-asar-root> <label>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const [root, label] = process.argv.slice(2);
if (!root || !label) {
  console.error('usage: node tools/r11b-preflight.cjs <extracted-asar-root> <label>');
  process.exit(2);
}

function ps(script) {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', timeout: 60000, windowsHide: true,
    }).trim();
  } catch (e) {
    return `ERR:${e.message}`;
  }
}

function sha256File(p) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

// --- 1. scheme registration --------------------------------------------------
const keyPath = 'HKCU:\\Software\\Classes\\zalo';
const keyExists = ps(`if (Test-Path '${keyPath}') { 'YES' } else { 'NO' }`);

// The default value has no name; Get-ItemProperty cannot select it, so read it
// through the key object. Empty string == default value.
function regValue(name) {
  const out = ps(
    `$k = Get-Item -Path '${keyPath}\\shell\\open\\command' -ErrorAction SilentlyContinue; ` +
    `if ($null -eq $k) { 'NOKEY' } else { ` +
    `$v = $k.GetValue('${name}'); if ($null -eq $v) { 'NONE' } else { $v } }`
  );
  return out;
}
const openCommand = regValue('');
const delegateExecute = regValue('DelegateExecute');

// Parse the registered command without leaking anything user-specific: the
// path is an install location (not PII), keep it; it is needed to prove the
// shell will hit the stub.
const cmdMatch = /^"([^"]+)"\s*(.*)$/.exec(openCommand) || [];
const registeredExe = cmdMatch[1] || null;
const registeredArgs = cmdMatch[2] || null;
const registeredExeExists = registeredExe ? fs.existsSync(registeredExe) : false;
const registeredExeName = registeredExe ? path.basename(registeredExe) : null;

// --- 2. running Zalo processes ----------------------------------------------
const procJson = ps(
  `$p = Get-Process -Name Zalo,sl -ErrorAction SilentlyContinue; ` +
  `if ($null -eq $p) { '[]' } else { ` +
  `$p | Select-Object Id,ProcessName,@{n='Path';e={$_.Path}},@{n='MainWindowHandle';e={$_.MainWindowHandle}},@{n='Responding';e={$_.Responding}} | ConvertTo-Json -Compress }`
);
let procs = [];
try { procs = JSON.parse(procJson); } catch { procs = { parse_error: procJson }; }
if (!Array.isArray(procs)) procs = [procs];

// Also record total process count by name, so "a second instance appeared" is
// measurable even if its main window handle is 0.
const zaloCount = procs.filter((p) => p && p.ProcessName === 'Zalo').length;
const stubCount = procs.filter((p) => p && p.ProcessName === 'sl').length;

// --- 3. install fingerprint --------------------------------------------------
// `root` is an EXTRACTED asar (no app.asar inside it). The real file lives next
// to the versioned Zalo.exe, which we take from the running process list.
const runningExe = (procs.find((p) => p && p.ProcessName === 'Zalo' && p.Path) || {}).Path || null;
const asarPath = runningExe ? path.join(path.dirname(runningExe), 'resources', 'app.asar') : null;
const asarExists = asarPath ? fs.existsSync(asarPath) : false;
const out = {
  label,
  at: new Date().toISOString(),
  scheme: {
    keyPath,
    keyExists: keyExists === 'YES',
    openCommand,
    delegateExecuteIsAbsent: delegateExecute === 'NONE',
    registeredExeName,
    registeredExeExists,
    registeredArgs,
  },
  processes: {
    zaloCount,
    stubCount,
    rows: procs.map((p) => ({
      pid: p && p.Id,
      name: p && p.ProcessName,
      // Path is an install location, not PII.
      path: p && p.Path,
      mainWindowHandle: p && p.MainWindowHandle,
      responding: p && p.Responding,
    })),
  },
  install: {
    asarPath,
    asarExists,
    asarSha256: asarExists ? sha256File(asarPath) : null,
    asarBytes: asarExists ? fs.statSync(asarPath).size : null,
  },
};

const json = JSON.stringify(out, null, 2);
console.log(json);
const dest = path.join('reports', 'executed', `r11b-preflight-${label}.json`);
fs.writeFileSync(dest, json, 'utf8');
console.error(`\nwritten: ${dest}`);
