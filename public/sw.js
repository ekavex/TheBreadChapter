// Service Worker — cache-first for static assets, network-first for API
const CACHE = 'tbc-pos-v1'

const STATIC_URLS = [
  '/',
  '/pos',
  '/login',
  '/manifest.json',
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(STATIC_URLS)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  const url = new URL(request.url)

  // Always go network-first for API routes and auth
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/login')) {
    e.respondWith(
      fetch(request).catch(() => caches.match(request))
    )
    return
  }

  // Cache-first for everything else (fonts, images, JS chunks)
  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        if (response.ok && request.method === 'GET') {
          const clone = response.clone()
          caches.open(CACHE).then((c) => c.put(request, clone))
        }
        return response
      })
    })
  )
})
