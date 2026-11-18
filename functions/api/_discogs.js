import { getDiscogsHeaders } from './_common.js';

const API_BASE = 'https://api.discogs.com';
const responseCache = new Map();
const CACHE_TTL = 12 * 60 * 1000;
const MAX_ENTRIES = 180;

// Cache działa w ciepłej instancji Worker; w nowych instancjach może być pusty.
// Brak automatycznego retry 429: ponowne próby pogarszały blokadę Discogs.
export async function discogsFetch(env, path, params = {}) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  const key = url.toString();
  const cached = responseCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;

  let response;
  try {
    response = await fetch(url, { headers: getDiscogsHeaders(env) });
  } catch {
    const error = new Error('Nie można połączyć się z Discogs. Skorzystaj z trybu ręcznego.');
    error.status = 503;
    error.code = 'DISCOGS_UNAVAILABLE';
    throw error;
  }

  const body = await response.text();
  let data;
  try { data = body ? JSON.parse(body) : {}; } catch { data = { message: body.slice(0, 220) }; }

  if (!response.ok) {
    const sourceMessage = String(data.message || `Discogs HTTP ${response.status}`);
    const rateLimited = response.status === 429 || /making requests too quickly|rate.?limit|too many requests/i.test(sourceMessage);
    const retryHeader = Number.parseInt(response.headers.get('retry-after') || '', 10);
    const error = new Error(rateLimited
      ? 'Discogs ogranicza dostęp do API. Przejdź do „Ręcznie”, aby normalnie dodawać albumy.'
      : `Błąd Discogs: ${sourceMessage}`);
    error.status = rateLimited ? 429 : response.status;
    error.code = rateLimited ? 'DISCOGS_RATE_LIMIT' : 'DISCOGS_ERROR';
    error.retryAfter = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : 90;
    error.data = { status: response.status, remaining: response.headers.get('x-discogs-ratelimit-remaining') };
    throw error;
  }

  if (responseCache.size >= MAX_ENTRIES) responseCache.clear();
  responseCache.set(key, { data, expires: Date.now() + CACHE_TTL });
  return data;
}

export function discogsErrorResponse(error, json) {
  return json({
    ok: false,
    code: error.code || 'DISCOGS_ERROR',
    message: error.message || 'Błąd pobierania danych z Discogs.',
    retryAfter: error.code === 'DISCOGS_RATE_LIMIT' ? error.retryAfter : undefined
  }, error.status || 502);
}
