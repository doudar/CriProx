import {
  elementPath,
  elementTransform,
  elementMatrix,
  parentMatrix,
  shapePath,
  type StickerDesign,
} from './sticker-design';
import { gradientStops, inverse, multiply } from './design-appearance';
const esc = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** One SVG renderer for editing, previews, export and print. Inputs must be validated. */
export function renderDesignContent(design: StickerDesign, prefix = 'art'): string {
  function siblings(parentId?: string | null): string {
    let content = '';
    const painted: string[] = [];
    for (const e of design.elements.filter(
      (e) => (e.parentId || null) === (parentId || null) && e.operation !== 'cut' && !e.hidden,
    )) {
      const id = `${prefix}-${e.id}`,
        w = e.width,
        h = e.height;
      let defs = '',
        fill = e.fill === 'transparent' ? 'none' : e.fill;
      if (e.gradient) {
        const g = e.gradient,
          stops = gradientStops(g)
            .map(
              (s) =>
                `<stop offset="${s.offset}" stop-color="${s.color}" stop-opacity="${s.opacity}"/>`,
            )
            .join('');
        if (g.type === 'radial')
          defs += `<radialGradient id="${id}-paint" cx="${g.cx ?? 0.5}" cy="${g.cy ?? 0.5}" r="${g.radius ?? 0.5}">${stops}</radialGradient>`;
        else {
          const a = ((g.angle ?? 0) * Math.PI) / 180,
            x = Math.cos(a) / 2,
            y = Math.sin(a) / 2;
          defs += `<linearGradient id="${id}-paint" x1="${0.5 - x}" y1="${0.5 - y}" x2="${0.5 + x}" y2="${0.5 + y}">${stops}</linearGradient>`;
        }
        fill = `url(#${id}-paint)`;
      }
      const shape = (paint: string) =>
        `<path d="${elementPath(e)}" fill="${paint}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
      let body = '';
      if (e.kind === 'group')
        body = `<g transform="scale(${w / e.groupWidth!} ${h / e.groupHeight!})">${siblings(e.id)}</g>`;
      else if (e.kind === 'image')
        body = `<image href="${e.image}" xlink:href="${e.image}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;
      else if (e.kind === 'text')
        body = `<text fill="${fill}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" paint-order="stroke fill" font-family="${e.font}" font-size="${e.fontSize}" font-weight="${e.bold ? 700 : 400}" text-anchor="${e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start'}">${e
          .text!.split('\n')
          .map(
            (line, i) =>
              `<tspan x="${e.align === 'center' ? w / 2 : e.align === 'right' ? w : 0}" y="${e.fontSize! * (1 + i * 1.2)}">${esc(line)}</tspan>`,
          )
          .join('')}</text>`;
      else body = shape(e.kind === 'shape' || e.closed ? fill : 'none');
      if (e.kind === 'text' && e.textPath) {
        const path = design.elements.find((p) => p.id === e.textPath!.pathId)!;
        const relative = multiply(
          inverse(multiply(parentMatrix(design, e), elementMatrix(e))),
          multiply(parentMatrix(design, path), elementMatrix(path)),
        );
        // Give closed guides a lap on either side of the requested position.
        // SVG otherwise drops glyphs that cross the start/end of a text path.
        const outline = elementPath(path);
        const start = outline.match(/^M\s*([-+\d.e]+)[ ,]+([-+\d.e]+)/i)!;
        const lap = outline.replace(/^M/, 'L').replace(/Z\s*$/i, `L${start[1]} ${start[2]}`);
        const wrapped = `M${start[1]} ${start[2]} ${lap} ${lap} ${lap}`;
        const offset = (100 + (e.textPath.offset % 100)) / 3;
        defs += `<path id="${id}-text-path" d="${wrapped}" transform="matrix(${relative.join(' ')})"/>`;
        const dy =
          e.textPath.side === 'inner'
            ? e.fontSize! * 0.85
            : e.textPath.side === 'middle'
              ? e.fontSize! * 0.35
              : -e.fontSize! * 0.15;
        body = `<text fill="${fill}" stroke="${e.stroke}" stroke-width="${e.strokeWidth}" paint-order="stroke fill" font-family="${e.font}" font-size="${e.fontSize}" font-weight="${e.bold ? 700 : 400}" text-anchor="${e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start'}" dy="${dy}"><textPath href="#${id}-text-path" xlink:href="#${id}-text-path" startOffset="${offset}%">${esc(e.text!.replaceAll('\n', ' '))}</textPath></text>`;
      }
      if (e.texture) {
        const t = e.texture;
        const textPaint = (paint: string) =>
          body
            .replace(`fill="${fill}"`, `fill="${paint}"`)
            .replace(`stroke="${e.stroke}"`, 'stroke="none"');

        defs += `<clipPath id="${id}-texture-clip"><path d="${elementPath(e)}"/></clipPath>`;
        if (t.type === 'image') {
          const size = 10 * t.scale;
          defs += `<pattern id="${id}-texture" patternUnits="userSpaceOnUse" width="${size}" height="${size}"><image href="${t.image}" xlink:href="${t.image}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice"/></pattern>`;
          body +=
            e.kind === 'text'
              ? `<g opacity="${t.opacity}">${textPaint(`url(#${id}-texture)`)}</g>`
              : `<rect width="${w}" height="${h}" fill="url(#${id}-texture)" opacity="${t.opacity}" clip-path="url(#${id}-texture-clip)"/>`;
        } else {
          const f = 1 / t.scale;
          const frequency =
            t.type === 'metal'
              ? `${f * 0.04} ${f * 2}`
              : t.type === 'stone'
                ? `${f * 0.15}`
                : `${f}`;
          defs += `<filter id="${id}-texture" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="${t.type === 'grain' ? 1 : 3}" seed="${t.seed}"/><feColorMatrix type="saturate" values="0"/>${t.type === 'paper' ? '<feComponentTransfer><feFuncR type="linear" slope=".35" intercept=".65"/><feFuncG type="linear" slope=".35" intercept=".62"/><feFuncB type="linear" slope=".35" intercept=".55"/></feComponentTransfer>' : ''}${e.kind === 'text' ? '<feComposite in2="SourceAlpha" operator="in"/>' : ''}</filter>`;
          body +=
            e.kind === 'text'
              ? `<g filter="url(#${id}-texture)" opacity="${t.opacity}" style="mix-blend-mode:multiply">${textPaint('white')}</g>`
              : `<g clip-path="url(#${id}-texture-clip)"><rect width="${w}" height="${h}" filter="url(#${id}-texture)" opacity="${t.opacity}" style="mix-blend-mode:multiply"/></g>`;
        }
      }
      if (e.adjustments) {
        const a = e.adjustments,
          gain = 2 ** (a.exposure ?? 0),
          contrast = a.contrast ?? 1,
          temp = a.temperature ?? 0,
          k = a.sharpen ?? 0;
        defs += `<filter id="${id}-adjust" color-interpolation-filters="sRGB"><feComponentTransfer>${['R', 'G', 'B'].map((c, i) => `<feFunc${c} type="linear" slope="${gain * contrast * (i === 0 ? 1 + temp * 0.25 : i === 2 ? 1 - temp * 0.25 : 1)}" intercept="${0.5 * (1 - contrast)}"/>`).join('')}</feComponentTransfer><feColorMatrix type="saturate" values="${a.saturation ?? 1}"/>${k ? `<feConvolveMatrix order="3" kernelMatrix="0 ${-k} 0 ${-k} ${1 + 4 * k} ${-k} 0 ${-k} 0" preserveAlpha="true"/>` : ''}</filter>`;
        body = `<g filter="url(#${id}-adjust)">${body}</g>`;
      }
      const fx = e.effects;
      if (fx?.backgroundBlur && content) {
        // Explicitly sample already-painted siblings; works in standalone exported SVG too.
        defs += `<filter id="${id}-backdrop" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${fx.backgroundBlur}"/></filter><clipPath id="${id}-backdrop-clip"><path d="${e.kind === 'shape' || e.kind === 'draw' ? elementPath(e) : shapePath('rectangle', w, h)}"/></clipPath>`;
        body = `<g clip-path="url(#${id}-backdrop-clip)"><g transform="matrix(${inverse(elementMatrix(e)).join(' ')})" filter="url(#${id}-backdrop)"><use href="#${id}-behind" xlink:href="#${id}-behind"/></g></g>${body}`;
        defs += `<g id="${id}-behind">${painted.map((previous) => `<use href="#${previous}" xlink:href="#${previous}"/>`).join('')}</g>`;
      }
      if (fx?.blur || fx?.shadows?.length) {
        let primitives = '',
          previous = 'SourceGraphic';
        if (fx.blur) {
          primitives += `<feGaussianBlur in="SourceGraphic" stdDeviation="${fx.blur}" result="soft"/>`;
          previous = 'soft';
        }
        for (const [i, s] of (fx.shadows ?? []).entries()) {
          const n = `shadow${i}`;
          primitives += `<feGaussianBlur in="SourceAlpha" stdDeviation="${s.blur}" result="${n}-blur"/><feOffset in="${n}-blur" dx="${s.type === 'glow' ? 0 : s.x}" dy="${s.type === 'glow' ? 0 : s.y}" result="${n}-offset"/>`;
          if (s.type === 'inner')
            primitives += `<feComposite in="SourceAlpha" in2="${n}-offset" operator="out" result="${n}-alpha"/>`;
          primitives += `<feFlood flood-color="${s.color}" flood-opacity="${s.opacity}" result="${n}-color"/><feComposite in="${n}-color" in2="${s.type === 'inner' ? n + '-alpha' : n + '-offset'}" operator="in" result="${n}-paint"/><feMerge result="${n}-result">${s.type === 'inner' ? `<feMergeNode in="${previous}"/><feMergeNode in="${n}-paint"/>` : `<feMergeNode in="${n}-paint"/><feMergeNode in="${previous}"/>`}</feMerge>`;
          previous = `${n}-result`;
        }
        const pad = Math.max(
          fx.blur ? fx.blur * 4 : 0,
          ...(fx.shadows ?? []).map((s) => s.blur * 4 + Math.max(Math.abs(s.x), Math.abs(s.y))),
        );
        defs += `<filter id="${id}-effects" filterUnits="userSpaceOnUse" x="${-pad}" y="${-pad}" width="${w + pad * 2}" height="${h + pad * 2}" color-interpolation-filters="sRGB">${primitives}</filter>`;
        body = `<g filter="url(#${id}-effects)">${body}</g>`;
      }
      if (e.mask) {
        const m = e.mask,
          fade = m.fade ?? 'none';
        let paint = 'white';
        if (fade !== 'none') {
          const stops =
            fade === 'radial'
              ? '<stop offset="0" stop-color="white"/><stop offset="1" stop-color="black"/>'
              : '<stop offset="0" stop-color="black"/><stop offset="1" stop-color="white"/>';
          defs +=
            fade === 'radial'
              ? `<radialGradient id="${id}-fade">${stops}</radialGradient>`
              : `<linearGradient id="${id}-fade" x1="${fade === 'right' ? 1 : 0}" y1="${fade === 'bottom' ? 1 : 0}" x2="${fade === 'left' ? 1 : 0}" y2="${fade === 'top' ? 1 : 0}">${stops}</linearGradient>`;
          paint = `url(#${id}-fade)`;
        }
        if (m.feather)
          defs += `<filter id="${id}-feather"><feGaussianBlur stdDeviation="${m.feather}"/></filter>`;
        defs += `<mask id="${id}-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}" style="mask-type:luminance"><path d="${shapePath(m.shape, w, h)}" fill="${paint}"${m.feather ? ` filter="url(#${id}-feather)"` : ''}/></mask>`;
        body = `<g mask="url(#${id}-mask)">${body}</g>`;
      }
      content += `<g id="${id}-layer" transform="${elementTransform(e)}" opacity="${e.opacity}" style="mix-blend-mode:${e.blendMode ?? 'normal'}${e.kind === 'group' ? ';isolation:isolate' : ''}"><defs>${defs}</defs>${body}</g>`;
      painted.push(`${id}-layer`);
    }
    return content;
  }
  return `<g style="isolation:isolate">${siblings()}</g>`;
}
