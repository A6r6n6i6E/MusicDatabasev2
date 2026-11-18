/**
 * Identyfikator konkretnego wydania Discogs. Nie pobieramy adresu z sieci:
 * na backend trafia wyłącznie numeryczne release ID (bez SSRF).
 */
export function parseDiscogsReleaseId(value) {
  const raw = String(value || '').trim();
  if (/^\d{1,15}$/.test(raw)) return raw;
  if (!raw) throw new Error('Wklej link do wydania Discogs.');

  // Pozwala wkleić URL skopiowany z Discogs lub z wiadomości zawierającej link.
  const found = raw.match(/https?:\/\/[^\s<>"']+|(?:www\.)?discogs\.com\/[^\s<>"']+/i);
  const text = (found ? found[0] : raw).replace(/^[<"']|[>"']$/g, '');
  const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  let url;
  try { url = new URL(candidate); } catch { throw new Error('Niepoprawny adres. Wklej link z discogs.com/release/…'); }
  if (!['discogs.com', 'www.discogs.com', 'm.discogs.com'].includes(url.hostname.toLowerCase())) {
    throw new Error('To nie jest link do wydania Discogs. Potrzebny jest adres discogs.com/release/… (nie adres wiadomości Discord).');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const releaseIndex = parts.findIndex((part) => part.toLowerCase() === 'release');
  const id = releaseIndex >= 0 ? parts[releaseIndex + 1]?.match(/^(\d{1,15})(?:-|$)/)?.[1] : '';
  if (!id) throw new Error('Wklej link do konkretnego wydania (/release/12345), nie do artysty ani strony /master/.');
  return id;
}
