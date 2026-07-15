import { clamp } from '../types.js'
import { h, svg_el } from './dom.js'

function fmt_val(v: number, unit: string): string {
  const a = Math.abs(v)
  if (a >= 100) {
    return String(Math.round(v)) + unit
  }
  if (a >= 10) {
    return v.toFixed(1) + unit
  }
  return v.toFixed(2) + unit
}

function snap(v: number, step: number): number {
  return Math.round(v / step) * step
}

function wire_value_input(
  input: HTMLInputElement,
  get: () => number,
  set: (v: number) => void,
  unit: string,
): void {
  input.addEventListener('focus', () => {
    input.removeAttribute('readonly')
    input.select()
  })
  const apply = (): void => {
    input.setAttribute('readonly', '')
    const p = parseFloat(input.value)
    if (Number.isFinite(p)) {
      set(p)
    } else {
      input.value = fmt_val(get(), unit)
    }
  }
  input.addEventListener('blur', apply)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur()
    }
    if (e.key === 'Escape') {
      input.setAttribute('readonly', '')
      input.value = fmt_val(get(), unit)
      input.blur()
    }
  })
}

export type knob_t = {
  root: HTMLElement
  arc: SVGPathElement
  needle: SVGLineElement
  val_el: HTMLInputElement
  value: number
  min: number
  max: number
  step: number
  def: number
  unit: string
  on_change: ((v: number) => void) | null
}

const KNOB_A0 = -135
const KNOB_A1 = 135

function knob_polar(
  cx: number,
  cy: number,
  r: number,
  deg: number,
): {
  x: number
  y: number
} {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function knob_arc_d(a0: number, a1: number): string {
  const s = knob_polar(50, 50, 38, a1)
  const e = knob_polar(50, 50, 38, a0)
  const large = a1 - a0 <= 180 ? '0' : '1'
  return 'M ' + s.x + ' ' + s.y + ' A 38 38 0 ' + large + ' 0 ' + e.x + ' ' + e.y
}

function knob_render(k: knob_t): void {
  const t = (k.value - k.min) / (k.max - k.min)
  const ang = KNOB_A0 + t * (KNOB_A1 - KNOB_A0)

  if (k.min < 0 && k.max > 0) {
    const zt = (0 - k.min) / (k.max - k.min)
    const za = KNOB_A0 + zt * (KNOB_A1 - KNOB_A0)
    k.arc.setAttribute('d', ang < za ? knob_arc_d(ang, za) : knob_arc_d(za, ang))
  } else {
    k.arc.setAttribute('d', knob_arc_d(KNOB_A0, ang))
  }
  const p1 = knob_polar(50, 50, 14, ang)
  const p2 = knob_polar(50, 50, 27, ang)
  k.needle.setAttribute('x1', String(p1.x))
  k.needle.setAttribute('y1', String(p1.y))
  k.needle.setAttribute('x2', String(p2.x))
  k.needle.setAttribute('y2', String(p2.y))
  k.val_el.value = fmt_val(k.value, k.unit)
}

export function knob_set(k: knob_t, v: number, fire: boolean): void {
  const nv = clamp(snap(v, k.step), k.min, k.max)
  if (nv === k.value && !fire) {
    return
  }
  k.value = nv
  knob_render(k)
  if (fire && k.on_change) {
    k.on_change(k.value)
  }
}

export function knob_new(
  parent: HTMLElement,
  label: string,
  min: number,
  max: number,
  value: number,
  step: number,
  unit: string,
  def?: number,
): knob_t {
  const arc = svg_el('path', { class: 'knob-arc' })
  const needle = svg_el('line', { class: 'knob-needle' })
  const svg = svg_el('svg', { class: 'knob-svg', viewBox: '0 0 100 100' }, [
    svg_el('path', { class: 'knob-track', d: knob_arc_d(KNOB_A0, KNOB_A1) }),
    arc,
    svg_el('circle', { class: 'knob-disc', cx: '50', cy: '50', r: '27' }),
    needle,
  ])
  const val_el = h('input', {
    class: 'knob-val',
    attrs: { type: 'text', readonly: '', inputmode: 'decimal' },
  })
  const root = h('div', { class: 'knob' }, [
    h('span', { class: 'knob-label', text: label }),
    svg,
    val_el,
  ])
  parent.appendChild(root)

  const k: knob_t = {
    root,
    arc,
    needle,
    val_el,
    value: clamp(value, min, max),
    min,
    max,
    step,
    def: def ?? value,
    unit,
    on_change: null,
  }

  let drag_y = 0
  let drag_v = 0

  svg.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    svg.setPointerCapture(e.pointerId)
    drag_y = e.clientY
    drag_v = k.value
    root.classList.add('active')
  })
  svg.addEventListener('pointermove', (e) => {
    if (!svg.hasPointerCapture(e.pointerId)) {
      return
    }
    const fine = e.shiftKey ? 0.1 : 1
    const dv = (((drag_y - e.clientY) * (k.max - k.min)) / 200) * fine
    knob_set(k, drag_v + dv, true)
  })
  const up = (e: PointerEvent): void => {
    if (svg.hasPointerCapture(e.pointerId)) {
      svg.releasePointerCapture(e.pointerId)
    }
    root.classList.remove('active')
  }
  svg.addEventListener('pointerup', up)
  svg.addEventListener('pointercancel', up)
  svg.addEventListener('dblclick', () => knob_set(k, k.def, true))
  k.val_el.addEventListener('dblclick', () => knob_set(k, k.def, true))
  wire_value_input(
    k.val_el,
    () => k.value,
    (v) => knob_set(k, v, true),
    unit,
  )

  knob_render(k)
  return k
}

