// Mixa, la gata del almacén: asoma por los bordes, suelta una frase y se vuelve a esconder.
const SVG = `<svg width="64" height="56" viewBox="0 0 64 56" aria-hidden="true">
<g class="mx-ear"><path d="M14 22 L17 3 L29 15 Z" fill="#E8833A"/><path d="M17 18 L18.5 8 L25 15 Z" fill="#F9B4A6"/></g>
<g class="mx-ear"><path d="M50 22 L47 3 L35 15 Z" fill="#E8833A"/><path d="M47 18 L45.5 8 L39 15 Z" fill="#F9B4A6"/></g>
<ellipse cx="32" cy="32" rx="21" ry="18" fill="#F29A4A"/>
<path d="M24 16 q2 5 0 9 M32 14 q1.5 5 0 10 M40 16 q-2 5 0 9" stroke="#D9732C" stroke-width="2.2" fill="none" stroke-linecap="round"/>
<ellipse cx="32" cy="40" rx="10" ry="7" fill="#FFF4E8"/>
<ellipse cx="24.5" cy="31" rx="4.2" ry="4.8" fill="#fff"/><ellipse cx="39.5" cy="31" rx="4.2" ry="4.8" fill="#fff"/>
<g class="mx-pupils"><g class="mx-eye"><ellipse cx="25" cy="31.5" rx="2.6" ry="3.4" fill="#1F2937"/><circle cx="26" cy="30" r=".9" fill="#fff"/></g>
<g class="mx-eye"><ellipse cx="40" cy="31.5" rx="2.6" ry="3.4" fill="#1F2937"/><circle cx="41" cy="30" r=".9" fill="#fff"/></g></g>
<path d="M30 37.5 h4 l-2 2.3 z" fill="#F07C8A"/>
<path d="M32 39.8 q-2.5 3 -5 1.2 M32 39.8 q2.5 3 5 1.2" stroke="#7C4A2D" stroke-width="1.2" fill="none" stroke-linecap="round"/>
<path d="M21 38 l-11 -2 M21 40.5 l-10 1.5 M43 38 l11 -2 M43 40.5 l10 1.5" stroke="#7C4A2D" stroke-width=".9" stroke-linecap="round" opacity=".7"/>
<ellipse cx="17" cy="53" rx="7" ry="4.5" fill="#F29A4A"/><ellipse cx="47" cy="53" rx="7" ry="4.5" fill="#F29A4A"/></svg>`;

// Escondites: borde de la ventana y dirección por la que asoma
const SPOTS = [
  { x: '86vw', y: '100vh', rot: 0 }, { x: '100vw', y: '58vh', rot: -90 }, { x: '0vw', y: '42vh', rot: 90 },
  { x: '24vw', y: '100vh', rot: 0 }, { x: '100vw', y: '28vh', rot: -90 },
];
const BUBBLE = { '0': ['0px', '-66px', 'translate(-50%,-100%)'], '90': ['66px', '0px', 'translate(0,-50%)'], '-90': ['-66px', '0px', 'translate(-100%,-50%)'] };

export class Mascot {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'mx';
    this.el.innerHTML = `<div class="mx-anchor"><div class="mx-clip"><button class="mx-cat" type="button" aria-label="Mixa, la gata: otra frase">${SVG}</button></div><div class="mx-bubble" role="status" aria-live="polite" hidden></div></div>`;
    document.body.appendChild(this.el);
    this.anchor = this.el.querySelector('.mx-anchor');
    this.clip = this.el.querySelector('.mx-clip');
    this.cat = this.el.querySelector('.mx-cat');
    this.bubble = this.el.querySelector('.mx-bubble');
    this.frases = ['Miau.']; this.i = 0; this.spot = 0;
    this.cat.addEventListener('click', () => this.say());
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) this.el.classList.add('mx-still');
    setTimeout(() => this.cycle(), 1500);
  }
  setPhrases(list) { if (list?.length) { this.frases = list; this.i = 0; } }
  place() {
    const s = SPOTS[this.spot % SPOTS.length];
    this.anchor.style.left = s.x; this.anchor.style.top = s.y;
    this.clip.style.transform = `rotate(${s.rot}deg)`;
    const b = BUBBLE[String(s.rot)];
    Object.assign(this.bubble.style, { left: b[0], top: b[1], transform: b[2] });
  }
  say(text) {
    if (!this.cat.classList.contains('mx-out')) {        // habla fuera de turno: asoma primero en su escondite
      clearTimeout(this.t); this.place(); this.cat.classList.add('mx-out');
      this.t = setTimeout(() => { this.bubble.hidden = true; this.cat.classList.remove('mx-out');
        this.t = setTimeout(() => { this.spot++; this.cycle(); }, 3000); }, 5200);
    }
    this.bubble.textContent = text || this.frases[this.i++ % this.frases.length];
    this.bubble.hidden = false;
    this.bubble.classList.remove('mx-pop'); void this.bubble.offsetWidth; this.bubble.classList.add('mx-pop');
  }
  cycle() {
    this.place();
    this.cat.classList.add('mx-out');
    this.t = setTimeout(() => {
      this.say();
      this.t = setTimeout(() => {
        this.bubble.hidden = true; this.cat.classList.remove('mx-out');
        this.t = setTimeout(() => { this.spot++; this.t = setTimeout(() => this.cycle(), 2500 + Math.random() * 2500); }, 600);
      }, 5200);
    }, 600);
  }
}
