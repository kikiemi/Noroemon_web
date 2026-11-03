'use strict'

var CACHE_NAME = 'noroemon-v11'

var PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/apple-touch-icon.png',
  './dist/main.js',
  './dist/types.js',
  './dist/engine.js',
  './dist/ui/app.js',
  './dist/ui/dom.js',
  './dist/ui/view.js',
  './dist/ui/theme.js',
  './dist/ui/widgets.js',
  './dist/ui/waveform.js',
  './dist/ui/visualizer.js',
  './dist/store/db.js',
  './dist/store/playlist.js',
  './dist/dsp/wav.js',
  './dist/worklet/dsp.js',
  './dist/worker/ana.js',
  './dist/worker/fft.js',
  './dist/worker/sep.js',
]

function with_isolation(res) {
  if (!res || res.status === 0 || res.type === 'opaque') {
    return res
  }
  var h = new Headers(res.headers)
  h.set('Cross-Origin-Opener-Policy', 'same-origin')
  h.set('Cross-Origin-Embedder-Policy', 'require-corp')
  h.set('Cross-Origin-Resource-Policy', 'same-origin')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h })
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(function (cache) {
        return Promise.all(
          PRECACHE.map(function (url) {
            return cache.add(url).catch(function () {})
          }),
        )
      })
      .then(function () {
        return self.skipWaiting()
      }),
  )
})

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) {
              return k !== CACHE_NAME
            })
            .map(function (k) {
              return caches.delete(k)
            }),
        )
      })
      .then(function () {
        return self.clients.claim()
      }),
  )
})

self.addEventListener('fetch', function (e) {
  var req = e.request
  if (req.method !== 'GET') {
    return
  }
  var url = new URL(req.url)
  if (url.origin !== location.origin) {
    return
  }
  if (url.pathname.indexOf('/models/') >= 0) {
    e.respondWith(
      fetch(req).then(function (res) {
        return with_isolation(res)
      }),
    )
    return
  }

  e.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone()
          caches
            .open(CACHE_NAME)
            .then(function (cache) {
              cache.put(req, copy)
            })
            .catch(function () {})
        }
        return with_isolation(res)
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          if (hit) {
            return with_isolation(hit)
          }
          if (req.mode === 'navigate') {
            return caches.match('./index.html').then(function (idx) {
              return with_isolation(idx)
            })
          }
          return new Response('offline', { status: 503, statusText: 'offline' })
        })
      }),
  )
})
