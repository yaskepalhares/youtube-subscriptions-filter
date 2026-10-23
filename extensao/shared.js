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

  // Palavras terminadas em * casam por prefixo ("invest*" casa "investimentos").
  // Sem *, a palavra precisa aparecer inteira. Acentos e maiúsculas são ignorados.
  const CATEGORIAS_PADRAO = [
    {
      id: 'tecnologia',
      nome: 'Tecnologia',
      palavras: [
        'tecnologia', 'tech', 'tecno*', 'gadget*', 'smartphone*', 'celular*', 'iphone', 'ipad',
        'android', 'apple', 'samsung', 'xiaomi', 'unboxing', 'hardware', 'software',
        'computador*', 'notebook*', 'pc', 'setup', 'linux', 'windows', 'macos', 'macbook',
        'programacao', 'programador*', 'codigo', 'coding', 'developer', 'dev', 'javascript',
        'python', 'inteligencia artificial', 'chatgpt', 'processador*', 'placa de video',
        'gpu', 'nvidia', 'eletronic*', 'informatica', 'startup*'
      ]
    },
    {
      id: 'runescape',
      nome: 'RuneScape',
      palavras: [
        'runescape', 'rune*', 'osrs', 'rs3', 'old school', 'oldschool', 'gielinor', 'ironman',
        'hcim', 'uim', 'gim', 'pvm', 'skilling', 'zulrah', 'jagex', 'deadman', 'gnome child'
      ]
    },
    {
      id: 'investimentos',
      nome: 'Investimentos',
      palavras: [
        'invest*', 'acoes', 'bolsa de valores', 'bolsa', 'b3', 'dividend*', 'fii', 'fiis',
        'fundos imobiliarios', 'renda fixa', 'renda variavel', 'renda passiva', 'tesouro direto',
        'financ*', 'dinheiro', 'patrimonio', 'aposentadoria', 'economi*', 'mercado financeiro',
        'trader', 'trading', 'day trade', 'stocks', 'etf', 'etfs', 'cripto*', 'bitcoin',
        'valuation', 'educacao financeira', 'riqueza'
      ]
    },
    {
      id: 'politica',
      nome: 'Política',
      palavras: [
        'politic*', 'eleic*', 'eleitora*', 'governo', 'congresso', 'senado', 'camara dos deputados',
        'deputad*', 'senador*', 'presidente', 'stf', 'democracia', 'esquerda', 'direita',
        'jornalismo', 'jornalista', 'jornal', 'noticia*', 'news', 'geopolitic*',
        'analise politica', 'brasilia', 'planalto'
      ]
    }
  ];

  const CONFIG_PADRAO = {
    ocultarShorts: true,      // esconde a prateleira de Shorts quando há filtro ativo
    mostrarSemCategoria: true // mostra a pílula "Sem categoria"
  };

  const CHAVES = ['categorias', 'canais', 'config', 'filtroAtivo', 'ultimaImportacao'];

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

  function compilarCategorias(categorias) {
    return (categorias || []).map((cat) => ({
      id: cat.id,
      regras: (cat.palavras || []).map(compilarPalavra).filter(Boolean)
    }));
  }

  // Pontuação: palavra no nome ou no @handle vale 3; na descrição vale 1.
  // O canal entra em todas as temáticas com pontuação >= metade da maior.
  function pontuarCanal(canal, compiladas) {
    const nome = normalizar(canal.nome);
    const handle = normalizar(canal.handle || '').replace(/^@/, '').replace(/[^a-z0-9]/g, '');
    const descricao = normalizar(canal.descricao);
    const pontos = {};
    for (const cat of compiladas) {
      let soma = 0;
      for (const regra of cat.regras) {
        const noNome = regra.re.test(nome) ||
          (regra.compacta.length >= 4 && handle.includes(regra.compacta));
        if (noNome) soma += 3;
        if (descricao && regra.re.test(descricao)) soma += 1;
      }
      if (soma > 0) pontos[cat.id] = soma;
    }
    return pontos;
  }

  function classificarCanal(canal, compiladas) {
    const pontos = pontuarCanal(canal, compiladas);
    const maior = Math.max(0, ...Object.values(pontos));
    if (maior === 0) return [];
    return Object.keys(pontos).filter((id) => pontos[id] >= maior / 2);
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
      filtroAtivo: d.filtroAtivo || 'todos',
      ultimaImportacao: d.ultimaImportacao || null
    };
  }

  function salvar(parcial) {
    return api.storage.local.set(parcial);
  }

  global.YTCat = {
    api,
    CATEGORIAS_PADRAO,
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
