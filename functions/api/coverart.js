import { isMbid } from './_musicbrainz.js';

// Safe image proxy: only verified MusicBrainz IDs, never an arbitrary URL.
const ALLOW_TYPE = /^(image\/jpeg|image\/png|image\/webp)$/i;

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const release = url.searchParams.get('release') || '';
  const group = url.searchParams.get('group') || '';
  if (!isMbid(release) || (group && !isMbid(group))) return new Response('Niepoprawny identyfikator okładki.', { status: 400 });

  const paths = [`https://coverartarchive.org/release/${release}/front-500`];
  if (group) paths.push(`https://coverartarchive.org/release-group/${group}/front-500`);
  for (const address of paths) {
    try {
      const upstream = await fetch(address, {
        headers: { 'User-Agent': 'BibliotekaPlyt/10.0 (https://musicdatabase.pages.dev)' },
        signal: AbortSignal.timeout(12000),
        cf: { cacheEverything: true, cacheTtl: 86400 }
      });
      const type = String(upstream.headers.get('content-type') || '').split(';')[0];
      if (upstream.ok && ALLOW_TYPE.test(type)) {
        // Stream response instead of putting image bytes into D1 or Workers memory.
        return new Response(upstream.body, {
          status: 200,
          headers: {
            'content-type': type,
            'cache-control': 'public, max-age=86400',
            'x-content-type-options': 'nosniff'
          }
        });
      }
      if (upstream.status === 429 || upstream.status === 503) break;
    } catch { /* fall through to next allowed candidate */ }
  }
  return new Response('Brak okładki w Cover Art Archive.', { status: 404, headers: { 'cache-control': 'public, max-age=1800' } });
}
