import { THEME_AUTO, THEME_DARK, THEME_LIGHT } from '../types.js'
let cached = null
const mq_dark = window.matchMedia('(prefers-color-scheme: dark)')
let cur_mode = THEME_AUTO
function css_var(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
export function theme_colors() {
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
function resolve(mode) {
  if (mode === THEME_LIGHT) {
    return 'light'
  }
  if (mode === THEME_DARK) {
    return 'dark'
  }
  return mq_dark.matches ? 'dark' : 'light'
}
export function theme_apply(mode) {
  cur_mode = mode
  document.documentElement.dataset['theme'] = resolve(mode)
  cached = null
  window.dispatchEvent(new CustomEvent('nr-theme'))
}
export function theme_on_change(cb) {
  window.addEventListener('nr-theme', cb)
}
mq_dark.addEventListener('change', () => {
  if (cur_mode === THEME_AUTO) {
    theme_apply(THEME_AUTO)
  }
})
