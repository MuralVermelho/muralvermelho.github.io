// Coleta os feeds RSS de todas as fontes e gera site/data/items.json.
// Uso: node scripts/fetch.mjs
// Variável opcional PREVIOUS_URL: URL do items.json já publicado, usado para
// manter o histórico (os feeds só trazem as ~10 matérias mais recentes).
import Parser from "rss-parser";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classify, THEMES } from "./themes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "site", "data", "items.json");
const KEEP_DAYS = 14;
const MAX_PER_SOURCE = 80;
const EXCERPT_LEN = 300;
const UA = "Mozilla/5.0 (compatible; MuralVermelhoBot/1.0; agregador de noticias; +https://muralvermelho.github.io/)";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail"],
      ["content:encoded", "contentEncoded"],
      ["dc:creator", "creator"],
      ["dc:date", "dcDate"]
    ]
  }
});

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»" };
function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
function stripHtml(html) {
  return decode(
    (html || "")
      .replace(/<(script|style|figure|figcaption)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}
function cleanExcerpt(text, title) {
  let t = text
    // rodapés típicos do WordPress: "O post X apareceu primeiro em Y."
    .replace(/(O post|The post) .{0,300}? (apareceu primeiro em|appeared first on) .*$/i, "")
    .replace(/\s*\[(…|\.{3,})\]/g, "…")
    .replace(/(Continue|Leia mais|Read more)\s*(lendo)?\s*(→|»)?\s*$/i, "")
    .trim();
  if (title && t.startsWith(title)) t = t.slice(title.length).trim();
  if (t.length > EXCERPT_LEN) {
    t = t.slice(0, EXCERPT_LEN);
    t = t.slice(0, t.lastIndexOf(" ")) + "…";
  }
  return t.replace(/[\s.,;:…]*(\.{2,}|…)[\s.…]*$/, "…");
}
function findImage(item) {
  const mc = item.mediaContent?.find((m) => m?.$?.url && (!m.$.medium || m.$.medium === "image"));
  if (mc) return mc.$.url;
  if (item.mediaThumbnail?.$?.url) return item.mediaThumbnail.$.url;
  if (item.enclosure?.url && /image|\.(jpe?g|png|webp|gif)/i.test(item.enclosure.type + item.enclosure.url)) return item.enclosure.url;
  const html = item.contentEncoded || item.content || "";
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m && !/(gravatar|emoji|pixel|feeds\.feedburner|1x1)/i.test(m[1])) return decode(m[1]);
  return null;
}
/* ---------- Autores ----------
   Muitos sites em WordPress informam no feed quem PUBLICOU o texto (o editor),
   não quem o ESCREVEU. Por isso: 1) procuramos "Por Fulano" no início do texto;
   2) conforme "author" em sources.json: "page" (página do artigo), "bio" (nota no fim), "content" ("Por Fulano") ou "none";
   3) escondemos créditos genéricos (nome do veículo, siglas, nomes de usuário). */
const NAME_PARTICLES = new Set(["da", "de", "do", "das", "dos", "e", "di", "del", "della", "la", "le", "van", "von", "y"]);
function titleCaseName(s) {
  if (s !== s.toUpperCase()) return s; // só corrige nomes TODOS EM MAIÚSCULAS
  return s.toLowerCase().split(/\s+/).map((w, i) =>
    i > 0 && NAME_PARTICLES.has(w) ? w : w.replace(/(^|[-'’])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  ).join(" ");
}
function cleanAuthor(name, src) {
  let a = decode(stripHtml(name || "")).replace(/\s+/g, " ").replace(/^(por|by)\s+/i, "").replace(/[|·,;:\s]+$/, "").trim();
  if (!a) return null;
  const n = normalize(a);
  if (normalize(src.name).includes(n) || /^(redacao|admin|administrador|editor|editoria|equipe|da redacao)$/.test(n)) return null;
  if (/^[a-z0-9._-]+$/.test(a)) return null;        // nome de usuário do sistema (ex.: "gutoalves")
  if (/^[A-Z]{1,4}$/.test(a) || a.length < 4) return null; // siglas (ex.: "FP")
  return titleCaseName(a);
}
const NAME_WORD = "[A-ZÀ-ÖØ-Þ][\\p{L}'’.-]*";
const BYLINE = new RegExp(`^Por\\s+(${NAME_WORD}(?:\\s+(?:d[aeo]s?|e|di|del|von|van|${NAME_WORD})){0,7})\\s*(?::|$)`, "u");
function authorFromContent(html) {
  const lines = decode((html || "").replace(/<\/(p|div|h\d|li|figure)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 3);
  for (const l of lines) {
    const m = l.match(BYLINE);
    if (m) return m[1];
  }
  return null;
}
// Nota biográfica no fim do texto: "Fulano de Tal é professor..." (ex.: Revista Cult)
function authorFromBio(html) {
  const paras = decode((html || "").replace(/<\/(p|div|h\d|li)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l && !/apareceu primeiro em/.test(l)).slice(-3);
  const re = new RegExp(`^\\*?\\s*(${NAME_WORD}(?:\\s+(?:d[aeo]s?|e|${NAME_WORD})){1,6})\\s+(?:é|são|foi)\\s`, "u");
  for (const p of paras.reverse()) { const m = p.match(re); if (m) return m[1]; }
  return null;
}
async function authorFromPage(url) {
  const r = await fetch(url, { headers: { "User-Agent": BROWSER_UA, "Accept-Language": "pt-BR,pt;q=0.9" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  const byline = [...html.matchAll(/class="(?:single-author|autoria)"[^>]*>\s*<a[^>]*>([^<]+)</g), ...html.matchAll(/<a[^>]+class="autoria"[^>]*>([^<]+)</g)]
    .map((m) => decode(m[1]).trim());
  if (byline.length) return [...new Set(byline)].join(", ").replace(/, ([^,]+)$/, " e $1");
  // parágrafo que contém só "Por Fulano" (ex.: Blog da Boitempo)
  for (const m of html.matchAll(/<p[^>]*>\s*(?:<[^>]+>\s*)*Por\s+(?:<[^>]+>\s*)*([^<]{3,80}?)\s*(?:<\/[^>]+>\s*)*<\/p>/g)) {
    const name = decode(m[1]).trim();
    if (new RegExp(`^${NAME_WORD}(?:\\s+(?:d[aeo]s?|e|${NAME_WORD})){1,7}$`, "u").test(name)) return name;
  }
  const meta = html.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']author["']/i);
  if (meta) return meta[1];
  const ld = html.match(/"author"\s*:\s*(?:\[\s*)?\{[^}]*?"name"\s*:\s*"([^"]+)"/);
  return ld ? ld[1] : null;
}
const normalize = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function wordCount(html) {
  return stripHtml(html).split(" ").filter(Boolean).length;
}
function canonicalLink(link) {
  try {
    const u = new URL(link.trim());
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/.test(p)) u.searchParams.delete(p);
    return u.toString();
  } catch {
    return link.trim();
  }
}

async function fetchSource(src) {
  const get = (ua) => fetch(src.feed, {
    headers: { "User-Agent": ua, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*", "Accept-Language": "pt-BR,pt;q=0.9" },
    signal: AbortSignal.timeout(25000)
  });
  let r = await get(UA);
  // alguns sites bloqueiam robôs; tenta de novo como navegador comum
  if (r.status === 403 || r.status === 429) r = await get(BROWSER_UA);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = await r.text();
  const feed = await parser.parseString(xml.replace(/^﻿/, "").trim());
  const now = new Date().toISOString();
  return feed.items
    .filter((it) => it.link && it.title)
    .map((it) => {
      const title = stripHtml(it.title);
      const body = it.contentEncoded || it.content || it.contentSnippet || it.summary || "";
      const byline = authorFromContent(it.contentEncoded || it.content);
      let excerpt = cleanExcerpt(stripHtml(it.contentSnippet && it.contentSnippet.length > 80 ? it.contentSnippet : body), title);
      if (byline) excerpt = excerpt.replace(new RegExp(`^Por\\s+${byline.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:?\\s*`), "");
      const cats = (it.categories || []).map((c) => (typeof c === "string" ? c : c?._ || "")).filter(Boolean);
      let date = it.isoDate || it.dcDate || it.pubDate;
      date = date && !isNaN(new Date(date)) ? new Date(date).toISOString() : now;
      if (date > now) date = now; // feeds com fuso errado
      return {
        id: canonicalLink(it.link),
        url: canonicalLink(it.link),
        title,
        excerpt,
        image: findImage(it),
        // src.author: "page" = ler na página; "bio" = nota no fim; "content" = só "Por Fulano" no texto; "none" = o feed só traz o editor
        author: byline ? cleanAuthor(byline, src)
          : src.author === "bio" ? cleanAuthor(authorFromBio(it.contentEncoded || it.content), src)
          : src.author ? null
          : cleanAuthor(it.creator || it.author, src),
        date,
        source: src.id,
        type: src.type,
        words: it.contentEncoded ? wordCount(it.contentEncoded) : null,
        themes: classify(title, stripHtml(body), cats)
      };
    });
}

async function loadPrevious() {
  try {
    if (process.env.PREVIOUS_URL) {
      const r = await fetch(process.env.PREVIOUS_URL, { signal: AbortSignal.timeout(20000) });
      if (r.ok) return (await r.json()).items || [];
    }
    return JSON.parse(await readFile(OUT, "utf8")).items || [];
  } catch {
    return [];
  }
}

async function pool(list, n, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k]); }
  }));
  return out;
}

const sources = JSON.parse(await readFile(join(ROOT, "sources.json"), "utf8"));
const previous = await loadPrevious();
const results = await pool(sources, 8, async (s) => {
  try {
    const items = await fetchSource(s);
    console.log(`✔ ${s.name}: ${items.length}`);
    return { s, items, ok: true };
  } catch (e) {
    console.warn(`✘ ${s.name}: ${e.message}`);
    return { s, items: [], ok: false, error: e.message };
  }
});

// Mescla com o histórico. Mantém a data original de quem já existia.
const byId = new Map();
const activeIds = new Set(sources.map((s) => s.id));
const srcById = Object.fromEntries(sources.map((s) => [s.id, s]));
for (const it of previous) {
  if (!activeIds.has(it.source)) continue;
  // Revisa autores do histórico com as regras atuais (textos que já saíram do feed)
  const src = srcById[it.source];
  if (!it.authorChecked) {
    const byline = authorFromContent(it.excerpt);
    it.author = byline ? cleanAuthor(byline, src) : src.author ? null : cleanAuthor(it.author, src);
    if (byline) it.excerpt = it.excerpt.replace(/^Por\s+[^:]{3,80}:\s*/, "");
  }
  byId.set(it.id, it);
}
for (const { items } of results) {
  for (const it of items) {
    const old = byId.get(it.id);
    const merged = old ? { ...it, date: old.date < it.date ? old.date : it.date } : it;
    if (old?.authorChecked) Object.assign(merged, { author: old.author, authorChecked: true }); // autor já lido da página
    byId.set(it.id, merged);
  }
}
// Mesmo título na mesma fonte = duplicata (ex.: links com parâmetros diferentes)
const seen = new Set();
const cutoff = Date.now() - KEEP_DAYS * 864e5;
const perSource = {};
const items = [...byId.values()]
  .filter((it) => new Date(it.date).getTime() >= cutoff)
  .sort((a, b) => b.date.localeCompare(a.date))
  .filter((it) => {
    const k = it.source + "|" + it.title.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    perSource[it.source] = (perSource[it.source] || 0) + 1;
    return perSource[it.source] <= MAX_PER_SOURCE;
  });

// Autor lido na página do artigo (só para fontes marcadas e só uma vez por texto)
const toCheck = items.filter((it) => srcById[it.source]?.author === "page" && !it.authorChecked);
let found = 0;
await pool(toCheck, 4, async (it) => {
  try {
    it.author = cleanAuthor(await authorFromPage(it.url), srcById[it.source]);
    it.authorChecked = true;
    if (it.author) found++;
  } catch { /* tenta de novo na próxima rodada */ }
});
if (toCheck.length) console.log(`Autores lidos nas páginas: ${found} de ${toCheck.length}.`);

const status = Object.fromEntries(results.map(({ s, items, ok, error }) => [s.id, { ok, count: items.length, error: error || null }]));
const data = {
  updated: new Date().toISOString(),
  sources: sources.map(({ id, name, site, type }) => ({ id, name, site, type, ...status[id] })),
  themes: Object.fromEntries(Object.entries(THEMES).map(([id, t]) => [id, t.label])),
  items
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(data));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${items.length} itens salvos (${failed} fontes falharam de ${sources.length}).`);
if (failed > sources.length / 2) process.exit(1);
