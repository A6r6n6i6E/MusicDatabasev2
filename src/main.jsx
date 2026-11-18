import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Search, Plus, Disc3, Upload, Download, ChevronDown, AlertTriangle, Loader2, Edit3, Trash2, Save, X, Image as ImageIcon } from 'lucide-react';
import './styles.css';
import { imageFileToDataUrl } from './image-utils.js';
import { parseDiscogsReleaseId } from './discogs-link.js';

// Nie używamy localStorage — źródłem prawdy jest D1.
const suggestCache = new Map();

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function albumKey(album) {
  const artist = normalizeText(album.artist);
  const title = normalizeText(album.title);
  const year = String(album.year || album.released || '').trim();
  const format = normalizeText(album.mediaFormat || '');

  return `${artist}__${title}__${year}__${format}`;
}

function isDuplicateAlbum(newAlbum, albums) {
  const newKey = albumKey(newAlbum);
  return albums.some((album) => albumKey(album) === newKey);
}

async function apiJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const error = new Error(data.message || `Błąd HTTP ${res.status}`);
    error.status = res.status;
    error.code = data.code || '';
    error.retryAfter = Number(data.retryAfter || 0);
    throw error;
  }
  return data;
}

async function loadCloudAlbums() {
  return apiJson('/api/collection');
}

async function createCloudAlbum(album) {
  return apiJson('/api/collection', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ album })
  });
}

async function updateCloudAlbum(album) {
  return apiJson('/api/collection', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: album.id, album })
  });
}

