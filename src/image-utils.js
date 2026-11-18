// Okładki przechowujemy w D1 jako niewielkie Data URL.
// Obraz jest zmniejszany PRZED wysłaniem, aby nie przekraczać limitów D1.
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_DATA_URL_LENGTH = 300_000;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export async function imageFileToDataUrl(file) {
  if (!file) throw new Error('Nie wybrano pliku okładki.');
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error('Wybierz okładkę JPG, PNG, WebP lub GIF.');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('Plik ma ponad 15 MB. Wybierz mniejszy obraz.');
  }

  const objectUrl = URL.createObjectURL(file);
  let img;
  try {
    img = await new Promise((resolve, reject) => {
      const picture = new Image();
      picture.onload = () => resolve(picture);
      picture.onerror = () => reject(new Error('Nie można odczytać pliku graficznego.'));
      picture.src = objectUrl;
    });

    const originalWidth = img.naturalWidth;
    const originalHeight = img.naturalHeight;
    if (!originalWidth || !originalHeight) throw new Error('Niepoprawny obraz.');

    for (const maxSide of [850, 700, 550, 420]) {
      const scale = Math.min(1, maxSide / Math.max(originalWidth, originalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(originalWidth * scale));
      canvas.height = Math.max(1, Math.round(originalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Przeglądarka nie potrafi przetworzyć okładki.');
      ctx.fillStyle = '#ffffff'; // jednolite tło także dla przezroczystych PNG
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      for (const quality of [0.82, 0.72, 0.6, 0.48]) {
        let url = canvas.toDataURL('image/webp', quality);
        // Nie wszystkie starsze przeglądarki obsługują eksport WebP.
        if (!url.startsWith('data:image/webp;')) url = canvas.toDataURL('image/jpeg', quality);
        if (url.length <= MAX_DATA_URL_LENGTH) return url;
      }
    }
    throw new Error('Nie udało się dostatecznie zmniejszyć okładki. Spróbuj innego zdjęcia.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
