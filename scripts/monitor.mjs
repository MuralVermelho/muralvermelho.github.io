// Verificação diária de saúde do site.
// Uso: SITE_URL=https://muralvermelho.github.io node scripts/monitor.mjs
// Escreve o relatório em relatorio.md e sai com código 1 se houver problema.
import { writeFile } from "node:fs/promises";

const SITE = (process.env.SITE_URL || "https://muralvermelho.github.io").replace(/\/$/, "");
const MAX_AGE_HOURS = 3;     // dados mais velhos que isso = robô de atualização parado
const MIN_ITEMS = 200;       // abaixo disso, algo estranho aconteceu na coleta
const QUIET_DAYS = 7;        // veículo sem texto novo há X dias (só observação: alguns publicam pouco)
// Fontes que os servidores do GitHub não conseguem ler (bloqueio por IP); não geram alerta.
const KNOWN_BLOCKED = ["diplomatique", "viomundo"];

const problems = [];
const notes = [];
const fmt = (d) => new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

async function get(path) {
  const r = await fetch(`${SITE}${path}?t=${Date.now()}`, { signal: AbortSignal.timeout(30000), headers: { "Cache-Control": "no-cache" } });
  return r;
}

// 1. Página principal no ar
try {
  const r = await get("/");
  const html = await r.text();
  if (!r.ok) problems.push(`A página principal respondeu com erro HTTP ${r.status}.`);
  else if (!html.includes("Mural Vermelho")) problems.push("A página principal abriu, mas o conteúdo não parece o do Mural Vermelho.");
  else notes.push("Página principal no ar.");
} catch (e) {
  problems.push(`Não foi possível abrir o site: ${e.message}.`);
}

// 2. Dados recentes e em quantidade normal
let data = null;
try {
  const r = await get("/data/items.json");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  data = await r.json();
} catch (e) {
  problems.push(`Não foi possível ler as notícias (data/items.json): ${e.message}.`);
}

if (data) {
  const ageH = (Date.now() - new Date(data.updated)) / 36e5;
  if (ageH > MAX_AGE_HOURS) problems.push(`As notícias não são atualizadas há ${ageH.toFixed(1)} horas (última: ${fmt(data.updated)}). O robô de atualização pode ter parado.`);
  else notes.push(`Última atualização: ${fmt(data.updated)} (há ${Math.round(ageH * 60)} min).`);

  if (data.items.length < MIN_ITEMS) problems.push(`Só ${data.items.length} textos no site (o normal é mais de ${MIN_ITEMS}).`);
  else notes.push(`${data.items.length} textos no ar.`);

  // 3. Veículos fora do ar ou parados
  const newest = {};
  for (const it of data.items) if (!newest[it.source] || it.date > newest[it.source]) newest[it.source] = it.date;
  const down = [], empty = [], quiet = [], blocked = [];
  for (const s of data.sources) {
    if (KNOWN_BLOCKED.includes(s.id)) { blocked.push(s.name); continue; }
    const last = newest[s.id];
    const days = last ? (Date.now() - new Date(last)) / 864e5 : Infinity;
    if (s.ok === false) down.push(`**${s.name}**: feed com erro (${s.error || "desconhecido"})${last ? `, último texto em ${fmt(last)}` : ""}`);
    else if (s.count === 0) empty.push(`**${s.name}**: o feed abre, mas veio vazio`);
    else if (days > QUIET_DAYS) quiet.push(`${s.name} (${last ? Math.floor(days) + " dias" : "mais de 14 dias"})`);
  }
  if (down.length) problems.push(`Veículos com o feed fora do ar:\n${down.map((d) => `  - ${d}`).join("\n")}`);
  if (empty.length) problems.push(`Veículos com o feed vazio (o site pode ter mudado o endereço do feed):\n${empty.map((d) => `  - ${d}`).join("\n")}`);
  const ok = data.sources.length - down.length - empty.length - blocked.length;
  notes.push(`${ok} de ${data.sources.length} veículos funcionando normalmente.`);
  if (quiet.length) notes.push(`Publicam pouco, sem texto novo há mais de ${QUIET_DAYS} dias (feed funcionando): ${quiet.join(", ")}.`);
  if (blocked.length) notes.push(`Bloqueio já conhecido (não gera alerta): ${blocked.join(", ")}.`);
}

const status = problems.length ? "⚠️ Problemas encontrados" : "✅ Tudo funcionando";
const report = [
  `## ${status}`,
  `Verificação de ${fmt(Date.now())} em ${SITE}`,
  problems.length ? `### O que precisa de atenção\n${problems.map((p) => `- ${p}`).join("\n")}` : "",
  `### Resumo\n${notes.map((n) => `- ${n}`).join("\n")}`
].filter(Boolean).join("\n\n");

await writeFile("relatorio.md", report + "\n");
console.log(report);
process.exit(problems.length ? 1 : 0);
