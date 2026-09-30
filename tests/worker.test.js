import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../worker.js';
import { fetchAlliances, fetchMembers } from '../lastwar-api.js';

const base = 'https://basegrid.example';
const id = 'a'.repeat(32);
const route = '/api/lastwar/rankings/1234/alliances';
const request = (path = route, options = {}) => new Request(base + path, {
  headers: { 'X-API-Key': 'test-key' }, ...options,
});

test('Cloudflare serves frontend requests through the asset binding without calling the provider', async () => {
  const worker = createWorker({ fetchImpl: () => assert.fail('Unexpected provider request') });
  for (const path of ['/', '/styles.css', '/ui.js', '/missing']) {
    const req = request(path);
    const expected = new Response('asset', { status: path === '/missing' ? 404 : 200 });
    assert.equal(await worker.fetch(req, { ASSETS: { fetch: received => {
      assert.equal(received, req);
      return expected;
    } } }), expected);
  }
});

test('Cloudflare import works with the existing client and preserves HQ and group metadata', async () => {
  const calls = [];
  const worker = createWorker({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return Response.json(url.includes('/rankings/')
      ? [{ id, abbr: 'BG', name: 'BaseGrid', member_count: 1 }]
      : { alliance_id: id, member_count: 1, members: [
        { uid: '1', name: 'Alice', hq_level: 35, rank: 4, power: 1000, server_id: 1234 },
      ] });
  } });
  const options = { apiKey: ' test-key ', fetchImpl: (path, init) => worker.fetch(request(path, init)) };
  const alliances = await fetchAlliances(1234, options);
  assert.equal(alliances[0].tag, 'BG');
  const players = await fetchMembers(id.toUpperCase(), options);
  assert.equal(players[0].hqLevel, 35);
  assert.equal(players[0].group, 4);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.lastwar.tools/rankings/1234/alliances?limit=200');
  assert.equal(calls[1].url, `https://api.lastwar.tools/alliance/${id}/members?sort_by=power&descending=true`);
  for (const { url, options: sent } of calls) {
    assert.ok(!url.includes('test-key'));
    assert.equal(sent.headers['X-API-Key'], 'test-key');
    assert.equal(sent.method, 'GET');
    assert.equal(sent.redirect, 'manual');
    assert.equal(sent.cache, 'no-store');
  }
});

test('Cloudflare rejects invalid routes, queries, methods, origins and keys before any provider call', async () => {
  const worker = createWorker({ fetchImpl: () => assert.fail('Unexpected provider request') });
  const cases = [
    [request('/api/lastwar/https://other.example'), 404],
    [request('/api/lastwar/auth/sessions'), 404],
    [request('/api/lastwar/rankings/0/alliances'), 404],
    [request('/api/lastwar/rankings/10000000000/alliances'), 404],
    [request('/api/lastwar/alliance/not-an-id/members'), 404],
    [request(route + '?api_key=secret'), 404],
    ...['POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'].map(method => [request(route, { method }), 405]),
    [request(route, { headers: { 'X-API-Key': 'key', Origin: 'https://other.example' } }), 403],
    [request(route, { headers: { 'X-API-Key': 'key', 'Sec-Fetch-Site': 'cross-site' } }), 403],
    [request(route, { headers: {} }), 401],
    [request(route, { headers: { 'X-API-Key': ' ' } }), 401],
    [request(route, { headers: { 'X-API-Key': 'x'.repeat(1025) } }), 401],
  ];
  for (const [req, status] of cases) {
    const response = await worker.fetch(req);
    assert.equal(response.status, status, `${req.method} ${req.url}`);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-BaseGrid-Relay'), '1');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
});

test('same-origin request succeeds without forwarding cookies or arbitrary headers', async () => {
  const worker = createWorker({ fetchImpl: async (_, options) => {
    assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'User-Agent', 'X-API-Key']);
    return Response.json([]);
  } });
  const response = await worker.fetch(request(route, { headers: {
    Origin: base, 'X-API-Key': 'key', Cookie: 'session=private', Authorization: 'private',
  } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-BaseGrid-Relay'), '1');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
});

test('provider errors and redirects never expose bodies, headers, or a new destination', async () => {
  for (const status of [301, 302, 307, 308, 400, 401, 402, 403, 404, 422, 429, 500, 503, 504]) {
    let calls = 0;
    let cancelled = false;
    const worker = createWorker({ fetchImpl: async () => {
      calls++;
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
        status, headers: { Location: 'https://other.example/secret', 'Set-Cookie': 'secret' },
      });
    } });
    const response = await worker.fetch(request());
    assert.equal(response.status, [401, 402, 403, 404, 422, 429, 503, 504].includes(status) ? status : 502);
    assert.equal(await response.text(), '{"error":"LastWarTools request failed"}');
    assert.equal(response.headers.get('Location'), null);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal(calls, 1);
    assert.ok(cancelled);
  }
});

test('oversized bodies are bounded even without Content-Length', async () => {
  for (const announced of [true, false]) {
    let cancelled = false;
    const worker = createWorker({ fetchImpl: async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    }), { headers: announced ? { 'Content-Length': String(3 * 1024 * 1024) } : {} }) });
    const response = await worker.fetch(request());
    assert.equal(response.status, 502);
    assert.match(await response.text(), /too large/);
    assert.ok(cancelled);
  }
});

test('invalid JSON and network errors are sanitized', async () => {
  for (const fetchImpl of [
    async () => new Response('private provider error'),
    async () => { throw new TypeError('private network detail'); },
    async () => new Response(null, { status: 204 }),
  ]) {
    const response = await createWorker({ fetchImpl }).fetch(request());
    assert.equal(response.status, 502);
    assert.equal(await response.text(), '{"error":"Upstream service unavailable"}');
  }
});

const stalled = async (_, { signal }) => new Promise((resolve, reject) => {
  const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
});

test('provider timeout aborts the request and returns a useful status', async () => {
  const response = await createWorker({ fetchImpl: stalled, timeoutMs: 5 }).fetch(request());
  assert.equal(response.status, 504);
});

test('closing the client request cancels the upstream request', async () => {
  const controller = new AbortController();
  const pending = createWorker({ fetchImpl: stalled }).fetch(request(route, { signal: controller.signal }));
  controller.abort();
  assert.equal((await pending).status, 499);
});

test('an already cancelled request spends no provider call', async () => {
  const controller = new AbortController();
  controller.abort();
  const response = await createWorker({ fetchImpl: () => assert.fail('Unexpected request') })
    .fetch(request(route, { signal: controller.signal }));
  assert.equal(response.status, 499);
});
