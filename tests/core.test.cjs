const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extension/core.js');
const manifest = require('../extension/manifest.json');

test('accepts Instagram usernames and rejects URLs, reserved pages and invalid input', () => {
  assert.equal(core.username(' @Example.User_1 '), 'example.user_1');
  for (const value of ['', 'https://instagram.com/example/', '../accounts', 'explore', 'a b', 'a'.repeat(31)]) {
    assert.equal(core.username(value), null, value);
  }
});

test('distinguishes following from followers and off-site links', () => {
  assert.equal(core.followingFromURL('https://www.instagram.com/Example/following/?x=1'), 'example');
  assert.equal(core.profileFromURL('/someone/'), 'someone');
  for (const url of [
    'https://www.instagram.com/example/followers/',
    'https://instagram.com.evil.test/example/following/',
    'https://evil.test/example/following/',
    'https://www.instagram.com/accounts/following/',
    'http://www.instagram.com/example/following/'
  ]) assert.equal(core.followingFromURL(url), null, url);
});

test('exports Unicode, quotes, commas and multiline names without breaking CSV cells', () => {
  const csv = core.toCSV([{ username: 'example', displayName: 'Renée, "Hello"\n世界', collectedAt: '2026-10-19T12:00:00Z' }], 'target');
  assert.ok(csv.startsWith('\ufeff"source_account","username","display_name","profile_url","collected_at"\r\n'));
  assert.ok(csv.includes('"Renée, ""Hello""\n世界"'));
  assert.ok(csv.includes('"https://www.instagram.com/example/"'));
  assert.ok(csv.endsWith('\r\n'));
});

test('neutralizes formula injection before spreadsheet import', () => {
  for (const value of ['=IMPORTXML("https://example.com")', '+SUM(1)', '-1+1', '@SUM(1)', '   =1', '\tcommand', '\rcommand', '\ncommand']) {
    assert.ok(core.csvCell(value).startsWith('"\''), value);
  }
  assert.equal(core.csvCell('A normal name'), '"A normal name"');
});

test('export excludes malformed usernames and cannot change the profile hostname', () => {
  const csv = core.toCSV([{ username: 'bad/path' }, { username: 'OK.name', displayName: 'Hello' }], 'target');
  assert.equal(csv.split('\r\n').length, 3);
  assert.ok(csv.includes('https://www.instagram.com/ok.name/'));
  assert.ok(!csv.includes('bad/path'));
});

test('extension uses only temporary active-tab access and contains no remote scripts', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting']);
  assert.equal(manifest.host_permissions, undefined);
  const fs = require('node:fs');
  const path = require('node:path');
  const popup = fs.readFileSync(path.join(__dirname, '../extension/popup.html'), 'utf8');
  assert.ok(!/<script[^>]+src=["']https?:/.test(popup));
});
