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
} from './dom.js'
import { knob_new, slider_new, eq_bank_new } from './widgets.js'
import type { knob_t, slider_t, eq_bank_t } from './widgets.js'
import { wf_new, wf_set_pos } from './waveform.js'
import type { wf_t } from './waveform.js'
import { vz_new } from './visualizer.js'
import type { vz_t } from './visualizer.js'
import {
  fmt_time,
  EQ_BANDS,
  EQ_PRESETS,
  LOOP_NONE,
  LOOP_SINGLE,
  LOOP_AB,
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
} from '../types.js'
import type {
  player_state_t,
  loop_mode_t,
  play_mode_t,
  theme_mode_t,
  viz_mode_t,
} from '../types.js'

export type mobile_view_t = 'playlist' | 'player' | 'fx'

export type refs_t = {
  btn_open: HTMLElement
  btn_play: HTMLElement
  btn_stop: HTMLElement
  btn_prev: HTMLElement
  btn_next: HTMLElement
  btn_loop_mode: HTMLElement
  btn_play_mode: HTMLElement
  btn_ab_clear: HTMLElement
  btn_vocal: HTMLElement
  btn_reverse: HTMLElement
  btn_bc_toggle: HTMLElement
  btn_export: HTMLElement
  btn_formant: HTMLElement
  btn_mod_toggle: HTMLElement
  btn_comp_toggle: HTMLElement
  btn_settings: HTMLElement
  btn_theme: HTMLElement
  btn_mic: HTMLElement
  btn_add_playlist: HTMLElement
  nav_player: HTMLElement
  nav_playlist: HTMLElement
  nav_fx: HTMLElement
  time_current: HTMLElement
  time_total: HTMLElement
  track_name: HTMLElement
  bpm_display: HTMLElement
  pitch_display: HTMLElement
  param_area: HTMLElement
  eq_area: HTMLElement
  eq_preset_select: HTMLSelectElement
  fx_area: HTMLElement
  mod_area: HTMLElement
  mod_mode_select: HTMLSelectElement
  comp_area: HTMLElement
  waveform_area: HTMLElement
  viz_container: HTMLElement
  playlist_list: HTMLElement
  export_default: Node[]
}

const REF_IDS = {
  btn_open: 'btn-open',
  btn_play: 'btn-play',
  btn_stop: 'btn-stop',
  btn_prev: 'btn-prev',
  btn_next: 'btn-next',
  btn_loop_mode: 'btn-loop-mode',
  btn_play_mode: 'btn-play-mode',
  btn_ab_clear: 'btn-ab-clear',
  btn_vocal: 'btn-vocal',
  btn_reverse: 'btn-reverse',
  btn_bc_toggle: 'btn-bc-toggle',
  btn_export: 'btn-export',
  btn_formant: 'btn-formant',
  btn_mod_toggle: 'btn-mod-toggle',
  btn_comp_toggle: 'btn-comp-toggle',
  btn_settings: 'btn-settings',
  btn_theme: 'btn-theme',
  btn_mic: 'btn-mic',
  btn_add_playlist: 'btn-add-playlist',
  nav_player: 'nav-player',
  nav_playlist: 'nav-playlist',
  nav_fx: 'nav-fx',
  time_current: 'time-current',
  time_total: 'time-total',
  track_name: 'track-name',
  bpm_display: 'bpm-display',
  pitch_display: 'pitch-display',
  param_area: 'param-area',
  eq_area: 'eq-area',
  eq_preset_select: 'eq-preset-select',
  fx_area: 'fx-area',
  mod_area: 'mod-area',
  mod_mode_select: 'mod-mode-select',
  comp_area: 'comp-area',
  waveform_area: 'waveform-area',
  viz_container: 'viz-container',
  playlist_list: 'playlist-list',
} as const

export function refs_init(): refs_t {
  const found: Record<string, HTMLElement> = {}
  const missing: string[] = []
  for (const [key, id] of Object.entries(REF_IDS)) {
    const el = by_id(id)
    if (el) {
      found[key] = el
    } else {
      missing.push('#' + id)
    }
  }
  if (missing.length > 0) {
    throw new Error('DOM要素が見つかりません: ' + missing.join(', ') + '(index.htmlが壊れています)')
  }
  const sel_eq = found['eq_preset_select']
  const sel_mod = found['mod_mode_select']
  if (!(sel_eq instanceof HTMLSelectElement) || !(sel_mod instanceof HTMLSelectElement)) {
    throw new Error('#eq-preset-select / #mod-mode-select はselect要素である必要があります')
  }
  const btn_export = found['btn_export'] as HTMLElement
  return {
    ...(found as Omit<refs_t, 'eq_preset_select' | 'mod_mode_select' | 'export_default'>),
    eq_preset_select: sel_eq,
    mod_mode_select: sel_mod,
    export_default: Array.from(btn_export.childNodes),
  }
}

