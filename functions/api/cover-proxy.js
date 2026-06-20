export async function onRequestGet({ request, env }) {
  const url = new URL(request.url).searchParams.get('url');
  if (!url || !/^https?:\/\//i.test(url)) {
    return new Response('Missing image url', { status: 400 });
  }
  try {
    const headers = {
      'User-Agent': env.DISCOGS_USER_AGENT || 'BibliotekaPlyt/7.0 +https://pages.dev',
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    };
    if (env.DISCOGS_TOKEN) headers.Authorization = `Discogs token=${env.DISCOGS_TOKEN}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return new Response('Image fetch failed', { status: res.status });
    return new Response(res.body, {
      status: 200,
      headers: {
        'content-type': res.headers.get('content-type') || 'image/jpeg',
        'cache-control': 'public, max-age=86400'
      }
    });
  } catch (err) {
    return new Response(err.message || 'Proxy error', { status: 500 });
  }
}