export type slider_t = {
  root: HTMLElement
  track: HTMLElement
  fill: HTMLElement
  thumb: HTMLElement
  val_el: HTMLInputElement
  value: number
  min: number
  max: number
  step: number
  def: number
  unit: string
  on_change: ((v: number) => void) | null
}

function slider_render(s: slider_t): void {
  const t = (s.value - s.min) / (s.max - s.min)
  s.fill.style.width = t * 100 + '%'
  s.thumb.style.left = t * 100 + '%'
  s.val_el.value = fmt_val(s.value, s.unit)
}

export function slider_set(s: slider_t, v: number, fire: boolean): void {
  const nv = clamp(snap(v, s.step), s.min, s.max)
  if (nv === s.value && !fire) {
    return
  }
  s.value = nv
  slider_render(s)
  if (fire && s.on_change) {
    s.on_change(s.value)
  }
}

export function slider_new(
  parent: HTMLElement,
  label: string,
  min: number,
  max: number,
  value: number,
  step: number,
  unit: string,
  def?: number,
): slider_t {
  const fill = h('div', { class: 'hs-fill' })
  const thumb = h('div', { class: 'hs-thumb' })
  const track = h('div', { class: 'hs-track' }, [fill, thumb])
  const val_el = h('input', {
    class: 'hs-val',
    attrs: { type: 'text', readonly: '', inputmode: 'decimal' },
  })
  const root = h('div', { class: 'hslider' }, [
    h('span', { class: 'hs-label', text: label }),
    track,
    val_el,
  ])
  parent.appendChild(root)

  const s: slider_t = {
    root,
    track,
    fill,
    thumb,
    val_el,
    value: clamp(value, min, max),
    min,
    max,
    step,
    def: def ?? value,
    unit,
    on_change: null,
  }

  const from_x = (cx: number): number => {
    const r = s.track.getBoundingClientRect()
    const t = clamp((cx - r.left) / r.width, 0, 1)
    return s.min + t * (s.max - s.min)
  }
  s.track.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    s.track.setPointerCapture(e.pointerId)
    slider_set(s, from_x(e.clientX), true)
  })
  s.track.addEventListener('pointermove', (e) => {
    if (!s.track.hasPointerCapture(e.pointerId)) {
      return
    }
    slider_set(s, from_x(e.clientX), true)
  })
  const up = (e: PointerEvent): void => {
    if (s.track.hasPointerCapture(e.pointerId)) {
      s.track.releasePointerCapture(e.pointerId)
    }
  }
  s.track.addEventListener('pointerup', up)
  s.track.addEventListener('pointercancel', up)
  s.track.addEventListener('dblclick', () => slider_set(s, s.def, true))
  wire_value_input(
    s.val_el,
    () => s.value,
    (v) => slider_set(s, v, true),
    unit,
  )

  slider_render(s)
  return s
}

export type eq_bank_t = {
  root: HTMLElement
  fills: HTMLElement[]
  values: number[]
  on_change: ((i: number, v: number) => void) | null
}

const EQ_RANGE = 12

function eq_render_one(b: eq_bank_t, i: number): void {
  const t = (b.values[i] + EQ_RANGE) / (EQ_RANGE * 2)
  const f = b.fills[i]
  if (f) {
    f.style.height = t * 100 + '%'
  }
}

export function eq_bank_set(b: eq_bank_t, gains: readonly number[]): void {
  gains.forEach((g, i) => {
    if (i < b.values.length) {
      b.values[i] = clamp(g, -EQ_RANGE, EQ_RANGE)
      eq_render_one(b, i)
    }
  })
}

export function eq_bank_new(
  parent: HTMLElement,
  freqs: readonly number[],
  init: readonly number[],
): eq_bank_t {
  const root = h('div', { class: 'eq-bank' })
  parent.appendChild(root)

  const b: eq_bank_t = {
    root,
    fills: [],
    values: freqs.map((_, i) => clamp(init[i] ?? 0, -EQ_RANGE, EQ_RANGE)),
    on_change: null,
  }

  freqs.forEach((freq, i) => {
    const fill = h('div', { class: 'eq-fill' })
    const bar = h('div', { class: 'eq-bar' }, [h('div', { class: 'eq-zero' }), fill])
    const col = h('div', { class: 'eq-col' }, [
      bar,
      h('span', {
        class: 'eq-freq',
        text: freq >= 1000 ? String(freq / 1000) + 'k' : String(freq),
      }),
    ])
    root.appendChild(col)
    b.fills.push(fill)
    eq_render_one(b, i)

    const from_y = (cy: number): number => {
      const r = bar.getBoundingClientRect()
      const t = 1 - clamp((cy - r.top) / r.height, 0, 1)
      return Math.round((t * EQ_RANGE * 2 - EQ_RANGE) * 2) / 2
    }
    const apply = (cy: number): void => {
      const v = from_y(cy)
      if (v !== b.values[i]) {
        b.values[i] = v
        eq_render_one(b, i)
        if (b.on_change) {
          b.on_change(i, v)
        }
      }
    }
    bar.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      bar.setPointerCapture(e.pointerId)
      apply(e.clientY)
    })
    bar.addEventListener('pointermove', (e) => {
      if (bar.hasPointerCapture(e.pointerId)) {
        apply(e.clientY)
      }
    })
    const up = (e: PointerEvent): void => {
      if (bar.hasPointerCapture(e.pointerId)) {
        bar.releasePointerCapture(e.pointerId)
      }
    }
    bar.addEventListener('pointerup', up)
    bar.addEventListener('pointercancel', up)
    bar.addEventListener('dblclick', () => {
      b.values[i] = 0
      eq_render_one(b, i)
      if (b.on_change) {
        b.on_change(i, 0)
      }
    })
  })

  return b
}
