import { THEME_AUTO, THEME_DARK, THEME_LIGHT } from '../types.js'
import type { theme_mode_t } from '../types.js'

export type theme_colors_t = {
  bg: string
  panel: string
  ink: string
  sub: string
  line: string
  accent: string
  accent_soft: string
  accent_contrast: string
}

let cached: theme_colors_t | null = null
const mq_dark = window.matchMedia('(prefers-color-scheme: dark)')
let cur_mode: theme_mode_t = THEME_AUTO

function css_var(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function theme_colors(): theme_colors_t {
  if (!cached) {
    cached = {
      bg: css_var('--bg'),
      panel: css_var('--panel'),
      ink: css_var('--ink'),
      sub: css_var('--sub'),
      line: css_var('--line'),
      accent: css_var('--accent'),
      accent_soft: css_var('--accent-soft'),
      accent_contrast: css_var('--accent-contrast'),
    }
  }
  return cached
}

function resolve(mode: theme_mode_t): 'light' | 'dark' {
  if (mode === THEME_LIGHT) {
    return 'light'
  }
  if (mode === THEME_DARK) {
    return 'dark'
  }
  return mq_dark.matches ? 'dark' : 'light'
}

export function theme_apply(mode: theme_mode_t): void {
  cur_mode = mode
  document.documentElement.dataset['theme'] = resolve(mode)
  cached = null
  window.dispatchEvent(new CustomEvent('nr-theme'))
}

export function theme_on_change(cb: () => void): void {
  window.addEventListener('nr-theme', cb)
}

mq_dark.addEventListener('change', () => {
  if (cur_mode === THEME_AUTO) {
    theme_apply(THEME_AUTO)
  }
})
