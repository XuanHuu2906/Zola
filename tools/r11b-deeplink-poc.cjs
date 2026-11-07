#!/usr/bin/env node
/**
 * R11B — Companion deep-link PoC (plan §B.3).
 *
 * Sends ONE `zalo://conversation/?phone=...` invocation through the OS-registered
 * scheme and measures what happened. It never sends a message, never reads
 * conversation content, never writes to the Zalo install.
 *
 * PRIVACY CONTRACT (enforced below, not just documented):
 *   - The phone number is read from an interactive prompt. It is NOT accepted
 *     from argv, NOT read from a file/env var, and NOT written to any output.
 *   - It is NOT hashed into the evidence either. Phone numbers are ~10 digits,
 *     i.e. ~33 bits: any hash we publish would be brute-forced in seconds. So
 *     the evidence records only the digit count.
 *   - Window titles are NOT recorded for the same reason: a Zalo window title
 *     contains the contact name, and names are low entropy.
 *   - No screenshot is taken. Screen recording requires separate permission and
 *     is not implemented here.
 *
 * AC2 (correct conversation opened) cannot be proven mechanically without
 * reading the window title, so it is recorded as a USER ATTESTATION obtained
 * after the run, and is labelled as such in the report.
 *
 * Usage:  node tools\r11b-deeplink-poc.cjs [--runs N]
 *         (run it yourself in a real console — do not paste the number to anyone)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const RUNS = (() => {
  const i = process.argv.indexOf('--runs');
  const n = i >= 0 ? Number(process.argv[i + 1]) : 3;
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : 3;
})();

// Refuse to accept the number as an argument — that would put it in shell
// history and in process listings.
if (process.argv.slice(2).some((a) => !a.startsWith('--') && /\d{6,}/.test(a))) {
  console.error('Refusing: the test number must not be passed as an argument.');
  console.error('Run the tool and type it at the prompt instead.');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// hidden prompt
// ---------------------------------------------------------------------------
function promptHidden(label) {
  return new Promise((resolve, reject) => {
    process.stderr.write(label);
    if (!process.stdin.isTTY) {
      // No console to mute; read a line but never echo it to any output.
      const rl = require('readline').createInterface({ input: process.stdin, output: process.stderr });
      rl.once('line', (line) => { rl.close(); process.stderr.write('\n'); resolve(line); });
      rl.once('error', reject);
      return;
    }
    let buf = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stderr.write('\n');
          resolve(buf);
          return;
        }
        if (c === '') { // Ctrl-C
          process.stdin.setRawMode(false);
          process.stderr.write('\n');
          process.exit(130);
        }
        if (c === '' || c === '\b') {
          if (buf.length) { buf = buf.slice(0, -1); process.stderr.write('\b \b'); }
          continue;
        }
        if (c >= ' ') { buf += c; process.stderr.write('*'); }
      }
    };
    process.stdin.on('data', onData);
  });
}

// ---------------------------------------------------------------------------
// measurement helpers
// ---------------------------------------------------------------------------
function ps(script, timeout = 30000) {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', timeout, windowsHide: true,
    }).trim();
  } catch (e) {
    return `ERR:${e.message}`;
  }
}

// One PowerShell round-trip that returns process rows + foreground pid, so the
// poll interval actually measures Zalo and not PowerShell startup.
const SNAPSHOT_PS = `
Add-Type -Namespace W -Name U -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
'@ -ErrorAction SilentlyContinue
$fg = [W.U]::GetForegroundWindow()
$fgPid = 0
if ($fg -ne [System.IntPtr]::Zero) { $null = [W.U]::GetWindowThreadProcessId($fg, [ref]$fgPid) }
$rows = @(Get-Process -Name Zalo,sl -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{ pid = $_.Id; name = $_.ProcessName; path = $_.Path; hwnd = $_.MainWindowHandle }
})
[pscustomobject]@{ foregroundPid = [int]$fgPid; rows = $rows } | ConvertTo-Json -Compress -Depth 5
`;

// A failed snapshot must never be indistinguishable from "no Zalo processes":
// silently returning [] would turn a broken measurement into a fake FAIL.
function snapshot() {
  const started = process.hrtime.bigint();
  const raw = ps(SNAPSHOT_PS);
  const latencyMs = Number((process.hrtime.bigint() - started) / 1000000n);
  if (raw.startsWith('ERR:')) {
    return { ok: false, foregroundPid: 0, rows: [], latencyMs, error: raw.slice(0, 200) };
  }
  try {
    const o = JSON.parse(raw);
    const rows = Array.isArray(o.rows) ? o.rows : (o.rows ? [o.rows] : []);
    return { ok: true, foregroundPid: o.foregroundPid || 0, rows, latencyMs };
  } catch {
    return { ok: false, foregroundPid: 0, rows: [], latencyMs, error: `unparsable: ${raw.slice(0, 200)}` };
  }
}

function stats(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, minMs: s[0], medianMs: s[Math.floor(s.length / 2)], maxMs: s[s.length - 1] };
}

const VERSIONED_RE = /[\\/]Zalo-[^\\/]+[\\/]Zalo\.exe$/i;
const SHIM_RE = /[\\/]sl\.exe$/i;

function classify(rows) {
  const stub = []; const versioned = []; const shim = []; const visible = [];
  for (const r of rows) {
    if (!r) continue;
    // Visibility does not depend on being able to read the path: a process we
    // cannot query is still a Zalo-family window if it has a handle.
    if (r.hwnd && r.hwnd !== 0) visible.push(r.pid);
    if (!r.path) continue;
    if (SHIM_RE.test(r.path)) shim.push(r.pid);
    else if (VERSIONED_RE.test(r.path)) versioned.push(r.pid);
    else stub.push(r.pid);
  }
  return { stubPids: stub, versionedPids: versioned, shimPids: shim, visiblePids: visible };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
(async () => {
  console.error('R11B Companion deep-link PoC — read-only observation, no message is sent.\n');

  const phoneRaw = await promptHidden('Test conversation phone (hidden, never stored): ');
  const digits = String(phoneRaw).replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    console.error(`\nRejected: expected 8-15 digits, got ${digits.length}. Nothing was launched.`);
    process.exit(2);
  }

  // Locate the running install (for the AC4 hash) without touching the phone.
  const base = snapshot();
  const somePath = (base.rows.find((r) => r && r.path && VERSIONED_RE.test(r.path)) || {}).path || null;
  const asarPath = somePath ? path.join(path.dirname(somePath), 'resources', 'app.asar') : null;
  const asarBefore = asarPath && fs.existsSync(asarPath) ? sha256File(asarPath) : null;
  const asarMtimeBefore = asarPath && fs.existsSync(asarPath) ? fs.statSync(asarPath).mtimeMs : null;

  const results = [];
  const uriShape = `zalo://conversation/?phone=<redacted:${digits.length} digits>`;
  const pollLatencies = [];
  let pollFailures = 0;
  let blockedReason = null;

  // If the observation channel is broken, launching anyway would produce a
  // "nothing happened" result that means nothing. Refuse instead.
  if (!base.ok) {
    blockedReason = `baseline snapshot failed: ${base.error}`;
    console.error(`\nBLOCKED: ${blockedReason}`);
    console.error('Nothing was launched.');
  }

  for (let run = 1; blockedReason === null && run <= RUNS; run++) {
    console.error(`\n--- run ${run}/${RUNS} ---`);
    const before = snapshot();
    pollLatencies.push(before.latencyMs);
    if (!before.ok) {
      pollFailures++;
      blockedReason = `pre-launch snapshot failed at run ${run}: ${before.error}`;
      console.error(`\nBLOCKED: ${blockedReason}`);
      break;
    }
    const beforePids = new Set(before.rows.map((r) => r.pid));
    const beforeVisible = new Set(classify(before.rows).visiblePids.map(String));
    const beforeCls = classify(before.rows);

    // Start-Process resolves the URI through ShellExecute, i.e. through
    // HKCU:\Software\Classes\zalo — exactly the mechanism under test. We
    // deliberately do NOT exec Zalo.exe ourselves.
    const t0 = process.hrtime.bigint();
    const launch = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Start-Process -FilePath '${uriShape.replace(/<redacted:[^>]*>/, digits)}'`,
    ], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    const launchMs = Number((process.hrtime.bigint() - t0) / 1000000n);

    // Poll for: a new process, a NEWLY visible Zalo window, and Zalo holding
    // the foreground. "Newly" matters — a window that was already up before
    // the launch proves nothing about this invocation.
    let firstNewProcessMs = null;
    let firstNewWindowMs = null;
    let firstForegroundMs = null;
    let peak = { stub: 0, versioned: 0, shim: 0, visible: 0 };
    let polls = 0;
    const seenNew = new Set();
    const seenNewVisible = new Set();
    let foregroundObserved = false;

    for (let i = 0; i < 100; i++) { // up to ~20 s
      await sleep(200);
      const s = snapshot();
      polls++;
      pollLatencies.push(s.latencyMs);
      if (!s.ok) { pollFailures++; continue; }
      const cls = classify(s.rows);
      const ms = Number((process.hrtime.bigint() - t0) / 1000000n);

      for (const r of s.rows) {
        if (r.pid && !beforePids.has(r.pid)) seenNew.add(`${r.pid}`);
      }
      for (const pid of cls.visiblePids) {
        if (!beforeVisible.has(String(pid))) seenNewVisible.add(String(pid));
      }
      if (firstNewProcessMs === null && seenNew.size) firstNewProcessMs = ms;
      if (firstNewWindowMs === null && seenNewVisible.size) firstNewWindowMs = ms;

      const fgIsZalo = s.foregroundPid > 0 && s.rows.some((r) => r.pid === s.foregroundPid);
      if (fgIsZalo) {
        foregroundObserved = true;
        // Foreground only counts as evidence if this invocation caused
        // something new; otherwise Zalo was simply already focused.
        if (firstForegroundMs === null && (seenNew.size || seenNewVisible.size)) firstForegroundMs = ms;
      }

      peak = {
        stub: Math.max(peak.stub, cls.stubPids.length),
        versioned: Math.max(peak.versioned, cls.versionedPids.length),
        shim: Math.max(peak.shim, cls.shimPids.length),
        visible: Math.max(peak.visible, cls.visiblePids.length),
      };

      // Stop early once we have the three signals.
      if (firstNewWindowMs !== null && firstForegroundMs !== null && seenNew.size) break;
    }

    const after = snapshot();
    pollLatencies.push(after.latencyMs);
    if (!after.ok) pollFailures++;
    const afterCls = classify(after.rows);

    results.push({
      run,
      launchExitCode: launch.status,
      launchStderr: (launch.stderr || '').slice(0, 400) || null,
      launchMs,
      uriShape,
      polls,
      newProcessSeen: seenNew.size > 0,
      newProcessCount: seenNew.size,
      firstNewProcessMs,
      newWindowObserved: seenNewVisible.size > 0,
      newWindowCount: seenNewVisible.size,
      firstNewWindowMs,
      foregroundMs: firstForegroundMs,
      foregroundObservedEver: foregroundObserved,
      peakStubCount: peak.stub,
      peakVersionedCount: peak.versioned,
      peakShimCount: peak.shim,
      peakVisibleCount: peak.visible,
      baselineStub: beforeCls.stubPids.length,
      baselineVersioned: beforeCls.versionedPids.length,
      baselineShim: beforeCls.shimPids.length,
      baselineVisible: beforeCls.visiblePids.length,
      afterVisible: after.ok ? afterCls.visiblePids.length : null,
    });

    // Return Zalo to the tray so the next run starts from the same state. This
    // calls the app's own window close, not a kill; Zalo keeps running.
    if (run < RUNS) {
      ps(`$w = (Get-Process -Name Zalo -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }); foreach ($p in $w) { $null = $p.CloseMainWindow() }`);
      await sleep(1500);
    }
  }

  // --- attestation (AC2/AC3 are human-observable facts) ---------------------
  console.error('\nLook at Zalo now.');
  const convAnswer = blockedReason === null
    ? (await promptHidden('Did the CORRECT test conversation open? [y/N]: ')).trim().toLowerCase()
    : 'n';
  const sentAnswer = blockedReason === null
    ? (await promptHidden('Did you send any message during this PoC? [y/N]: ')).trim().toLowerCase()
    : 'n';

  const asarAfter = asarPath && fs.existsSync(asarPath) ? sha256File(asarPath) : null;
  const asarMtimeAfter = asarPath && fs.existsSync(asarPath) ? fs.statSync(asarPath).mtimeMs : null;

  const evidence = {
    poc: 'R11B-companion-deeplink',
    at: new Date().toISOString(),
    host: { platform: process.platform, node: process.version },
    phone: { stored: false, digitCount: digits.length },
    invocation: 'ShellExecute via HKCU\\Software\\Classes\\zalo (Start-Process <uri>)',
    runs: results,
    userAttestation: {
      correctConversationOpened: convAnswer === 'y',
      anyMessageSent: sentAnswer === 'y',
      note: 'Human observation. Zalo window titles contain contact names, so they are deliberately not recorded.',
    },
    installIntegrity: {
      asarPath,
      asarSha256Before: asarBefore,
      asarSha256After: asarAfter,
      asarUnchanged: Boolean(asarBefore) && asarBefore === asarAfter,
      asarMtimeBefore,
      asarMtimeAfter,
      asarMtimeUnchanged: asarMtimeBefore === asarMtimeAfter,
    },
    screenshotsTaken: 0,
  };

  const json = JSON.stringify(evidence, null, 2);
  const dest = path.join('reports', 'executed', `r11b-deeplink-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, json, 'utf8');
  console.log(json);
  console.error(`\nwritten: ${dest}`);
})().catch((e) => { console.error('PoC error:', e && e.message); process.exit(1); });
