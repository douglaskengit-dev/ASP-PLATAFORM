/* ASP PWA — service worker (Fases 0-1).
 * - Casca e estáticos: cache para abrir offline.
 * - GET /api/*: network-first com fallback de cache (leitura offline do que
 *   já foi carregado). NUNCA intercepta POST/PATCH/DELETE (as escritas offline
 *   são tratadas pela fila em IndexedDB — lib/pwa). */
const CACHE = "asp-v3";
const API_CACHE = "asp-api-v3";

/* Arquivos com nome FIXO (o conteúdo muda, o endereço não): o modelo do
 * relatório, a ferramenta do medidor, ícones. Se forem servidos com
 * "cache-first", a versão antiga fica presa no navegador para sempre e as
 * correções nunca chegam ao usuário — foi o que aconteceu com o template do
 * relatório e com o medidor.
 *
 * Já os arquivos de /_next/static têm o hash do conteúdo no nome: cada build
 * gera um endereço novo, então cache-first ali é seguro e rápido. */
function temNomeFixo(pathname) {
  return !pathname.startsWith("/_next/static/");
}

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

  // Estáticos com hash no nome (/_next/static): cache-first, sem risco de
  // servir versão velha — um build novo produz um endereço novo.
  if (!temNomeFixo(url.pathname)) {
    event.respondWith(
      caches.match(req).then((m) => m || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // Demais estáticos (nome fixo): REDE PRIMEIRO, cache só como reserva
  // offline. Assim uma correção no modelo .docx ou no medidor chega no
  // primeiro carregamento, e o app continua abrindo sem internet.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

/* ---------- Fase 3: notificações push ---------- */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const titulo = data.titulo || "ASP";
  const opcoes = {
    body: data.mensagem || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { link: data.link || "/dashboard" },
    tag: data.tag || undefined,
  };
  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cli) => {
      for (const c of cli) {
        if ("focus" in c) { c.navigate(link); return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    })
  );
});
