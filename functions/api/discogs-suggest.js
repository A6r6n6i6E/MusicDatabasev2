import { json } from './_common.js';
import { discogsFetch, discogsErrorResponse } from './_discogs.js';

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

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();
    const kind = (url.searchParams.get('kind') || 'release').trim();
    const artist = (url.searchParams.get('artist') || '').trim();
    if (q.length < 4) return json({ ok: true, suggestions: [] }, 200, { 'cache-control': 'public, max-age=300' });
    if (!env.DISCOGS_TOKEN) return json({ ok: true, suggestions: [], warning: 'MISSING_DISCOGS_TOKEN' }, 200, { 'cache-control': 'public, max-age=300' });

    let search;
    if (kind === 'artist') {
      search = await discogsFetch(env, { type: 'artist', q, per_page: 6, page: 1 });
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
      per_page: 6,
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
    return discogsErrorResponse(error, json);
  }
}
