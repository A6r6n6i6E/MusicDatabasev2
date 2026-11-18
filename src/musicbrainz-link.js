/** Extracts a MusicBrainz *release* MBID, never a release-group ID or arbitrary URL. */
export function parseMusicBrainzReleaseId(value) {
  const raw = String(value || '').trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuid.test(raw)) return raw.toLowerCase();
  if (!raw) throw new Error('Wklej link do konkretnego wydania MusicBrainz.');

  const matched = raw.match(/https?:\/\/[^\s<>"']+|(?:www\.|beta\.)?musicbrainz\.org\/[^\s<>"']+/i);
  if (!matched) throw new Error('Wklej adres musicbrainz.org/release/… lub identyfikator UUID wydania.');
  const text = matched[0].replace(/[)\].,;]+$/, '');
  let url;
  try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); }
  catch { throw new Error('Nieprawidłowy link MusicBrainz.'); }
  if (!['musicbrainz.org', 'www.musicbrainz.org', 'beta.musicbrainz.org'].includes(url.hostname.toLowerCase())) {
    throw new Error('To nie jest adres MusicBrainz.');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'release' || !uuid.test(parts[1] || '')) {
    throw new Error('Wybierz link do konkretnego wydania /release/UUID, nie do /release-group/ ani strony wykonawcy.');
  }
  return parts[1].toLowerCase();
}
