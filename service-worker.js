'use strict'

var CACHE_NAME = 'noroemon-v7'

var PRECACHE = [
  './',
  './index.html',
  './manifest.json',
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
  './dist/dsp/pv_worklet.js',
  './dist/dsp/fx_worklets.js',
  './dist/dsp/bpm_worker.js',
  './dist/dsp/wav.js',
]

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
        return res
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          if (hit) {
            return hit
          }
          if (req.mode === 'navigate') {
            return caches.match('./index.html')
          }
          return new Response('offline', { status: 503, statusText: 'offline' })
        })
      }),
  )
})