export function view_fatal(msg: string): void {
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

export function view_splash(start: () => Promise<void>): boolean {
  const splash = by_id('splash')
  if (!splash) {
    return false
  }
  let started = false
  const on_tap = (): void => {
    if (started) {
      return
    }
    started = true
    const label = splash.querySelector('.splash-tap')
    if (label) {
      label.textContent = '起動中...'
    }
    void start()
      .then(() => {
        splash.remove()
      })
      .catch((err: unknown) => {
        splash.remove()
        view_fatal(err instanceof Error ? (err.stack ?? err.message) : String(err))
      })
  }
  splash.addEventListener('pointerdown', on_tap)
  splash.addEventListener('click', on_tap)
  return true
}

export function view_global_errors(): void {
  window.addEventListener('error', (e: ErrorEvent) => {
    view_fatal(e.message + '\n' + (e.filename ?? '') + ':' + String(e.lineno ?? ''))
  })
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const r: unknown = e.reason
    view_fatal(r instanceof Error ? (r.stack ?? r.message) : String(r))
  })
}

export function view_toast(msg: string, is_err: boolean): void {
  const t = h('div', { class: 'toast' + (is_err ? ' err' : ''), text: msg })
  body_append(t)
  requestAnimationFrame(() => t.classList.add('show'))
  window.setTimeout(() => {
    t.classList.remove('show')
    window.setTimeout(() => t.remove(), 250)
  }, 3000)
}

export function view_confirm(msg: string): boolean {
  return window.confirm(msg)
}

export function view_prompt(msg: string, def: string): string | null {
  return window.prompt(msg, def)
}

export function view_pick_files(accept: string, cb: (files: File[]) => void): void {
  const input = h('input', { attrs: { type: 'file', multiple: '', accept } })
  input.addEventListener('change', () => {
    const files = input.files
    if (files && files.length > 0) {
      cb(Array.from(files))
    }
  })
  input.click()
}

export function view_play_btn(refs: refs_t, playing: boolean): void {
  el_swap(refs.btn_play, svg_icon(playing ? 'pause' : 'play', 26))
}

export function view_play_enabled(refs: refs_t, enabled: boolean): void {
  if (enabled) {
    refs.btn_play.removeAttribute('disabled')
  } else {
    refs.btn_play.setAttribute('disabled', '')
  }
}

export function view_loop_btn(refs: refs_t, mode: loop_mode_t): void {
  const icons: Record<loop_mode_t, SVGSVGElement> = {
    [LOOP_NONE]: svg_icon('repeat', 17),
    [LOOP_SINGLE]: svg_icon('repeat1', 17),
    [LOOP_AB]: svg_icon('repeatab', 17),
    [LOOP_ALL]: svg_icon('repeat', 17),
  }
  const titles: Record<loop_mode_t, string> = {
    [LOOP_NONE]: 'ループ: なし',
    [LOOP_SINGLE]: 'ループ: 1曲',
    [LOOP_AB]: 'ループ: A-B区間',
    [LOOP_ALL]: 'ループ: 全曲',
  }
  el_swap(refs.btn_loop_mode, icons[mode])
  refs.btn_loop_mode.title = titles[mode]
  el_active(refs.btn_loop_mode, mode !== LOOP_NONE)
}

export function view_play_mode_btn(refs: refs_t, mode: play_mode_t): void {
  const icons: Record<play_mode_t, SVGSVGElement> = {
    [PLAY_SEQ]: svg_icon('list', 17),
    [PLAY_SHUFFLE]: svg_icon('shuffle', 17),
    [PLAY_REPEAT1]: svg_icon('repeat1', 17),
    [PLAY_REPEATALL]: svg_icon('repeat', 17),
  }
  const titles: Record<play_mode_t, string> = {
    [PLAY_SEQ]: '再生順: リスト順',
    [PLAY_SHUFFLE]: '再生順: シャッフル',
    [PLAY_REPEAT1]: '再生順: 1曲リピート',
    [PLAY_REPEATALL]: '再生順: 全曲リピート',
  }
  el_swap(refs.btn_play_mode, icons[mode])
  refs.btn_play_mode.title = titles[mode]
  el_active(refs.btn_play_mode, mode !== PLAY_SEQ)
}

