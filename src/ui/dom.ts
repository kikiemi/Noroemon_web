export type h_opts_t = {
  class?: string
  id?: string
  title?: string
  text?: string
  attrs?: Readonly<Record<string, string>>
  dataset?: Readonly<Record<string, string>>
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts?: h_opts_t,
  children?: readonly (Node | string)[],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (opts) {
    if (opts.class !== undefined) {
      el.className = opts.class
    }
    if (opts.id !== undefined) {
      el.id = opts.id
    }
    if (opts.title !== undefined) {
      el.title = opts.title
    }
    if (opts.text !== undefined) {
      el.textContent = opts.text
    }
    if (opts.attrs) {
      for (const [k, v] of Object.entries(opts.attrs)) {
        el.setAttribute(k, v)
      }
    }
    if (opts.dataset) {
      for (const [k, v] of Object.entries(opts.dataset)) {
        el.dataset[k] = v
      }
    }
  }
  if (children) {
    for (const c of children) {
      el.append(c)
    }
  }
  return el
}

const SVG_NS = 'http://www.w3.org/2000/svg'

export function svg_el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Readonly<Record<string, string>>,
  children?: readonly (Node | string)[],
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag)
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v)
    }
  }
  if (children) {
    for (const c of children) {
      el.append(c)
    }
  }
  return el
}

export type icon_t =
  | 'play'
  | 'pause'
  | 'repeat'
  | 'repeat1'
  | 'repeatab'
  | 'list'
  | 'shuffle'
  | 'x'
  | 'pencil'

const STROKE: Readonly<Record<string, string>> = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
}

const REPEAT_D = 'M17 2l4 4-4 4M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 01-4 4H3'

function icon_label(text: string, size: string): SVGTextElement {
  return svg_el(
    'text',
    {
      x: '12',
      y: '15.5',
      'text-anchor': 'middle',
      fill: 'currentColor',
      'font-size': size,
      'font-weight': '700',
    },
    [text],
  )
}

function icon_dot(cx: string, cy: string): SVGCircleElement {
  return svg_el('circle', { cx, cy, r: '1.5', fill: 'currentColor' })
}

const ICON_BUILDERS: Readonly<Record<icon_t, () => SVGElement[]>> = {
  play: () => [svg_el('polygon', { points: '8,5 19,12 8,19', fill: 'currentColor' })],
  pause: () => [
    svg_el('rect', { x: '6', y: '5', width: '4', height: '14', rx: '1', fill: 'currentColor' }),
    svg_el('rect', { x: '14', y: '5', width: '4', height: '14', rx: '1', fill: 'currentColor' }),
  ],
  repeat: () => [svg_el('path', { d: REPEAT_D, ...STROKE })],
  repeat1: () => [svg_el('path', { d: REPEAT_D, ...STROKE }), icon_label('1', '9')],
  repeatab: () => [svg_el('path', { d: REPEAT_D, ...STROKE }), icon_label('AB', '8')],
  list: () => [
    svg_el('path', {
      d: 'M9 6h11M9 12h11M9 18h11',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
    }),
    icon_dot('4.5', '6'),
    icon_dot('4.5', '12'),
    icon_dot('4.5', '18'),
  ],
  shuffle: () => [
    svg_el('path', { d: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5', ...STROKE }),
  ],
  x: () => [
    svg_el('path', {
      d: 'M18 6L6 18M6 6l12 12',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
    }),
  ],
  pencil: () => [
    svg_el('path', {
      d: 'M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linejoin': 'round',
    }),
  ],
}

export function svg_icon(name: icon_t, size: number): SVGSVGElement {
  return svg_el(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: String(size),
      height: String(size),
      style: 'pointer-events:none;flex-shrink:0',
    },
    ICON_BUILDERS[name](),
  )
}

export function el_clear(el: HTMLElement): void {
  el.replaceChildren()
}

export function el_active(el: HTMLElement, on: boolean): void {
  el.classList.toggle('active', on)
}

export function el_swap(el: HTMLElement, ...children: readonly (Node | string)[]): void {
  el.replaceChildren(...children)
}

export function doc_hidden(): boolean {
  return document.hidden
}

export function on_visibility(cb: (hidden: boolean) => void): void {
  document.addEventListener('visibilitychange', () => cb(document.hidden))
}

export function by_id(id: string): HTMLElement | null {
  return document.getElementById(id)
}

export function body_dataset(key: string, value: string): void {
  document.body.dataset[key] = value
}

export function body_append(el: HTMLElement): void {
  document.body.appendChild(el)
}
