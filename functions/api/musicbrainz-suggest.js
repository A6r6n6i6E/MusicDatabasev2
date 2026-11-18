import { json } from './_common.js';
import { creditedArtist, formatName, guessMediaFormat, lucenePrefix, mbCountry, musicBrainzError, musicBrainzFetch } from './_musicbrainz.js';

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
    const query = artist ? `${lucenePrefix('release', q)} AND ${lucenePrefix('artist', artist)}` : lucenePrefix('release', q);
    let data = await musicBrainzFetch(env, '/release/', { query, limit: 12 });
    // Deliberate search can fall back to title only when artist aliases differ.
    // Autocomplete never makes this second request.
    if (explicitSearch && artist && !(data.releases || []).length) {
      data = await musicBrainzFetch(env, '/release/', { query: lucenePrefix('release', q), limit: 12 });
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
          + (preferredYear && String(r.date || '').startsWith(preferredYear) ? 20 : 0)
          + (preferredFormat && (r.media || []).some((m) => m.format) && guessMediaFormat(r.media || []).toLowerCase() === preferredFormat ? 10 : 0)
      };
    }).sort((a, b) => b.score - a.score);
    return json({ ok: true, suggestions: result });
  } catch (error) { return musicBrainzError(error, json); }
}
