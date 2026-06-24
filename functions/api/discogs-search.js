import { getDiscogsHeaders, json } from './_common.js';

const DISCOGS_BASE = 'https://api.discogs.com';

function norm(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreResult(item, artist, title, year, format) {
  const wantArtist = norm(artist);
  const wantTitle = norm(title);
  const hayTitle = norm(item.title || '');
  const hayFormat = norm(Array.isArray(item.format) ? item.format.join(' ') : item.format || '');
  let score = 0;

  if (wantArtist && hayTitle.includes(wantArtist)) score += 35;
  if (wantTitle && hayTitle.includes(wantTitle)) score += 45;
  if (year && String(item.year || '') === String(year)) score += 20;
  if (format) {
    const f = norm(format);
    if (f.includes('lp') || f.includes('vinyl')) {
      if (hayFormat.includes('vinyl') || hayFormat.includes('lp')) score += 10;
    } else if (f.includes('cd')) {
      if (hayFormat.includes('cd')) score += 10;
    } else if (hayFormat.includes(f)) score += 7;
  }
  if (item.type === 'release') score += 5;
  if (item.cover_image) score += 5;
  return score;
}

function pickBest(results, artist, title, year, format) {
  return [...(results || [])]
    .map((r) => ({ ...r, _score: scoreResult(r, artist, title, year, format) }))
    .sort((a, b) => b._score - a._score)[0];
}

function proxiedImage(url) {
  if (!url) return '';
  return `/api/cover-proxy?url=${encodeURIComponent(url)}`;
}

function mapTrack(track, index) {
  return {
    position: track.position || String(index + 1),
    title: track.title || 'Untitled',
    duration: track.duration || '',
    type: track.type_ || 'track'
  };
}

function normalizeRelease(release, fallback, source = 'Discogs') {
  const artists = (release.artists || release.extraartists || [])
    .filter((a) => a && a.name)
    .map((a) => a.name.replace(/\s*\(\d+\)$/, ''));
  const labels = (release.labels || []).map((l) => l.name).filter(Boolean);
  const formats = (release.formats || []).map((f) => {
    const parts = [f.name, ...(f.descriptions || [])].filter(Boolean);
    return parts.join(' / ');
  });
  const rawTracks = (release.tracklist || []).filter((t) => t && t.type_ !== 'heading');
  const image = (release.images || [])[0]?.uri || (release.images || [])[0]?.resource_url || fallback.cover_image || fallback.thumb || '';

  return {
    source,
    discogsId: release.id || fallback.id,
    discogsUrl: release.uri ? `https://www.discogs.com${release.uri}` : fallback.uri || '',
    artist: artists.join(', ') || fallback.artist || '',
    title: release.title || fallback.release_title || fallback.title || '',
    year: release.year || fallback.year || '',
    released: release.released || '',
    country: release.country || fallback.country || '',
    label: labels.join(', '),
    format: formats.join(', ') || (Array.isArray(fallback.format) ? fallback.format.join(', ') : fallback.format || ''),
    genres: release.genres || fallback.genre || [],
    styles: release.styles || fallback.style || [],
    coverUrl: proxiedImage(image),
    tracks: rawTracks.map(mapTrack),
    rawCoverUrl: image || '',
    confidence: fallback._score || null
  };
}

async function discogsFetch(env, path, params = {}) {
  const url = new URL(`${DISCOGS_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      url.searchParams.set(key, value);
    }
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
    const artist = (url.searchParams.get('artist') || '').trim();
    const title = (url.searchParams.get('title') || '').trim();
    const year = (url.searchParams.get('year') || '').trim();
    const format = (url.searchParams.get('format') || '').trim();
    const discogsId = (url.searchParams.get('discogsId') || '').trim();

    if (!artist || !title) {
      return json({ ok: false, message: 'Podaj wykonawce i tytul albumu.' }, 400);
    }

    if (!env.DISCOGS_TOKEN) {
      return json({
        ok: false,
        code: 'MISSING_DISCOGS_TOKEN',
        message: 'Brakuje zmiennej DISCOGS_TOKEN. Dodaj token Discogs w Cloudflare Pages Environment Variables.'
      }, 401);
    }

    if (discogsId) {
  const release = await discogsFetch(env, `/releases/${discogsId}`);
  const album = normalizeRelease(release, { id: discogsId, _score: 999 });

  return json({
    ok: true,
    album,
    alternatives: []
  }, 200, { 'cache-control': 'public, max-age=86400' });
}

    const searchParams = {
      type: 'release',
      artist,
      release_title: title,
      year,
      format,
      per_page: 25,
      page: 1
    };

    let search = await discogsFetch(env, '/database/search', searchParams);

    if (!search.results?.length) {
      search = await discogsFetch(env, '/database/search', {
        type: 'release',
        q: `${artist} ${title}`,
        year,
        format,
        per_page: 25,
        page: 1
      });
    }

    const best = pickBest(search.results, artist, title, year, format);
    if (!best?.id) {
      return json({ ok: false, message: 'Nie znaleziono albumu w Discogs. Sprobuj usunac rok albo wpisac dokladniejszy tytul.' }, 404);
    }

    const release = await discogsFetch(env, `/releases/${best.id}`);
    const album = normalizeRelease(release, best);

    return json({
      ok: true,
      album,
      alternatives: (search.results || []).slice(0, 6).map((r) => ({
        id: r.id,
        title: r.title,
        year: r.year,
        country: r.country,
        format: r.format,
        score: scoreResult(r, artist, title, year, format)
      }))
    }, 200, { 'cache-control': 'public, max-age=600' });
  } catch (error) {
    return json({ ok: false, message: error.message || 'Nieznany blad pobierania danych z Discogs.', details: error.data || null }, error.status || 500);
  }
}
