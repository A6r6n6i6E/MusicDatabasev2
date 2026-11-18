import { json } from './_common.js';
import { isMbid, musicBrainzError, musicBrainzFetch, normalizeMBRelease } from './_musicbrainz.js';

export async function onRequestGet({ request, env }) {
  const id = String(new URL(request.url).searchParams.get('id') || '').trim();
  if (!isMbid(id)) return json({ ok: false, code: 'INVALID_MBID', message: 'Wybierz poprawny identyfikator wydania MusicBrainz (UUID).' }, 400);
  try {
    const release = await musicBrainzFetch(env, `/release/${id.toLowerCase()}`, {
      inc: 'recordings+artist-credits+labels+release-groups+genres'
    });
    const album = normalizeMBRelease(release);
    if (!album.artist || !album.title) return json({ ok: false, message: 'Wydanie nie ma kompletnych danych artysty i tytułu.' }, 422);
    return json({ ok: true, album });
  } catch (error) { return musicBrainzError(error, json); }
}
