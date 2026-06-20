import { albumKey, json, readJson, requireDb } from './_common.js';

function rowToAlbum(row) {
  const album = JSON.parse(row.album || '{}');
  return {
    id: row.id,
    ...album,
    createdAt: album.createdAt || row.created_at,
    updatedAt: album.updatedAt || row.updated_at
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  try {
    const db = requireDb(env);
    const method = request.method.toUpperCase();
    const url = new URL(request.url);

    if (method === 'GET') {
      const result = await db.prepare(
        'SELECT id, album, created_at, updated_at FROM albums ORDER BY datetime(created_at) DESC'
      ).all();
      return json({ ok: true, mode: 'cloudflare-d1', albums: (result.results || []).map(rowToAlbum) });
    }

    if (method === 'POST') {
      const body = await readJson(request);
      const album = body.album || body;
      if (!album || !album.id) return json({ ok: false, message: 'Brakuje obiektu album z polem id.' }, 400);

      album.updatedAt = new Date().toISOString();
      album.createdAt = album.createdAt || album.updatedAt;
      const key = album.albumKey || albumKey(album);
      album.albumKey = key;

      try {
        await db.prepare(
          'INSERT INTO albums (id, album_key, album, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(album.id, key, JSON.stringify(album), album.createdAt, album.updatedAt).run();
      } catch (err) {
        if (String(err.message || '').toLowerCase().includes('unique')) {
          return json({ ok: false, code: 'DUPLICATE_ALBUM', message: `Album "${album.artist} - ${album.title}" jest już w bazie.` }, 409);
        }
        throw err;
      }
      return json({ ok: true, album });
    }

    if (method === 'PUT') {
      const body = await readJson(request);
      const id = body.id || body.album?.id;
      const album = body.album;
      if (!id || !album) return json({ ok: false, message: 'Brakuje id lub album.' }, 400);

      album.id = id;
      album.updatedAt = new Date().toISOString();
      const key = album.albumKey || albumKey(album);
      album.albumKey = key;

      try {
        const result = await db.prepare(
          'UPDATE albums SET album_key = ?, album = ?, updated_at = ? WHERE id = ?'
        ).bind(key, JSON.stringify(album), album.updatedAt, id).run();
        if (!result.meta || result.meta.changes === 0) return json({ ok: false, message: 'Nie znaleziono albumu do aktualizacji.' }, 404);
      } catch (err) {
        if (String(err.message || '').toLowerCase().includes('unique')) {
          return json({ ok: false, code: 'DUPLICATE_ALBUM', message: `Taki album już istnieje w bazie.` }, 409);
        }
        throw err;
      }
      return json({ ok: true, album });
    }

    if (method === 'DELETE') {
      const body = await readJson(request);
      const id = url.searchParams.get('id') || body.id;
      if (!id) return json({ ok: false, message: 'Brakuje id albumu.' }, 400);
      await db.prepare('DELETE FROM albums WHERE id = ?').bind(id).run();
      return json({ ok: true, id });
    }

    return json({ ok: false, message: 'Metoda nieobsługiwana.' }, 405);
  } catch (error) {
    return json({
      ok: false,
      code: error.code || 'COLLECTION_ERROR',
      message: error.message || 'Błąd bazy kolekcji.'
    }, error.status || 500);
  }
}
