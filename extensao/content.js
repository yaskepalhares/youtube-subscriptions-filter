/*
 * Roda em todo o youtube.com (o site é uma SPA e não recarrega ao trocar de
 * página), mas só age em dois lugares:
 *   /feed/subscriptions -> barra de pílulas e filtro dos vídeos
 *   /feed/channels      -> importação da lista de canais inscritos
 */
(() => {
  'use strict';
  if (window.__ytcatCarregado) return;
  window.__ytcatCarregado = true;

  const Y = globalThis.YTCat;
  const api = Y.api;

  const ID_BARRA = 'ytcat-barra';
  const ID_IMPORTADOR = 'ytcat-importador';
  const ATRIBUTO_OCULTO = 'data-ytcat-oculto';
  const FILTRO_TODOS = 'todos';
  const FILTRO_SEM = '__sem__';

  const SEL_CARDS = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer';
  const SEL_PRATELEIRAS = 'ytd-rich-section-renderer, ytd-reel-shelf-renderer, ytd-rich-shelf-renderer';
  const SEL_CANAL_LISTA = 'ytd-channel-renderer';

  const SELETORES_NOME_CARD = [
    'ytd-channel-name #text',
    '#channel-name #text',
    'ytd-channel-name a',
    'yt-content-metadata-view-model [class*="metadata-row"]'
  ];

  const log = (...args) => console.debug('[Filtro de Inscrições]', ...args);

  let estado = null;
  let indice = null;
  let importacaoPendente = false;
  let importando = false;
  let assinaturaBarra = '';
  let temporizador = null;
  let ultimoEmpurrao = 0;
  let avisoSemCards = 0;
  let ultimoResumoLog = '';

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  function textoDe(raiz, seletores) {
    for (const sel of seletores) {
      const el = raiz.querySelector(sel);
      const t = el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
      if (t) return t;
    }
    return '';
  }

  function visivelNoDom(el) {
    return !el.closest('[hidden]');
  }

  function criar(tag, attrs, filhos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'texto') el.textContent = v;
      else if (k.includes('-') || k === 'role') el.setAttribute(k, v);
      else el[k] = v;
    }
    for (const f of filhos || []) if (f) el.append(f);
    return el;
  }

  function abrirOpcoes() {
    try {
      api.runtime.sendMessage({ tipo: 'abrirOpcoes' });
    } catch (e) {
      log('Não consegui abrir as configurações', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------------

  async function recarregar() {
    estado = await Y.carregarEstado();
    indice = Y.construirIndice(estado.canais);
    const extra = (await api.storage.local.get('importacaoPendente')) || {};
    importacaoPendente = !!extra.importacaoPendente &&
      Date.now() - extra.importacaoPendente < 10 * 60 * 1000;
    assinaturaBarra = '';
    agendar(0);
  }

  api.storage.onChanged.addListener((mudancas, area) => {
    if (area && area !== 'local') return;
    recarregar();
  });

  // ---------------------------------------------------------------------------
  // Agendamento: o YouTube muda o DOM o tempo todo; processamos com atraso curto.
  // ---------------------------------------------------------------------------

  function agendar(atraso = 200) {
    clearTimeout(temporizador);
    temporizador = setTimeout(processar, atraso);
  }

  function processar() {
    if (!estado) return;
    const caminho = location.pathname;
    if (caminho === '/feed/subscriptions') processarFeed();
    if (caminho === '/feed/channels') processarListaDeCanais();
    else if (!importando) removerImportador();
  }

  const observador = new MutationObserver((mutacoes) => {
    for (const m of mutacoes) {
      const alvo = m.target;
      if (alvo && alvo.closest && alvo.closest('#' + ID_BARRA + ', #' + ID_IMPORTADOR)) continue;
      agendar();
      return;
    }
  });
  observador.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('yt-navigate-finish', () => agendar(0));
  document.addEventListener('yt-page-data-updated', () => agendar(0));

  // ---------------------------------------------------------------------------
  // Feed de inscrições
  // ---------------------------------------------------------------------------

  function raizInscricoes() {
    const todas = document.querySelectorAll('ytd-browse[page-subtype="subscriptions"]');
    for (const el of todas) if (!el.hasAttribute('hidden')) return el;
    return todas[0] || null;
  }

  function nomeDoCard(card) {
    return textoDe(card, SELETORES_NOME_CARD);
  }

  // Descobre de qual canal é o card: primeiro pelos links (/@handle ou
  // /channel/UC...), depois pelo nome do canal escrito no card.
  function identificarCard(card) {
    let temPista = false;
    for (const a of card.querySelectorAll('a[href]')) {
      const info = Y.extrairCanalDeHref(a.getAttribute('href'));
      if (!info) continue;
      temPista = true;
      const canal = Y.buscarCanal(indice, info);
      if (canal) return { canal, identificado: true };
    }
    const nome = nomeDoCard(card);
    if (nome) {
      temPista = true;
      const canal = Y.buscarCanal(indice, { nome });
      if (canal) return { canal, identificado: true };
    }
    return { canal: null, identificado: temPista };
  }

  function filtroValido() {
    const f = estado.filtroAtivo;
    if (f === FILTRO_TODOS) return f;
    if (f === FILTRO_SEM) return estado.config.mostrarSemCategoria ? f : FILTRO_TODOS;
    return estado.categorias.some((c) => c.id === f) ? f : FILTRO_TODOS;
  }

  function processarFeed() {
    const raiz = raizInscricoes();
    if (!raiz) return;

    const filtro = filtroValido();
    const contagem = { [FILTRO_TODOS]: 0, [FILTRO_SEM]: 0 };
    for (const c of estado.categorias) contagem[c.id] = 0;

    let visiveis = 0;
    let naoIdentificados = 0;
    const cards = [...raiz.querySelectorAll(SEL_CARDS)].filter(
      (card) => !card.parentElement || !card.parentElement.closest(SEL_PRATELEIRAS)
    );

    for (const card of cards) {
      // Anúncios e cards vazios não têm canal.
      const { canal, identificado } = identificarCard(card);
      const cats = canal ? canal.categorias || [] : [];
      if (!identificado) naoIdentificados++;

      contagem[FILTRO_TODOS]++;
      if (identificado && cats.length === 0) contagem[FILTRO_SEM]++;
      for (const id of cats) if (id in contagem) contagem[id]++;

      let mostrar;
      if (filtro === FILTRO_TODOS) mostrar = true;
      else if (filtro === FILTRO_SEM) mostrar = identificado && cats.length === 0;
      else mostrar = cats.includes(filtro);

      if (mostrar) visiveis++;
      if (card.hasAttribute(ATRIBUTO_OCULTO) === mostrar) {
        card.toggleAttribute(ATRIBUTO_OCULTO, !mostrar);
      }
    }

    const ocultarPrateleiras = filtro !== FILTRO_TODOS && estado.config.ocultarShorts;
    for (const prateleira of raiz.querySelectorAll(SEL_PRATELEIRAS)) {
      if (prateleira.hasAttribute(ATRIBUTO_OCULTO) !== ocultarPrateleiras) {
        prateleira.toggleAttribute(ATRIBUTO_OCULTO, ocultarPrateleiras);
      }
    }

    if (cards.length === 0) {
      if (Date.now() - avisoSemCards > 15000) {
        avisoSemCards = Date.now();
        log('Nenhum card de vídeo encontrado no feed (o YouTube pode ter mudado o layout).');
      }
    }

    garantirBarra(raiz, filtro, contagem, visiveis);
    empurrarCarregamento(raiz, filtro, visiveis);
    const resumo = `${naoIdentificados}/${cards.length}`;
    if (naoIdentificados > 0 && resumo !== ultimoResumoLog) {
      ultimoResumoLog = resumo;
      log(`${naoIdentificados} de ${cards.length} cards sem canal identificado (anúncios contam aqui).`);
    }
  }

  // Com um filtro ativo, a página fica curta e o YouTube pode demorar a pedir
  // mais vídeos. Se o indicador de "carregar mais" está à vista, cutucamos a rolagem.
  function empurrarCarregamento(raiz, filtro, visiveis) {
    if (filtro === FILTRO_TODOS || visiveis > 24) return;
    if (Date.now() - ultimoEmpurrao < 1500) return;
    const continuacao = raiz.querySelector('ytd-continuation-item-renderer');
    if (!continuacao || !continuacao.getBoundingClientRect) return;
    const r = continuacao.getBoundingClientRect();
    if (r.height === 0 && r.top === 0) return;
    if (r.top < window.innerHeight + 400) {
      ultimoEmpurrao = Date.now();
      window.dispatchEvent(new Event('scroll'));
    }
  }

  function pontoDeInsercao(raiz) {
    const grade = raiz.querySelector('ytd-rich-grid-renderer');
    if (grade && grade.parentElement) return { antes: grade };
    const lista = raiz.querySelector('ytd-section-list-renderer');
    if (lista && lista.parentElement) return { antes: lista };
    const primario = raiz.querySelector('#primary');
    if (primario) return { dentro: primario };
    return null;
  }

  function garantirBarra(raiz, filtro, contagem, visiveis) {
    let barra = raiz.querySelector('#' + ID_BARRA);
    if (!barra) {
      const lugar = pontoDeInsercao(raiz);
      if (!lugar) return;
      barra = criar('div', { id: ID_BARRA, className: 'ytcat-barra' });
      barra.addEventListener('click', aoClicarNaBarra);
      if (lugar.antes) lugar.antes.before(barra);
      else lugar.dentro.prepend(barra);
      assinaturaBarra = '';
    }

    const semCanais = Object.keys(estado.canais).length === 0;
    const assinatura = JSON.stringify([
      filtro, contagem, visiveis, semCanais,
      estado.categorias.map((c) => [c.id, c.nome]),
      estado.config.mostrarSemCategoria
    ]);
    if (assinatura === assinaturaBarra && barra.childElementCount) return;
    assinaturaBarra = assinatura;

    const pilula = (id, rotulo, n) => criar(
      'button',
      {
        type: 'button',
        className: 'ytcat-pilula' + (filtro === id ? ' ytcat-ativa' : ''),
        'data-filtro': id,
        title: `${rotulo}: ${n} vídeo(s) carregado(s)`
      },
      [criar('span', { texto: rotulo }), criar('span', { className: 'ytcat-n', texto: String(n) })]
    );

    const pilulas = criar('div', { className: 'ytcat-pilulas', role: 'toolbar' });
    pilulas.append(pilula(FILTRO_TODOS, 'Todos', contagem[FILTRO_TODOS]));
    for (const c of estado.categorias) pilulas.append(pilula(c.id, c.nome, contagem[c.id] || 0));
    if (estado.config.mostrarSemCategoria) {
      pilulas.append(pilula(FILTRO_SEM, 'Sem categoria', contagem[FILTRO_SEM]));
    }
    if (semCanais) {
      pilulas.append(criar('button', {
        type: 'button',
        className: 'ytcat-aviso',
        'data-acao': 'opcoes',
        texto: 'Importe seus canais para começar'
      }));
    }

    const lateral = criar('div', { className: 'ytcat-lateral' });
    if (filtro !== FILTRO_TODOS) {
      lateral.append(criar('span', {
        className: 'ytcat-status',
        texto: `${visiveis} de ${contagem[FILTRO_TODOS]} vídeos carregados`
      }));
    }
    lateral.append(criar('button', {
      type: 'button',
      className: 'ytcat-engrenagem',
      'data-acao': 'opcoes',
      title: 'Configurar temáticas',
      'aria-label': 'Configurar temáticas',
      texto: '⚙'
    }));

    barra.replaceChildren(pilulas, lateral);
  }

  function aoClicarNaBarra(evento) {
    const alvo = evento.target.closest('button');
    if (!alvo) return;
    if (alvo.dataset.acao === 'opcoes') {
      abrirOpcoes();
      return;
    }
    const filtro = alvo.dataset.filtro;
    if (!filtro || filtro === estado.filtroAtivo) return;
    estado.filtroAtivo = filtro;
    assinaturaBarra = '';
    processarFeed();
    window.scrollTo({ top: 0 });
    Y.salvar({ filtroAtivo: filtro });
  }

  // ---------------------------------------------------------------------------
  // Importação a partir de /feed/channels
  // ---------------------------------------------------------------------------

  function cardsDeCanais() {
    return [...document.querySelectorAll(SEL_CANAL_LISTA)].filter(visivelNoDom);
  }

  function coletarCanais() {
    const lista = [];
    for (const el of cardsDeCanais()) {
      let info = {};
      for (const a of el.querySelectorAll('a[href]')) {
        const x = Y.extrairCanalDeHref(a.getAttribute('href'));
        if (x && (x.handle || x.id)) { info = x; break; }
      }
      let handle = info.handle || '';
      if (!handle) {
        const meta = textoDe(el, ['#subscribers', '#video-count', '#metadata']);
        const m = meta.match(/@[^\s•·]+/);
        if (m) handle = m[0];
      }
      const nome = textoDe(el, [
        '#channel-title #text', 'ytd-channel-name #text', '#text.ytd-channel-name', '#channel-title', '#title'
      ]);
      const descricao = textoDe(el, ['#description']);
      const img = el.querySelector('img');
      const avatar = img && /^https?:/.test(img.src || '') ? img.src : '';
      if (handle || info.id || nome) {
        lista.push({ handle, id: info.id || '', nome, descricao, avatar });
      }
    }
    return lista;
  }

  function garantirImportador() {
    let painel = document.getElementById(ID_IMPORTADOR);
    if (painel) return painel;
    painel = criar('div', { id: ID_IMPORTADOR, className: 'ytcat-importador' }, [
      criar('div', { className: 'ytcat-imp-titulo', texto: 'Filtro de Inscrições' }),
      criar('div', {
        className: 'ytcat-imp-status',
        texto: 'Importe esta lista de canais para classificá-los por temática.'
      }),
      criar('div', { className: 'ytcat-imp-acoes' }, [
        criar('button', { type: 'button', className: 'ytcat-botao', 'data-acao': 'importar', texto: 'Importar canais' })
      ])
    ]);
    painel.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.acao === 'importar') iniciarImportacao();
      if (b.dataset.acao === 'opcoes') abrirOpcoes();
      if (b.dataset.acao === 'fechar') painel.remove();
    });
    document.body.append(painel);
    return painel;
  }

  function removerImportador() {
    const p = document.getElementById(ID_IMPORTADOR);
    if (p) p.remove();
  }

  function statusImportador(texto, botoes) {
    const painel = garantirImportador();
    painel.querySelector('.ytcat-imp-status').textContent = texto;
    if (botoes) {
      painel.querySelector('.ytcat-imp-acoes').replaceChildren(
        ...botoes.map(([acao, rotulo]) =>
          criar('button', { type: 'button', className: 'ytcat-botao', 'data-acao': acao, texto: rotulo })
        )
      );
    }
  }

  let esperaDesde = 0;

  function processarListaDeCanais() {
    if (importando) return;
    garantirImportador();
    if (!importacaoPendente) return;
    if (cardsDeCanais().length > 0) {
      iniciarImportacao();
      return;
    }
    if (!esperaDesde) esperaDesde = Date.now();
    if (Date.now() - esperaDesde > 20000) {
      importacaoPendente = false;
      api.storage.local.remove('importacaoPendente');
      statusImportador(
        'Não encontrei a lista de canais nesta página. Confira se você está logado e me avise se o problema continuar.',
        [['importar', 'Tentar de novo'], ['fechar', 'Fechar']]
      );
    } else {
      statusImportador('Esperando a lista de canais carregar…', []);
      agendar(1000);
    }
  }

  async function iniciarImportacao() {
    if (importando) return;
    importando = true;
    importacaoPendente = false;
    esperaDesde = 0;
    try {
      await api.storage.local.remove('importacaoPendente');

      let anterior = -1;
      let estavel = 0;
      for (let i = 0; i < 400; i++) {
        const n = cardsDeCanais().length;
        statusImportador(`Rolando a página para carregar todos os canais… ${n} encontrados.`, []);
        const continuacao = [...document.querySelectorAll('ytd-continuation-item-renderer')].some(visivelNoDom);
        estavel = n === anterior ? estavel + 1 : 0;
        if ((!continuacao && estavel >= 2) || estavel >= 8) break;
        anterior = n;
        window.scrollTo(0, document.documentElement.scrollHeight);
        await esperar(900);
      }

      const lista = coletarCanais();
      if (lista.length === 0) {
        statusImportador(
          'Não encontrei canais nesta página. O YouTube pode ter mudado o layout; me avise.',
          [['importar', 'Tentar de novo'], ['fechar', 'Fechar']]
        );
        return;
      }

      const atual = await Y.carregarEstado();
      const r = Y.mesclarImportacao(atual.canais, lista, atual.categorias);
      await Y.salvar({
        canais: atual.canais,
        ultimaImportacao: { quando: Date.now(), lidos: lista.length, novos: r.novos, origem: 'youtube' }
      });
      window.scrollTo(0, 0);
      const semCat = Object.values(atual.canais).filter((c) => !(c.categorias || []).length).length;
      statusImportador(
        `Pronto: ${lista.length} canais lidos (${r.novos} novos). ${semCat} ficaram sem categoria; revise nas configurações.`,
        [['opcoes', 'Abrir configurações'], ['fechar', 'Fechar']]
      );
      log('Importação concluída', r);
    } catch (e) {
      log('Erro na importação', e);
      statusImportador('Algo deu errado na importação: ' + (e && e.message ? e.message : e), [
        ['importar', 'Tentar de novo'], ['fechar', 'Fechar']
      ]);
    } finally {
      importando = false;
    }
  }

  // Para os testes automatizados.
  window.__ytcatInterno = { processar, recarregar, identificarCard, coletarCanais, iniciarImportacao };

  recarregar();
})();
