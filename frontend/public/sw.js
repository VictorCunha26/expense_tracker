// Cache public assets only. Never cache pages, API, auth or payment responses.
const CACHE = "synch-cash-public-v2"
const ASSETS = ["/favicon.svg", "/synch-cash-logo.png", "/manifest.webmanifest"]
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)))
  self.skipWaiting()
})
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("synch-cash-") && key !== CACHE).map(key => caches.delete(key)))))
  self.clients.claim()
})
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url)
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !ASSETS.includes(url.pathname) || url.search) return
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))) }
    return response
  }).catch(async () => (await caches.match(event.request)) || Response.error()))
})
