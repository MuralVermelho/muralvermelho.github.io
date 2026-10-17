// Service worker do Mural Vermelho: permite instalar como app e abrir sem internet
// (mostra as últimas manchetes baixadas).
const CACHE = "mural-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro; se falhar, usa a cópia guardada.
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") return (await cache.match("index.html")) || Response.error();
    return Response.error();
  }
}

// Cópia guardada primeiro (rápido) e atualiza em segundo plano.
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const update = fetch(req)
    .then((res) => { if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; })
    .catch(() => cached);
  return cached || update;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";

  if (sameOrigin) e.respondWith(networkFirst(req));
  else if (fonts) e.respondWith(staleWhileRevalidate(req));
  // demais (estatísticas, imagens dos veículos) seguem direto pela rede
});
