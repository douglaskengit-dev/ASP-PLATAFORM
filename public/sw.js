/* ASP PWA — service worker (Fase 0).
 * Objetivo: app instalável e a "casca" abrindo offline, SEM interferir nas
 * escritas (POST/PATCH/DELETE) nem nas rotas /api. A leitura offline de dados
 * (cache de /api) fica para a Fase 1. */
const CACHE = "asp-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/icon-192.png"]).catch(() => {})));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;                 // não toca em POST/PATCH/DELETE
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // só same-origin
  if (url.pathname.startsWith("/api/")) return;      // API não é cacheada nesta fase

  // Páginas: network-first, com fallback para o cache (ou o dashboard) offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((m) => m || caches.match("/dashboard")))
    );
    return;
  }

  // Estáticos (_next, ícones, assets): cache-first.
  event.respondWith(
    caches.match(req).then((m) => m || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }))
  );
});
