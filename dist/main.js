import { app_init } from './ui/app.js'
import { view_splash, view_fatal, view_global_errors } from './ui/view.js'
function boot() {
  view_global_errors()
  if (!view_splash(() => app_init())) {
    view_fatal('#splash が見つかりません(index.htmlが壊れています)')
    return
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {})
  }
}
boot()
