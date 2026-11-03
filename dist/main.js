import { app_init } from './ui/app.js'
import { view_fatal, view_global_errors, view_booted } from './ui/view.js'
function boot() {
  view_global_errors()
  app_init()
    .then(() => view_booted())
    .catch((err) => {
      view_fatal(err instanceof Error ? (err.stack ?? err.message) : String(err))
    })
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {})
  }
}
boot()
