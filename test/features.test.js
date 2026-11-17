const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml } = require('../src/utils/html');

test('escapeHtml neutralises markup in pharmacy names', () => {
  assert.equal(escapeHtml('<img src=x onerror=1>"&\''), '&lt;img src=x onerror=1&gt;&quot;&amp;&#39;');
  assert.equal(escapeHtml(null), '');
});

test('public pharmacy page: bad id is a 404 and never throws', async () => {
  process.env.NODE_ENV = 'test';
  const app = require('../src/app');
  const server = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/p/not-an-id`);
    assert.equal(r.status, 404);
    assert.match(await r.text(), /NOT FOUND/);
  } finally { server.close(); }
});
