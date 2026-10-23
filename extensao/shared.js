/*
 * Lógica compartilhada entre o script do YouTube (content.js) e a página de
 * configurações (options.js): armazenamento, classificação por palavras-chave
 * e identificação de canais.
 */
(function (global) {
  'use strict';

  const api = global.browser || global.chrome;

  // ---------------------------------------------------------------------------
  // Valores padrão
  // ---------------------------------------------------------------------------

  const { CATALOGO, CATEGORIAS_YOUTUBE } = global.YTCatCatalogo;
  const IDS_PADRAO = ['tecnologia', 'runescape', 'investimentos', 'politica'];

  function temaDoCatalogo(id) {
    const t = CATALOGO.find((c) => c.id === id);
    return t ? JSON.parse(JSON.stringify(t)) : null;
  }

  const CATEGORIAS_PADRAO = IDS_PADRAO.map(temaDoCatalogo);

  const CONFIG_PADRAO = {
    ocultarShorts: true,      // esconde a prateleira de Shorts quando há filtro ativo
    mostrarSemCategoria: true, // mostra a pílula "Sem categoria"
    sugestoesIgnoradas: []     // temáticas do catálogo que o usuário dispensou
  };

  const CHAVES = ['categorias', 'canais', 'config', 'filtrosAtivos', 'filtroAtivo', 'ultimaImportacao'];

  // ---------------------------------------------------------------------------
  // Texto
  // ---------------------------------------------------------------------------

  function normalizar(texto) {
    return String(texto || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  }

  function escaparRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function slug(texto) {
    return normalizar(texto).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tema';
  }

  // ---------------------------------------------------------------------------
  // Identificação de canais
  // ---------------------------------------------------------------------------

  function normalizarHandle(handle) {
    let h = String(handle || '').trim();
    if (!h) return '';
    try { h = decodeURIComponent(h); } catch (e) { /* já decodificado */ }
    h = h.normalize('NFC').toLowerCase();
    if (!h.startsWith('@')) h = '@' + h;
    return h;
  }

  function normalizarNome(nome) {
    return normalizar(nome).replace(/\s+/g, ' ').trim();
  }

  // Extrai a identidade do canal a partir de um link do YouTube.
  function extrairCanalDeHref(href) {
    if (!href) return null;
    let caminho;
    try {
      caminho = new URL(href, 'https://www.youtube.com').pathname;
    } catch (e) {
      return null;
    }
    try { caminho = decodeURIComponent(caminho); } catch (e) { /* mantém */ }
    let m = caminho.match(/^\/(@[^/?#]+)/);
    if (m) return { handle: normalizarHandle(m[1]) };
    m = caminho.match(/^\/channel\/(UC[\w-]{10,})/);
    if (m) return { id: m[1] };
    m = caminho.match(/^\/(?:c|user)\/([^/?#]+)/);
    if (m) return { legado: normalizar(m[1]) };
    return null;
  }

  function chaveCanal(canal) {
    if (canal.handle) return 'h:' + normalizarHandle(canal.handle);
    if (canal.id) return 'c:' + canal.id;
    return 'n:' + normalizarNome(canal.nome);
  }

  // Índices para achar um canal salvo por handle, ID ou nome.
  function construirIndice(canais) {
    const porHandle = new Map();
    const porId = new Map();
    const porNome = new Map();
    for (const canal of Object.values(canais || {})) {
      if (canal.handle) porHandle.set(normalizarHandle(canal.handle), canal);
      if (canal.id) porId.set(canal.id, canal);
      const nome = normalizarNome(canal.nome);
      if (nome && !porNome.has(nome)) porNome.set(nome, canal);
    }
    return { porHandle, porId, porNome };
  }

  function buscarCanal(indice, { handle, id, nome } = {}) {
    if (handle) {
      const c = indice.porHandle.get(normalizarHandle(handle));
      if (c) return c;
    }
    if (id) {
      const c = indice.porId.get(id);
      if (c) return c;
    }
    if (nome) {
      const c = indice.porNome.get(normalizarNome(nome));
      if (c) return c;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Classificação automática
  // ---------------------------------------------------------------------------

  function compilarPalavra(palavra) {
    let p = normalizar(palavra).trim();
    if (!p) return null;
    const prefixo = p.endsWith('*');
    if (prefixo) p = p.slice(0, -1).trim();
    if (!p) return null;
    const corpo = escaparRegex(p).replace(/\s+/g, '\\s+');
    const fim = prefixo ? '' : '(?![a-z0-9])';
    return {
      base: p,
      compacta: p.replace(/\s+/g, ''),
      re: new RegExp('(?:^|[^a-z0-9])' + corpo + fim)
    };
  }

  // ---------------------------------------------------------------------------
  // Categorias oficiais do YouTube
  // ---------------------------------------------------------------------------

  const APELIDOS_YOUTUBE = new Map();
  for (const [oficial, apelidos] of Object.entries(CATEGORIAS_YOUTUBE)) {
    APELIDOS_YOUTUBE.set(normalizar(oficial), oficial);
    for (const a of apelidos) APELIDOS_YOUTUBE.set(normalizar(a), oficial);
  }

  function categoriaYoutubeCanonica(nome) {
    const original = String(nome || '').trim();
    if (!original) return null;
    return APELIDOS_YOUTUBE.get(normalizar(original)) || original;
  }

  // Categoria mais frequente entre os vídeos recentes lidos do canal.
  function categoriaPrincipal(canal) {
    const lista = (canal.yt && canal.yt.categorias) || [];
    const n = {};
    let melhor = null;
    for (const c of lista) {
      if (!c) continue;
      n[c] = (n[c] || 0) + 1;
      if (!melhor || n[c] > n[melhor]) melhor = c;
    }
    return melhor;
  }

  // Temáticas salvas antes do catálogo não têm as categorias do YouTube:
  // usamos as do catálogo com o mesmo id.
  function youtubeDaTematica(cat) {
    if (cat.youtube !== undefined || cat.youtubeFraco !== undefined) {
      return { forte: cat.youtube || [], fraco: cat.youtubeFraco || [] };
    }
    const t = CATALOGO.find((c) => c.id === cat.id) || {};
    return { forte: t.youtube || [], fraco: t.youtubeFraco || [] };
  }

  // ---------------------------------------------------------------------------
  // Pontuação
  // ---------------------------------------------------------------------------

  const PONTO_MINIMO = 2;

  function compilarCategorias(categorias) {
    return (categorias || []).map((cat) => {
      const yt = youtubeDaTematica(cat);
      return {
        id: cat.id,
        regras: (cat.palavras || []).map(compilarPalavra).filter(Boolean),
        youtube: yt.forte,
        youtubeFraco: yt.fraco
      };
    });
  }

  // Palavra no nome ou no @ vale 3; na descrição ou nas tags dos vídeos, 1.
  // A categoria oficial do YouTube (a mais comum nos vídeos recentes) vale 3.
  function pontuarCanal(canal, compiladas) {
    const nome = normalizar(canal.nome);
    const handle = normalizar(canal.handle || '').replace(/^@/, '').replace(/[^a-z0-9]/g, '');
    const descricao = normalizar(canal.descricao);
    const tags = normalizar(((canal.yt && canal.yt.tags) || []).join(' | '));
    const principal = categoriaPrincipal(canal);
    const pontos = {};
    for (const cat of compiladas) {
      let soma = 0;
      for (const regra of cat.regras) {
        const noNome = regra.re.test(nome) ||
          (regra.compacta.length >= 4 && handle.includes(regra.compacta));
        if (noNome) soma += 3;
        if (descricao && regra.re.test(descricao)) soma += 1;
        if (tags && regra.re.test(tags)) soma += 1;
      }
      if (principal && cat.youtube.includes(principal)) soma += 3;
      if (soma > 0) pontos[cat.id] = soma;
    }
    return pontos;
  }

  // O canal entra nas temáticas com pelo menos 2 pontos e pelo menos metade da
  // maior pontuação. Se nada encaixar, vale a categoria ampla do YouTube
  // (ex.: "Entretenimento"), quando alguma temática a usa.
  function classificarCanal(canal, compiladas) {
    const pontos = pontuarCanal(canal, compiladas);
    const maior = Math.max(0, ...Object.values(pontos));
    if (maior >= PONTO_MINIMO) {
      const corte = Math.max(PONTO_MINIMO, maior / 2);
      return Object.keys(pontos).filter((id) => pontos[id] >= corte);
    }
    const principal = categoriaPrincipal(canal);
    if (principal) {
      return compiladas.filter((c) => c.youtubeFraco.includes(principal)).map((c) => c.id);
    }
    return [];
  }

  // ---------------------------------------------------------------------------
  // Sugestões
  // ---------------------------------------------------------------------------

  // Temáticas do catálogo que ainda não estão em uso e encaixariam pelo menos
  // dois canais, da que pega mais canais para a que pega menos.
  function sugerirTematicas(canais, categorias, ignoradas) {
    const atuais = new Set((categorias || []).map((c) => c.id));
    const fora = new Set(ignoradas || []);
    const candidatas = CATALOGO.filter((c) => !atuais.has(c.id) && !fora.has(c.id));
    if (!candidatas.length) return [];
    const compiladas = compilarCategorias([...(categorias || []), ...candidatas]);
    const achados = new Map(candidatas.map((c) => [c.id, []]));
    for (const canal of Object.values(canais || {})) {
      for (const id of classificarCanal(canal, compiladas)) {
        if (achados.has(id)) achados.get(id).push(canal.nome || canal.handle || '');
      }
    }
    return candidatas
      .map((c) => ({ id: c.id, nome: c.nome, total: achados.get(c.id).length, exemplos: achados.get(c.id).slice(0, 3) }))
      .filter((s) => s.total >= 2)
      .sort((a, b) => b.total - a.total);
  }

  const PALAVRAS_VAZIAS = new Set((
    'para como mais sobre todos todas toda todo canal canais videos video aqui este esta esse essa ' +
    'isso isto voce voces nosso nossa nossos nossas seus suas pelo pela pelos pelas quem quando onde ' +
    'porque entao tambem muito muita muitos muitas sempre cada novo novos nova novas semana segunda ' +
    'terca quarta quinta sexta sabado domingo dias inscreva inscrevase inscreve inscricao inscritos ' +
    'contato email gmail hotmail instagram twitter tiktok facebook youtube twitch discord http https ' +
    'www link links oficial official channel the and with your this that from about more have will ' +
    'just what comercial parcerias parceria business inquiries contact subscribe follow every week ' +
    'conteudo conteudos mundo vida melhor melhores brasil brasileiro brasileira sejam bem vindos ' +
    'ainda agora depois antes entre desde mesmo outros outras coisa coisas fazer feito ser sua seu ' +
    'tudo nada ate pra pro vamos video'
  ).split(/\s+/));

  // Palavras que se repetem entre os canais ainda sem categoria (contadas uma
  // vez por canal), para o usuário criar temáticas novas a partir delas.
  function palavrasFrequentes(canais, categorias, limite = 12) {
    const usadas = new Set();
    for (const cat of categorias || []) {
      for (const p of cat.palavras || []) usadas.add(normalizar(p).replace(/\*$/, '').trim());
    }
    const contagem = new Map();
    for (const canal of Object.values(canais || {})) {
      if ((canal.categorias || []).length) continue;
      const texto = normalizar([canal.nome, canal.descricao, ...((canal.yt && canal.yt.tags) || [])].join(' '));
      const termos = new Set(texto.split(/[^a-z0-9]+/).filter((t) =>
        t.length >= 4 && !/^\d+$/.test(t) && !PALAVRAS_VAZIAS.has(t) && !usadas.has(t)));
      for (const t of termos) contagem.set(t, (contagem.get(t) || 0) + 1);
    }
    return [...contagem]
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limite)
      .map(([palavra, total]) => ({ palavra, total }));
  }

  // Reclassifica os canais. Os ajustados à mão são preservados, a não ser que
  // incluirManuais seja true.
  function classificarTodos(canais, categorias, incluirManuais) {
    const compiladas = compilarCategorias(categorias);
    let alterados = 0;
    for (const canal of Object.values(canais)) {
      if (canal.manual && !incluirManuais) continue;
      canal.categorias = classificarCanal(canal, compiladas);
      canal.manual = false;
      alterados++;
    }
    return alterados;
  }

  // ---------------------------------------------------------------------------
  // Importação
  // ---------------------------------------------------------------------------

  // Junta uma lista recém-importada com os canais já salvos. Canais novos são
  // classificados; os já existentes têm os dados atualizados e só são
  // reclassificados se não tiverem ajuste manual. Nada é apagado.
  function mesclarImportacao(canais, importados, categorias) {
    const compiladas = compilarCategorias(categorias);
    const indice = construirIndice(canais);
    let novos = 0;
    let atualizados = 0;
    for (const bruto of importados) {
      if (!bruto || (!bruto.handle && !bruto.id && !bruto.nome)) continue;
      const item = {
        handle: bruto.handle ? normalizarHandle(bruto.handle) : '',
        id: bruto.id || '',
        nome: String(bruto.nome || '').trim(),
        descricao: String(bruto.descricao || '').trim(),
        avatar: bruto.avatar || ''
      };
      const existente = buscarCanal(indice, item);
      if (existente) {
        const chaveAntiga = chaveCanal(existente);
        existente.handle = item.handle || existente.handle || '';
        existente.id = item.id || existente.id || '';
        existente.nome = item.nome || existente.nome;
        existente.descricao = item.descricao || existente.descricao || '';
        existente.avatar = item.avatar || existente.avatar || '';
        if (!existente.manual) existente.categorias = classificarCanal(existente, compiladas);
        const chaveNova = chaveCanal(existente);
        if (chaveNova !== chaveAntiga) {
          delete canais[chaveAntiga];
          canais[chaveNova] = existente;
        }
        atualizados++;
      } else {
        const canal = {
          ...item,
          categorias: [],
          manual: false,
          adicionadoEm: Date.now()
        };
        canal.categorias = classificarCanal(canal, compiladas);
        canais[chaveCanal(canal)] = canal;
        if (canal.handle) indice.porHandle.set(canal.handle, canal);
        if (canal.id) indice.porId.set(canal.id, canal);
        const n = normalizarNome(canal.nome);
        if (n && !indice.porNome.has(n)) indice.porNome.set(n, canal);
        novos++;
      }
    }
    return { novos, atualizados };
  }

  // CSV do Google Takeout (subscriptions.csv): ID do canal, URL, título.
  function lerCsvTakeout(texto) {
    const linhas = [];
    let campo = '';
    let linha = [];
    let aspas = false;
    const t = String(texto || '').replace(/^﻿/, '');
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (aspas) {
        if (ch === '"' && t[i + 1] === '"') { campo += '"'; i++; }
        else if (ch === '"') aspas = false;
        else campo += ch;
      } else if (ch === '"') {
        aspas = true;
      } else if (ch === ',') {
        linha.push(campo); campo = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && t[i + 1] === '\n') i++;
        linha.push(campo); campo = '';
        if (linha.some((c) => c.trim())) linhas.push(linha);
        linha = [];
      } else {
        campo += ch;
      }
    }
    linha.push(campo);
    if (linha.some((c) => c.trim())) linhas.push(linha);

    const canais = [];
    for (const cols of linhas) {
      const celulas = cols.map((c) => c.trim());
      const id = celulas.find((c) => /^UC[\w-]{20,}$/.test(c));
      if (!id) continue; // cabeçalho ou linha inválida
      const url = celulas.find((c) => /youtube\.com/i.test(c)) || '';
      const nome = celulas.find((c) => c && c !== id && c !== url) || '';
      const doLink = extrairCanalDeHref(url) || {};
      canais.push({ id, handle: doLink.handle || '', nome });
    }
    return canais;
  }

  // ---------------------------------------------------------------------------
  // Armazenamento
  // ---------------------------------------------------------------------------

  function clonar(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  async function carregarEstado() {
    const d = (await api.storage.local.get(CHAVES)) || {};
    return {
      categorias: Array.isArray(d.categorias) ? d.categorias : clonar(CATEGORIAS_PADRAO),
      canais: d.canais && typeof d.canais === 'object' ? d.canais : {},
      config: { ...CONFIG_PADRAO, ...(d.config || {}) },
      // Temáticas marcadas na barra; vazio = "Todos". (filtroAtivo é da versão
      // com seleção única e só é lido para não perder a escolha antiga.)
      filtrosAtivos: Array.isArray(d.filtrosAtivos)
        ? d.filtrosAtivos
        : d.filtroAtivo && d.filtroAtivo !== 'todos' ? [d.filtroAtivo] : [],
      ultimaImportacao: d.ultimaImportacao || null
    };
  }

  function salvar(parcial) {
    return api.storage.local.set(parcial);
  }

  global.YTCat = {
    api,
    CATEGORIAS_PADRAO,
    CATALOGO,
    temaDoCatalogo,
    categoriaYoutubeCanonica,
    categoriaPrincipal,
    youtubeDaTematica,
    sugerirTematicas,
    palavrasFrequentes,
    CONFIG_PADRAO,
    normalizar,
    normalizarNome,
    normalizarHandle,
    slug,
    clonar,
    extrairCanalDeHref,
    chaveCanal,
    construirIndice,
    buscarCanal,
    compilarCategorias,
    pontuarCanal,
    classificarCanal,
    classificarTodos,
    mesclarImportacao,
    lerCsvTakeout,
    carregarEstado,
    salvar
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
