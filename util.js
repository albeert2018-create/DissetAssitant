export const normRef = s => String(s ?? '').toUpperCase().replace(/[\s.\-_/]/g, '');

export const normText = s => String(s ?? '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const STOP = new Set('de del la las el los y con para en a por sin un una al mm cm m x'.split(' '));
export const tokens = s => normText(s).split(' ').filter(t => t.length > 1 && !STOP.has(t));

export function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let i = 0; for (const x of A) if (B.has(x)) i++;
  return i / (A.size + B.size - i);
}

// Hash estable (FNV-1a) para generar ids internos permanentes a partir de la URL/slug
export function stableId(prefix, s) {
  let h = 0x811c9dc5;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  return prefix + '_' + (h >>> 0).toString(36);
}

export const uuid = () => crypto.randomUUID();

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const DIM_RE = /\b\d{2,5}(?:[.,]\d+)?\s*[x×X*]\s*\d{2,5}(?:[.,]\d+)?(?:\s*[x×X*]\s*\d{2,5}(?:[.,]\d+)?)?\s*(?:mm|cm|m)?\b/;

// Solo se aceptan fotos y enlaces de la web propia
const ALLOWED_HOSTS = /(^|\.)dissetodiseo\.com$/i;
export function safeDissetUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && ALLOWED_HOSTS.test(url.hostname) ? url.href : '';
  } catch { return ''; }
}
