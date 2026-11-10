// Catálogo A4 (794 × 1123 px por página). Sin precios, IVA ni datos del cliente: solo lo que se le pasa.
import { esc } from './util.js';

const PAGE_H = 1123, HEAD_H = 118, FOOT_H = 58, PAD = 28;
const BODY_H = PAGE_H - HEAD_H - FOOT_H - PAD;

/** Agrupa las líneas del presupuesto en bloques del catálogo */
export function buildBlocks(quote, cat) {
  const blocks = [];
  let group = null, cur = null;
  for (const l of quote.lines) {
    if (l.include === false) continue;
    if ((l.group || '') !== group) {
      group = l.group || '';
      if (group) blocks.push({ type: 'group', title: group });
      cur = null;
    }
    const p = l.match?.pi != null ? cat.product(l.match.pi) : null;
    const v = l.match?.vi != null ? cat.variants[l.match.vi] : null;
    const row = { ref: l.ref || v?.ref || '', title: l.title || v?.detalle || '', text: l.text || '', dims: l.dims || '' };
    if (p && cur && cur.product === p) { cur.rows.push(row); continue; }   // misma ficha y foto consecutiva → un bloque
    cur = p ? { type: 'product', product: p, rows: [row] } : { type: 'loose', rows: [row] };
    blocks.push(cur);
  }
  for (const e of quote.extras || []) {   // complementos añadidos en venta cruzada (Fase 4)
    const p = cat.product(e.pi);
    if (!blocks.some(b => b.extraTitle)) blocks.push({ type: 'group', title: 'TE PUEDE INTERESAR', extraTitle: true });
    if (p) blocks.push({ type: 'product', product: p, rows: [{ ref: e.ref || '', title: e.title || '', text: '', dims: '' }], extra: true });
  }
  return blocks;
}

function rowsTable(rows) {
  return `<table class="cb-refs"><tbody>${rows.map(r => `<tr><th>${esc(r.ref)}</th><td>${esc(r.title)}</td><td class="cb-dim">${esc(r.dims)}</td></tr>`).join('')}</tbody></table>`;
}

export function blockHTML(b) {
  if (b.type === 'group') return `<h2 class="cb-group">${esc(b.title)}</h2>`;
  if (b.type === 'loose') {
    const r = b.rows[0];
    return `<section class="cb cb-compact"><strong>${esc(r.ref)}</strong><span>${esc(r.text || r.title)}</span><em>${esc(r.dims)}</em></section>`;
  }
  const p = b.product, link = p.url ? `<a class="cb-link" href="${esc(p.url)}">Ver ficha ›</a>` : '';
  if (!p.photo) {
    return `<section class="cb cb-compact cb-nophoto"><div class="cb-info"><h3>${esc(p.name)}</h3>${rowsTable(b.rows)}${link}</div></section>`;
  }
  const one = b.rows.length === 1 ? b.rows[0] : null;
  const text = one ? one.text : (b.rows.find(r => r.text)?.text || '');
  return `<section class="cb${b.extra ? ' cb-extra' : ''}">
    <a class="cb-ph" href="${esc(p.url)}"><img src="${esc(p.photo)}" alt="" loading="eager" referrerpolicy="no-referrer"></a>
    <div class="cb-info">
      ${one ? `<div class="cb-meta"><strong>${esc(one.ref)}</strong>${one.dims ? ` · ${esc(one.dims)}` : ''}</div>` : ''}
      <h3>${esc(p.name)}</h3>
      ${text ? `<p class="cb-text">${esc(text)}</p>` : (p.desc ? `<p class="cb-text">${esc(p.desc)}</p>` : '')}
      ${one ? '' : rowsTable(b.rows)}
      ${link}
    </div></section>`;
}

function pageHTML(inner, n, total, head, foot) {
  return `<div class="a4"><header class="a4-head"><div class="a4-brand"><span class="a4-mark"></span>DISSET ODISEO <span>· CATÁLOGO DE PRODUCTOS</span></div>
    <div class="a4-offer">${head.offer ? `Oferta <strong>${esc(head.offer)}</strong><br>` : ''}${esc(head.date)}</div></header>
    <main class="a4-body">${inner}</main>
    <footer class="a4-foot"><span>${esc(foot)}</span><span>${n} / ${total}</span></footer></div>`;
}

/** Pagina midiendo la altura real de cada bloque. Los títulos de grupo nunca quedan solos al final. */
export async function renderCatalog(container, quote, cat, footer) {
  const blocks = buildBlocks(quote, cat);
  const meas = document.createElement('div');
  meas.className = 'a4-measure';
  meas.innerHTML = `<div class="a4"><main class="a4-body">${blocks.map(blockHTML).join('')}</main></div>`;
  document.body.appendChild(meas);
  const imgs = [...meas.querySelectorAll('img')];
  await Promise.all(imgs.map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; setTimeout(r, 6000); })));
  imgs.forEach(img => { if (!img.naturalWidth) markNoPhoto(img); });
  const els = [...meas.querySelector('.a4-body').children];
  const gap = 12;
  const pages = [[]]; let h = 0;
  els.forEach((el, i) => {
    const eh = el.offsetHeight + gap;
    const isGroup = el.classList.contains('cb-group');
    const nextH = isGroup && els[i + 1] ? els[i + 1].offsetHeight + gap : 0;
    if (h > 0 && h + eh + nextH > BODY_H) { pages.push([]); h = 0; }
    pages[pages.length - 1].push(el.outerHTML);
    h += eh;
  });
  meas.remove();
  container.innerHTML = pages.map((p, i) => pageHTML(p.join(''), i + 1, pages.length,
    { offer: quote.offer, date: quote.date }, footer)).join('');
  container.querySelectorAll('img').forEach(img => { img.onerror = () => markNoPhoto(img); });
  return pages.length;
}

function markNoPhoto(img) {
  const sec = img.closest('.cb');
  if (!sec) return;
  img.closest('.cb-ph')?.remove();
  sec.classList.add('cb-compact', 'cb-nophoto');
}
