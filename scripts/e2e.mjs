#!/usr/bin/env node
// Real-browser run of the web UI against the real server, which serves the UI itself (server/src/index.js): scan, hostile record with visible hidden
// characters, rug-pull on the second scan, pipeline Simulate/Reset, keyboard-only navigation, dark and light screenshots.
//
//   npm run build          (once; the server serves web/dist)
//   npm run e2e            starts the server on E2E_PORT (default 5340), drives it, stops it
//   E2E_SHOTS=/some/dir    where screenshots go (default .data/e2e-screenshots, git-ignored)
//
// The demo stubs use fixed ports 5311-5315, so stop any other running mcp-discovery first. Uses the Chromium the
// installed Playwright resolves (`npx playwright install chromium` if missing). The run makes no outbound request.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.E2E_SHOTS || path.join(root, '.data', 'e2e-screenshots');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures += 1; };

const port = Number(process.env.E2E_PORT) || 5340;
const base = `http://127.0.0.1:${port}`;
if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) { console.error('Run `npm run build` first.'); process.exit(2); }
const env = { ...process.env, MCP_DISCOVERY_PORT: String(port) };
delete env.MCP_DISCOVERY_LIVE; // the e2e run is always demo mode
const server = spawn(process.execPath, ['server/src/index.js'], { cwd: root, env, stdio: 'inherit' });
let up = false;
for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`${base}/api/health`)).ok; } catch { await sleep(250); } }
if (!up) { server.kill(); console.error('server did not start'); process.exit(2); }
fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, colorScheme: 'light' });
  const external = []; const errors = []; const dialogs = [];
  page.on('request', (r) => { if (!r.url().startsWith(base) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
  const active = () => page.evaluate(() => `${document.activeElement?.tagName}|${document.activeElement?.textContent?.trim().slice(0, 40)}`);

  await page.goto(`${base}/`);
  await page.getByTestId('mode-badge').waitFor();
  check((await page.getByTestId('mode-badge').innerText()).includes('DEMO MODE'), 'header shows the DEMO MODE badge');
  check((await page.getByTestId('live-banner').count()) === 0, 'no live banner in demo mode');
  check((await page.locator('.empty').count()) === 1, 'inventory starts empty');

  // Keyboard only: skip link first, then Tab to Scan, press Enter.
  await page.keyboard.press('Tab');
  check((await active()).includes('Skip to content'), 'first Tab stop is the skip link');
  let reached = false;
  for (let i = 0; i < 12 && !reached; i++) { await page.keyboard.press('Tab'); reached = (await active()).endsWith('|Scan'); }
  check(reached, 'Tab reaches the Scan button');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-testid="scan-status"]').textContent.startsWith('Scan complete'));
  const status1 = await page.getByTestId('scan-status').innerText();
  check(/10 records/.test(status1) && /1 hostile/.test(status1), `scan announced in the live region: "${status1}"`);
  check((await page.getByTestId('scan-status').getAttribute('aria-live')) === 'polite', 'scan result region is aria-live');
  check((await page.locator('tbody tr').count()) === 10, 'ten inventory rows');

  const poisonRow = page.locator('tbody tr', { hasText: 'stub-poisoned' }).or(page.locator('tbody tr', { hasText: '5312' })).first();
  check((await poisonRow.innerText()).includes('hostile'), 'the poisoned server shows hostile');
  check((await page.locator('tbody [data-status="offline"]').count()) === 1, 'one offline server');
  check((await page.locator('tbody [data-status="degraded"]').count()) === 1, 'one degraded (auth) server');
  check((await page.getByTestId('rugpull').count()) === 0, 'first scan has no rug-pull');
  check((await page.getByText('First scan: this is the baseline').count()) === 1, 'first scan says baseline');

  // Keyboard-only: Tab on to the poisoned record's button and open it with Enter.
  let focusedRecord = false;
  for (let i = 0; i < 40 && !focusedRecord; i++) { await page.keyboard.press('Tab'); focusedRecord = (await active()).includes('node 5312'); }
  check(focusedRecord, 'Tab reaches the poisoned record button');
  await page.keyboard.press('Enter');
  const dlg = page.getByRole('dialog');
  await dlg.getByText('Findings (3)').waitFor();
  check(await dlg.locator('#drawer-title').evaluate((el) => el === document.activeElement), 'drawer heading receives focus');
  const chips = await dlg.locator('.chip').allInnerTexts();
  check(chips.includes('[U+200B]'), `hidden character is visible in the drawer: ${JSON.stringify(chips)}`);
  check((await dlg.locator('mark').count()) > 0, 'instruction-like text is marked');
  check((await dlg.innerText()).includes('<IMPORTANT>'), 'markup is shown as text');
  check((await dlg.locator('important').count()) === 0, 'no element was created from markup');
  await shot('1-scan-drawer-light');
  await page.keyboard.press('Escape');
  check((await page.getByRole('dialog').count()) === 0 && (await active()).includes('node 5312'), 'Escape closes the drawer and returns focus to the row');

  // Second scan: rug-pull.
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByTestId('rugpull').waitFor();
  const rug = await page.getByTestId('rugpull').innerText();
  check(/POSSIBLE RUG-PULL/.test(rug) && /before/i.test(rug) && /after/i.test(rug), 'second scan shows the rug-pull with before and after hashes');
  const hashes = await page.getByTestId('rugpull').locator('dd').allInnerTexts();
  check(hashes.length === 2 && hashes[0] !== hashes[1] && /^[0-9a-f]{12}$/.test(hashes[0]), `hashes differ: ${hashes.join(' -> ')}`);
  check((await page.getByTestId('scan-status').innerText()).includes('Possible rug-pull'), 'rug-pull announced in the live region');
  await shot('2-rugpull-light');
  await page.getByRole('button', { name: /Switch to dark theme/ }).click();
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'theme toggles to dark');
  await shot('3-rugpull-dark');

  // Pipeline
  await page.getByRole('button', { name: 'Pipeline' }).click();
  await page.locator('.react-flow__node').first().waitFor();
  check((await page.locator('.react-flow__node').count()) === 9, 'nine diagram boxes');
  const node = page.locator('.react-flow__node', { hasText: 'Probe' }).first();
  const before = await node.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down(); await page.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2 + 80, { steps: 6 }); await page.mouse.up();
  const after = await node.boundingBox();
  check(Math.abs(after.x - before.x) > 20 || Math.abs(after.y - before.y) > 20, 'a box can be dragged');
  await page.getByLabel('Speed').selectOption('4');
  await page.getByRole('button', { name: 'Simulate' }).click();
  await page.getByTestId('caption').filter({ hasText: 'Step 1 of 5' }).waitFor();
  check((await page.locator('.fbox.on').count()) > 0, 'Simulate highlights boxes');
  await page.getByTestId('caption').filter({ hasText: 'Step 5 of 5' }).waitFor({ timeout: 8000 });
  const cap = await page.getByTestId('caption').innerText();
  check(/rug-pull/i.test(cap), `final step reflects the real scan: "${cap}"`);
  await shot('4-pipeline-dark');
  await page.getByRole('button', { name: 'Reset diagram' }).click();
  check((await page.getByTestId('caption').innerText()).includes('Press Simulate') && (await page.locator('.fbox.on').count()) === 0, 'diagram Reset clears the highlight');
  await page.getByRole('button', { name: /Switch to light theme/ }).click();
  await shot('5-pipeline-light');

  // Reset
  await page.getByRole('button', { name: 'Inventory' }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByText('Inventory is empty').waitFor();
  check(true, 'Reset empties the inventory');
  await page.getByRole('button', { name: 'Scan' }).click();
  await page.getByText('First scan: this is the baseline').waitFor();
  check((await page.getByTestId('rugpull').count()) === 0, 'after Reset, scan is a fresh baseline (rug-pull restarted)');

  // Narrow viewport
  await page.setViewportSize({ width: 390, height: 800 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal page scroll at phone width');
  await shot('6-phone');

  check(external.length === 0, `no request left the origin ${JSON.stringify(external)}`);
  check(errors.length === 0, `no page or console errors ${JSON.stringify(errors)}`);
  check(dialogs.length === 0, 'no JavaScript dialog fired');
} catch (e) {
  console.error(e); failures += 1;
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
console.log(`screenshots: ${shots}`);
process.exit(failures ? 1 : 0);
