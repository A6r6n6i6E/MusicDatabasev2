export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  });
}

export function getDiscogsHeaders(env) {
  const headers = {
    'User-Agent': env.DISCOGS_USER_AGENT || 'BibliotekaPlyt/7.0'
  };

  if (env.DISCOGS_TOKEN) {
    headers.Authorization = `Discogs token=${env.DISCOGS_TOKEN}`;
  }

  return headers;
}

export function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function albumKey(album = {}) {
  const artist = normalizeText(album.artist);
  const title = normalizeText(album.title);
  const year = String(album.year || album.released || '').trim();
  const format = normalizeText(album.mediaFormat || '');
  return `${artist}__${title}__${year}__${format}`;
}

export function requireDb(env) {
  if (!env.DB) {
    const err = new Error('Brakuje bindingu D1 o nazwie DB. Dodaj bazę D1 w Cloudflare Pages -> Settings -> Functions -> D1 database bindings.');
    err.status = 501;
    err.code = 'MISSING_D1_BINDING';
    throw err;
  }
  return env.DB;
}

export async function readJson(request) {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
