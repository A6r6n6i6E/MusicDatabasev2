import { json } from './_common.js';
import { creditedArtist, formatName, guessMediaFormat, lucenePrefix, luceneReleaseQuery, mbCountry, musicBrainzError, musicBrainzFetch } from './_musicbrainz.js';

export async function onRequestGet({ request, env }) {
  try {
    const params = new URL(request.url).searchParams;
    const kind = params.get('kind') === 'artist' ? 'artist' : 'release';
    const q = String(params.get('q') || '').trim().slice(0, 120);
    const artist = String(params.get('artist') || '').trim().slice(0, 120);
    const preferredYear = String(params.get('year') || '').trim().slice(0, 4);
    const preferredFormat = String(params.get('format') || '').trim().toLowerCase();
    const explicitSearch = params.get('search') === '1';
    if (q.length < (explicitSearch ? 2 : 4)) return json({ ok: true, suggestions: [] });
    if (kind === 'artist') {
      const data = await musicBrainzFetch(env, '/artist/', { query: lucenePrefix('artist', q), limit: 7 });
      return json({ ok: true, suggestions: (data.artists || []).map((r) => ({
        kind: 'artist', id: r.id, mbid: r.id, title: r.name || '', artist: r.name || '',
        label: `${r.name || ''}${r.disambiguation ? ` — ${r.disambiguation}` : ''}`,
        country: r.country || '', score: r.score || 0
      })) });
    }
    // An explicit search must match the WHOLE album title, not every word
    // independently. The old query included `release:of`, which could produce
    // no results for a very common album such as Master of Puppets (1986).
    const titleQuery = explicitSearch ? luceneReleaseQuery(q) : lucenePrefix('release', q);
    const query = artist
      ? (explicitSearch ? luceneReleaseQuery(q, artist) : `${titleQuery} AND ${lucenePrefix('artist', artist)}`)
      : titleQuery;
    let data = await musicBrainzFetch(env, '/release/', { query, limit: explicitSearch ? 45 : 16 });

    // The artist credit may use a different alias or transliteration. Fallback
    // to a title-only phrase, then broad title tokens, only on deliberate search.
    if (explicitSearch && artist && !(data.releases || []).length) {
      data = await musicBrainzFetch(env, '/release/', { query: luceneReleaseQuery(q), limit: 45 });
    }
    if (explicitSearch && !(data.releases || []).length) {
      data = await musicBrainzFetch(env, '/release/', { query: lucenePrefix('release', q), limit: 45 });
    }
    const result = (data.releases || []).map((r) => {
      const artistName = creditedArtist(r['artist-credit']);
      const format = formatName(r.media || []);
      const country = mbCountry(r.country);
      return {
        kind: 'release', id: r.id, mbid: r.id, title: r.title || '', artist: artistName,
        year: String(r.date || '').slice(0, 4), country, format, mediaFormat: guessMediaFormat(r.media || []),
        label: `${artistName || 'Nieznany wykonawca'} — ${r.title || ''} (${String(r.date || '').slice(0, 4) || 'bez roku'})`,
        score: (r.score || 0)
          + (String(r.title || '').trim().toLocaleLowerCase() === q.toLocaleLowerCase() ? 40 : 0)
          + (artist && artistName.toLocaleLowerCase().includes(artist.toLocaleLowerCase()) ? 25 : 0)
          + (preferredYear && String(r.date || '').startsWith(preferredYear) ? 35 : 0)
          + (preferredFormat && (r.media || []).some((m) => m.format) && guessMediaFormat(r.media || []).toLowerCase() === preferredFormat ? 15 : 0)
      };
    }).sort((a, b) => b.score - a.score);
    return json({ ok: true, suggestions: result.slice(0, explicitSearch ? 20 : 10) });
  } catch (error) { return musicBrainzError(error, json); }
}
