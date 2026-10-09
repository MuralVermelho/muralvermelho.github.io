(() => {
  "use strict";
  const PAGE = 30;
  const $ = (s) => document.querySelector(s);
  const feedEl = $("#feed"), moreBtn = $("#more"), qEl = $("#q"), fonteEl = $("#fonte"), temasEl = $("#temas"), controls = $("#controls");

  let DATA = null, SRC = {};
  const state = { tab: "noticias", q: "", fonte: "", tema: "", shown: PAGE };

  const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  function ago(iso) {
    const s = (new Date(iso) - Date.now()) / 1000;
    const steps = [[60, "second"], [3600, "minute", 60], [86400, "hour", 3600], [604800, "day", 86400], [Infinity, "week", 604800]];
    if (s > -60) return "agora";
    for (const [lim, unit, div] of steps) if (-s < lim) return rtf.format(Math.round(s / (div || 1)), unit);
  }
  const fullDate = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  /* ---------- Estado na URL (links compartilháveis) ---------- */
  function readHash() {
    const [path, qs] = location.hash.replace(/^#\/?/, "").split("?");
    const p = new URLSearchParams(qs || "");
    state.tab = ["noticias", "ensaios", "fontes"].includes(path) ? path : "noticias";
    state.q = p.get("q") || "";
    state.fonte = p.get("fonte") || "";
    state.tema = p.get("tema") || "";
    state.shown = PAGE;
  }
  function writeHash() {
    const p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.fonte) p.set("fonte", state.fonte);
    if (state.tema) p.set("tema", state.tema);
    const h = `#/${state.tab}${p.toString() ? "?" + p : ""}`;
    if (location.hash !== h) history.replaceState(null, "", h);
  }

  /* ---------- Filtragem ---------- */
  function pool() {
    const type = state.tab === "ensaios" ? "ensaio" : "noticia";
    return DATA.items.filter((it) => it.type === type);
  }
  function filtered() {
    const terms = norm(state.q).split(/\s+/).filter(Boolean);
    return pool().filter((it) => {
      if (state.fonte && it.source !== state.fonte) return false;
      if (state.tema && !it.themes.includes(state.tema)) return false;
      if (terms.length) {
        const hay = it._hay || (it._hay = norm(`${it.title} ${it.excerpt} ${it.author || ""} ${SRC[it.source]?.name || ""}`));
        return terms.every((t) => hay.includes(t));
      }
      return true;
    });
  }
  // Evita que um veículo muito prolífico ocupe a página inteira:
  // segura itens cuja fonte já apareceu 2x nas últimas 6 posições.
  function diversify(list) {
    const out = [], held = [];
    const recent = (src) => out.slice(-6).filter((x) => x.source === src).length;
    for (const it of list) {
      for (let i = 0; i < held.length; i++) if (recent(held[i].source) < 2) out.push(...held.splice(i--, 1));
      if (recent(it.source) < 2) out.push(it); else held.push(it);
    }
    return out.concat(held);
  }

  /* ---------- Renderização ---------- */
  const srcLink = (it) => `<button class="src tag-src" data-fonte="${esc(it.source)}">${esc(SRC[it.source]?.name || it.source)}</button>`;
  const tags = (it) => it.themes.length ? `<div class="tags">${it.themes.map((t) => `<button class="tag" data-tema="${t}">${esc(DATA.themes[t])}</button>`).join("")}</div>` : "";
  const img = (it, eager) => it.image ? `<div class="img"><img src="${esc(safeUrl(it.image))}" alt="" loading="${eager ? "eager" : "lazy"}" referrerpolicy="no-referrer" onerror="this.closest('.img').remove()"></div>` : "";
  const link = (it, inner) => `<a href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
  const readTime = (it) => it.words && it.words > 150 ? `<span>${Math.max(1, Math.round(it.words / 200))} min de leitura</span>` : "";

  function leadHTML(it) {
    return `<article class="lead${it.image ? "" : " noimg"}">${img(it, true)}<div class="body">
      <span class="kicker">Mais recente</span>${srcLink(it)}
      <h2>${link(it, esc(it.title))}</h2>
      ${it.excerpt ? `<p>${esc(it.excerpt)}</p>` : ""}
      <div class="meta"><time datetime="${it.date}" title="${fullDate(it.date)}">${ago(it.date)}</time>${it.author ? `<span>por ${esc(it.author)}</span>` : ""}</div>
      ${tags(it)}</div></article>`;
  }
  function cardHTML(it) {
    return `<article class="card">${srcLink(it)}${img(it)}
      <h3>${link(it, esc(it.title))}</h3>
      ${it.excerpt ? `<p>${esc(it.excerpt)}</p>` : ""}
      <div class="meta"><time datetime="${it.date}" title="${fullDate(it.date)}">${ago(it.date)}</time></div>
      ${tags(it)}</article>`;
  }
  function essayHTML(it, i) {
    return `<article class="essay${it.image ? "" : " noimg"}"><div class="num">${String(i + 1).padStart(2, "0")}</div><div>
      ${srcLink(it)}
      <h3>${link(it, esc(it.title))}</h3>
      ${it.author ? `<div class="author">${esc(it.author)}</div>` : ""}
      ${it.excerpt ? `<p>${esc(it.excerpt)}</p>` : ""}
      <div class="meta"><time datetime="${it.date}" title="${fullDate(it.date)}">${ago(it.date)}</time>${readTime(it)}</div>
      ${tags(it)}</div>${img(it)}</article>`;
  }

  function renderControls() {
    const items = pool();
    const typeSources = DATA.sources.filter((s) => items.some((i) => i.source === s.id)).sort((a, b) => a.name.localeCompare(b.name, "pt"));
    fonteEl.innerHTML = `<option value="">Todos os veículos (${typeSources.length})</option>` +
      typeSources.map((s) => `<option value="${esc(s.id)}"${s.id === state.fonte ? " selected" : ""}>${esc(s.name)}</option>`).join("");
    const base = items.filter((it) => !state.fonte || it.source === state.fonte);
    const counts = {};
    base.forEach((it) => it.themes.forEach((t) => (counts[t] = (counts[t] || 0) + 1)));
    const themes = Object.keys(DATA.themes).filter((t) => counts[t]).sort((a, b) => counts[b] - counts[a]);
    temasEl.innerHTML = `<button class="chip" data-tema="" aria-pressed="${!state.tema}">Todos</button>` +
      themes.map((t) => `<button class="chip" data-tema="${t}" aria-pressed="${state.tema === t}">${esc(DATA.themes[t])}<small>${counts[t]}</small></button>`).join("");
    if (qEl.value !== state.q) qEl.value = state.q;
  }

  function renderSources() {
    const block = (type, title) => {
      const list = DATA.sources.filter((s) => s.type === type).sort((a, b) => a.name.localeCompare(b.name, "pt"));
      const n = (id) => DATA.items.filter((i) => i.source === id).length;
      return `<h2>${title} <small style="font-family:var(--body);font-size:16px;color:var(--muted)">${list.length} veículos</small></h2><ul>${list.map((s) =>
        `<li><a href="${esc(safeUrl(s.site))}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>
         ${s.ok === false ? `<span class="off" title="${esc(s.error)}">fora do ar agora</span>` : `<button data-goto="${esc(s.id)}" data-type="${type}">${n(s.id)} textos</button>`}</li>`).join("")}</ul>`;
    };
    feedEl.innerHTML = `<div class="sources">
      <p class="sources-intro">O Panfleto lê os feeds públicos (RSS) destes veículos de hora em hora e mostra título, trecho e link. Nada é republicado na íntegra: a leitura completa acontece sempre no site de origem. A lista é curada e revisada periodicamente.</p>
      ${block("noticia", "Notícias")}${block("ensaio", "Textos longos e análise")}</div>`;
  }

  function render() {
    document.querySelectorAll(".tabs a").forEach((a) => (a.dataset.tab === state.tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    writeHash();
    if (state.tab === "fontes") {
      controls.hidden = true; moreBtn.hidden = true;
      renderSources();
      return;
    }
    controls.hidden = false;
    renderControls();
    let list = filtered();
    const filtering = state.q || state.fonte || state.tema;
    if (!state.fonte && state.tab === "noticias") list = diversify(list);
    const page = list.slice(0, state.shown);
    const info = filtering
      ? `<div class="result-info">${list.length} resultado${list.length === 1 ? "" : "s"} · <button data-clear>limpar filtros</button></div>` : "";
    if (!list.length) {
      feedEl.innerHTML = info + `<div class="status">Nada encontrado com esses filtros.</div>`;
    } else if (state.tab === "ensaios") {
      feedEl.innerHTML = info + `<div class="essays">${page.map(essayHTML).join("")}</div>`;
    } else {
      const [first, ...rest] = page;
      feedEl.innerHTML = info + (filtering ? "" : leadHTML(first)) + `<div class="grid">${(filtering ? page : rest).map(cardHTML).join("")}</div>`;
    }
    moreBtn.hidden = list.length <= state.shown;
  }

  /* ---------- Eventos ---------- */
  let t;
  qEl.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { state.q = qEl.value.trim(); state.shown = PAGE; render(); }, 180); });
  fonteEl.addEventListener("change", () => { state.fonte = fonteEl.value; state.tema = ""; state.shown = PAGE; render(); });
  moreBtn.addEventListener("click", () => { state.shown += PAGE; render(); });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tema],[data-fonte],[data-clear],[data-goto]");
    if (!b) return;
    if (b.matches("[data-clear]")) Object.assign(state, { q: "", fonte: "", tema: "" });
    else if (b.matches("[data-goto]")) Object.assign(state, { tab: b.dataset.type === "ensaio" ? "ensaios" : "noticias", fonte: b.dataset.goto, tema: "", q: "" });
    else if (b.matches("[data-fonte]")) { state.fonte = b.dataset.fonte; state.tema = ""; }
    else state.tema = state.tema === b.dataset.tema && b.classList.contains("tag") ? "" : b.dataset.tema;
    state.shown = PAGE;
    render();
    if (!b.classList.contains("chip")) window.scrollTo({ top: document.querySelector(".tabs").offsetTop, behavior: "smooth" });
  });
  window.addEventListener("hashchange", () => { readHash(); render(); });

  /* ---------- Início ---------- */
  $("#today").textContent = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  readHash();
  feedEl.innerHTML = `<div class="status">Carregando as manchetes…</div>`;
  fetch("data/items.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => {
      DATA = d;
      d.sources.forEach((s) => (SRC[s.id] = s));
      const ok = d.sources.filter((s) => s.ok !== false).length;
      $("#updated").textContent = `Atualizado ${ago(d.updated)} · ${ok} veículos`;
      render();
    })
    .catch(() => { feedEl.innerHTML = `<div class="status">Não foi possível carregar as notícias. Tente recarregar a página.</div>`; });
})();
