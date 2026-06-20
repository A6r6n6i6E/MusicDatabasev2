import { getDiscogsHeaders, json } from './_common.js';

const DISCOGS_BASE = 'https://api.discogs.com';

function cleanArtist(value = '') {
  return String(value).replace(/\s*\(\d+\)$/, '').trim();
}

function splitReleaseTitle(value = '') {
  const parts = String(value).split(' - ');
  if (parts.length >= 2) {
    return { artist: cleanArtist(parts[0]), title: parts.slice(1).join(' - ').trim() };
  }
  return { artist: '', title: String(value).trim() };
}

async function discogsFetch(env, params) {
  const url = new URL(`${DISCOGS_BASE}/database/search`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url, { headers: getDiscogsHeaders(env) });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!res.ok) {
    const err = new Error(data.message || `Discogs HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();
    const kind = (url.searchParams.get('kind') || 'release').trim();
    const artist = (url.searchParams.get('artist') || '').trim();
    if (q.length < 3) return json({ ok: true, suggestions: [] }, 200, { 'cache-control': 'public, max-age=300' });
    if (!env.DISCOGS_TOKEN) return json({ ok: true, suggestions: [], warning: 'MISSING_DISCOGS_TOKEN' }, 200, { 'cache-control': 'public, max-age=300' });

    let search;
    if (kind === 'artist') {
      search = await discogsFetch(env, { type: 'artist', q, per_page: 8, page: 1 });
      const suggestions = (search.results || []).map((r) => ({
        id: r.id,
        kind: 'artist',
        label: cleanArtist(r.title),
        artist: cleanArtist(r.title),
        thumb: r.thumb || r.cover_image || ''
      }));
      return json({ ok: true, suggestions }, 200, { 'cache-control': 'public, max-age=300' });
    }

    search = await discogsFetch(env, {
      type: 'release',
      q: artist ? `${artist} ${q}` : q,
      artist,
      release_title: q,
      per_page: 10,
      page: 1
    });
    const suggestions = (search.results || []).map((r) => {
      const parsed = splitReleaseTitle(r.title);
      return {
        id: r.id,
        kind: 'release',
        label: `${r.title}${r.year ? ` (${r.year})` : ''}${r.country ? ` • ${r.country}` : ''}`,
        artist: parsed.artist || artist,
        title: parsed.title,
        year: r.year || '',
        country: r.country || '',
        format: Array.isArray(r.format) ? r.format.join(', ') : r.format || '',
        thumb: r.thumb || r.cover_image || ''
      };
    });
    return json({ ok: true, suggestions }, 200, { 'cache-control': 'public, max-age=300' });
  } catch (error) {
    return json({ ok: false, message: error.message || 'Błąd autouzupełniania Discogs.', details: error.data || null }, error.status || 500);
  }
}
