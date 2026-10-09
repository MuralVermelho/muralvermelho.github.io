// Transforma o relatório do monitor em um aviso (issue) no GitHub.
// O GitHub manda e-mail para o dono do repositório a cada aviso novo.
// - problema novo        -> abre um aviso
// - problema mudou       -> comenta no aviso aberto
// - problema igual       -> não faz nada (evita e-mail repetido)
// - voltou ao normal     -> comenta e fecha o aviso
import { readFile } from "node:fs/promises";

const { GITHUB_TOKEN, GITHUB_REPOSITORY, MONITOR_FAILED } = process.env;
const API = `https://api.github.com/repos/${GITHUB_REPOSITORY}`;
const LABEL = "monitor";
const headers = { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "mural-monitor" };

async function gh(path, method = "GET", body) {
  const r = await fetch(API + path, { method, headers, body: body && JSON.stringify(body) });
  if (!r.ok && r.status !== 422) throw new Error(`${method} ${path}: HTTP ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

const report = await readFile("relatorio.md", "utf8");
const failed = MONITOR_FAILED === "true";
// Parte do relatório que descreve os problemas (sem datas), usada para comparar
const problemsOf = (text) => (text.split("### O que precisa de atenção")[1] || "").split("### Resumo")[0].replace(/\d{2}\/\d{2}\/\d{2,4},? \d{2}:\d{2}|há [\d.]+ (horas|dias|min)/g, "").trim();

await gh("/labels", "POST", { name: LABEL, color: "d7261e", description: "Alertas automáticos do monitor diário" }); // 422 = já existe
const open = (await gh(`/issues?state=open&labels=${LABEL}&per_page=1`))[0];

if (failed) {
  if (!open) {
    const issue = await gh("/issues", "POST", { title: "⚠️ Mural Vermelho: o monitor encontrou problemas", body: report, labels: [LABEL] });
    console.log("Aviso aberto:", issue.html_url);
  } else {
    const comments = await gh(`/issues/${open.number}/comments?per_page=100`);
    const last = comments.length ? comments[comments.length - 1].body : open.body;
    if (problemsOf(last) !== problemsOf(report)) {
      await gh(`/issues/${open.number}/comments`, "POST", { body: report });
      console.log("Problemas mudaram; comentário adicionado em", open.html_url);
    } else {
      console.log("Mesmos problemas do último aviso; nada a fazer.");
    }
  }
} else if (open) {
  await gh(`/issues/${open.number}/comments`, "POST", { body: report });
  await gh(`/issues/${open.number}`, "PATCH", { state: "closed", state_reason: "completed" });
  console.log("Tudo normal de novo; aviso fechado.");
} else {
  console.log("Tudo normal; nenhum aviso aberto.");
}
