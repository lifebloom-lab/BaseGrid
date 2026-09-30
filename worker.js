/** Cloudflare entry point. Keep the relay contract in sync with server.py. */
const UPSTREAM = 'https://api.lastwar.tools';
const MAX_RESPONSE = 2 * 1024 * 1024;
const ERROR_STATUSES = new Set([401, 402, 403, 404, 422, 429, 503, 504]);

function jsonResponse(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-BaseGrid-Relay': '1',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function upstreamPath(path) {
  let match = /^\/api\/lastwar\/rankings\/([1-9][0-9]{0,9})\/alliances$/.exec(path);
  if (match) return `/rankings/${match[1]}/alliances?limit=200`;
  match = /^\/api\/lastwar\/alliance\/([a-fA-F0-9]{32})\/members$/.exec(path);
  if (match) return `/alliance/${match[1].toLowerCase()}/members?sort_by=power&descending=true`;
  return null;
}

async function readJson(response) {
  if (Number(response.headers.get('Content-Length')) > MAX_RESPONSE) {
    await response.body?.cancel();
    throw new RangeError('Response too large');
  }
  if (!response.body) throw new Error('Empty response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE) {
        await reader.cancel();
        throw new RangeError('Response too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

// Dependencies can be replaced in tests without making paid provider requests.
export function createWorker({ fetchImpl = (...args) => fetch(...args), timeoutMs = 90_000 } = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      if (request.method !== 'GET') {
        return jsonResponse(405, { error: 'Only GET requests are accepted' }, { Allow: 'GET' });
      }
      const origin = request.headers.get('Origin');
      if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || (origin && origin !== url.origin)) {
        return jsonResponse(403, { error: 'Cross-origin requests are not accepted' });
      }
      const path = upstreamPath(url.pathname);
      if (!path || url.search) return jsonResponse(404, { error: 'Unsupported import request' });
      const key = (request.headers.get('X-API-Key') || '').trim();
      if (!key || key.length > 1024) return jsonResponse(401, { error: 'An API key is required' });

      const controller = new AbortController();
      const abort = () => controller.abort();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort();
      try {
        controller.signal.throwIfAborted();
        const response = await fetchImpl(UPSTREAM + path, {
          method: 'GET',
          headers: { 'X-API-Key': key, Accept: 'application/json', 'User-Agent': 'BaseGrid/1.0' },
          redirect: 'manual', // Never send the key to a redirect destination.
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          await response.body?.cancel();
          return jsonResponse(ERROR_STATUSES.has(response.status) ? response.status : 502,
            { error: 'LastWarTools request failed' });
        }
        return jsonResponse(200, await readJson(response));
      } catch (error) {
        if (timedOut) return jsonResponse(504, { error: 'Upstream request timed out' });
        if (request.signal.aborted) return jsonResponse(499, { error: 'Import cancelled' });
        return jsonResponse(502, { error: error instanceof RangeError
          ? 'Upstream response is too large' : 'Upstream service unavailable' });
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener('abort', abort);
      }
    },
  };
}

export default createWorker();
