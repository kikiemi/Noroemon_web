import { clamp } from '../types.js'
import { h, svg_el, ptr_capture } from './dom.js'
function fmt_val(v, unit, q) {
  const a = Math.abs(v)
  let d = a >= 100 ? 0 : a >= 10 ? 1 : 2
  const qd = q >= 1 ? 0 : q >= 0.1 ? 1 : 2
  if (qd < d) {
    d = qd
  }
  return v.toFixed(d) + unit
}
function snap(v, step) {
  return Math.round(v / step) * step
}
function wire_value_input(input, get, set, unit, q) {
  input.addEventListener('focus', () => {
    input.removeAttribute('readonly')
    input.select()
  })
  const apply = () => {
    input.setAttribute('readonly', '')
    const p = parseFloat(input.value)
    if (Number.isFinite(p)) {
      set(p)
    } else {
      input.value = fmt_val(get(), unit, q)
    }
  }
  input.addEventListener('blur', apply)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur()
    }
    if (e.key === 'Escape') {
      input.setAttribute('readonly', '')
      input.value = fmt_val(get(), unit, q)
      input.blur()
    }
  })
}
function wheel_armed(el, step) {
  let armed = false
  el.addEventListener('pointerdown', () => {
    armed = true
  })
  el.addEventListener('pointerleave', () => {
    armed = false
  })
  el.addEventListener(
    'wheel',
    (e) => {
      if (!armed) {
        return
      }
      e.preventDefault()
      const dir = e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0
      if (dir !== 0) {
        step(dir)
      }
    },
    { passive: false },
  )
}
const KNOB_A0 = -135
const KNOB_A1 = 135
function knob_polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}
function knob_arc_d(a0, a1) {
  const s = knob_polar(50, 50, 38, a1)
  const e = knob_polar(50, 50, 38, a0)
  const large = a1 - a0 <= 180 ? '0' : '1'
  return 'M ' + s.x + ' ' + s.y + ' A 38 38 0 ' + large + ' 0 ' + e.x + ' ' + e.y
}
function knob_render(k) {
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
  k.val_el.value = fmt_val(k.value, k.unit, k.fine)
}
export function knob_set(k, v, fire) {
  knob_set_q(k, v, k.fine, fire)
}
function knob_set_q(k, v, q, fire) {
  const nv = clamp(Math.round(snap(v, q) * 1e6) / 1e6, k.min, k.max)
  if (nv === k.value && !fire) {
    return
  }
  k.value = nv
  knob_render(k)
  if (fire && k.on_change) {
    k.on_change(k.value)
  }
}
export function knob_new(parent, label, min, max, value, step, unit, def, fine) {
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
  const k = {
    root,
    arc,
    needle,
    val_el,
    value: clamp(value, min, max),
    min,
    max,
    step,
    def: def ?? value,
    fine: fine ?? step,
    unit,
    on_change: null,
  }
  let drag_y = 0
  let drag_v = 0
  svg.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    ptr_capture(svg, e.pointerId)
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
    knob_set_q(k, drag_v + dv, e.shiftKey ? k.fine : k.step, true)
  })
  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const q = e.shiftKey ? k.fine : k.step
      const dir = e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0
      if (dir !== 0) {
        knob_set_q(k, k.value + dir * q, q, true)
      }
    },
    { passive: false },
  )
  const up = (e) => {
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
    (v) => knob_set_q(k, v, k.fine, true),
    unit,
    k.fine,
  )
  knob_render(k)
  return k
}
function slider_render(s) {
  const t = (s.value - s.min) / (s.max - s.min)
  s.fill.style.width = t * 100 + '%'
  s.thumb.style.left = t * 100 + '%'
  s.val_el.value = fmt_val(s.value, s.unit, s.step)
}
export function slider_set(s, v, fire) {
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
export function slider_new(parent, label, min, max, value, step, unit, def) {
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
  const s = {
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
  const from_x = (cx) => {
    const r = s.track.getBoundingClientRect()
    const t = clamp((cx - r.left) / r.width, 0, 1)
    return s.min + t * (s.max - s.min)
  }
  s.track.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    ptr_capture(s.track, e.pointerId)
    slider_set(s, from_x(e.clientX), true)
  })
  s.track.addEventListener('pointermove', (e) => {
    if (!s.track.hasPointerCapture(e.pointerId)) {
      return
    }
    slider_set(s, from_x(e.clientX), true)
  })
  const up = (e) => {
    if (s.track.hasPointerCapture(e.pointerId)) {
      s.track.releasePointerCapture(e.pointerId)
    }
  }
  s.track.addEventListener('pointerup', up)
  s.track.addEventListener('pointercancel', up)
  s.track.addEventListener('dblclick', () => slider_set(s, s.def, true))
  wheel_armed(s.track, (dir) => slider_set(s, s.value + dir * s.step, true))
  wire_value_input(
    s.val_el,
    () => s.value,
    (v) => slider_set(s, v, true),
    unit,
    s.step,
  )
  slider_render(s)
  return s
}
const EQ_RANGE = 12
function eq_render_one(b, i) {
  const t = ((b.values[i] ?? 0) + EQ_RANGE) / (EQ_RANGE * 2)
  const f = b.fills[i]
  if (f) {
    f.style.height = t * 100 + '%'
  }
}
export function eq_bank_set(b, gains) {
  gains.forEach((g, i) => {
    if (i < b.values.length) {
      b.values[i] = clamp(g, -EQ_RANGE, EQ_RANGE)
      eq_render_one(b, i)
    }
  })
}
export function eq_bank_new(parent, freqs, init) {
  const root = h('div', { class: 'eq-bank' })
  parent.appendChild(root)
  const b = {
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
    const from_y = (cy) => {
      const r = bar.getBoundingClientRect()
      const t = 1 - clamp((cy - r.top) / r.height, 0, 1)
      return Math.round((t * EQ_RANGE * 2 - EQ_RANGE) * 2) / 2
    }
    const apply = (cy) => {
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
      ptr_capture(bar, e.pointerId)
      apply(e.clientY)
    })
    bar.addEventListener('pointermove', (e) => {
      if (bar.hasPointerCapture(e.pointerId)) {
        apply(e.clientY)
      }
    })
    const up = (e) => {
      if (bar.hasPointerCapture(e.pointerId)) {
        bar.releasePointerCapture(e.pointerId)
      }
    }
    bar.addEventListener('pointerup', up)
    bar.addEventListener('pointercancel', up)
    wheel_armed(bar, (dir) => {
      const v = clamp((b.values[i] ?? 0) + dir * 0.5, -EQ_RANGE, EQ_RANGE)
      if (v !== b.values[i]) {
        b.values[i] = v
        eq_render_one(b, i)
        if (b.on_change) {
          b.on_change(i, v)
        }
      }
    })
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
