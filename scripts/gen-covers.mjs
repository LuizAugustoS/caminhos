// Gera as capas de paisagem (cartão-postal do Caparaó) por tema, em WebP.
// Saída: public/assets/covers/<slug>.webp (1600×1000) e <slug>_t.webp (400×250).
// Determinístico — mesmas capas a cada execução. Uso: node scripts/gen-covers.mjs
//
// As capas são placeholders temáticos da demo (produtores reais sobem as próprias
// fotos, que assumem o lugar da capa). Os arquivos ficam versionados em
// public/assets/covers; rode este script só quiser regenerá-los.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'public', 'assets', 'covers');
mkdirSync(OUT, { recursive: true });
const W = 1600, H = 1000;

// Ridge suave atravessando a largura, fechada até a base.
function ridge(baseY, amp, freq, phase, jag = 0.35) {
  const pts = [];
  for (let x = 0; x <= W; x += 32) {
    const t = x / W;
    const y = baseY
      + Math.sin(t * Math.PI * freq + phase) * amp
      + Math.sin(t * Math.PI * freq * 2.4 + phase * 1.7) * amp * jag;
    pts.push(`${x.toFixed(0)},${y.toFixed(1)}`);
  }
  return `M0,${H} L0,${pts[0].split(',')[1]} ` + pts.map(p => `L${p}`).join(' ') + ` L${W},${H} Z`;
}

// Pico anguloso (temas de montanha/trilha).
function peak(cx, baseY, halfW, height) {
  return `M${cx - halfW},${H} L${cx - halfW},${baseY} L${cx - halfW * 0.35},${baseY - height * 0.55} `
       + `L${cx},${baseY - height} L${cx + halfW * 0.4},${baseY - height * 0.5} L${cx + halfW},${baseY} L${cx + halfW},${H} Z`;
}

const themes = {
  cafe:      { sky: ['#F5DEBE', '#EBB98A'], sun: { cx: 1180, cy: 300, r: 120, c: '#F7EAD2' }, ridges: ['#B98E63', '#7C5C3E', '#41341F'] },
  queijo:    { sky: ['#F3ECD7', '#E7D6A8'], sun: { cx: 420,  cy: 260, r: 100, c: '#FBF4DD' }, ridges: ['#AFB98C', '#7E8F62', '#4C5A38'] },
  mel:       { sky: ['#F8E4B0', '#EFC169'], sun: { cx: 800,  cy: 320, r: 150, c: '#FDF3CE' }, ridges: ['#C79A57', '#9B7434', '#5E4620'] },
  arte:      { sky: ['#F0D6C2', '#D89A78'], sun: { cx: 1200, cy: 340, r: 110, c: '#F6E1D0' }, ridges: ['#C08663', '#8E5638', '#512E1E'] },
  trilha:    { sky: ['#CFE0D9', '#9BC0B4'], sun: { cx: 1120, cy: 270, r: 130, c: '#EFF6F0' }, ridges: ['#8AA98F', '#4E7B5C', '#234634'], peaky: true },
  pousada:   { sky: ['#E6EFDC', '#B9D0A0'], sun: { cx: 360,  cy: 300, r: 105, c: '#F3F8E9' }, ridges: ['#9DB77F', '#6E9152', '#3F5A30'] },
  cavalgada: { sky: ['#F4E2B6', '#E3B06E'], sun: { cx: 940,  cy: 340, r: 140, c: '#FBEFC9' }, ridges: ['#C2A05C', '#94702F', '#5A421D'] },
  festival:  { sky: ['#F2CDA6', '#C97E6A'], sun: { cx: 800,  cy: 360, r: 125, c: '#F8DEC6' }, ridges: ['#B87456', '#864733', '#4C271C'] },
  estrelas:  { sky: ['#1C2E37', '#0C4A38'], moon: { cx: 1220, cy: 250, r: 70, c: '#EAF1E4' }, ridges: ['#2C5D48', '#1C4030', '#0E2519'], night: true },
};

function svg(t) {
  const light = t.sun || t.moon;
  const stars = t.night
    ? Array.from({ length: 90 }, (_, i) => {
        const x = (i * 613 % W), y = (i * 271 % 520), r = (i % 3 === 0 ? 2.2 : 1.3);
        return `<circle cx="${x}" cy="${y}" r="${r}" fill="#F2F6EE" opacity="${0.5 + (i % 4) * 0.12}"/>`;
      }).join('')
    : '';
  const glow = light
    ? `<radialGradient id="glow" cx="50%" cy="50%" r="50%">
         <stop offset="0%" stop-color="${light.c}" stop-opacity="0.95"/>
         <stop offset="55%" stop-color="${light.c}" stop-opacity="0.35"/>
         <stop offset="100%" stop-color="${light.c}" stop-opacity="0"/>
       </radialGradient>`
    : '';
  const disc = light
    ? `<circle cx="${light.cx}" cy="${light.cy}" r="${light.r * 2.1}" fill="url(#glow)"/>
       <circle cx="${light.cx}" cy="${light.cy}" r="${light.r}" fill="${light.c}" opacity="0.92"/>`
    : '';
  const peaks = t.peaky
    ? `<path d="${peak(560, 560, 360, 300)}" fill="${t.ridges[2]}" opacity="0.9"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${t.sky[0]}"/>
        <stop offset="100%" stop-color="${t.sky[1]}"/>
      </linearGradient>
      ${glow}
    </defs>
    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    ${stars}
    ${disc}
    <path d="${ridge(560, 70, 2.1, 0.6)}" fill="${t.ridges[0]}" opacity="0.75"/>
    <path d="${ridge(660, 95, 1.6, 2.3)}" fill="${t.ridges[1]}" opacity="0.9"/>
    ${peaks}
    <path d="${ridge(790, 120, 1.2, 4.1, 0.5)}" fill="${t.ridges[2]}"/>
  </svg>`;
}

async function grain(w, h) {
  return sharp({ create: { width: w, height: h, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 10 } } })
    .png().toBuffer();
}

for (const [name, t] of Object.entries(themes)) {
  const g = await grain(W, H);
  const full = await sharp(Buffer.from(svg(t)))
    .composite([{ input: g, blend: 'overlay' }])
    .webp({ quality: 82 }).toBuffer();
  await sharp(full).toFile(join(OUT, `${name}.webp`));
  await sharp(full).resize(400, 250, { fit: 'cover' }).webp({ quality: 78 }).toFile(join(OUT, `${name}_t.webp`));
  console.log('cover:', name);
}
console.log('done');