export function view_toggles(refs: refs_t, st: player_state_t): void {
  el_active(refs.btn_vocal, st.vocalCancel)
  el_active(refs.btn_reverse, st.reverse)
  el_active(refs.btn_bc_toggle, st.bitcrusherEnabled)
  el_active(refs.btn_formant, st.formant)
  el_active(refs.btn_mod_toggle, st.mod.en)
  el_active(refs.btn_comp_toggle, st.comp.en)
}

export function view_toggle(
  refs: refs_t,
  key:
    | 'btn_vocal'
    | 'btn_reverse'
    | 'btn_bc_toggle'
    | 'btn_formant'
    | 'btn_mod_toggle'
    | 'btn_comp_toggle'
    | 'btn_mic',
  on: boolean,
): void {
  el_active(refs[key], on)
}

export function view_track_name(refs: refs_t, text: string, hover_title: boolean): void {
  refs.track_name.textContent = text
  refs.track_name.title = hover_title ? text : ''
}

export function view_time_current(refs: refs_t, sec: number): void {
  refs.time_current.textContent = fmt_time(sec)
}

export function view_time_total(refs: refs_t, sec: number): void {
  refs.time_total.textContent = fmt_time(sec)
}

export function view_position(refs: refs_t, wf: wf_t, cur: number, total: number): void {
  if (doc_hidden()) {
    return
  }
  view_time_current(refs, cur)
  if (total > 0) {
    wf_set_pos(wf, cur / total)
  }
}

export function view_bpm(refs: refs_t, bpm: number): void {
  refs.bpm_display.textContent = bpm > 0 ? String(bpm) + ' BPM' : '-- BPM'
}

export function view_pitch_chip(refs: refs_t, text: string): void {
  if (refs.pitch_display.textContent !== text) {
    refs.pitch_display.textContent = text
  }
}

export function view_export_busy(refs: refs_t, busy: boolean): void {
  if (busy) {
    refs.btn_export.textContent = '書き出し中…'
    refs.btn_export.classList.add('disabled')
  } else {
    el_swap(refs.btn_export, ...refs.export_default)
    refs.btn_export.classList.remove('disabled')
  }
}

export function view_set_view(refs: refs_t, v: mobile_view_t): void {
  body_dataset('view', v)
  el_active(refs.nav_playlist, v === 'playlist')
  el_active(refs.nav_player, v === 'player')
  el_active(refs.nav_fx, v === 'fx')
}

export type ui_t = {
  wf: wf_t
  vz: vz_t
  eq: eq_bank_t
  k_pitch: knob_t
  k_tempo: knob_t
  k_vol: knob_t
  s_reverb: slider_t
  s_bits: slider_t
  s_red: slider_t
  k_mrate: knob_t
  k_mdepth: knob_t
  k_mfb: knob_t
  k_mmix: knob_t
  s_cthr: slider_t
  s_crat: slider_t
  s_catk: slider_t
  s_crel: slider_t
  s_cmk: slider_t
}

export function view_controls_new(refs: refs_t, st: player_state_t): ui_t {
  const pa = refs.param_area
  const fx = refs.fx_area
  const ma = refs.mod_area
  const ca = refs.comp_area

  const ui: ui_t = {
    wf: wf_new(refs.waveform_area),
    vz: vz_new(refs.viz_container),
    eq: eq_bank_new(refs.eq_area, EQ_BANDS, st.eqGains),
    k_pitch: knob_new(pa, 'ピッチ', PITCH_MIN, PITCH_MAX, st.pitch, 0.5, ' st', 0),
    k_tempo: knob_new(pa, 'テンポ', 25, 400, st.tempo * 100, 1, '%', 100),
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
  }

  for (const pr of EQ_PRESETS) {
    refs.eq_preset_select.appendChild(h('option', { text: pr.name, attrs: { value: pr.name } }))
  }
  refs.mod_mode_select.value = st.mod.mode
  return ui
}

export function view_mod_mode(refs: refs_t, mode: string): void {
  refs.mod_mode_select.value = mode
}

export type wire_handlers_t = {
  on_open: () => void
  on_play_toggle: () => void
  on_stop: () => void
  on_prev: () => void
  on_next: () => void
  on_loop_cycle: () => void
  on_play_mode_cycle: () => void
  on_ab_clear: () => void
  on_vocal: () => void
  on_reverse: () => void
  on_bc: () => void
  on_formant: () => void
  on_mod: () => void
  on_comp: () => void
  on_export: () => void
  on_settings: () => void
  on_theme: () => void
  on_mic: () => void
  on_add_playlist: () => void
  on_nav: (v: mobile_view_t) => void
  on_eq_preset: (name: string) => void
  on_mod_mode: (value: string) => void
  on_seek_delta: (sec: number) => void
  on_tempo_delta: (delta: number) => void
  on_viz_click: () => void
}

