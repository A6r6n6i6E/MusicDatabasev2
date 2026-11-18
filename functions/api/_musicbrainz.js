const MB_BASE = 'https://musicbrainz.org/ws/2';
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_LIMIT = 240;
const memoryCache = new Map();
const inFlight = new Map();
let requestQueue = Promise.resolve();
let nextFetchAt = 0;
const MIN_INTERVAL_MS = 1250;

export const isMbid = (text) => MBID.test(String(text || ''));

export function musicBrainzHeaders(env = {}) {
  return {
    'User-Agent': String(env.MUSICBRAINZ_USER_AGENT || 'BibliotekaPlyt/10.0 (https://musicdatabase.pages.dev)'),
    Accept: 'application/json'
  };
}

export function lucenePhrase(input) {
  const text = String(input || '').replace(/[\\"\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  return `"${text}"`;
}

// Wildcards are useful for autocomplete: "Metall" -> Metallica, "Mast" -> Master.
// Keep all earlier words as separate field tokens; only the last one gets a prefix.
export function lucenePrefix(field, input) {
  const parts = String(input || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .trim().split(/\s+/).filter(Boolean).slice(0, 8);
  return parts.map((part, index) => `${field}:${part}${index === parts.length - 1 ? '*' : ''}`).join(' AND ');
}

// Serialize requests in each warm Worker isolate. MusicBrainz limits by source IP,
// so this is best effort (not a cross-datacenter global throttle).
async function scheduledFetch(url, headers) {
  const work = async () => {
    const wait = Math.max(0, nextFetchAt - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    nextFetchAt = Date.now() + MIN_INTERVAL_MS;
    return fetch(url, { headers, signal: AbortSignal.timeout(14000) });
  };
  const task = requestQueue.then(work, work);
  requestQueue = task.then(() => undefined, () => undefined);
  return task;
}

export async function musicBrainzFetch(env, path, query = {}) {
  const url = new URL(`${MB_BASE}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value != null && String(value).trim()) url.searchParams.set(key, String(value));
  }
  url.searchParams.set('fmt', 'json');
  const key = url.toString();
  const now = Date.now();
  const saved = memoryCache.get(key);
  if (saved && saved.expires > now) return saved.data;
  if (inFlight.has(key)) return inFlight.get(key);

  const task = (async () => {
    let response;
    try { response = await scheduledFetch(key, musicBrainzHeaders(env)); }
    catch {
      const error = new Error('Nie można teraz połączyć się z MusicBrainz. Spróbuj później albo użyj trybu ręcznego.');
      error.status = 503;
      error.code = 'MUSICBRAINZ_UNAVAILABLE';
      throw error;
    }
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw || '{}'); }
    catch { data = { message: raw.slice(0, 220) }; }

    if (!response.ok) {
      const throttled = response.status === 429 || response.status === 503;
      const error = new Error(throttled
        ? 'MusicBrainz jest chwilowo przeciążony lub ogranicza zapytania. Spróbuj ponownie za chwilę albo dodaj album ręcznie.'
        : response.status === 404 ? 'Nie znaleziono tego wydania w MusicBrainz.'
          : `MusicBrainz HTTP ${response.status}: ${String(data.message || data.error || '').slice(0, 140)}`);
      error.status = throttled ? 503 : response.status;
      error.code = throttled ? 'MUSICBRAINZ_RATE_LIMIT' : 'MUSICBRAINZ_ERROR';
      error.retryAfter = Math.max(3, Math.min(120, parseInt(response.headers.get('retry-after') || '8', 10) || 8));
      throw error;
    }
    if (memoryCache.size >= CACHE_LIMIT) memoryCache.clear();
    memoryCache.set(key, { data, expires: Date.now() + TTL_MS });
    return data;
  })();
  inFlight.set(key, task);
  try { return await task; }
  finally { inFlight.delete(key); }
}

export function musicBrainzError(error, json) {
  return json({
    ok: false,
    code: error.code || 'MUSICBRAINZ_ERROR',
    message: error.message || 'Nie udało się pobrać danych z MusicBrainz.',
    retryAfter: error.retryAfter || undefined
  }, error.status || 502);
}

export function creditedArtist(credits) {
  if (!Array.isArray(credits)) return '';
  return credits.map((c) => {
    if (typeof c === 'string') return c;
    return `${c.name || c.artist?.name || ''}${c.joinphrase || ''}`;
  }).join('').trim();
}

export function formatName(media = []) {
  const names = [...new Set((media || []).map((m) => String(m.format || '').trim()).filter(Boolean))];
  return names.join(', ');
}

export function guessMediaFormat(media = [], format = '') {
  const name = `${format || ''} ${formatName(media)}`.toLowerCase();
  if (/box set/.test(name)) return 'Box Set';
  if (/\bcd\b|compact disc/.test(name)) return 'CD';
  if (/vinyl|\b12"|\b7"|\b10"|\blp\b/.test(name)) return 'LP';
  if (/cassette/.test(name)) return 'Cassette';
  if (/digital|download|stream/.test(name)) return 'Digital';
  return 'CD';
}

export function mbCountry(code) {
  if (!code) return '';
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; }
  catch { return code; }
}

function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.round(ms / 1000);
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = seconds % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

export function normalizeMBRelease(release = {}) {
  const media = Array.isArray(release.media) ? release.media : [];
  const releaseGroupId = release['release-group']?.id || '';
  const id = release.id || '';
  const tracks = media.flatMap((disc, discIndex) => {
    const items = Array.isArray(disc.tracks) ? disc.tracks : [];
    return items.map((track, index) => ({
      position: media.length > 1 ? `${discIndex + 1}-${track.number || track.position || index + 1}` : String(track.number || track.position || index + 1),
      title: track.title || track.recording?.title || 'Untitled',
      duration: duration(track.length ?? track.recording?.length),
      type: 'track'
    }));
  });
  const labels = [...new Set((release['label-info'] || []).map((info) => info.label?.name).filter(Boolean))];
  const genres = (release.genres || []).map((g) => g.name).filter(Boolean);
  const coverParams = new URLSearchParams({ release: id });
  if (isMbid(releaseGroupId)) coverParams.set('group', releaseGroupId);
  const coverUrl = isMbid(id) ? `/api/coverart?${coverParams}` : '';
  return {
    source: 'MusicBrainz',
    musicbrainzId: id,
    musicbrainzUrl: id ? `https://musicbrainz.org/release/${id}` : '',
    releaseGroupId,
    artist: creditedArtist(release['artist-credit']),
    title: release.title || '',
    year: String(release.date || '').slice(0, 4),
    released: release.date || '',
    country: mbCountry(release.country),
    format: formatName(media),
    mediaFormat: guessMediaFormat(media),
    label: labels.join(', '),
    genres,
    styles: [],
    coverUrl,
    rawCoverUrl: id ? `https://coverartarchive.org/release/${id}/front-500` : '',
    tracks,
    confidence: null
  };
}
