import {
  h,
  svg_icon,
  el_clear,
  el_swap,
  el_active,
  doc_hidden,
  by_id,
  body_dataset,
  body_append,
  ptr_capture,
} from './dom.js'
import { knob_new, slider_new, eq_bank_new } from './widgets.js'
import { wf_new, wf_set_pos } from './waveform.js'
import { vz_new } from './visualizer.js'
import {
  fmt_time,
  EQ_BANDS,
  EQ_PRESETS,
  LOOP_NONE,
  LOOP_SINGLE,
  LOOP_AB,
  LOOP_MARK,
  LOOP_ALL,
  PLAY_SEQ,
  PLAY_SHUFFLE,
  PLAY_REPEAT1,
  PLAY_REPEATALL,
  THEME_AUTO,
  THEME_LIGHT,
  THEME_DARK,
  VIZ_BARS,
  VIZ_WAVE,
  PITCH_MIN,
  PITCH_MAX,
  TEMPO_MIN,
  TEMPO_MAX,
  RATE_MIN,
  RATE_MAX,
  SPECIALS,
  REVERB_TYPES,
  EXPORT_16,
  EXPORT_24,
  EXPORT_32F,
  AI_AUTO,
  AI_WEBGPU,
  AI_WASM,
  STEM_NAMES,
} from '../types.js'
const EL_IDS = [
  'btn-open',
  'btn-play',
  'btn-stop',
  'btn-prev',
  'btn-next',
  'btn-loop-mode',
  'btn-play-mode',
  'btn-ab-clear',
  'btn-set-a',
  'btn-set-b',
  'btn-marker',
  'btn-vocal',
  'btn-reverse',
  'btn-bc-toggle',
  'btn-export',
  'btn-formant',
  'btn-mod-toggle',
  'btn-comp-toggle',
  'btn-delay-toggle',
  'btn-dist-toggle',
  'btn-click',
  'btn-sep-run',
  'btn-reset-all',
  'btn-settings',
  'btn-theme',
  'btn-mic',
  'btn-add-playlist',
  'btn-add-track',
  'nav-player',
  'nav-playlist',
  'nav-fx',
  'time-current',
  'time-total',
  'track-name',
  'bpm-display',
  'key-display',
  'pitch-display',
  'param-area',
  'eq-area',
  'fx-area',
  'mod-area',
  'comp-area',
  'delay-area',
  'dist-area',
  'stereo-area',
  'practice-area',
  'sep-area',
  'waveform-area',
  'viz-container',
  'playlist-list',
]
const SEL_IDS = [
  'eq-preset-select',
  'mod-mode-select',
  'preset-select',
  'reverb-type-select',
  'delay-preset-select',
  'ch-mode-select',
  'special-select',
]
function need(id) {
  const el = by_id(id)
  if (!el) {
    throw new Error('DOM要素が見つかりません: #' + id)
  }
  return el
}
function need_sel(id) {
  const el = by_id(id)
  if (!(el instanceof HTMLSelectElement)) {
    throw new Error('#' + id + ' はselect要素である必要があります')
  }
  return el
}
export function refs_init() {
  const missing = []
  for (const id of [...EL_IDS, ...SEL_IDS]) {
    if (!by_id(id)) {
      missing.push('#' + id)
    }
  }
  if (missing.length > 0) {
    throw new Error('DOM要素が見つかりません: ' + missing.join(', ') + '(index.htmlが壊れています)')
  }
  const btn_export = need('btn-export')
  return {
    btn_open: need('btn-open'),
    btn_play: need('btn-play'),
    btn_stop: need('btn-stop'),
    btn_prev: need('btn-prev'),
    btn_next: need('btn-next'),
    btn_loop_mode: need('btn-loop-mode'),
    btn_play_mode: need('btn-play-mode'),
    btn_ab_clear: need('btn-ab-clear'),
    btn_set_a: need('btn-set-a'),
    btn_set_b: need('btn-set-b'),
    btn_marker: need('btn-marker'),
    btn_vocal: need('btn-vocal'),
    btn_reverse: need('btn-reverse'),
    btn_bc_toggle: need('btn-bc-toggle'),
    btn_export,
    btn_formant: need('btn-formant'),
    btn_mod_toggle: need('btn-mod-toggle'),
    btn_comp_toggle: need('btn-comp-toggle'),
    btn_delay_toggle: need('btn-delay-toggle'),
    btn_dist_toggle: need('btn-dist-toggle'),
    btn_click: need('btn-click'),
    btn_sep_run: need('btn-sep-run'),
    btn_reset_all: need('btn-reset-all'),
    btn_settings: need('btn-settings'),
    btn_theme: need('btn-theme'),
    btn_mic: need('btn-mic'),
    btn_add_playlist: need('btn-add-playlist'),
    btn_add_track: need('btn-add-track'),
    nav_player: need('nav-player'),
    nav_playlist: need('nav-playlist'),
    nav_fx: need('nav-fx'),
    time_current: need('time-current'),
    time_total: need('time-total'),
    track_name: need('track-name'),
    bpm_display: need('bpm-display'),
    key_display: need('key-display'),
    pitch_display: need('pitch-display'),
    param_area: need('param-area'),
    eq_area: need('eq-area'),
    fx_area: need('fx-area'),
    mod_area: need('mod-area'),
    comp_area: need('comp-area'),
    delay_area: need('delay-area'),
    dist_area: need('dist-area'),
    stereo_area: need('stereo-area'),
    practice_area: need('practice-area'),
    sep_area: need('sep-area'),
    waveform_area: need('waveform-area'),
    viz_container: need('viz-container'),
    playlist_list: need('playlist-list'),
    eq_preset_select: need_sel('eq-preset-select'),
    mod_mode_select: need_sel('mod-mode-select'),
    preset_select: need_sel('preset-select'),
    reverb_type_select: need_sel('reverb-type-select'),
    delay_preset_select: need_sel('delay-preset-select'),
    ch_mode_select: need_sel('ch-mode-select'),
    special_select: need_sel('special-select'),
    export_default: Array.from(btn_export.childNodes),
  }
}
export function view_fatal(msg) {
  if (document.querySelector('.fatal-overlay')) {
    return
  }
  const btn = h('button', { text: '再読み込み' })
  btn.addEventListener('click', () => location.reload())
  body_append(
    h('div', { class: 'fatal-overlay' }, [
      h('div', { class: 'fatal-box' }, [
        h('h2', { text: '起動に失敗しました' }),
        h('pre', { text: msg }),
        btn,
      ]),
    ]),
  )
}
let booted = false
export function view_booted() {
  booted = true
}
export function view_global_errors() {
  window.addEventListener('error', (e) => {
    if (e.error === null && e.message.startsWith('ResizeObserver')) {
      return
    }
    if (booted) {
      view_toast('エラー: ' + e.message, true)
      return
    }
    view_fatal(e.message + '\n' + (e.filename ?? '') + ':' + String(e.lineno ?? ''))
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    view_toast('エラー: ' + (r instanceof Error ? r.message : String(r)), true)
  })
}
export function view_toast(msg, is_err) {
  for (const prev of document.querySelectorAll('.toast')) {
    prev.remove()
  }
  const t = h('div', { class: 'toast' + (is_err ? ' err' : ''), text: msg })
  body_append(t)
  requestAnimationFrame(() => t.classList.add('show'))
  window.setTimeout(() => {
    t.classList.remove('show')
    window.setTimeout(() => t.remove(), 250)
  }, 3000)
}
export function view_confirm(msg) {
  return window.confirm(msg)
}
export function view_prompt(msg, def) {
  return window.prompt(msg, def)
}
export function view_pick_files(accept, cb) {
  const input = h('input', { attrs: { type: 'file', multiple: '', accept } })
  input.addEventListener('change', () => {
    const files = input.files
    if (files && files.length > 0) {
      cb(Array.from(files))
    }
  })
  input.click()
}
export function view_play_btn(refs, playing) {
  el_swap(refs.btn_play, svg_icon(playing ? 'pause' : 'play', 26))
}
export function view_play_enabled(refs, enabled) {
  if (enabled) {
    refs.btn_play.removeAttribute('disabled')
  } else {
    refs.btn_play.setAttribute('disabled', '')
  }
}
export function view_loop_btn(refs, mode) {
  const icons = {
    [LOOP_NONE]: svg_icon('repeat', 17),
    [LOOP_SINGLE]: svg_icon('repeat1', 17),
    [LOOP_AB]: svg_icon('repeatab', 17),
    [LOOP_MARK]: svg_icon('repeatmk', 17),
    [LOOP_ALL]: svg_icon('repeat', 17),
  }
  const titles = {
    [LOOP_NONE]: 'ループ: なし',
    [LOOP_SINGLE]: 'ループ: 1曲',
    [LOOP_AB]: 'ループ: A-B区間',
    [LOOP_MARK]: 'ループ: マーカー間',
    [LOOP_ALL]: 'ループ: 全曲',
  }
  el_swap(refs.btn_loop_mode, icons[mode])
  refs.btn_loop_mode.title = titles[mode]
  el_active(refs.btn_loop_mode, mode !== LOOP_NONE)
}
export function view_play_mode_btn(refs, mode) {
  const icons = {
    [PLAY_SEQ]: svg_icon('list', 17),
    [PLAY_SHUFFLE]: svg_icon('shuffle', 17),
    [PLAY_REPEAT1]: svg_icon('repeat1', 17),
    [PLAY_REPEATALL]: svg_icon('repeat', 17),
  }
  const titles = {
    [PLAY_SEQ]: '再生順: リスト順',
    [PLAY_SHUFFLE]: '再生順: シャッフル',
    [PLAY_REPEAT1]: '再生順: 1曲リピート',
    [PLAY_REPEATALL]: '再生順: 全曲リピート',
  }
  el_swap(refs.btn_play_mode, icons[mode])
  refs.btn_play_mode.title = titles[mode]
  el_active(refs.btn_play_mode, mode !== PLAY_SEQ)
}
export function view_toggles(refs, st) {
  el_active(refs.btn_vocal, st.vocalCancel)
  el_active(refs.btn_reverse, st.reverse)
  el_active(refs.btn_bc_toggle, st.bitcrusherEnabled)
  el_active(refs.btn_formant, st.formant)
  el_active(refs.btn_mod_toggle, st.mod.en)
  el_active(refs.btn_comp_toggle, st.comp.en)
  el_active(refs.btn_delay_toggle, st.delay.en)
  el_active(refs.btn_dist_toggle, st.dist.en)
  el_active(refs.btn_click, st.practice.click)
}
export function view_toggle(refs, key, on) {
  el_active(refs[key], on)
}
export function view_track_name(refs, text, hover_title) {
  refs.track_name.textContent = text
  refs.track_name.title = hover_title ? text : ''
}
export function view_time_current(refs, sec) {
  refs.time_current.textContent = fmt_time(sec)
}
export function view_time_total(refs, sec) {
  refs.time_total.textContent = fmt_time(sec)
}
export function view_position(refs, wf, cur, total) {
  if (doc_hidden()) {
    return
  }
  view_time_current(refs, cur)
  if (total > 0) {
    wf_set_pos(wf, cur / total)
  }
}
export function view_bpm(refs, bpm, speed) {
  if (!(bpm > 0)) {
    refs.bpm_display.textContent = '-- BPM'
    return
  }
  if (Math.abs(speed - 1) < 0.005) {
    refs.bpm_display.textContent = String(bpm) + ' BPM'
    return
  }
  refs.bpm_display.textContent = String(Math.round(bpm * speed * 10) / 10) + ' BPM'
  refs.bpm_display.title = '原曲 ' + String(bpm) + ' BPM'
}
export function view_key(refs, text, title) {
  refs.key_display.textContent = text === '' ? 'Key --' : text
  refs.key_display.title = title
}
export function view_pitch_chip(refs, text) {
  if (refs.pitch_display.textContent !== text) {
    refs.pitch_display.textContent = text
  }
}
export function view_export_busy(refs, busy, text) {
  if (busy) {
    refs.btn_export.textContent = text
    refs.btn_export.classList.add('disabled')
  } else {
    el_swap(refs.btn_export, ...refs.export_default)
    refs.btn_export.classList.remove('disabled')
  }
}
export function view_set_view(refs, v) {
  body_dataset('view', v)
  el_active(refs.nav_playlist, v === 'playlist')
  el_active(refs.nav_player, v === 'player')
  el_active(refs.nav_fx, v === 'fx')
}
function sep_view_new(parent) {
  const status = h('div', { class: 'sep-status', text: '' })
  const bar = h('div', { class: 'sep-bar' })
  const bar_track = h('div', { class: 'sep-bar-track' }, [bar])
  const stems = h('div')
  const b_export = h('button', {
    class: 'chip-btn',
    text: 'ステム書き出し',
    title: '分離した各パートをWAVで保存',
  })
  const b_clear = h('button', { class: 'chip-btn', text: '分離を解除', title: '元の音源に戻す' })
  const btns = h('div', { class: 'btn-row' }, [b_export, b_clear])
  bar_track.style.display = 'none'
  btns.style.display = 'none'
  parent.append(status, bar_track, stems, btns)
  return { status, bar_track, bar, stems, btns, b_export, b_clear }
}
export function sep_view_status(v, text) {
  v.status.textContent = text
}
export function sep_view_progress(v, frac) {
  if (frac === null) {
    v.bar_track.style.display = 'none'
    return
  }
  v.bar_track.style.display = ''
  v.bar.style.width = String(Math.round(Math.min(1, Math.max(0, frac)) * 1000) / 10) + '%'
}
export function sep_view_run_btn(refs, busy) {
  refs.btn_sep_run.textContent = busy ? '中止' : '分離する'
  el_active(refs.btn_sep_run, busy)
}
export function sep_view_stems(v, rows, hd) {
  el_clear(v.stems)
  v.btns.style.display = rows.length > 0 ? '' : 'none'
  for (const r of rows) {
    const holder = h('div')
    const s = slider_new(holder, STEM_NAMES[r.name] ?? r.name, 0, 200, r.gain * 100, 1, '%', 100)
    s.root.classList.add('compact')
    s.on_change = (val) => hd.on_gain(r.name, val / 100)
    const m = h('button', {
      class: 'chip-btn' + (r.mute ? ' active' : ''),
      text: 'M',
      title: 'ミュート',
    })
    const so = h('button', {
      class: 'chip-btn' + (r.solo ? ' active' : ''),
      text: 'S',
      title: 'ソロ',
    })
    m.addEventListener('click', () => hd.on_mute(r.name))
    so.addEventListener('click', () => hd.on_solo(r.name))
    v.stems.appendChild(h('div', { class: 'stem-row' }, [s.root, m, so]))
  }
}
export function view_controls_new(refs, st) {
  const pa = refs.param_area
  const fx = refs.fx_area
  const ma = refs.mod_area
  const ca = refs.comp_area
  const da = refs.delay_area
  const xa = refs.dist_area
  const sa = refs.stereo_area
  const pr = refs.practice_area
  const b_dpp = h('button', { class: 'chip-btn', text: 'ピンポン', title: '左右に跳ね返るエコー' })
  const ui = {
    wf: wf_new(refs.waveform_area),
    vz: vz_new(refs.viz_container),
    eq: eq_bank_new(refs.eq_area, EQ_BANDS, st.eqGains),
    k_pitch: knob_new(pa, 'ピッチ', PITCH_MIN, PITCH_MAX, st.pitch, 0.5, ' st', 0, 0.01),
    k_tempo: knob_new(
      pa,
      'テンポ',
      TEMPO_MIN * 100,
      TEMPO_MAX * 100,
      st.tempo * 100,
      1,
      '%',
      100,
      0.1,
    ),
    k_rate: knob_new(pa, '周波数', RATE_MIN * 100, RATE_MAX * 100, st.rate * 100, 1, '%', 100, 0.1),
    k_vol: knob_new(pa, '音量', 0, 100, st.volume * 100, 1, '%', 80),
    s_reverb: slider_new(fx, 'リバーブ', 0, 100, st.reverb * 100, 1, '%', 0),
    s_bits: slider_new(fx, 'ビット深度', 1, 16, st.bitcrusherBits, 1, ' bit', 16),
    s_red: slider_new(fx, 'ダウンサンプル', 1, 32, st.bitcrusherReduction, 1, 'x', 1),
    k_mrate: knob_new(ma, 'レート', 0.01, 10, st.mod.rate, 0.01, ' Hz', 0.5),
    k_mdepth: knob_new(ma, '深さ', 0, 1, st.mod.depth, 0.01, '', 0.5),
    k_mfb: knob_new(ma, 'FB', -0.95, 0.95, st.mod.fb, 0.01, '', 0.3),
    k_mmix: knob_new(ma, 'ミックス', 0, 1, st.mod.mix, 0.01, '', 0.5),
    s_cthr: slider_new(ca, 'スレッショルド', -60, 0, st.comp.thr, 1, ' dB', -10),
    s_crat: slider_new(ca, 'レシオ', 1, 20, st.comp.rat, 0.5, ':1', 4),
    s_catk: slider_new(ca, 'アタック', 0.1, 200, st.comp.atk, 0.1, ' ms', 10),
    s_crel: slider_new(ca, 'リリース', 10, 2000, st.comp.rel, 1, ' ms', 100),
    s_cmk: slider_new(ca, 'メイクアップ', 0, 40, st.comp.mkup, 0.5, ' dB', 0),
    s_dtime: slider_new(da, 'ディレイ時間', 10, 2000, st.delay.time, 1, ' ms', 350),
    s_dfb: slider_new(da, 'フィードバック', 0, 95, st.delay.fb * 100, 1, '%', 35),
    s_dmix: slider_new(da, 'ミックス', 0, 100, st.delay.mix * 100, 1, '%', 30),
    s_ddamp: slider_new(da, 'こもり', 0, 100, st.delay.damp * 100, 1, '%', 30),
    b_dpp,
    s_xdrive: slider_new(xa, 'ドライブ', 0, 48, st.dist.drive, 0.5, ' dB', 12),
    s_xtone: slider_new(xa, 'トーン', 0, 100, st.dist.tone * 100, 1, '%', 60),
    s_xmix: slider_new(xa, 'ミックス', 0, 100, st.dist.mix * 100, 1, '%', 100),
    s_pan: slider_new(sa, 'パン', -100, 100, st.pan * 100, 1, '', 0),
    s_width: slider_new(sa, 'ステレオ幅', 0, 200, st.width * 100, 1, '%', 100),
    s_lcount: slider_new(pr, 'ループ回数', 0, 20, st.practice.loopCount, 1, '回', 0),
    s_lstep: slider_new(pr, '1周ごと', -10, 10, st.practice.loopStep, 0.5, '%', 0),
    s_ltarget: slider_new(pr, '目標テンポ', 25, 400, st.practice.loopTarget, 1, '%', 100),
    s_clickvol: slider_new(pr, 'クリック音量', 0, 100, st.practice.clickVol * 100, 1, '%', 50),
    sep: sep_view_new(refs.sep_area),
  }
  da.appendChild(h('div', { class: 'btn-row' }, [b_dpp]))
  el_active(b_dpp, st.delay.pp)
  ui.s_lcount.root.title = '0 はずっとループ。回数に達するとループを抜けて先へ進みます'
  ui.s_lstep.root.title = 'A-B/マーカーループが1周するたびにテンポを変える（だんだん速く/遅く）'
  ui.s_ltarget.root.title = '1周ごとのテンポ変化がここで止まる'
  for (const p of EQ_PRESETS) {
    refs.eq_preset_select.appendChild(h('option', { text: p.name, attrs: { value: p.name } }))
  }
  for (const r of REVERB_TYPES) {
    refs.reverb_type_select.appendChild(h('option', { text: r.name, attrs: { value: r.id } }))
  }
  for (const sp of SPECIALS) {
    refs.special_select.appendChild(h('option', { text: sp.name, attrs: { value: sp.id } }))
  }
  refs.mod_mode_select.value = st.mod.mode
  refs.reverb_type_select.value = st.reverbType
  refs.ch_mode_select.value = String(st.chMode)
  refs.special_select.value = st.practice.special
  return ui
}
export function view_fill_select(sel, head, names) {
  el_clear(sel)
  sel.appendChild(h('option', { text: head, attrs: { value: '' } }))
  for (const n of names) {
    sel.appendChild(h('option', { text: n, attrs: { value: n } }))
  }
  sel.value = ''
}
function card_collapsible() {
  let saved = {}
  try {
    const raw = localStorage.getItem('wf-collapsed')
    if (raw) {
      const j = JSON.parse(raw)
      if (typeof j === 'object' && j !== null) {
        for (const k of Object.keys(j)) {
          const v = Reflect.get(j, k)
          if (typeof v === 'boolean') {
            saved[k] = v
          }
        }
      }
    }
  } catch {
    saved = {}
  }
  const defaults = { dl: true, ds: true, st: true, pr: false }
  for (const card of document.querySelectorAll('.card[data-card]')) {
    const key = card.dataset['card'] ?? ''
    const title = card.querySelector('.card-title')
    if (!title) {
      continue
    }
    title.prepend(svg_icon('chev', 10))
    const collapsed = saved[key] ?? defaults[key] ?? false
    card.classList.toggle('collapsed', collapsed)
    title.title = 'クリックで開閉'
    title.addEventListener('click', () => {
      const now = !card.classList.contains('collapsed')
      card.classList.toggle('collapsed', now)
      saved[key] = now
      try {
        localStorage.setItem('wf-collapsed', JSON.stringify(saved))
      } catch {}
    })
  }
}
function drop_wire(on_files) {
  let depth = 0
  let ov = null
  const has_files = (e) => {
    const t = e.dataTransfer
    return t !== null && Array.from(t.types).includes('Files')
  }
  const hide = () => {
    depth = 0
    if (ov) {
      ov.remove()
      ov = null
    }
  }
  window.addEventListener('dragenter', (e) => {
    if (!has_files(e)) {
      return
    }
    e.preventDefault()
    depth++
    if (!ov) {
      ov = h('div', { class: 'drop-overlay' }, [
        h('div', { class: 'drop-box', text: 'ここにドロップして曲を追加' }),
      ])
      body_append(ov)
    }
  })
  window.addEventListener('dragover', (e) => {
    if (has_files(e)) {
      e.preventDefault()
    }
  })
  window.addEventListener('dragleave', (e) => {
    if (!has_files(e)) {
      return
    }
    depth--
    if (depth <= 0) {
      hide()
    }
  })
  window.addEventListener('drop', (e) => {
    if (!has_files(e)) {
      return
    }
    e.preventDefault()
    hide()
    const t = e.dataTransfer
    if (!t) {
      return
    }
    void collect_drop(t).then((files) => {
      if (files.length > 0) {
        on_files(files)
      }
    })
  })
}
function entry_files(entry, out, depth) {
  if (entry instanceof FileSystemFileEntry || entry.isFile) {
    return new Promise((resolve) => {
      if (!(entry instanceof FileSystemFileEntry)) {
        resolve()
        return
      }
      entry.file(
        (f) => {
          out.push(f)
          resolve()
        },
        () => resolve(),
      )
    })
  }
  if (depth > 6 || !(entry instanceof FileSystemDirectoryEntry)) {
    return Promise.resolve()
  }
  const rd = entry.createReader()
  return new Promise((resolve) => {
    const all = []
    const step = () => {
      rd.readEntries(
        (list) => {
          if (list.length === 0) {
            void Promise.all(all.map((x) => entry_files(x, out, depth + 1))).then(() => resolve())
            return
          }
          all.push(...list)
          step()
        },
        () => resolve(),
      )
    }
    step()
  })
}
async function collect_drop(t) {
  const out = []
  const entries = []
  for (const it of Array.from(t.items)) {
    if (it.kind !== 'file') {
      continue
    }
    const en = typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null
    if (en) {
      entries.push(en)
    } else {
      const f = it.getAsFile()
      if (f) {
        out.push(f)
      }
    }
  }
  for (const en of entries) {
    await entry_files(en, out, 0)
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }))
  return out
}
export function view_wire(refs, ui, hd) {
  refs.btn_open.addEventListener('click', hd.on_open)
  refs.btn_play.addEventListener('click', hd.on_play_toggle)
  refs.btn_stop.addEventListener('click', hd.on_stop)
  refs.btn_prev.addEventListener('click', hd.on_prev)
  refs.btn_next.addEventListener('click', hd.on_next)
  refs.btn_loop_mode.addEventListener('click', hd.on_loop_cycle)
  refs.btn_play_mode.addEventListener('click', hd.on_play_mode_cycle)
  refs.btn_ab_clear.addEventListener('click', hd.on_ab_clear)
  refs.btn_set_a.addEventListener('click', hd.on_set_a)
  refs.btn_set_b.addEventListener('click', hd.on_set_b)
  refs.btn_marker.addEventListener('click', hd.on_marker_add)
  refs.btn_vocal.addEventListener('click', hd.on_vocal)
  refs.btn_reverse.addEventListener('click', hd.on_reverse)
  refs.btn_bc_toggle.addEventListener('click', hd.on_bc)
  refs.btn_formant.addEventListener('click', hd.on_formant)
  refs.btn_mod_toggle.addEventListener('click', hd.on_mod)
  refs.btn_comp_toggle.addEventListener('click', hd.on_comp)
  refs.btn_delay_toggle.addEventListener('click', hd.on_delay)
  refs.btn_dist_toggle.addEventListener('click', hd.on_dist)
  refs.btn_click.addEventListener('click', hd.on_click)
  refs.btn_sep_run.addEventListener('click', hd.on_sep_run)
  refs.btn_reset_all.addEventListener('click', hd.on_reset_all)
  ui.b_dpp.addEventListener('click', hd.on_delay_pp)
  ui.sep.b_export.addEventListener('click', hd.on_sep_export)
  ui.sep.b_clear.addEventListener('click', hd.on_sep_clear)
  refs.btn_export.addEventListener('click', hd.on_export)
  refs.btn_settings.addEventListener('click', hd.on_settings)
  refs.btn_theme.addEventListener('click', hd.on_theme)
  refs.btn_mic.addEventListener('click', hd.on_mic)
  refs.btn_add_playlist.addEventListener('click', hd.on_add_playlist)
  refs.btn_add_track.addEventListener('click', hd.on_add_track)
  refs.nav_player.addEventListener('click', () => hd.on_nav('player'))
  refs.nav_playlist.addEventListener('click', () => hd.on_nav('playlist'))
  refs.nav_fx.addEventListener('click', () => hd.on_nav('fx'))
  refs.eq_preset_select.addEventListener('change', () => {
    hd.on_eq_preset(refs.eq_preset_select.value)
    refs.eq_preset_select.value = ''
  })
  refs.mod_mode_select.addEventListener('change', () => hd.on_mod_mode(refs.mod_mode_select.value))
  refs.reverb_type_select.addEventListener('change', () =>
    hd.on_reverb_type(refs.reverb_type_select.value),
  )
  refs.delay_preset_select.addEventListener('change', () => {
    hd.on_delay_preset(refs.delay_preset_select.value)
    refs.delay_preset_select.value = ''
  })
  refs.ch_mode_select.addEventListener('change', () => hd.on_ch_mode(refs.ch_mode_select.value))
  refs.special_select.addEventListener('change', () => hd.on_special(refs.special_select.value))
  refs.preset_select.addEventListener('change', () => {
    const v = refs.preset_select.value
    refs.preset_select.value = ''
    hd.on_preset(v)
  })
  ui.vz.canvas.addEventListener('click', hd.on_viz_click)
  card_collapsible()
  drop_wire(hd.on_files)
  window.addEventListener('keydown', (e) => {
    const t = e.target
    if (
      t instanceof HTMLInputElement ||
      t instanceof HTMLSelectElement ||
      t instanceof HTMLTextAreaElement
    ) {
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return
    }
    let used = true
    switch (e.code) {
      case 'Space':
        hd.on_play_toggle()
        break
      case 'ArrowLeft':
        hd.on_seek_delta(e.shiftKey ? -1 : -5)
        break
      case 'ArrowRight':
        hd.on_seek_delta(e.shiftKey ? 1 : 5)
        break
      case 'KeyJ':
        hd.on_seek_delta(-10)
        break
      case 'KeyL':
        hd.on_seek_delta(10)
        break
      case 'ArrowUp':
        hd.on_tempo_delta(e.shiftKey ? 1 : 5)
        break
      case 'ArrowDown':
        hd.on_tempo_delta(e.shiftKey ? -1 : -5)
        break
      case 'PageUp':
      case 'Equal':
      case 'NumpadAdd':
        hd.on_pitch_delta(e.shiftKey ? 0.1 : 1)
        break
      case 'PageDown':
      case 'Minus':
      case 'NumpadSubtract':
        hd.on_pitch_delta(e.shiftKey ? -0.1 : -1)
        break
      case 'BracketLeft':
        hd.on_set_a()
        break
      case 'BracketRight':
        hd.on_set_b()
        break
      case 'Backslash':
      case 'IntlRo':
        hd.on_ab_clear()
        break
      case 'KeyM':
        hd.on_marker_add()
        break
      case 'Comma':
        hd.on_marker_step(-1)
        break
      case 'Period':
        hd.on_marker_step(1)
        break
      case 'Home':
        hd.on_home()
        break
      case 'KeyN':
        hd.on_next()
        break
      case 'KeyP':
        hd.on_prev()
        break
      case 'KeyR':
        hd.on_reverse()
        break
      default:
        used = false
    }
    if (used) {
      e.preventDefault()
    }
  })
}
const ROW_H = 52
export function view_playlist_render(refs, tabs_data, tracks, playing_id, hd) {
  const container = refs.playlist_list
  el_clear(container)
  container.dataset['playingId'] = playing_id ?? ''
  if (tabs_data.length === 0) {
    return
  }
  const tabs = h('div', { class: 'pl-tabs' })
  for (const p of tabs_data) {
    const tab = h('button', {
      class: 'pl-tab' + (p.active ? ' active' : ''),
      text: p.name,
      title: 'ダブルクリックで名前変更',
    })
    tab.addEventListener('click', () => {
      if (!p.active) {
        hd.on_tab_select(p.id)
      }
    })
    tab.addEventListener('dblclick', () => hd.on_tab_rename(p.id))
    if (p.deletable) {
      const del = h('span', { class: 'pl-tab-del', title: 'プレイリストを削除' }, [
        svg_icon('x', 12),
      ])
      del.addEventListener('click', (ev) => {
        ev.stopPropagation()
        hd.on_tab_delete(p.id)
      })
      tab.appendChild(del)
    }
    tabs.appendChild(tab)
  }
  container.appendChild(tabs)
  const list = h('ul', { class: 'track-list' })
  list.style.height = String(Math.max(tracks.length * ROW_H, 1)) + 'px'
  const scroll = h('div', { class: 'pl-scroll' }, [list])
  container.appendChild(scroll)
  if (tracks.length === 0) {
    scroll.appendChild(
      h('div', {
        class: 'pl-empty',
        text: '曲がありません。「＋曲」「開く」、またはファイルやフォルダをドロップして読み込んでください。',
      }),
    )
    return
  }
  const rows = new Map()
  const order = [...tracks]
  const BUF = 5
  let drag_id = null
  let drag_pos = 0
  let drag_moved = false
  let ptr_y = 0
  let ptr_y0 = 0
  let scroll0 = 0
  let top0 = 0
  let auto = 0
  const clampi = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
  const layout = () => {
    for (let i = 0; i < order.length; i++) {
      const t = order[i]
      if (t === undefined) {
        continue
      }
      const row = rows.get(t.id)
      if (!row) {
        continue
      }
      row.idx.textContent = String(i + 1)
      if (t.id !== drag_id) {
        row.li.style.top = String(i * ROW_H) + 'px'
      }
    }
  }
  const render_range = () => {
    const top = scroll.scrollTop
    const vh = scroll.clientHeight || 400
    const i0 = Math.max(0, Math.floor(top / ROW_H) - BUF)
    const i1 = Math.min(order.length, Math.ceil((top + vh) / ROW_H) + BUF)
    const seen = new Set()
    if (drag_id !== null) {
      seen.add(drag_id)
    }
    for (let i = i0; i < i1; i++) {
      const tr = order[i]
      if (tr === undefined) {
        continue
      }
      seen.add(tr.id)
      let row = rows.get(tr.id)
      if (!row) {
        row = make_row(tr)
        rows.set(tr.id, row)
        list.appendChild(row.li)
      }
      if (tr.id !== drag_id) {
        row.li.style.top = String(i * ROW_H) + 'px'
      }
      row.idx.textContent = String(i + 1)
      const pid = container.dataset['playingId'] ?? ''
      row.li.classList.toggle('playing', pid !== '' && pid === tr.id)
    }
    for (const [tid, row] of rows) {
      if (!seen.has(tid)) {
        row.li.remove()
        rows.delete(tid)
      }
    }
  }
  const drag_move = () => {
    if (drag_id === null) {
      return
    }
    const dy = ptr_y - ptr_y0 + (scroll.scrollTop - scroll0)
    const top = clampi(top0 + dy, 0, (order.length - 1) * ROW_H)
    const row = rows.get(drag_id)
    if (row) {
      row.li.style.top = String(top) + 'px'
    }
    const ni = clampi(Math.round(top / ROW_H), 0, order.length - 1)
    if (ni !== drag_pos) {
      const moved = order.splice(drag_pos, 1)[0]
      if (moved !== undefined) {
        order.splice(ni, 0, moved)
      }
      drag_pos = ni
      drag_moved = true
      layout()
    }
  }
  const auto_step = () => {
    if (drag_id === null) {
      auto = 0
      return
    }
    const r = scroll.getBoundingClientRect()
    const d = ptr_y < r.top + 44 ? -12 : ptr_y > r.bottom - 44 ? 12 : 0
    if (d !== 0) {
      const before = scroll.scrollTop
      scroll.scrollTop = before + d
      if (scroll.scrollTop !== before) {
        render_range()
        drag_move()
      }
    }
    auto = requestAnimationFrame(auto_step)
  }
  const drag_end = () => {
    if (drag_id === null) {
      return
    }
    const row = rows.get(drag_id)
    if (row) {
      row.li.classList.remove('dragging')
    }
    drag_id = null
    if (auto !== 0) {
      cancelAnimationFrame(auto)
      auto = 0
    }
    layout()
    if (drag_moved) {
      drag_moved = false
      hd.on_track_reorder(order.map((t) => t.id))
    }
  }
  const drag_start = (ev, tid) => {
    if (drag_id !== null || ev.button > 0) {
      return
    }
    const pos = order.findIndex((t) => t.id === tid)
    const row = rows.get(tid)
    if (pos < 0 || !row) {
      return
    }
    ev.preventDefault()
    ev.stopPropagation()
    drag_id = tid
    drag_pos = pos
    drag_moved = false
    ptr_y = ev.clientY
    ptr_y0 = ev.clientY
    scroll0 = scroll.scrollTop
    top0 = pos * ROW_H
    row.li.classList.add('dragging')
    const grip = ev.currentTarget
    if (grip instanceof HTMLElement) {
      ptr_capture(grip, ev.pointerId)
    }
    auto = requestAnimationFrame(auto_step)
  }
  const make_row = (tr) => {
    const grip = h('span', { class: 'track-item-grip', title: 'ドラッグで並べ替え' }, [
      svg_icon('grip', 14),
    ])
    const idx = h('span', { class: 'track-item-idx' })
    const name = h('span', { class: 'track-item-name', text: tr.name, title: tr.name })
    const ren = h('button', { class: 'track-item-rename', title: '名前を変更' }, [
      svg_icon('pencil', 14),
    ])
    const del = h('button', { class: 'track-item-del', title: 'ライブラリから削除' }, [
      svg_icon('x', 14),
    ])
    const li = h('li', { class: 'track-item', dataset: { tid: tr.id } }, [
      grip,
      h('span', { class: 'track-item-eq' }, [h('span'), h('span'), h('span')]),
      idx,
      name,
      h('span', { class: 'track-item-dur', text: fmt_time(tr.duration) }),
      ren,
      del,
    ])
    li.addEventListener('click', () => hd.on_track_select(tr.id))
    grip.addEventListener('pointerdown', (ev) => drag_start(ev, tr.id))
    grip.addEventListener('pointermove', (ev) => {
      if (drag_id !== null) {
        ptr_y = ev.clientY
        drag_move()
      }
    })
    grip.addEventListener('pointerup', drag_end)
    grip.addEventListener('pointercancel', drag_end)
    grip.addEventListener('click', (ev) => ev.stopPropagation())
    ren.addEventListener('click', (ev) => {
      ev.stopPropagation()
      hd.on_track_rename(tr.id)
    })
    del.addEventListener('click', (ev) => {
      ev.stopPropagation()
      hd.on_track_delete(tr.id)
    })
    return { li, idx }
  }
  render_range()
  scroll.addEventListener('scroll', render_range, { passive: true })
}
export function view_playlist_highlight(refs, playing_id) {
  refs.playlist_list.dataset['playingId'] = playing_id ?? ''
  const items = refs.playlist_list.querySelectorAll('.track-item')
  for (const li of items) {
    li.classList.toggle('playing', playing_id !== null && li.dataset['tid'] === playing_id)
  }
}
function sel_new(opts, value) {
  const s = h(
    'select',
    undefined,
    opts.map(([v, t]) => h('option', { text: t, attrs: { value: v } })),
  )
  s.value = value
  return s
}
const SHORTCUTS = [
  ['Space', '再生 / 一時停止'],
  ['← →', '5秒戻る / 進む（Shift で1秒）'],
  ['J L', '10秒戻る / 進む'],
  ['↑ ↓', 'テンポ ±5%（Shift で±1%）'],
  ['+ −', 'ピッチ ±1（Shift で±0.1）'],
  ['[ ]', '現在位置を A / B に設定'],
  ['\\', 'A-Bループ解除'],
  ['M', 'マーカー追加'],
  [', .', '前 / 次のマーカーへ'],
  ['Home', '頭出し'],
  ['N P', '次 / 前の曲'],
  ['R', '逆再生の切り替え'],
]
export function view_settings_toggle(data, hd) {
  const old = by_id('settings-overlay')
  if (old) {
    old.remove()
    return null
  }
  const sel_theme = sel_new(
    [
      ['auto', '自動（OS連動）'],
      ['light', 'ライト'],
      ['dark', 'ダーク'],
    ],
    data.theme,
  )
  const chk_fm = h('input', { attrs: { type: 'checkbox' } })
  const chk_bpm = h('input', { attrs: { type: 'checkbox' } })
  const chk_resume = h('input', { attrs: { type: 'checkbox' } })
  const chk_hq = h('input', { attrs: { type: 'checkbox' } })
  const chk_norm = h('input', { attrs: { type: 'checkbox' } })
  const chk_lim = h('input', { attrs: { type: 'checkbox' } })
  const sel_viz = sel_new(
    [
      ['bars', 'バー'],
      ['wave', '波形'],
    ],
    data.viz_mode,
  )
  const sel_fmt = sel_new(
    [
      [String(EXPORT_16), '16bit（ディザあり）'],
      [String(EXPORT_24), '24bit'],
      [String(EXPORT_32F), '32bit float'],
    ],
    String(data.export_fmt),
  )
  const sel_fade = sel_new(
    [
      ['0', 'なし'],
      ['1', '1秒'],
      ['2', '2秒'],
      ['3', '3秒'],
      ['5', '5秒'],
    ],
    String(data.fade_stop),
  )
  const sel_sleep = sel_new(
    [
      ['0', 'なし'],
      ['15', '15分後'],
      ['30', '30分後'],
      ['45', '45分後'],
      ['60', '60分後'],
      ['90', '90分後'],
    ],
    String(data.sleep_min),
  )
  const sel_ai = sel_new(
    [
      [AI_AUTO, '自動（WebGPU優先）'],
      [AI_WEBGPU, 'WebGPU'],
      [AI_WASM, 'CPU'],
    ],
    data.ai_backend,
  )
  const b_ai_file = h('button', { class: 'chip-btn', text: 'モデルファイルを選ぶ' })
  const b_ai_clear = h('button', { class: 'chip-btn', text: 'モデルのキャッシュを削除' })
  const bar = h('div', { class: 'storage-bar' })
  const lbl = h('div', { class: 'storage-label', text: '計算中...' })
  const close = h('button', { class: 'modal-close', text: '閉じる' })
  const kbd = h(
    'div',
    { class: 'kbd-list' },
    SHORTCUTS.flatMap(([k, t]) => [h('kbd', { text: k }), h('span', { text: t })]),
  )
  const box = h('div', { class: 'modal' }, [
    h('h3', { text: '設定' }),
    h('div', { class: 'set-row' }, [h('span', { text: 'テーマ' }), sel_theme]),
    h('label', { class: 'set-row' }, [h('span', { text: 'フォルマント補正を既定でON' }), chk_fm]),
    h('label', { class: 'set-row' }, [h('span', { text: 'BPM・キーの自動検出' }), chk_bpm]),
    h('div', { class: 'set-row' }, [h('span', { text: 'ビジュアライザ' }), sel_viz]),
    h('label', { class: 'set-row' }, [h('span', { text: '前回の再生位置から再開' }), chk_resume]),
    h('h4', { text: '再生' }),
    h('label', { class: 'set-row' }, [
      h('span', { text: '音量をそろえる（ノーマライズ）' }),
      chk_norm,
    ]),
    h('label', { class: 'set-row' }, [h('span', { text: '音割れ防止（リミッター）' }), chk_lim]),
    h('div', { class: 'set-row' }, [h('span', { text: '停止時のフェードアウト' }), sel_fade]),
    h('div', { class: 'set-row' }, [h('span', { text: 'スリープタイマー' }), sel_sleep]),
    h('h4', { text: '書き出し' }),
    h('div', { class: 'set-row' }, [h('span', { text: 'WAVの形式' }), sel_fmt]),
    h('h4', { text: 'AI音源分離' }),
    h('div', { class: 'set-row' }, [h('span', { text: '計算に使う装置' }), sel_ai]),
    h('label', { class: 'set-row' }, [h('span', { text: '高品質（時間は約1.5倍）' }), chk_hq]),
    h('div', { class: 'storage-label', text: data.ai_info }),
    h('div', { class: 'set-btns' }, [b_ai_file, b_ai_clear]),
    h('h4', { text: 'キーボード操作' }),
    kbd,
    h('div', { class: 'set-storage' }, [
      h('span', { text: 'ストレージ使用量' }),
      h('div', { class: 'storage-track' }, [bar]),
      lbl,
    ]),
    close,
  ])
  const ov = h('div', { id: 'settings-overlay', class: 'modal-overlay' }, [box])
  body_append(ov)
  chk_fm.checked = data.formant_def
  chk_bpm.checked = data.bpm_auto
  chk_resume.checked = data.resume
  chk_hq.checked = data.ai_hq
  chk_norm.checked = data.normalize
  chk_lim.checked = data.limiter
  ov.addEventListener('click', (e) => {
    if (e.target === ov) {
      ov.remove()
    }
  })
  close.addEventListener('click', () => ov.remove())
  sel_theme.addEventListener('change', () => {
    const v = sel_theme.value
    hd.on_theme(v === 'light' ? THEME_LIGHT : v === 'dark' ? THEME_DARK : THEME_AUTO)
  })
  chk_fm.addEventListener('change', () => hd.on_formant_def(chk_fm.checked))
  chk_bpm.addEventListener('change', () => hd.on_bpm_auto(chk_bpm.checked))
  chk_resume.addEventListener('change', () => hd.on_resume(chk_resume.checked))
  chk_hq.addEventListener('change', () => hd.on_ai_hq(chk_hq.checked))
  chk_norm.addEventListener('change', () => hd.on_normalize(chk_norm.checked))
  chk_lim.addEventListener('change', () => hd.on_limiter(chk_lim.checked))
  sel_viz.addEventListener('change', () =>
    hd.on_viz_mode(sel_viz.value === 'wave' ? VIZ_WAVE : VIZ_BARS),
  )
  sel_fmt.addEventListener('change', () => {
    const v = sel_fmt.value
    hd.on_export_fmt(v === '24' ? EXPORT_24 : v === '32' ? EXPORT_32F : EXPORT_16)
  })
  sel_fade.addEventListener('change', () => hd.on_fade_stop(Number(sel_fade.value) || 0))
  sel_sleep.addEventListener('change', () => hd.on_sleep(Number(sel_sleep.value) || 0))
  sel_ai.addEventListener('change', () => {
    const v = sel_ai.value
    hd.on_ai_backend(v === AI_WEBGPU ? AI_WEBGPU : v === AI_WASM ? AI_WASM : AI_AUTO)
  })
  b_ai_file.addEventListener('click', hd.on_ai_file)
  b_ai_clear.addEventListener('click', hd.on_ai_clear)
  return {
    set_storage: (usage, quota) => {
      const pct = Math.min(100, (usage / Math.max(quota, 1)) * 100)
      bar.style.width = String(pct) + '%'
      bar.classList.toggle('warn', pct > 80)
      lbl.textContent =
        (usage / 1048576).toFixed(1) +
        ' MB 使用中 / 約 ' +
        (quota / 1048576).toFixed(0) +
        ' MB (' +
        pct.toFixed(1) +
        '%)'
    },
    set_storage_unsupported: () => {
      lbl.textContent = 'このブラウザは非対応です'
    },
  }
}
