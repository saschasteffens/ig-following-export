const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
const { html, row } = require('./fixtures.cjs');
let browser;

before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
});
after(async () => { await browser?.close(); });

async function fixture(url = 'https://www.instagram.com/target/following/') {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(url);
  await page.addScriptTag({ path: path.join(__dirname, '../extension/core.js') });
  await page.addScriptTag({ path: path.join(__dirname, '../extension/collector.js') });
  return page;
}
async function command(page, command) {
  return page.evaluate(command => new Promise(resolve => {
    globalThis.messageHandler({ app: 'following-export', command }, {}, resolve);
  }), command);
}

test('collects a rendered list, deduplicates avatar/name links and loads new rows by scrolling', async () => {
  const page = await fixture();
  try {
    assert.equal((await command(page, 'start')).count, 2);
    await page.waitForFunction(() => document.querySelector('a[href="/gamma/"]'));
    await page.waitForFunction(() => {
      let state; messageHandler({app:'following-export',command:'status'}, {}, s => { state = s; });
      return state.count === 3;
    });
    const result = await command(page, 'export');
    assert.deepEqual(result.accounts.map(a => a.username), ['alpha', 'beta', 'gamma']);
    assert.equal(result.source, 'target');
    assert.equal(result.accounts[0].displayName, 'Alice, "A"');
    assert.equal(result.accounts[1].displayName, 'Renée 世界');
    assert.equal(result.accounts[2].displayName, '=1+1');
    assert.ok(result.accounts.every(a => !Number.isNaN(Date.parse(a.collectedAt))));
  } finally { await page.close(); }
});

test('refuses Followers lists and missing dialogs', async () => {
  const page = await fixture('https://www.instagram.com/target/followers/');
  try {
    assert.match((await command(page, 'start')).error, /Followers/);
    assert.equal((await command(page, 'export')).count, 0);
    await page.evaluate(() => { history.replaceState({}, '', '/target/following/'); document.querySelector('[role=dialog]').remove(); });
    assert.match((await command(page, 'start')).error, /isn’t open/);
  } finally { await page.close(); }
});

test('pauses and resumes without losing collected accounts, then clears explicitly', async () => {
  const page = await fixture();
  try {
    await command(page, 'start');
    const stopped = await command(page, 'stop');
    assert.equal(stopped.status, 'paused');
    await page.evaluate(row => document.querySelector('.list').insertAdjacentHTML('beforeend', row), row('delta', 'New after pause'));
    assert.equal((await command(page, 'status')).count, stopped.count);
    assert.equal((await command(page, 'start')).count, stopped.count + 1);
    assert.equal((await command(page, 'clear')).count, 0);
    assert.deepEqual((await command(page, 'export')).accounts, []);
  } finally { await page.close(); }
});

test('changing profiles pauses collection and cannot silently overwrite previous results', async () => {
  const page = await fixture();
  try {
    await command(page, 'start');
    await page.evaluate(() => history.replaceState({}, '', '/different/following/'));
    await page.waitForFunction(() => {
      let state; messageHandler({app:'following-export',command:'status'}, {}, s => { state = s; });
      return state.status === 'paused';
    });
    assert.match((await command(page, 'start')).error, /Download them/);
    assert.equal((await command(page, 'export')).source, 'target');
  } finally { await page.close(); }
});

test('stops after repeated empty scrolls and reports a limited result rather than claiming completeness', async () => {
  const page = await fixture();
  try {
    await page.clock.install();
    await command(page, 'start');
    // Paused virtual time; no real waiting for the no-growth timeout.
    await page.clock.runFor(25000);
    const result = await command(page, 'status');
    assert.equal(result.status, 'finished');
    assert.match(result.message, /may limit/);
    assert.ok(result.count >= 2);
  } finally { await page.close(); }
});

test('an Instagram notice stops automatic scrolling and preserves partial results', async () => {
  const page = await fixture();
  try {
    await page.clock.install();
    await command(page, 'start');
    await page.evaluate(() => document.querySelector('[role=dialog]').insertAdjacentHTML('afterbegin', '<div role="alert">Try again later</div>'));
    await page.clock.runFor(1600);
    const result = await command(page, 'status');
    assert.equal(result.status, 'paused');
    assert.match(result.message, /notice/);
    assert.ok(result.count >= 2);
  } finally { await page.close(); }
});

test('injecting the extension a second time retains the existing session', async () => {
  const page = await fixture();
  try {
    await command(page, 'start');
    await command(page, 'stop');
    const before = await command(page, 'export');
    await page.addScriptTag({ path: path.join(__dirname, '../extension/collector.js') });
    assert.deepEqual(await command(page, 'export'), before);
  } finally { await page.close(); }
});
