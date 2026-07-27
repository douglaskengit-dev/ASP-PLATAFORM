/* ASP PWA — service worker (Fases 0-1).
 * - Casca e estáticos: cache para abrir offline.
 * - GET /api/*: network-first com fallback de cache (leitura offline do que
 *   já foi carregado). NUNCA intercepta POST/PATCH/DELETE (as escritas offline
 *   são tratadas pela fila em IndexedDB — lib/pwa). */
const CACHE = "asp-v2";
const API_CACHE = "asp-api-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/icon-192.png"]).catch(() => {})));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== API_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;                 // escritas nunca passam por aqui
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // só same-origin

  // Leitura de dados (GET /api): network-first, cache como reserva offline.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(API_CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || new Response(JSON.stringify({ ok: false, offline: true }), { headers: { "Content-Type": "application/json" }, status: 503 })))
    );
    return;
  }

  // Páginas: network-first com fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((m) => m || caches.match("/dashboard")))
    );
    return;
  }

  // Estáticos: cache-first.
  event.respondWith(
    caches.match(req).then((m) => m || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }))
  );
});