export function view_wire(refs: refs_t, ui: ui_t, hd: wire_handlers_t): void {
  refs.btn_open.addEventListener('click', hd.on_open)
  refs.btn_play.addEventListener('click', hd.on_play_toggle)
  refs.btn_stop.addEventListener('click', hd.on_stop)
  refs.btn_prev.addEventListener('click', hd.on_prev)
  refs.btn_next.addEventListener('click', hd.on_next)
  refs.btn_loop_mode.addEventListener('click', hd.on_loop_cycle)
  refs.btn_play_mode.addEventListener('click', hd.on_play_mode_cycle)
  refs.btn_ab_clear.addEventListener('click', hd.on_ab_clear)
  refs.btn_vocal.addEventListener('click', hd.on_vocal)
  refs.btn_reverse.addEventListener('click', hd.on_reverse)
  refs.btn_bc_toggle.addEventListener('click', hd.on_bc)
  refs.btn_formant.addEventListener('click', hd.on_formant)
  refs.btn_mod_toggle.addEventListener('click', hd.on_mod)
  refs.btn_comp_toggle.addEventListener('click', hd.on_comp)
  refs.btn_export.addEventListener('click', hd.on_export)
  refs.btn_settings.addEventListener('click', hd.on_settings)
  refs.btn_theme.addEventListener('click', hd.on_theme)
  refs.btn_mic.addEventListener('click', hd.on_mic)
  refs.btn_add_playlist.addEventListener('click', hd.on_add_playlist)
  refs.nav_player.addEventListener('click', () => hd.on_nav('player'))
  refs.nav_playlist.addEventListener('click', () => hd.on_nav('playlist'))
  refs.nav_fx.addEventListener('click', () => hd.on_nav('fx'))
  refs.eq_preset_select.addEventListener('change', () =>
    hd.on_eq_preset(refs.eq_preset_select.value),
  )
  refs.mod_mode_select.addEventListener('change', () => hd.on_mod_mode(refs.mod_mode_select.value))
  ui.vz.canvas.addEventListener('click', hd.on_viz_click)

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const t = e.target
    if (
      t instanceof HTMLInputElement ||
      t instanceof HTMLSelectElement ||
      t instanceof HTMLTextAreaElement
    ) {
      return
    }
    switch (e.code) {
      case 'Space':
        e.preventDefault()
        hd.on_play_toggle()
        break
      case 'ArrowLeft':
        e.preventDefault()
        hd.on_seek_delta(-5)
        break
      case 'ArrowRight':
        e.preventDefault()
        hd.on_seek_delta(5)
        break
      case 'ArrowUp':
        e.preventDefault()
        hd.on_tempo_delta(5)
        break
      case 'ArrowDown':
        e.preventDefault()
        hd.on_tempo_delta(-5)
        break
    }
  })
}

const ROW_H = 52

export type pl_tab_view_t = {
  id: string
  name: string
  active: boolean
  deletable: boolean
}

export type pl_track_view_t = {
  id: string
  name: string
  duration: number
}

export type pl_view_handlers_t = {
  on_tab_select: (id: string) => void
  on_tab_rename: (id: string) => void
  on_tab_delete: (id: string) => void
  on_track_select: (id: string) => void
  on_track_rename: (id: string) => void
  on_track_delete: (id: string) => void
}

