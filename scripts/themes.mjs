// Classificação temática por palavras-chave (sem acento, minúsculas).
// Cada termo casa no início de palavra, então "sindic" pega "sindicato", "sindical" etc.
export const THEMES = {
  politica: {
    label: "Política",
    terms: ["lula", "bolsonar", "congresso", "camara dos deputados", "senado", "stf", "supremo", "eleic", "eleitor", "governo federal", "ministro", "ministra", "partido", "psol", "centrao", "golpe", "democracia", "extrema direita", "extrema-direita", "impeachment", "planalto", "deputad", "senador", "prefeit", "governador", "anistia", "8 de janeiro", "tarcisio", "lira", "motta", "alcolumbre"]
  },
  trabalho: {
    label: "Trabalho",
    terms: ["trabalhador", "trabalhista", "sindic", "greve", "salari", "emprego", "desemprego", "precariz", "uberiz", "entregador", "aplicativo", "6x1", "jornada", "previdencia", "aposentad", "clt", "classe trabalhadora", "operari", "terceiriz", "servidor"]
  },
  internacional: {
    label: "Internacional",
    terms: ["eua", "estados unidos", "trump", "china", "chines", "russia", "putin", "ucrania", "palestin", "gaza", "israel", "netanyahu", "cisjordania", "venezuel", "maduro", "cuba", "argentin", "milei", "otan", "europa", "imperialis", "america latina", "africa", "onu", "bolivia", "chile", "colombia", "mexico", "irani", "teera", "libano", "siria", "brics", "geopolit", "franca", "alemanha", "reino unido", "india", "haiti", "equador", "peru"]
  },
  ambiente: {
    label: "Meio ambiente",
    terms: ["clima", "climat", "desmat", "amazonia", "ambienta", "cop30", "cop 30", "agrotox", "queimada", "incendio", "minerac", "mineradora", "garimp", "enchente", "seca", "petroleo", "combustiv", "energia", "ecolog", "biodiversidade", "cerrado", "pantanal", "aquecimento global", "emissoes"]
  },
  terra: {
    label: "Terra e povos",
    terms: ["mst", "reforma agraria", "agronegocio", "campones", "indigena", "povos originarios", "quilombol", "assentamento", "latifund", "agricultura familiar", "sem terra", "sem-terra", "demarcac", "marco temporal", "yanomami", "guarani", "ruralista", "agroecolog", "acampamento"]
  },
  raca: {
    label: "Raça",
    terms: ["racis", "antirracis", "negro", "negra", "negros", "negras", "racial", "raciais", "quilombo", "abolic", "afro", "escravid", "escraviz", "branquitude", "injuria racial", "consciencia negra"]
  },
  genero: {
    label: "Gênero e LGBT",
    terms: ["mulher", "mulheres", "feminis", "feminicid", "machis", "misogin", "lgbt", "transexua", "transgener", "pessoas trans", "mulheres trans", "travesti", "homofob", "transfob", "aborto", "genero", "violencia domestica", "maria da penha", "violencia contra a mulher", "maternidade", "patriarc", "estupro"]
  },
  economia: {
    label: "Economia",
    terms: ["juros", "selic", "banco central", "inflac", "pib", "fiscal", "arcabouco", "imposto", "tribut", "mercado financeiro", "divida", "privatiz", "desigualdade", "renda", "fome", "pobreza", "bolsa familia", "orcamento", "taxac", "bilionari", "economi", "industria", "galipolo", "haddad", "tarifa"]
  },
  direitos: {
    label: "Direitos e repressão",
    terms: ["policia", "policial", "chacina", "prisao", "presos", "presidio", "encarcer", "violencia policial", "militar", "ditadura", "tortura", "direitos humanos", "milicia", "massacre", "genocid", "periferia", "favela", "seguranca publica", "racismo estrutural", "censura", "perseguic"]
  },
  cultura: {
    label: "Cultura e educação",
    terms: ["cultura", "cultural", "cinema", "filme", "livro", "literatur", "music", "arte", "artista", "educac", "universidade", "escola", "professor", "estudant", "ensino", "teatro", "poesia", "poeta"]
  },
  teoria: {
    label: "Teoria",
    terms: ["marx", "marxis", "socialis", "comunis", "capitalis", "lenin", "gramsci", "revoluc", "luta de classes", "neoliberal", "ideologi", "dialetic", "trotsk", "engels", "materialis", "emancipac", "anticapitalis", "rosa luxemburgo", "fanon", "paulo freire", "mais-valia", "classe social"]
  }
};

export const normalize = (s) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const COMPILED = Object.entries(THEMES).map(([id, t]) => [
  id,
  new RegExp(`(^|[^a-z0-9])(${t.terms.map(escape).join("|")})`, "g")
]);

// Título conta em dobro; feed categories também ajudam.
export function classify(title, text, categories = []) {
  const T = normalize(title);
  const B = normalize(text).slice(0, 2500) + " " + normalize(categories.join(" "));
  const scores = [];
  for (const [id, re] of COMPILED) {
    const s = 2 * (T.match(re) || []).length + (B.match(re) || []).length;
    if (s > 0) scores.push([id, s]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  const top = scores[0]?.[1] || 0;
  return scores.filter(([, s]) => s >= Math.max(2, top / 3)).slice(0, 3).map(([id]) => id);
}