async function deleteCloudAlbum(id) {
  return apiJson(`/api/collection?id=${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
}

function PlaceholderCover() {
  return (
    <div className="cover placeholder">
      <Disc3 size={42} />
      <span>brak okładki</span>
    </div>
  );
}

function TrackList({ tracks }) {
  if (!tracks?.length) return <p className="empty-track">Brak tracklisty. Kliknij „Edytuj”, aby uzupełnić utwory ręcznie.</p>;
  return (
    <ol className="tracklist">
      {tracks.map((track, index) => (
        <li key={`${track.position}-${track.title}-${index}`}>
          <span className="track-no">{track.position || index + 1}</span>
          <span className="track-title">{track.title}</span>
          {track.duration ? <span className="duration">{track.duration}</span> : null}
        </li>
      ))}
    </ol>
  );
}

function tracksToText(tracks = []) {
  return tracks.map((t, i) => `${t.position || i + 1} | ${t.title || ''}${t.duration ? ` | ${t.duration}` : ''}`).join('\n');
}

function textToTracks(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split('|').map((p) => p.trim());
      if (parts.length >= 2) return { position: parts[0] || String(index + 1), title: parts[1] || '', duration: parts[2] || '' };
      return { position: String(index + 1), title: line, duration: '' };
    })
    .filter((track) => track.title);
}

function csvToArray(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function EditAlbumForm({ album, onCancel, onSave }) {
  const [draft, setDraft] = useState(() => ({
    ...album,
    genresText: (album.genres || []).join(', '),
    stylesText: (album.styles || []).join(', '),
    tracksText: tracksToText(album.tracks || [])
  }));
  const [saving, setSaving] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [error, setError] = useState('');

  const update = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));

  async function handleCoverFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCoverBusy(true);
    setError('');
    try {
      update('coverUrl', await imageFileToDataUrl(file));
    } catch (err) {
      setError(err.message || 'Nie udało się wgrać okładki.');
    } finally {
      setCoverBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (coverBusy) return;
    setSaving(true);
    setError('');
    try {
      const next = {
        ...album,
        ...draft,
        year: String(draft.year || '').trim(),
        country: String(draft.country || '').trim(),
        artist: String(draft.artist || '').trim(),
        title: String(draft.title || '').trim(),
        mediaFormat: String(draft.mediaFormat || '').trim(),
        coverUrl: String(draft.coverUrl || '').trim(),
        discogsUrl: String(draft.discogsUrl || '').trim(),
        label: String(draft.label || '').trim(),
        format: String(draft.format || '').trim(),
        genres: csvToArray(draft.genresText),
        styles: csvToArray(draft.stylesText),
        tracks: textToTracks(draft.tracksText),
        updatedAt: new Date().toISOString()
      };
      delete next.genresText;
      delete next.stylesText;
      delete next.tracksText;
      await onSave(next);
    } catch (err) {
      setError(err.message || 'Nie udało się zapisać zmian.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="edit-form" onSubmit={submit}>
      <div className="edit-title"><Edit3 size={17} /> Edycja albumu</div>
      <div className="edit-grid two">
        <label>Wykonawca<input value={draft.artist || ''} onChange={(e) => update('artist', e.target.value)} /></label>
        <label>Tytuł<input value={draft.title || ''} onChange={(e) => update('title', e.target.value)} /></label>
      </div>
      <div className="edit-grid three">
        <label>Rok<input value={draft.year || ''} onChange={(e) => update('year', e.target.value)} /></label>
        <label>Kraj<input value={draft.country || ''} onChange={(e) => update('country', e.target.value)} /></label>
        <label>Format kolekcji<input value={draft.mediaFormat || ''} onChange={(e) => update('mediaFormat', e.target.value)} placeholder="CD / LP" /></label>
      </div>
      <label>Adres okładki<input value={draft.coverUrl || ''} onChange={(e) => update('coverUrl', e.target.value)} placeholder="https://... albo wgraj plik poniżej" /></label>
      <label className="ghost upload cover-upload"><ImageIcon size={16} /> {coverBusy ? 'Zmniejszam okładkę…' : 'Wgraj własną okładkę'}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={coverBusy || saving} onChange={handleCoverFile} /></label>
      <div className="edit-grid two">
        <label>Label<input value={draft.label || ''} onChange={(e) => update('label', e.target.value)} /></label>
        <label>Format Discogs<input value={draft.format || ''} onChange={(e) => update('format', e.target.value)} /></label>
      </div>
      <div className="edit-grid two">
        <label>Gatunki<input value={draft.genresText || ''} onChange={(e) => update('genresText', e.target.value)} placeholder="Heavy Metal, Rock" /></label>
        <label>Style<input value={draft.stylesText || ''} onChange={(e) => update('stylesText', e.target.value)} placeholder="Thrash, Hard Rock" /></label>
      </div>
      <label>Discogs URL<input value={draft.discogsUrl || ''} onChange={(e) => update('discogsUrl', e.target.value)} /></label>
      <label>Tracklista<textarea value={draft.tracksText || ''} onChange={(e) => update('tracksText', e.target.value)} rows={9} placeholder={'1 | Tytuł utworu | 4:32\n2 | Kolejny utwór | 3:58'} /></label>
      {error ? <div className="error"><AlertTriangle size={16} /> {error}</div> : null}
      <div className="edit-actions">
        <button type="button" className="ghost" onClick={onCancel}><X size={16} /> Anuluj</button>
        <button className="primary" disabled={saving || coverBusy}><Save size={16} /> {saving ? 'Zapisuję…' : 'Zapisz zmiany'}</button>
      </div>
    </form>
  );
}

function AlbumCard({ album, onDelete, onUpdate }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const country = album.country ? ` • ${album.country}` : '';
  const year = album.year || album.released || 'brak roku';

  async function handleDelete() {
    const ok = window.confirm(`Usunąć album „${album.artist} - ${album.title}”?`);
    if (!ok) return;
    setBusyDelete(true);
    setDeleteError('');
    try {
      await onDelete(album.id);
    } catch (err) {
      setDeleteError(err.message || 'Nie udało się usunąć albumu.');
    } finally {
      setBusyDelete(false);
    }
  }

  async function handleSave(next) {
    await onUpdate(next);
    setEditing(false);
    setImageError(false);
  }

  return (
    <article className="album-card">
      <button className="cover-button" onClick={() => setOpen(!open)} aria-label="Rozwiń album">
  {album.mediaFormat ? <span className="format-pill">{album.mediaFormat}</span> : null}

  {album.coverUrl && !imageError ? (
    <img className="cover" loading="lazy" decoding="async" src={album.coverUrl} alt={`Okładka ${album.title}`} onError={() => setImageError(true)} />
  ) : <PlaceholderCover />}
</button>
      <div className="album-body">
        <div className="album-head">
          <div>
            <h3>{album.title}</h3>
            <p>{album.artist} • {year}</p>
          </div>
          <button className="round" onClick={() => setOpen(!open)} aria-label="Rozwiń tracklistę">
            <ChevronDown className={open ? 'rotate' : ''} size={20} />
          </button>
        </div>
    {/*    <div className="meta-grid">
          {album.genres?.length ? <span>Gatunek: {album.genres.join(', ')}</span> : null}
          {album.styles?.length ? <span>Styl: {album.styles.join(', ')}</span> : null}
        </div>
        */}
        {open ? (
          <div className="expanded">
            {editing ? (
              <EditAlbumForm album={album} onCancel={() => setEditing(false)} onSave={handleSave} />
            ) : (
              <>
                <TrackList tracks={album.tracks} />
                <div className="card-actions">
                  <button className="ghost" onClick={() => setEditing(true)}><Edit3 size={16} /> Edytuj</button>
                  <button className="danger" onClick={handleDelete} disabled={busyDelete}><Trash2 size={16} /> {busyDelete ? 'Usuwam…' : 'Usuń'}</button>
                </div>
                {deleteError ? <div className="error" role="alert">{deleteError}</div> : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function SuggestInput({ label, value, onChange, placeholder, kind, artist, onPick, required }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lockedValue, setLockedValue] = useState('');
  const [hint, setHint] = useState('');
  const cooldownRef = useRef(0);
  const boxRef = useRef(null);

  useEffect(() => {
    function close(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    const q = value.trim();
    if (q === lockedValue && lockedValue) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    if (q.length < 4 || Date.now() < cooldownRef.current) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    const cacheKey = `${kind}:${artist || ''}:${q}`.toLocaleLowerCase('pl');
    const cached = suggestCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      setSuggestions(cached.items);
      setOpen(Boolean(cached.items.length));
      setHint('');
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setHint('');
      try {
        const params = new URLSearchParams({ kind, q, artist: artist || '' });
        const data = await apiJson(`/api/discogs-suggest?${params}`, { signal: controller.signal });
        const items = data.suggestions || [];
        if (!controller.signal.aborted) {
          if (suggestCache.size > 120) suggestCache.clear();
          suggestCache.set(cacheKey, { items, expires: Date.now() + 15 * 60_000 });
          setSuggestions(items);
          setOpen(Boolean(items.length));
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setSuggestions([]);
        setOpen(false);
        if (err.status === 429 || err.code === 'DISCOGS_RATE_LIMIT') {
          cooldownRef.current = Date.now() + Math.max(90, err.retryAfter || 0) * 1000;
          setHint('Discogs ograniczył podpowiedzi. Możesz dodać płytę ręcznie.');
        } else {
          setHint('Podpowiedzi chwilowo niedostępne. Możesz wpisać nazwę ręcznie.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 850);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, kind, artist, lockedValue]);

  function handleChange(next) {
    setLockedValue('');
    setHint('');
    onChange(next);
  }

  function handlePick(item) {
    // Blokada po wybraniu: sugestie nie wyskakują ponownie aż do ręcznej edycji.
    const picked = String(item.title || item.artist || item.label || '').trim();
    setLockedValue(picked);
    setSuggestions([]);
    setOpen(false);
    setHint('');
    onPick(item);
  }

  return (
    <label ref={boxRef} className="suggest-label">
      {label}
      <div className="suggest-wrap">
        <input
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (suggestions.length && value.trim() !== lockedValue) setOpen(true); }}
          placeholder={placeholder}
          autoComplete="off"
          required={required}
        />
        {loading ? <Loader2 className="input-spinner" size={16} /> : null}
        {open ? (
          <div className="suggestions">
            {suggestions.map((item) => (
              <button type="button" key={`${item.kind}-${item.id}-${item.label}`} onClick={() => handlePick(item)}>
                {item.thumb ? <img src={item.thumb} alt="" loading="lazy" /> : <span className="suggest-disc"><Disc3 size={18} /></span>}
                <span>
                  <strong>{item.label}</strong>
                  {item.format ? <small>{item.format}</small> : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {hint ? <span className="input-hint">{hint}</span> : null}
    </label>
  );
}

const EMPTY_MANUAL = {
  artist: '', title: '', year: '', country: '', mediaFormat: 'CD',
  coverUrl: '', label: '', genresText: '', stylesText: '', discogsUrl: '', tracksText: ''
};

function ManualAddForm({ onAdd }) {
  const [draft, setDraft] = useState({ ...EMPTY_MANUAL });
  const [coverBusy, setCoverBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const update = (field, value) => setDraft((prev) => ({ ...prev, [field]: value }));

  async function handleCoverFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setCoverBusy(true);
    setError('');
    try {
      update('coverUrl', await imageFileToDataUrl(file));
    } catch (err) {
      setError(err.message || 'Nie udało się przygotować okładki.');
    } finally {
      setCoverBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (coverBusy || saving) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const now = new Date().toISOString();
      const album = {
        id: uid(),
        source: 'Ręcznie',
        artist: draft.artist.trim(),
        title: draft.title.trim(),
        year: draft.year.trim(),
        country: draft.country.trim(),
        mediaFormat: draft.mediaFormat,
        coverUrl: draft.coverUrl.trim(),
        label: draft.label.trim(),
        genres: csvToArray(draft.genresText),
        styles: csvToArray(draft.stylesText),
        discogsUrl: draft.discogsUrl.trim(),
        tracks: textToTracks(draft.tracksText),
        createdAt: now,
        updatedAt: now
      };
      if (!album.artist || !album.title) throw new Error('Podaj wykonawcę i tytuł albumu.');
      await onAdd(album); // wyłącznie zapis w D1; ZERO zapytań do Discogs
      setSuccess(`Dodano: ${album.artist} — ${album.title}`);
      setDraft({ ...EMPTY_MANUAL });
    } catch (err) {
      setError(err.message || 'Nie udało się zapisać albumu w D1.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="entry-form" onSubmit={submit}>
      <p className="hint">Ten tryb nie korzysta z Discogs. Album zapisuje się bezpośrednio w Twojej bazie Cloudflare D1.</p>
      <label>Wykonawca<input value={draft.artist} onChange={(e) => update('artist', e.target.value)} placeholder="np. Behemoth" required /></label>
      <label>Tytuł albumu<input value={draft.title} onChange={(e) => update('title', e.target.value)} placeholder="np. The Satanist" required /></label>
      <div className="two-cols">
        <label>Rok wydania<input inputMode="numeric" value={draft.year} onChange={(e) => update('year', e.target.value)} placeholder="2014" /></label>
        <label>Format
          <select value={draft.mediaFormat} onChange={(e) => update('mediaFormat', e.target.value)}>
            <option>CD</option><option>LP</option><option>Vinyl</option><option>Cassette</option><option>Box Set</option><option>Digital</option>
          </select>
        </label>
      </div>
      <label>Kraj wydania<input value={draft.country} onChange={(e) => update('country', e.target.value)} placeholder="np. Poland" /></label>
      <label>Adres okładki (opcjonalnie)
        <input value={draft.coverUrl} onChange={(e) => update('coverUrl', e.target.value)} placeholder="https://… lub wgraj plik poniżej" />
      </label>
      <label className="ghost upload cover-upload"><ImageIcon size={16} /> {coverBusy ? 'Zmniejszam okładkę…' : 'Wgraj okładkę z urządzenia'}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={coverBusy || saving} onChange={handleCoverFile} />
      </label>
      {draft.coverUrl ? (
        <div className="manual-preview">
          <img src={draft.coverUrl} alt="Podgląd wybranej okładki" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <button type="button" className="ghost small-btn" onClick={() => update('coverUrl', '')}>Usuń okładkę</button>
        </div>
      ) : null}
      <label>Lista utworów (po jednym w wierszu)
        <textarea value={draft.tracksText} onChange={(e) => update('tracksText', e.target.value)} rows={7} placeholder={'1 | Pierwszy utwór | 4:32\n2 | Drugi utwór | 3:58\nLub same tytuły, każdy w osobnej linii'} />
      </label>
      <details className="extra-fields">
        <summary>Więcej informacji (opcjonalnie)</summary>
        <label>Wytwórnia (Label)<input value={draft.label} onChange={(e) => update('label', e.target.value)} /></label>
        <label>Gatunki (po przecinku)<input value={draft.genresText} onChange={(e) => update('genresText', e.target.value)} /></label>
        <label>Style (po przecinku)<input value={draft.stylesText} onChange={(e) => update('stylesText', e.target.value)} /></label>
        <label>Link Discogs (jeśli posiadasz)<input value={draft.discogsUrl} onChange={(e) => update('discogsUrl', e.target.value)} /></label>
      </details>
      <button className="primary" type="submit" disabled={saving || coverBusy}>
        <Save size={17} /> {saving ? 'Zapisuję w D1…' : 'Dodaj ręcznie do kolekcji'}
      </button>
      {error ? <div className="error" role="alert"><AlertTriangle size={16} /> {error}</div> : null}
      {success ? <div className="success" role="status">{success}</div> : null}
    </form>
  );
}

function guessFormat(release) {
  const value = String(release.format || '').toLowerCase();
  if (value.includes('box set')) return 'Box Set';
  if (value.includes('cd')) return 'CD';
  if (value.includes('vinyl') || value.includes('lp')) return 'LP';
  if (value.includes('cassette')) return 'Cassette';
  if (value.includes('digital') || value.includes('file')) return 'Digital';
  return 'CD';
}

function DiscogsLinkForm({ onAdd, onSwitchToManual }) {
  const [link, setLink] = useState('');
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const requestSeq = useRef(0);
  const updateDraft = (field, value) => setDraft((prev) => prev ? { ...prev, [field]: value } : prev);

  function handleLinkChange(value) {
    requestSeq.current += 1;
    setLink(value);
    setDraft(null);
    setError('');
    setSuccess('');
    setLoading(false);
  }

  async function loadLink(value = link) {
    let id;
    try {
      id = parseDiscogsReleaseId(value);
    } catch (err) {
      setError(err.message);
      setDraft(null);
      return;
    }
    const sequence = ++requestSeq.current;
    setLoading(true);
    setError('');
    setSuccess('');
    setDraft(null);
    try {
      // Tylko jeden request do /releases/{id} — bez wyszukiwania artysty i tytułu.
      const data = await apiJson(`/api/discogs-search?discogsId=${encodeURIComponent(id)}`);
      if (sequence !== requestSeq.current) return;
      const album = data.album;
      setDraft({
        ...album,
        artist: String(album.artist || ''),
        title: String(album.title || ''),
        year: String(album.year || ''),
        country: String(album.country || ''),
        mediaFormat: guessFormat(album),
        label: String(album.label || ''),
        coverUrl: String(album.coverUrl || ''),
        genresText: (album.genres || []).join(', '),
        stylesText: (album.styles || []).join(', '),
        tracksText: tracksToText(album.tracks || [])
      });
    } catch (err) {
      if (sequence !== requestSeq.current) return;
      if (err.status === 429 || err.code === 'DISCOGS_RATE_LIMIT') {
        setError('Discogs nadal ogranicza dostęp do API. Link pozwala pominąć wyszukiwanie, ale nie znosi blokady Discogs. Możesz dodać album w zakładce „Ręcznie” albo spróbować później.');
      } else if (err.code === 'MISSING_DISCOGS_TOKEN') {
        setError('Brak tokenu Discogs w Cloudflare. Dodaj DISCOGS_TOKEN w ustawieniach Pages.');
      } else {
        setError(err.message || 'Nie udało się pobrać wydania.');
      }
    } finally {
      if (sequence === requestSeq.current) setLoading(false);
    }
  }

  function handlePaste(event) {
    const pasted = event.clipboardData.getData('text').trim();
    if (!pasted) return;
    event.preventDefault();
    handleLinkChange(pasted);
    // Wklejenie kompletnego adresu uruchamia pobieranie automatycznie.
    void loadLink(pasted);
  }

  async function handleCoverFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setCoverBusy(true);
    setError('');
    try {
      updateDraft('coverUrl', await imageFileToDataUrl(file));
    } catch (err) {
      setError(err.message || 'Nie udało się przygotować okładki.');
    } finally {
      setCoverBusy(false);
    }
  }

  async function saveAlbum(event) {
    event.preventDefault();
    if (!draft || saving || coverBusy) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const now = new Date().toISOString();
      const album = {
        ...draft,
        id: uid(),
        artist: draft.artist.trim(),
        title: draft.title.trim(),
        year: draft.year.trim(),
        country: draft.country.trim(),
        mediaFormat: draft.mediaFormat,
        label: draft.label.trim(),
        coverUrl: draft.coverUrl.trim(),
        genres: csvToArray(draft.genresText),
        styles: csvToArray(draft.stylesText),
        tracks: textToTracks(draft.tracksText),
        createdAt: now,
        updatedAt: now
      };
      delete album.genresText;
      delete album.stylesText;
      delete album.tracksText;
      if (!album.artist || !album.title) throw new Error('Sprawdź wykonawcę i tytuł. Oba pola są wymagane.');
      await onAdd(album); // To jest TYLKO zapis w D1.
      setSuccess(`Dodano: ${album.artist} — ${album.title}`);
      setDraft(null);
      setLink('');
    } catch (err) {
      setError(err.message || 'Nie udało się zapisać albumu w D1.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="entry-form link-add-form">
      <p className="hint">Wklej link do <strong>konkretnego wydania Discogs</strong> (adres zawierający <code>/release/</code>). Nie musisz wpisywać wykonawcy ani tracklisty. Dane będzie można poprawić przed zapisem.</p>
      <label>Link Discogs lub ID wydania
        <input
          type="text"
          value={link}
          onChange={(event) => handleLinkChange(event.target.value)}
          onPaste={handlePaste}
          placeholder="https://www.discogs.com/release/123456…"
          autoComplete="off"
          inputMode="url"
          aria-label="Link do wydania Discogs"
        />
      </label>
      <button className="ghost full" type="button" disabled={!link.trim() || loading || saving} onClick={() => loadLink()}>
        {loading ? <Loader2 size={17} className="spin" /> : <Disc3 size={17} />}
        {loading ? 'Pobieram wydanie…' : draft ? 'Pobierz dane ponownie' : 'Pobierz dane z linku'}
      </button>
      {error ? <div className="error" role="alert"><AlertTriangle size={16} /> {error}</div> : null}
      {error ? <button type="button" className="ghost" onClick={onSwitchToManual}>Przejdź do dodawania ręcznego</button> : null}
      {success ? <div className="success" role="status">{success}</div> : null}

      {draft ? (
        <form className="link-review" onSubmit={saveAlbum}>
          <div className="link-review-heading"><Save size={16} /> Sprawdź dane przed dodaniem</div>
          <div className="link-review-hero">
            {draft.coverUrl ? (
              <img className="link-review-cover" src={draft.coverUrl} alt={`Okładka ${draft.title}`} onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} />
            ) : <div className="link-review-cover link-review-empty"><Disc3 size={35} /></div>}
            <div className="link-review-summary">
              <strong>{draft.artist || 'Nieznany wykonawca'}</strong>
              <span>{draft.title || 'Brak tytułu'}</span>
              <small>{draft.year || 'Brak roku'} · {draft.country || 'Brak kraju'} · {draft.mediaFormat}</small>
              <small>Tracklista: {textToTracks(draft.tracksText).length} utworów</small>
            </div>
          </div>
          <label>Wykonawca<input value={draft.artist} onChange={(event) => updateDraft('artist', event.target.value)} required /></label>
          <label>Tytuł albumu<input value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} required /></label>
          <div className="two-cols">
            <label>Rok wydania<input inputMode="numeric" value={draft.year} onChange={(event) => updateDraft('year', event.target.value)} /></label>
            <label>Format<select value={draft.mediaFormat} onChange={(event) => updateDraft('mediaFormat', event.target.value)}>
              <option>CD</option><option>LP</option><option>Vinyl</option><option>Cassette</option><option>Box Set</option><option>Digital</option>
            </select></label>
          </div>
          <label>Kraj wydania<input value={draft.country} onChange={(event) => updateDraft('country', event.target.value)} /></label>
          <details className="extra-fields">
            <summary>Lista utworów ({textToTracks(draft.tracksText).length}) — rozwiń, aby poprawić</summary>
            <textarea value={draft.tracksText} onChange={(event) => updateDraft('tracksText', event.target.value)} rows={8} placeholder="1 | Tytuł utworu | 4:32" />
          </details>
          <details className="extra-fields">
            <summary>Okładka i dodatkowe informacje (opcjonalne)</summary>
            <label>Adres okładki<input value={draft.coverUrl} onChange={(event) => updateDraft('coverUrl', event.target.value)} /></label>
            <label className="ghost upload cover-upload"><ImageIcon size={16} /> {coverBusy ? 'Zmniejszam okładkę…' : 'Wgraj własną okładkę'}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={coverBusy || saving} onChange={handleCoverFile} />
            </label>
            <label>Wytwórnia<input value={draft.label} onChange={(event) => updateDraft('label', event.target.value)} /></label>
            <label>Gatunki<input value={draft.genresText} onChange={(event) => updateDraft('genresText', event.target.value)} /></label>
            <label>Style<input value={draft.stylesText} onChange={(event) => updateDraft('stylesText', event.target.value)} /></label>
          </details>
          <button type="submit" className="primary" disabled={saving || coverBusy}>
            <Save size={17} /> {saving ? 'Zapisuję w Cloudflare D1…' : 'Dodaj ten album do kolekcji'}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function DiscogsAddForm({ onAdd, onSwitchToManual }) {
  const initial = { artist: '', title: '', year: '', mediaFormat: 'CD', discogsId: '', releaseUrl: '' };
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  function pickArtist(s) {
    setForm((prev) => ({ ...prev, artist: s.artist || s.label || '', discogsId: '' }));
  }
  function pickRelease(s) {
    setForm((prev) => ({ ...prev, artist: s.artist || prev.artist, title: s.title || prev.title, year: s.year || prev.year, discogsId: s.id || '' }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const params = new URLSearchParams({ artist: form.artist.trim(), title: form.title.trim(), year: form.year.trim(), format: form.mediaFormat });
      const selectedId = form.releaseUrl ? parseDiscogsReleaseId(form.releaseUrl) : form.discogsId;
      if (selectedId) params.set('discogsId', String(selectedId));
      const data = await apiJson(`/api/discogs-search?${params}`);
      const album = { ...data.album, id: uid(), mediaFormat: form.mediaFormat, createdAt: new Date().toISOString() };
      await onAdd(album);
      setSuccess(`Dodano: ${album.artist} — ${album.title}`);
      setForm({ ...initial });
    } catch (err) {
      setError(err.status === 429 || err.code === 'DISCOGS_RATE_LIMIT'
        ? 'Discogs ogranicza teraz zapytania. Możesz użyć zakładki „Ręcznie” — zapis do D1 nadal działa.'
        : err.message || 'Nie udało się pobrać płyty.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="entry-form" onSubmit={submit}>
      <p className="hint">Autouzupełnianie jest opcjonalne. Jeśli Discogs odmawia dostępu, możesz dodać album ręcznie.</p>
      <SuggestInput label="Wykonawca" kind="artist" value={form.artist}
        onChange={(v) => setForm((p) => ({ ...p, artist: v, discogsId: '' }))}
        onPick={pickArtist} placeholder="np. Metallica" required={!form.releaseUrl} />
      <SuggestInput label="Tytuł albumu" kind="release" artist={form.artist} value={form.title}
        onChange={(v) => setForm((p) => ({ ...p, title: v, discogsId: '' }))}
        onPick={pickRelease} placeholder="np. Master Of Puppets" required={!form.releaseUrl} />
      <div className="two-cols">
        <label>Rok<input value={form.year} onChange={(e) => update('year', e.target.value)} placeholder="1986" /></label>
        <label>Format<select value={form.mediaFormat} onChange={(e) => update('mediaFormat', e.target.value)}>
          <option>CD</option><option>LP</option><option>Vinyl</option><option>Cassette</option><option>Box Set</option><option>Digital</option>
        </select></label>
      </div>
      <label>Discogs Release ID / URL (opcjonalnie)
        <input value={form.releaseUrl} onChange={(e) => update('releaseUrl', e.target.value)} placeholder="123456 lub https://www.discogs.com/release/…" />
      </label>
      <button type="submit" className="primary" disabled={busy}>
        <Plus size={16} /> {busy ? 'Pobieram z Discogs…' : 'Pobierz i dodaj'}
      </button>
      {error ? <div className="error" role="alert"><AlertTriangle size={16} /> {error}</div> : null}
      {error ? <button type="button" className="ghost" onClick={onSwitchToManual}>Przejdź do dodawania ręcznego</button> : null}
      {success ? <div className="success" role="status">{success}</div> : null}
    </form>
  );
}

function AddAlbumForm({ onAdd }) {
  const [mode, setMode] = useState('link');
  return (
    <div className="panel add-panel">
      <div className="panel-title"><Plus size={20} /> Dodaj płytę</div>
      <div className="mode-switch three-modes" role="group" aria-label="Sposób dodawania albumu">
        <button type="button" className={mode === 'link' ? 'active' : ''} aria-pressed={mode === 'link'} onClick={() => setMode('link')}>Z linku</button>
        <button type="button" className={mode === 'discogs' ? 'active' : ''} aria-pressed={mode === 'discogs'} onClick={() => setMode('discogs')}>Wyszukaj</button>
        <button type="button" className={mode === 'manual' ? 'active' : ''} aria-pressed={mode === 'manual'} onClick={() => setMode('manual')}>Ręcznie</button>
      </div>
      {mode === 'link' ? <DiscogsLinkForm onAdd={onAdd} onSwitchToManual={() => setMode('manual')} /> : null}
      {mode === 'manual' ? <ManualAddForm onAdd={onAdd} /> : null}
      {mode === 'discogs' ? <DiscogsAddForm onAdd={onAdd} onSwitchToManual={() => setMode('manual')} /> : null}
    </div>
  );
}

function App() {
  const [albums, setAlbums] = useState([]);
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState('all');
  const [cloud, setCloud] = useState({ loading: true, enabled: false, message: '' });
  const [importStatus, setImportStatus] = useState('');
  const revisionRef = useRef('');
  const refreshingRef = useRef(false);

  useEffect(() => {
    let active = true;
    async function sync(force = false) {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      try {
        if (!force && revisionRef.current) {
          const info = await apiJson('/api/collection?meta=1');
          if (revisionRef.current === info.revision) return;
        }
        const data = await loadCloudAlbums();
        if (!active) return;
        setAlbums(data.albums || []);
        revisionRef.current = data.revision || '';
        setCloud({ loading: false, enabled: true, message: '' });
      } catch (err) {
        if (active && force) {
          setCloud({ loading: false, enabled: false, message: err.message || 'Błąd połączenia z D1.' });
        }
      } finally {
        refreshingRef.current = false;
      }
    }

    sync(true);
    const onFocus = () => sync(false);
    const onVisibility = () => { if (document.visibilityState === 'visible') sync(false); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    // Lekka synchronizacja bez ponownego pobierania wszystkich okładek.
    const timer = setInterval(() => { if (document.visibilityState === 'visible') sync(false); }, 90_000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  async function addAlbum(album) {
    if (!cloud.enabled) throw new Error('Brak połączenia z bazą Cloudflare D1. Odśwież stronę i spróbuj ponownie.');
    if (isDuplicateAlbum(album, albums)) {
      throw new Error(`Album „${album.artist} — ${album.title}” już istnieje w kolekcji.`);
    }
    const data = await createCloudAlbum(album);
    setAlbums((prev) => [data.album || album, ...prev]);
  }

  async function updateAlbum(album) {
    if (!cloud.enabled) throw new Error('Brak połączenia z bazą D1.');
    const data = await updateCloudAlbum(album);
    setAlbums((prev) => prev.map((item) => item.id === album.id ? (data.album || album) : item));
  }

  async function removeAlbum(id) {
    if (!cloud.enabled) throw new Error('Brak połączenia z bazą D1.');
    await deleteCloudAlbum(id);
    setAlbums((prev) => prev.filter((item) => item.id !== id));
  }

  const filtered = useMemo(() => {
    const q = normalizeText(query);
    const result = albums.filter((album) => {
      const haystack = normalizeText(`${album.artist} ${album.title} ${album.year} ${album.country} ${album.label}`);
      const matchesQuery = !q || haystack.includes(q);
      const matchesFormat = format === 'all' || (album.mediaFormat || album.format || '').toLowerCase().includes(format.toLowerCase());
      return matchesQuery && matchesFormat;
    });
    if (!q) return result; // bez wyszukiwania: kolejność dodania (najnowsze na górze)
    return [...result].sort((a, b) => {
      const yearA = Number.parseInt(a.year || a.released || '0', 10) || 0;
      const yearB = Number.parseInt(b.year || b.released || '0', 10) || 0;
      if (yearA !== yearB) return yearB - yearA;
      const artistCompare = String(a.artist || '').localeCompare(String(b.artist || ''), 'pl');
      return artistCompare || String(a.title || '').localeCompare(String(b.title || ''), 'pl');
    });
  }, [albums, query, format]);

  function exportJson() {
    const blob = new Blob([JSON.stringify(albums, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `biblioteka-plyt-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!cloud.enabled) {
      setImportStatus('Błąd: baza D1 jest niedostępna. Import został wstrzymany.');
      return;
    }
    setImportStatus('Odczytuję plik…');
    let saved = 0;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error('Plik nie zawiera tablicy albumów.');
      const seen = new Set(albums.map(albumKey));
      const imported = [];
      for (const item of parsed) {
        if (!item || typeof item !== 'object' || !item.artist || !item.title) continue;
        const album = { ...item, id: item.id || uid(), updatedAt: new Date().toISOString() };
        const key = albumKey(album);
        if (seen.has(key)) continue;
        seen.add(key);
        imported.push(album);
      }
      if (!imported.length) {
        setImportStatus('Nie znaleziono nowych albumów — wszystkie są już w kolekcji.');
        return;
      }
      for (const album of imported) {
        const data = await createCloudAlbum(album);
        setAlbums((prev) => [data.album || album, ...prev]);
        saved++;
        setImportStatus(`Import do D1: ${saved} / ${imported.length}`);
      }
      setImportStatus(`Zaimportowano ${saved} nowych albumów do Cloudflare D1.`);
    } catch (err) {
      setImportStatus(`Błąd importu: ${err.message}. Zapisano ${saved} albumów; pozostają one w bazie.`);
    }
  }

  return (
    <main>
      <section className="hero">
        <div>
          <div className="eyebrow">Prywatna kolekcja CD / LP</div>
          <h1>Biblioteka płyt</h1>
        </div>
        <div className="stats"><strong>{albums.length}</strong><span>albumów w kolekcji</span></div>
      </section>

      <section className="layout">
        <aside>
          <AddAlbumForm onAdd={addAlbum} />
          <div className="panel tools">
            <div className="panel-title">Backup</div>
            <button className="ghost full" onClick={exportJson} disabled={cloud.loading}><Download size={16} /> Eksport JSON</button>
            <label className="ghost full upload"><Upload size={16} /> Import JSON<input type="file" accept="application/json" onChange={importJson} disabled={!cloud.enabled} /></label>
            {importStatus ? <p className="hint" role="status">{importStatus}</p> : null}
          </div>
        </aside>

        <section className="collection">
          {!cloud.loading && !cloud.enabled ? (
            <div className="error cloud-error" role="alert"><AlertTriangle size={18} /> Nie można połączyć się z Cloudflare D1: {cloud.message}. Dodawanie jest wstrzymane — odśwież stronę po usunięciu problemu.</div>
          ) : null}
          <div className="toolbar">
            <div className="searchbox"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Szukaj po artyście, tytule, roku, kraju…" /></div>
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="all">Wszystkie formaty</option><option value="CD">CD</option><option value="LP">LP</option>
              <option value="Vinyl">Vinyl</option><option value="Cassette">Cassette</option>
            </select>
          </div>
          <div className="grid">
            {filtered.map((album) => <AlbumCard key={album.id} album={album} onDelete={removeAlbum} onUpdate={updateAlbum} />)}
          </div>
          {!filtered.length ? (
            <div className="empty"><Disc3 size={44} />
              <h2>{cloud.loading ? 'Ładuję kolekcję…' : 'Brak albumów'}</h2>
              <p>{cloud.loading ? 'Pobieram dane z Cloudflare D1.' : 'Dodaj płytę ręcznie albo wyszukaj ją w Discogs.'}</p>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