export function view_playlist_render(
  refs: refs_t,
  tabs_data: readonly pl_tab_view_t[],
  tracks: readonly pl_track_view_t[],
  playing_id: string | null,
  hd: pl_view_handlers_t,
): void {
  const container = refs.playlist_list
  el_clear(container)
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
      h('div', { class: 'pl-empty', text: '曲がありません。「開く」から追加してください。' }),
    )
    return
  }

  const rows = new Map<
    string,
    {
      li: HTMLLIElement
      idx: HTMLElement
    }
  >()
  const BUF = 5

  const make_row = (
    tr: pl_track_view_t,
  ): {
    li: HTMLLIElement
    idx: HTMLElement
  } => {
    const idx = h('span', { class: 'track-item-idx' })
    const name = h('span', { class: 'track-item-name', text: tr.name, title: tr.name })
    const ren = h('button', { class: 'track-item-rename', title: '名前を変更' }, [
      svg_icon('pencil', 14),
    ])
    const del = h('button', { class: 'track-item-del', title: 'ライブラリから削除' }, [
      svg_icon('x', 14),
    ])
    const li = h('li', { class: 'track-item', dataset: { tid: tr.id } }, [
      h('span', { class: 'track-item-eq' }, [h('span'), h('span'), h('span')]),
      idx,
      name,
      h('span', { class: 'track-item-dur', text: fmt_time(tr.duration) }),
      ren,
      del,
    ])
    li.addEventListener('click', () => hd.on_track_select(tr.id))
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

  const render_range = (): void => {
    const top = scroll.scrollTop
    const vh = scroll.clientHeight || 400
    const i0 = Math.max(0, Math.floor(top / ROW_H) - BUF)
    const i1 = Math.min(tracks.length, Math.ceil((top + vh) / ROW_H) + BUF)
    const seen = new Set<string>()
    for (let i = i0; i < i1; i++) {
      const tr = tracks[i]
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
      row.li.style.top = String(i * ROW_H) + 'px'
      row.idx.textContent = String(i + 1)
      row.li.classList.toggle('playing', playing_id !== null && playing_id === tr.id)
    }
    for (const [tid, row] of rows) {
      if (!seen.has(tid)) {
        row.li.remove()
        rows.delete(tid)
      }
    }
  }

  render_range()
  scroll.addEventListener('scroll', render_range, { passive: true })
}

export function view_playlist_highlight(refs: refs_t, playing_id: string | null): void {
  const items = refs.playlist_list.querySelectorAll<HTMLElement>('.track-item')
  for (const li of items) {
    li.classList.toggle('playing', playing_id !== null && li.dataset['tid'] === playing_id)
  }
}

export type settings_view_data_t = {
  theme: theme_mode_t
  formant_def: boolean
  bpm_auto: boolean
  viz_mode: viz_mode_t
}

export type settings_view_handlers_t = {
  on_theme: (mode: theme_mode_t) => void
  on_formant_def: (on: boolean) => void
  on_bpm_auto: (on: boolean) => void
  on_viz_mode: (mode: viz_mode_t) => void
}

export type settings_modal_t = {
  set_storage: (usage: number, quota: number) => void
  set_storage_unsupported: () => void
}

export function view_settings_toggle(
  data: settings_view_data_t,
  hd: settings_view_handlers_t,
): settings_modal_t | null {
  const old = by_id('settings-overlay')
  if (old) {
    old.remove()
    return null
  }

  const sel_theme = h('select', undefined, [
    h('option', { text: '自動（OS連動）', attrs: { value: 'auto' } }),
    h('option', { text: 'ライト', attrs: { value: 'light' } }),
    h('option', { text: 'ダーク', attrs: { value: 'dark' } }),
  ])
  const chk_fm = h('input', { attrs: { type: 'checkbox' } })
  const chk_bpm = h('input', { attrs: { type: 'checkbox' } })
  const sel_viz = h('select', undefined, [
    h('option', { text: 'バー', attrs: { value: 'bars' } }),
    h('option', { text: '波形', attrs: { value: 'wave' } }),
  ])
  const bar = h('div', { class: 'storage-bar' })
  const lbl = h('div', { class: 'storage-label', text: '計算中...' })
  const close = h('button', { class: 'modal-close', text: '閉じる' })

  const box = h('div', { class: 'modal' }, [
    h('h3', { text: '設定' }),
    h('div', { class: 'set-row' }, [h('span', { text: 'テーマ' }), sel_theme]),
    h('label', { class: 'set-row' }, [h('span', { text: 'フォルマント補正を既定でON' }), chk_fm]),
    h('label', { class: 'set-row' }, [h('span', { text: 'BPM自動検出' }), chk_bpm]),
    h('div', { class: 'set-row' }, [h('span', { text: 'ビジュアライザ' }), sel_viz]),
    h('div', { class: 'set-storage' }, [
      h('span', { text: 'ストレージ使用量' }),
      h('div', { class: 'storage-track' }, [bar]),
      lbl,
    ]),
    close,
  ])
  const ov = h('div', { id: 'settings-overlay', class: 'modal-overlay' }, [box])
  body_append(ov)

  sel_theme.value = data.theme
  chk_fm.checked = data.formant_def
  chk_bpm.checked = data.bpm_auto
  sel_viz.value = data.viz_mode

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
  sel_viz.addEventListener('change', () =>
    hd.on_viz_mode(sel_viz.value === 'wave' ? VIZ_WAVE : VIZ_BARS),
  )

  return {
    set_storage: (usage: number, quota: number): void => {
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
    set_storage_unsupported: (): void => {
      lbl.textContent = 'このブラウザは非対応です'
    },
  }
}
