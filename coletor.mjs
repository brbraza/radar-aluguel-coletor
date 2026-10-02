// Radar Aluguel — coletor gratuito (GitHub Actions)
// Lê páginas públicas de portais e imobiliárias de Teixeira de Freitas,
// padroniza no mesmo formato do site e grava data/anuncios.json.
import * as cheerio from "cheerio";
import fs from "node:fs/promises";

const CIDADE = "Teixeira de Freitas";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const PAUSA_MS = 1500;
const MAX_DETALHES_POR_EXECUCAO = 60;
const ARQ = "data/anuncios.json";
const ARQ_STATUS = "data/status.json";

/* ---------------- fontes ---------------- */
// paginas(n) devolve a URL da página n (1, 2, ...). link: regex do link de um anúncio.
const FONTES = [
  {
    id: "zap", nome: "ZAP Imóveis", maxPaginas: 6,
    paginas: (n) => `https://www.zapimoveis.com.br/aluguel/imoveis/ba+teixeira-de-freitas/${n > 1 ? `?pagina=${n}` : ""}`,
    link: /zapimoveis\.com\.br\/imovel\/[^"'#?\s]+-id-(\d+)/,
  },
  {
    id: "vivareal", nome: "Viva Real", maxPaginas: 6,
    paginas: (n) => `https://www.vivareal.com.br/aluguel/bahia/teixeira-de-freitas/${n > 1 ? `?pagina=${n}` : ""}`,
    link: /vivareal\.com\.br\/imovel\/[^"'#?\s]+-id-(\d+)/,
  },
  {
    id: "olx", nome: "OLX", maxPaginas: 3,
    paginas: (n) => `https://www.olx.com.br/imoveis/aluguel/estado-ba/sul-da-bahia/teixeira-de-freitas${n > 1 ? `?o=${n}` : ""}`,
    link: /olx\.com\.br\/imoveis\/[^"'#?\s]*?-(\d{8,})(?:[/?"']|$)/,
  },
  {
    id: "clovia", nome: "Clóvia Imobiliária", maxPaginas: 4,
    paginas: (n) => `https://www.cloviaimobiliaria.com.br/imoveis/para-alugar${n > 1 ? `?pagina=${n}` : ""}`,
    link: /cloviaimobiliaria\.com\.br\/imovel\/[^"'#?\s]+\/([A-Z]{1,4}\d{3,}-[A-Z]+)/,
  },
  {
    id: "kellylima", nome: "Kelly Lima Corretora", maxPaginas: 4,
    paginas: (n) => `https://www.kellylimacorretora.com.br/filtro/locacao/todos/todas/todos/todos/todos/todos/1/${n}`,
    link: /kellylimacorretora\.com\.br\/imovel\/(?:locacao|venda-e-locacao)\/[^"'#?\s]+\/(\d+)/,
  },
  {
    id: "renatabarbosa", nome: "Renata Barbosa Imobiliária", maxPaginas: 3,
    paginas: (n) => `https://www.renatabarbosaimobiliaria.com.br/filtro/locacao/todos/todas/todos/todos/todos/todos/1/${n}`,
    link: /renatabarbosaimobiliaria\.com\.br\/imovel\/(?:locacao|venda-e-locacao)\/[^"'#?\s]+\/(\d+)/,
  },
];

/* ---------------- utilidades ---------------- */
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const limpa = (s) => String(s || "").replace(/\s+/g, " ").trim();
const titleCase = (s) => limpa(s).toLowerCase().replace(/(^|\s|-)\S/g, (c) => c.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das|E)\b/g, (m) => m.toLowerCase());
const reais = (txt) => [...String(txt).matchAll(/R\$\s*([\d.]+(?:,\d{1,2})?)/g)].map((m) => Number(m[1].replace(/\./g, "").replace(",", "."))).filter((n) => Number.isFinite(n));

async function baixar(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "pt-BR,pt;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  const html = await r.text();
  return { status: r.status, html, url: r.url };
}

/* ---------------- bairros conhecidos ---------------- */
const BAIRROS = [
  ["Bela Vista", ["bela vista"]], ["Colina Verde", ["colina verde"]], ["Santa Rita", ["santa rita"]],
  ["Jardim Planalto", ["jardim planalto"]], ["Universitário", ["universitario"]], ["Novo Horizonte", ["novo horizonte"]],
  ["Estância Biquíni", ["estancia biquini", "estancia biquine", "biquini"]], ["Kaikan Sul", ["kaikan sul"]], ["Kaikan", ["kaikan"]],
  ["São Lourenço", ["sao lourenco"]], ["Wilson Brito", ["wilson brito"]], ["Monte Castelo", ["monte castelo"]],
  ["Santa Rosa de Lima", ["santa rosa de lima"]], ["Ouro Verde", ["ouro verde"]], ["Jardim Beira Rio", ["jardim beira rio", "beira rio"]],
  ["Luiz Eduardo Magalhães", ["luiz eduardo magalhaes", "luis eduardo magalhaes"]], ["Tancredo Neves", ["tancredo neves"]],
  ["Castelinho", ["castelinho"]], ["Vila Vargas", ["vila vargas"]], ["Recanto do Lago", ["recanto do lago"]], ["Teixeirinha", ["teixeirinha"]],
  ["Ulisses Guimarães", ["ulisses guimaraes", "ulysses guimaraes"]], ["Nova Jerusalém", ["nova jerusalem"]], ["Jerusalém", ["jerusalem"]],
  ["Bonadiman", ["bonadiman"]], ["Duque de Caxias", ["duque de caxias"]], ["Nova Teixeira", ["nova teixeira"]],
  ["Vila Caraípe", ["vila caraipe"]], ["Jardim Caraípe", ["jardim caraipe"]], ["Caraípe", ["caraipe"]], ["Monte Alegre", ["monte alegre"]],
  ["Jardim Europa", ["jardim europa"]], ["Vila Verde", ["vila verde"]], ["Liberdade Sul", ["liberdade sul"]], ["Liberdade", ["bairro liberdade", "liberdade"]],
  ["Redenção", ["redencao"]], ["Aviação", ["aviacao"]], ["Portal Sul", ["portal sul"]], ["Mont Serrat", ["mont serrat", "monte serrat"]],
  ["Residencial dos Pioneiros", ["residencial dos pioneiros"]], ["Jardim das Palmeiras", ["jardim das palmeiras"]], ["Pituba", ["pituba"]],
  ["Plaza Ville", ["plaza ville"]], ["La Ville", ["la ville"]], ["Reserva Imperial", ["reserva imperial"]], ["Golden Imperial", ["golden imperial"]],
  ["Rosa de Luxemburgo", ["rosa de luxemburgo"]], ["Setor Bahia", ["setor bahia"]], ["Urbis", ["urbis"]], ["Pesque e Pague", ["pesque e pague"]],
  ["Eixo Sul", ["eixo sul"]], ["Cidadel", ["cidadel"]], ["Canta Galo", ["canta galo"]], ["Caminho do Mar", ["caminho do mar"]],
  ["Centro", ["bairro centro", "no centro", ", centro,", " centro - ", "/centro/", "centro, teixeira"]],
];
function detectarBairro(...textos) {
  const t = " " + norm(textos.join(" | ")) + " ";
  let melhor = null;
  for (const [nome, vars] of BAIRROS) {
    for (const v of vars) {
      const i = t.search(new RegExp("(^|[^a-z])" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+") + "($|[^a-z])"));
      if (i >= 0 && (!melhor || i < melhor.i)) melhor = { nome, i };
    }
  }
  return melhor ? melhor.nome : null;
}

/* ---------------- extração genérica de cartões ---------------- */
function extrairCartoes(html, fonte, base) {
  const $ = cheerio.load(html);
  const absol = (u) => { try { return new URL(u, base).href; } catch { return null; } };
  const porHref = new Map();
  $("a[href]").each((_, a) => {
    const href = absol($(a).attr("href"));
    if (!href) return;
    const m = href.match(fonte.link);
    if (!m) return;
    const canon = href.split("#")[0].split("?")[0];
    if (!porHref.has(canon)) porHref.set(canon, { id: m[1], els: [] });
    porHref.get(canon).els.push(a);
  });

  const saida = [];
  for (const [url, { id, els }] of porHref) {
    // sobe na árvore enquanto o bloco contiver só este anúncio
    let card = $(els[0]);
    for (let i = 0; i < 10; i++) {
      const pai = card.parent();
      if (!pai.length || pai.is("body")) break;
      const hrefs = new Set();
      pai.find("a[href]").each((_, a) => {
        const h = absol($(a).attr("href"));
        if (h && fonte.link.test(h)) hrefs.add(h.split("#")[0].split("?")[0]);
      });
      if (hrefs.size > 1) break;
      card = pai;
    }
    const texto = limpa(card.text());
    const titulo = limpa($(els[0]).attr("title") || card.find("h2,h3,h4").first().text() || $(els[0]).text()).slice(0, 160);
    const imgs = [];
    card.find("img, source").each((_, im) => {
      const cands = [$(im).attr("src"), $(im).attr("data-src"), $(im).attr("data-lazy"), ($(im).attr("srcset") || $(im).attr("data-srcset") || "").split(",").pop()?.trim().split(" ")[0]];
      for (const c of cands) {
        const u = c && absol(c);
        if (u && /^https?:/.test(u) && !/\.svg(\?|$)|logo|icon|placeholder|blank|pixel/i.test(u)) imgs.push(u);
      }
    });
    card.find("[style*='background']").each((_, el) => {
      const m = String($(el).attr("style")).match(/url\(['"]?([^'")]+)/);
      if (m) { const u = absol(m[1]); if (u) imgs.push(u); }
    });
    saida.push({ url, id, titulo, texto, fotos: [...new Set(imgs)].slice(0, 10) });
  }
  return saida;
}

function interpretar(c, fonte) {
  const tudo = `${c.titulo} | ${c.texto} | ${decodeURIComponent(c.url).replace(/[-/]/g, " ")}`;
  const n = norm(tudo);
  if (!n.includes("teixeira de freitas") && !n.includes("teixeira-de-freitas")) return null;
  if (/\b(galpao|ponto comercial|sala comercial|loja|terreno|lote|predio|comercial|escritorio|deposito|chacara|fazenda)\b/.test(norm(c.titulo + " " + c.url))) return null;

  const tipo = /apart|apto|kitnet|kitinete|flat|studio|cobertura/.test(n) ? "apartamento" : /\bcasa|sobrado|condominio fechado|duplex/.test(n) ? "casa" : null;
  if (!tipo) return null;

  // aluguel: valor plausível; se houver venda+locação, pega o menor valor de aluguel plausível
  const valores = reais(c.texto).filter((v) => v >= 200 && v <= 30000);
  let aluguel = null;
  const mAl = c.texto.match(/(?:aluguel|loca[cç][aã]o|\/m[eê]s)[^R]{0,25}R\$\s*([\d.]+(?:,\d{1,2})?)/i) || c.texto.match(/R\$\s*([\d.]+(?:,\d{1,2})?)\s*(?:\/\s*m[eê]s|mensal)/i);
  if (mAl) aluguel = Number(mAl[1].replace(/\./g, "").replace(",", "."));
  if (!(aluguel >= 200 && aluguel <= 30000)) aluguel = valores.length ? Math.min(...valores) : null;
  if (!aluguel) return null;
  const mCond = c.texto.match(/condom[ií]nio[^R]{0,15}R\$\s*([\d.]+(?:,\d{1,2})?)/i);
  const mIptu = c.texto.match(/iptu[^R]{0,15}R\$\s*([\d.]+(?:,\d{1,2})?)/i);
  const cond = mCond ? Number(mCond[1].replace(/\./g, "").replace(",", ".")) : 0;
  const iptu = mIptu ? Number(mIptu[1].replace(/\./g, "").replace(",", ".")) : 0;

  const num = (re) => { const m = n.match(re); return m ? Number(m[1]) : null; };
  const quartos = num(/(\d+)\s*(?:quartos?|dormit[oó]rios?|dorms?\b|suites?)/);
  const banheiros = num(/(\d+)\s*banheiros?/);
  const garagens = num(/(\d+)\s*(?:vagas?|garage(?:m|ns))/);
  const area = num(/(\d{2,4})(?:[.,]\d+)?\s*m(?:²|2)\b/);

  let bairro = null;
  const mUrl = c.url.match(/teixeira-de-freitas-ba\/([^/]+)\//); // Kelly Lima / Renata Barbosa
  if (mUrl) bairro = titleCase(mUrl[1].replace(/-/g, " "));
  const mKenlo = c.texto.match(/([A-Za-zÀ-ú .]{3,40}) - Teixeira de Freitas - BA/i);
  if (!bairro && mKenlo) bairro = titleCase(mKenlo[1]);
  const mZap = (c.titulo || "").match(/,\s*([^,]{3,40}),\s*Teixeira de Freitas/i);
  if (!bairro && mZap) bairro = titleCase(mZap[1]);
  bairro = detectarBairro(bairro || "", c.titulo) || bairro;

  return {
    id: `${fonte.id}-${String(c.id).toLowerCase()}`,
    titulo: c.titulo || `${tipo === "casa" ? "Casa" : "Apartamento"} para alugar`,
    descricao: "",
    tipo,
    status: "ativo",
    fonte: { nome: fonte.nome, url: c.url, anuncioId: String(c.id) },
    preco: { aluguel: Math.round(aluguel), custoMensalConhecido: cond || iptu ? Math.round(aluguel + cond + iptu) : null },
    localizacao: { bairro, cidade: CIDADE, estado: "BA" },
    caracteristicas: { quartos, banheiros, garagens, areaM2: area },
    fotos: c.fotos,
    fotoPrincipal: c.fotos[0] || null,
  };
}

/* ---------------- página de detalhe (só para anúncios novos) ---------------- */
async function enriquecer(a) {
  try {
    const { status, html } = await baixar(a.fonte.url);
    if (status >= 400) return a;
    const $ = cheerio.load(html);
    const meta = (p) => $(`meta[property="${p}"]`).attr("content") || $(`meta[name="${p}"]`).attr("content") || "";
    let desc = limpa(meta("og:description") || meta("description"));
    // tenta um bloco de descrição maior
    $("[class*=descri], [id*=descri], [data-testid*=descri], [data-cy*=descri]").each((_, el) => {
      const t = limpa($(el).text());
      if (t.length > desc.length && t.length < 4000) desc = t;
    });
    const fotos = [...a.fotos];
    $('meta[property="og:image"]').each((_, m) => { const u = $(m).attr("content"); if (u) fotos.push(u); });
    $("img").each((_, im) => {
      const u = $(im).attr("src") || $(im).attr("data-src");
      if (u && /^https?:/.test(u) && /(resizedimgs|img\.kenlo|cloudfront|olx|imgs?\.|\/fotos?\/|uploads)/i.test(u) && !/logo|icon|\.svg/i.test(u)) fotos.push(u);
    });
    a.descricao = desc.slice(0, 3000);
    a.fotos = [...new Set(fotos)].slice(0, 12);
    a.fotoPrincipal = a.fotos[0] || null;
    const n = norm(desc);
    if (a.caracteristicas.quartos == null) { const m = n.match(/(\d+)\s*(?:quartos?|dormitorios?)/); if (m) a.caracteristicas.quartos = Number(m[1]); }
    if (a.caracteristicas.banheiros == null) { const m = n.match(/(\d+)\s*banheiros?/); if (m) a.caracteristicas.banheiros = Number(m[1]); }
    if (!a.localizacao.bairro) a.localizacao.bairro = detectarBairro(desc);
    if (/aceita (?:pets?|animais)/.test(n)) a.caracteristicas.aceitaAnimais = true;
    if (/\bmobiliad/.test(n)) a.caracteristicas.mobiliado = true;
  } catch (e) { /* mantém o que veio do cartão */ }
  return a;
}

/* ---------------- execução ---------------- */
const agora = new Date().toISOString();
let anteriores = [];
try { anteriores = JSON.parse(await fs.readFile(ARQ, "utf8")).anuncios || []; } catch {}
const antPorId = new Map(anteriores.map((a) => [a.id, a]));

const status = {};
const coletados = new Map();
for (const fonte of FONTES) {
  const st = { ok: false, paginas: 0, cartoes: 0, anuncios: 0, http: [], erro: null };
  try {
    for (let p = 1; p <= fonte.maxPaginas; p++) {
      const url = fonte.paginas(p);
      const { status: code, html } = await baixar(url);
      st.http.push(code);
      if (code >= 400) { if (p === 1) st.erro = `HTTP ${code}`; break; }
      if (/cf-chl|captcha|Just a moment|px-captcha|Access Denied/i.test(html.slice(0, 20000)) && !fonte.link.test(html)) { st.erro = "bloqueado (captcha/antirrobô)"; break; }
      const cartoes = extrairCartoes(html, fonte, url);
      st.paginas++;
      let novosNaPagina = 0;
      for (const c of cartoes) {
        st.cartoes++;
        const a = interpretar(c, fonte);
        if (!a || coletados.has(a.id)) continue;
        coletados.set(a.id, a);
        st.anuncios++;
        novosNaPagina++;
      }
      if (!cartoes.length || !novosNaPagina) break;
      await dormir(PAUSA_MS);
    }
    st.ok = !st.erro;
  } catch (e) {
    st.erro = String(e.message || e).slice(0, 200);
  }
  status[fonte.id] = st;
  console.log(`[${fonte.id}] páginas=${st.paginas} cartões=${st.cartoes} anúncios=${st.anuncios} http=${st.http.join(",")} ${st.erro || ""}`);
  await dormir(PAUSA_MS);
}

// mescla com o que já existia (mantém descrição/fotos já enriquecidas e a data da 1ª captura)
let detalhes = 0;
const finais = [];
for (const a of coletados.values()) {
  const ant = antPorId.get(a.id);
  if (ant) {
    a.descricao = ant.descricao || a.descricao;
    if ((ant.fotos || []).length > a.fotos.length) { a.fotos = ant.fotos; a.fotoPrincipal = ant.fotoPrincipal; }
    for (const k of ["quartos", "banheiros", "garagens", "areaM2", "aceitaAnimais", "mobiliado"]) if (a.caracteristicas[k] == null && ant.caracteristicas?.[k] != null) a.caracteristicas[k] = ant.caracteristicas[k];
    a.localizacao.bairro = a.localizacao.bairro || ant.localizacao?.bairro || null;
    a.rastreamento = { primeiraCapturaEm: ant.rastreamento?.primeiraCapturaEm || agora, ultimaCapturaEm: agora };
    if (ant.preco?.aluguel && ant.preco.aluguel !== a.preco.aluguel) a.precoAnterior = ant.preco.aluguel;
  } else {
    a.rastreamento = { primeiraCapturaEm: agora, ultimaCapturaEm: agora };
    if (detalhes < MAX_DETALHES_POR_EXECUCAO) { await enriquecer(a); detalhes++; await dormir(PAUSA_MS); }
  }
  finais.push(a);
}

// fonte que falhou hoje: mantém os anúncios dela de antes (até 10 dias sem ver)
for (const ant of anteriores) {
  const fid = ant.id.split("-")[0];
  if (coletados.has(ant.id) || status[fid]?.ok) continue;
  const visto = Date.parse(ant.rastreamento?.ultimaCapturaEm || 0);
  if (Date.now() - visto < 10 * 864e5) finais.push(ant);
}

// remove duplicados entre fontes (mesmo tipo, preço, bairro e quartos)
const chaves = new Map();
const unicos = [];
for (const a of finais.sort((x, y) => (y.fotos?.length || 0) - (x.fotos?.length || 0))) {
  const k = a.localizacao.bairro && a.caracteristicas.quartos != null ? [a.tipo, a.preco.aluguel, norm(a.localizacao.bairro), a.caracteristicas.quartos].join("|") : null;
  if (k && chaves.has(k) && chaves.get(k) !== a.fonte.nome) continue;
  if (k) chaves.set(k, a.fonte.nome);
  unicos.push(a);
}

await fs.mkdir("data", { recursive: true });
await fs.writeFile(ARQ, JSON.stringify({ atualizadoEm: agora, total: unicos.length, anuncios: unicos }, null, 1));
await fs.writeFile(ARQ_STATUS, JSON.stringify({ atualizadoEm: agora, fontes: status }, null, 2));
console.log(`Total: ${unicos.length} anúncios (${detalhes} páginas de detalhe lidas)`);
