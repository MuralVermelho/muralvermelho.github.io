# Panfleto

Agregador de notícias e textos de esquerda em português. Reúne títulos, trechos e links de dezenas de veículos, atualizado de hora em hora, com duas seções (**Notícias** e **Textos longos**), filtro por tema e por veículo e busca.

O site é 100% estático: um robô (GitHub Actions) lê os feeds RSS, gera `site/data/items.json` e publica tudo no GitHub Pages. Não há servidor nem banco de dados, e o custo é zero.

## Como funciona

| Arquivo | O que faz |
|---|---|
| `sources.json` | Lista de veículos. `type: "noticia"` vai para a aba Notícias, `type: "ensaio"` vai para Textos longos. |
| `scripts/fetch.mjs` | Baixa os feeds, limpa os textos, detecta temas e mescla com o histórico (14 dias). |
| `scripts/themes.mjs` | Temas e palavras-chave usados na classificação automática. |
| `site/` | O site em si (HTML, CSS e JS puros). |
| `.github/workflows/atualizar.yml` | Roda a coleta de hora em hora e publica no GitHub Pages. |

## Rodar no seu computador

```bash
npm install
npm run fetch
npm run dev
```

Depois abra http://localhost:4321.

## Adicionar ou remover um veículo

Edite `sources.json`, acrescentando ou apagando uma linha no formato:

```json
{ "id": "apelido-sem-espaco", "name": "Nome do Veículo", "site": "https://site.com", "feed": "https://site.com/feed/", "type": "noticia" }
```

A maioria dos sites em WordPress tem o feed em `https://site.com/feed/`.

## Publicar no GitHub Pages (uma vez só)

1. Crie um repositório no GitHub e envie esta pasta.
2. No repositório, vá em **Settings → Pages → Build and deployment → Source** e escolha **GitHub Actions**.
3. Vá em **Actions → Atualizar e publicar → Run workflow**.

Daí em diante, o site se atualiza sozinho de hora em hora.

## Direitos autorais

O Panfleto mostra apenas título, um trecho curto e o link, que é o que os próprios veículos publicam nos feeds RSS. A leitura completa sempre acontece no site original.
