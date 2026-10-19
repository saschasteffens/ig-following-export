const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { html } = require('./fixtures.cjs');
let browser;

before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
});
after(async () => { await browser?.close(); });

async function setup(url = 'https://www.instagram.com/target/following/') {
  const context = await browser.newContext({ acceptDownloads: true });
  const target = await context.newPage();
  await target.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await target.goto(url);
  for (const file of ['core.js', 'collector.js']) await target.addScriptTag({path: path.join(__dirname, '../extension', file)});
  const popup = await context.newPage();
  await popup.exposeFunction('relayToTab', message => target.evaluate(message => new Promise(resolve => messageHandler(message, {}, resolve)), message));
  await popup.addInitScript(url => {
    globalThis.chrome = {
      tabs: {
        query: async () => [{ id: 1, url }],
        sendMessage: async (_id, message) => globalThis.relayToTab(message),
        create: async options => { globalThis.openedProfile = options.url; }
      },
      scripting: { executeScript: async () => [] }
    };
    // Keep the popup page open so the test can inspect the selected profile.
    window.close = () => {};
  }, url);
  await popup.route('https://extension.test/**', async route => {
    const file = new URL(route.request().url()).pathname.slice(1) || 'popup.html';
    const contentType = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8';
    await route.fulfill({ contentType, body: await fs.readFile(path.join(__dirname, '../extension', file)) });
  });
  await popup.goto('https://extension.test/popup.html');
  return { context, target, popup };
}

test('popup starts and pauses a collection, then downloads a CSV with the real collected rows', async () => {
  const { context, popup } = await setup();
  const errors = [];
  popup.on('pageerror', error => errors.push(error.message));
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'ig-download-test-'));
  try {
    await popup.locator('#start').click();
    await popup.waitForFunction(() => document.querySelector('#count').textContent === '3');
    await popup.locator('#stop').click();
    await popup.waitForFunction(() => document.querySelector('#badge').textContent === 'Paused');
    const downloadPromise = popup.waitForEvent('download');
    await popup.locator('#download').click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^target-following-\d{4}-\d{2}-\d{2}\.csv$/);
    const downloaded = path.join(output, 'following.csv');
    await download.saveAs(downloaded);
    const csv = await fs.readFile(downloaded, 'utf8');
    assert.ok(csv.startsWith('\ufeff'));
    assert.ok(csv.includes('"target","alpha","Alice, ""A"""'));
    assert.ok(csv.includes('"beta","Renée 世界"'));
    assert.ok(csv.includes('"gamma","\'=1+1"'));
    assert.equal(csv.split('\r\n').length, 5);
    assert.deepEqual(errors, []);
    await popup.screenshot({ path: path.join(output, 'popup.png') });
  } finally { await context.close(); await fs.rm(output, {recursive: true, force: true}); }
});

test('a start error keeps Start enabled so the user can correct the open list and retry', async () => {
  const { context, target, popup } = await setup('https://www.instagram.com/target/followers/');
  try {
    await popup.locator('#start').click();
    await popup.waitForFunction(() => document.querySelector('#status').textContent.includes('Followers'));
    assert.equal(await popup.locator('#start').isEnabled(), true);
    await target.evaluate(() => history.replaceState({}, '', '/target/following/'));
    await popup.locator('#start').click();
    await popup.waitForFunction(() => document.querySelector('#badge').textContent === 'Collecting');
    assert.equal(await popup.locator('#download').isEnabled(), true);
  } finally { await context.close(); }
});

test('opens only a validated Instagram profile', async () => {
  const { context, popup } = await setup();
  try {
    await popup.locator('#username').fill('https://evil.test');
    await popup.locator('button[type=submit]').click();
    assert.equal(await popup.evaluate(() => globalThis.openedProfile), undefined);
    await popup.locator('#username').fill('@Example.Name');
    await popup.locator('button[type=submit]').click();
    await popup.waitForFunction(() => globalThis.openedProfile);
    assert.equal(await popup.evaluate(() => globalThis.openedProfile), 'https://www.instagram.com/example.name/');
  } finally { await context.close(); }
});
