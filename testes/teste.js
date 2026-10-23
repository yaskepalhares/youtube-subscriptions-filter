'use strict';
// Testes da extensão em páginas simuladas com jsdom. Rode com: npm test
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const EXT = path.join(__dirname, '..', 'extensao');
const ler = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
let falhas = 0;
function confere(cond, msg) {
  console.log((cond ? '  ok   ' : '  FALHA ') + msg);
  if (!cond) falhas++;
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeBrowser(inicial = {}) {
  const dados = JSON.parse(JSON.stringify(inicial));
  const ouvintes = [];
  const mensagens = [];
  const abas = [];
  const disparar = (mud) => setTimeout(() => ouvintes.forEach((f) => f(mud, 'local')), 0);
  return {
    _dados: dados, _mensagens: mensagens, _abas: abas,
    storage: {
      local: {
        async get(chaves) {
          const ks = Array.isArray(chaves) ? chaves : [chaves];
          const r = {};
          for (const k of ks) if (k in dados) r[k] = JSON.parse(JSON.stringify(dados[k]));
          return r;
        },
        async set(obj) {
          const mud = {};
          for (const [k, v] of Object.entries(obj)) { mud[k] = { newValue: v }; dados[k] = JSON.parse(JSON.stringify(v)); }
          disparar(mud);
        },
        async remove(k) { delete dados[k]; disparar({ [k]: {} }); }
      },
      onChanged: { addListener: (f) => ouvintes.push(f) }
    },
    runtime: { sendMessage: (m) => mensagens.push(m) },
    tabs: { create: async (o) => abas.push(o) }
  };
}

// Simula as respostas do YouTube usadas para ler a categoria dos canais.
// canais: { '@handle': { id, cats: [...], tags: [...] } }
function youtubeFalso(canais) {
  const pedidos = [];
  const porId = {};
  for (const [h, c] of Object.entries(canais)) porId[c.id] = { ...c, h };
  const resposta = (corpo, status = 200) => ({
    ok: status >= 200 && status < 300, status,
    json: async () => corpo, text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo))
  });
  const fetch = async (url, opcoes = {}) => {
    pedidos.push(url);
    const u = new URL(url, 'https://www.youtube.com');
    const corpo = opcoes.body ? JSON.parse(opcoes.body) : {};
    if (u.pathname === '/youtubei/v1/navigation/resolve_url') {
      const caminho = decodeURI(new URL(corpo.url).pathname).slice(1);
      if (caminho === 'canaltech-legado') return resposta({ endpoint: { browseEndpoint: { browseId: canais['@canaltech'].id } } });
      if (caminho === '@canaltech') return resposta({ endpoint: { urlEndpoint: { url: 'https://www.youtube.com/canaltech-legado' } } });
      const c = canais[caminho];
      return resposta(c ? { endpoint: { browseEndpoint: { browseId: c.id } } } : {});
    }
    if (u.pathname === '/feeds/videos.xml') {
      const c = porId[u.searchParams.get('channel_id')];
      if (!c) return resposta('', 404);
      const ids = c.cats.map((_, i) => (c.id.slice(2, 12) + i).padEnd(11, 'x'));
      return resposta('<feed>' + ids.map((v) => `<entry><yt:videoId>${v}</yt:videoId></entry>`).join('') + '</feed>');
    }
    if (u.pathname === '/youtubei/v1/player') {
      const v = corpo.videoId;
      const c = Object.values(porId).find((x) => v.startsWith(x.id.slice(2, 12)));
      const i = Number(v[10]);
      return resposta({ microformat: { playerMicroformatRenderer: { category: c.cats[i] } }, videoDetails: { keywords: c.tags || [] } });
    }
    return resposta('', 404);
  };
  return { fetch, pedidos };
}

function carregarNaJanela(dom, browser, arquivos, fetchFalso) {
  const w = dom.window;
  if (fetchFalso) w.fetch = fetchFalso;
  w.browser = browser;
  w.scrollTo = () => {};
  w.CSS = w.CSS || { escape: (s) => s };
  for (const f of arquivos) w.eval(ler(f));
}

// ---------------------------------------------------------------------------
async function testeClassificador() {
  console.log('\nClassificador');
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://www.youtube.com/', runScripts: 'outside-only' });
  carregarNaJanela(dom, fakeBrowser(), ['catalogo.js', 'shared.js']);
  const Y = dom.window.YTCat;
  const comp = Y.compilarCategorias(Y.CATEGORIAS_PADRAO);
  const casos = [
    [{ nome: 'Canaltech', handle: '@canaltech', descricao: 'Notícias de tecnologia, reviews de celulares' }, ['tecnologia']],
    [{ nome: 'Coisa de Nerd', handle: '@coisadenerd', descricao: 'Games, tecnologia e reviews de gadgets' }, ['tecnologia']],
    [{ nome: 'Framed', handle: '@framedrs', descricao: 'Old School RuneScape content: ironman, PvM and more' }, ['runescape']],
    [{ nome: 'Me Poupe!', handle: '@mepoupe', descricao: 'Educação financeira para você investir melhor' }, ['investimentos']],
    [{ nome: 'Meteoro Brasil', handle: '@meteorobrasil', descricao: 'Análise política e cultural' }, ['politica']],
    [{ nome: 'Receitas da Vó', handle: '@receitasdavo', descricao: 'Bolo, pão e muito amor' }, []],
    [{ nome: 'OSRS Wiki', handle: '@osrswiki', descricao: '' }, ['runescape']]
  ];
  for (const [canal, esperado] of casos) {
    const r = Y.classificarCanal(canal, comp);
    confere(JSON.stringify(r.sort()) === JSON.stringify(esperado.sort()), `${canal.nome} -> [${r}] (esperado [${esperado}])`);
  }
  confere(JSON.stringify(Y.extrairCanalDeHref('/@Fulano%C3%A7/videos')) === JSON.stringify({ handle: '@fulanoç' }), 'handle com acento decodificado');
  confere(Y.extrairCanalDeHref('/channel/UCabcdefghijklmnopqrstuv').id === 'UCabcdefghijklmnopqrstuv', 'link /channel/UC…');
  confere(Y.extrairCanalDeHref('/watch?v=123') === null, 'link de vídeo ignorado');

  const csv = 'Channel Id,Channel Url,Channel Title\nUCaaaaaaaaaaaaaaaaaaaaaa,http://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa,"Canal, com vírgula"\nUCbbbbbbbbbbbbbbbbbbbbbb,http://www.youtube.com/channel/UCbbbbbbbbbbbbbbbbbbbbbb,OSRS Daily\n';
  const lidos = Y.lerCsvTakeout(csv);
  confere(lidos.length === 2 && lidos[0].nome === 'Canal, com vírgula', 'CSV do Takeout com aspas');

  // Mesclagem preserva ajustes manuais e une por ID/handle.
  const canais = {};
  Y.mesclarImportacao(canais, lidos, Y.CATEGORIAS_PADRAO);
  const chave = Object.keys(canais).find((k) => canais[k].nome === 'OSRS Daily');
  confere(canais[chave].categorias.includes('runescape'), 'canal do CSV classificado pelo nome');
  canais[chave].categorias = ['politica']; canais[chave].manual = true;
  const r = Y.mesclarImportacao(canais, [{ id: 'UCbbbbbbbbbbbbbbbbbbbbbb', handle: '@osrsdaily', nome: 'OSRS Daily', descricao: 'runescape' }], Y.CATEGORIAS_PADRAO);
  confere(r.novos === 0 && Object.keys(canais).length === 2, 'reimportação não duplica (une por ID)');
  confere(canais['h:@osrsdaily'] && canais['h:@osrsdaily'].categorias[0] === 'politica', 'ajuste manual preservado e chave atualizada para o handle');
}

// ---------------------------------------------------------------------------
async function testeSugestoes() {
  console.log('\nCategoria do YouTube e sugestões');
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://www.youtube.com/', runScripts: 'outside-only' });
  carregarNaJanela(dom, fakeBrowser(), ['catalogo.js', 'shared.js']);
  const Y = dom.window.YTCat;
  const canal = (nome, cats, extra = {}) => ({ nome, handle: '@' + Y.slug(nome), descricao: '', categorias: [], yt: { categorias: cats, tags: [], quando: 1 }, ...extra });
  const canais = {
    a: canal('Coldplay', ['Music', 'Music', 'Music']),
    b: canal('Anitta', ['Music', 'Music']),
    c: canal('Tim Maia Oficial', ['Music']),
    d: canal('Gaules', ['Gaming', 'Gaming']),
    e: canal('Alanzoka', ['Gaming']),
    f: canal('Casimiro', ['Entertainment', 'Entertainment']),
    g: canal('Canal Aleatório', ['People & Blogs']),
    h: canal('Ana Podcast', [], { descricao: 'podcast semanal sobre maternidade' }),
    i: canal('Bia e Lu', [], { descricao: 'maternidade real' }),
    j: canal('Mães Reais', [], { descricao: 'maternidade e família' })
  };
  const comp = Y.compilarCategorias(Y.CATEGORIAS_PADRAO);
  confere(Y.classificarCanal(canais.a, comp).length === 0, 'sem temática de música, Coldplay fica sem categoria');
  const sug = Y.sugerirTematicas(canais, Y.CATEGORIAS_PADRAO, []);
  const porId = Object.fromEntries(sug.map((s) => [s.id, s]));
  confere(porId.musica && porId.musica.total === 3, `sugere Música com 3 canais (${porId.musica && porId.musica.exemplos.join(', ')})`);
  confere(porId.games && porId.games.total === 2, 'sugere Games com 2 canais');
  confere(sug[0].id === 'musica', 'sugestões em ordem de tamanho');
  confere(!porId.entretenimento, 'categoria ampla com 1 canal não vira sugestão');
  confere(!Y.sugerirTematicas(canais, Y.CATEGORIAS_PADRAO, ['musica']).some((s) => s.id === 'musica'), 'sugestão ignorada não volta');
  const comMusica = [...Y.CATEGORIAS_PADRAO, Y.temaDoCatalogo('musica')];
  confere(Y.classificarCanal(canais.a, Y.compilarCategorias(comMusica)).join() === 'musica', 'com Música criada, Coldplay entra nela');
  const comEnt = [...Y.CATEGORIAS_PADRAO, Y.temaDoCatalogo('entretenimento'), Y.temaDoCatalogo('musica')];
  confere(Y.classificarCanal(canais.f, Y.compilarCategorias(comEnt)).join() === 'entretenimento', 'categoria ampla vale quando nada mais encaixa');
  confere(Y.categoriaYoutubeCanonica('Ciência e tecnologia') === 'Science & Technology', 'nome da categoria em português é reconhecido');
  const palavras = Y.palavrasFrequentes(canais, Y.CATEGORIAS_PADRAO);
  confere(palavras[0] && palavras[0].palavra === 'maternidade' && palavras[0].total === 3, 'palavra frequente entre canais sem categoria: ' + JSON.stringify(palavras.slice(0, 3)));
  confere(!palavras.some((p) => p.palavra === 'sobre'), 'palavras vazias ficam de fora');
  dom.window.close();
}

// ---------------------------------------------------------------------------
function cardLegado(handle, nome, titulo) {
  return `<ytd-rich-item-renderer><div id="content"><ytd-rich-grid-media>
    <a id="thumbnail" href="/watch?v=${titulo}"></a>
    <a id="avatar-link" href="/${handle}"></a>
    <ytd-channel-name><div id="text-container"><yt-formatted-string id="text"><a href="/${handle}">${nome}</a></yt-formatted-string></div></ytd-channel-name>
  </ytd-rich-grid-media></div></ytd-rich-item-renderer>`;
}
function cardLockup(href, nome, titulo, comLink = true) {
  return `<ytd-rich-item-renderer><div id="content"><yt-lockup-view-model>
    <a href="/watch?v=${titulo}"></a>
    <yt-lockup-metadata-view-model><h3><a href="/watch?v=${titulo}">${titulo}</a></h3>
    <yt-content-metadata-view-model><div class="yt-content-metadata-view-model__metadata-row">
      ${comLink ? `<a href="${href}">${nome}</a>` : `<span>${nome}</span>`}
    </div><div class="yt-content-metadata-view-model__metadata-row"><span>10 mil visualizações</span></div></yt-content-metadata-view-model>
    </yt-lockup-metadata-view-model></yt-lockup-view-model></div></ytd-rich-item-renderer>`;
}

async function testeFeed() {
  console.log('\nFeed de inscrições');
  const html = `<!doctype html><body><ytd-app>
    <ytd-browse page-subtype="home" hidden></ytd-browse>
    <ytd-browse page-subtype="subscriptions"><ytd-two-column-browse-results-renderer><div id="primary">
      <ytd-rich-grid-renderer><div id="header"><h2>Mais recentes</h2></div><div id="contents">
        ${cardLegado('@canaltech', 'Canaltech', 'v1')}
        ${cardLockup('/@framedrs', 'Framed', 'v2')}
        ${cardLockup('/channel/UCcccccccccccccccccccccc', 'Me Poupe!', 'v3')}
        ${cardLockup('', 'Meteoro Brasil', 'v4', false)}
        ${cardLockup('/@desconhecido', 'Canal Novo', 'v5')}
        <ytd-rich-item-renderer><ytd-ad-slot-renderer></ytd-ad-slot-renderer></ytd-rich-item-renderer>
        <ytd-rich-section-renderer><ytd-rich-shelf-renderer is-shorts>
          <ytd-rich-item-renderer><a href="/shorts/abc"></a></ytd-rich-item-renderer>
        </ytd-rich-shelf-renderer></ytd-rich-section-renderer>
        ${cardLegado('@canaltech', 'Canaltech', 'v6')}
        <ytd-continuation-item-renderer></ytd-continuation-item-renderer>
      </div></ytd-rich-grid-renderer>
    </div></ytd-two-column-browse-results-renderer></ytd-browse>
  </ytd-app></body>`;
  const dom = new JSDOM(html, { url: 'https://www.youtube.com/feed/subscriptions', runScripts: 'outside-only' });
  const browser = fakeBrowser({
    canais: {
      'h:@canaltech': { handle: '@canaltech', nome: 'Canaltech', categorias: ['tecnologia'] },
      'h:@framedrs': { handle: '@framedrs', nome: 'Framed', categorias: ['runescape'] },
      'c:UCcccccccccccccccccccccc': { id: 'UCcccccccccccccccccccccc', nome: 'Me Poupe!', categorias: ['investimentos'] },
      'h:@meteorobrasil': { handle: '@meteorobrasil', nome: 'Meteoro Brasil', categorias: ['politica', 'tecnologia'] }
    }
  });
  carregarNaJanela(dom, browser, ['catalogo.js', 'shared.js', 'content.js']);
  await esperar(400);
  const d = dom.window.document;
  const barra = d.getElementById('ytcat-barra');
  confere(!!barra, 'barra inserida');
  confere(barra && barra.parentElement.tagName === 'YTD-RICH-GRID-RENDERER' &&
    barra.previousElementSibling.id === 'header' && barra.nextElementSibling.id === 'contents',
    'barra fica entre o cabeçalho "Mais recentes" e os vídeos');
  confere(!!barra.querySelector('.ytcat-engrenagem svg'), 'botão de ajustes usa ícone SVG');
  const contagem = (id) => {
    const b = barra.querySelector(`[data-filtro="${id}"] .ytcat-n`);
    return b ? Number(b.textContent) : NaN;
  };
  confere(contagem('todos') === 7, `contagem "Todos" = ${contagem('todos')} (6 vídeos + 1 anúncio)`);
  confere(contagem('tecnologia') === 3, `contagem Tecnologia = ${contagem('tecnologia')} (2 Canaltech + Meteoro)`);
  confere(contagem('politica') === 1, 'Meteoro identificado só pelo nome');
  confere(contagem('__sem__') === 1, `Sem categoria = ${contagem('__sem__')} (canal novo)`);

  const ocultos = () => [...d.querySelectorAll('[data-ytcat-oculto]')];
  confere(ocultos().length === 0, 'nada oculto em "Todos"');

  barra.querySelector('[data-filtro="runescape"]').click();
  await esperar(50);
  const visiveis = [...d.querySelectorAll('#contents > ytd-rich-item-renderer:not([data-ytcat-oculto])')];
  confere(visiveis.length === 1 && visiveis[0].textContent.includes('Framed'), 'filtro RuneScape mostra só o Framed');
  confere(d.querySelector('ytd-rich-section-renderer').hasAttribute('data-ytcat-oculto'), 'prateleira de Shorts oculta com filtro');
  await esperar(300);
  confere(browser._dados.filtroAtivo === 'runescape', 'filtro escolhido é salvo');

  // Novos vídeos chegando pela rolagem infinita também são filtrados.
  const novo = d.createElement('div');
  novo.innerHTML = cardLegado('@canaltech', 'Canaltech', 'v7');
  d.querySelector('#contents').append(novo.firstElementChild);
  await esperar(400);
  confere(d.querySelector('#contents > ytd-rich-item-renderer:last-of-type').hasAttribute('data-ytcat-oculto'), 'vídeo carregado depois também é filtrado');

  d.getElementById('ytcat-barra').querySelector('[data-filtro="runescape"]').click();
  await esperar(50);
  confere(ocultos().length === 0, 'clicar de novo na temática ativa volta para "Todos"');
  confere(d.getElementById('ytcat-barra').querySelector('[data-filtro="todos"]').classList.contains('ytcat-ativa'), 'pílula "Todos" fica ativa');
  await esperar(300);
  confere(browser._dados.filtroAtivo === 'todos', 'volta para "Todos" é salva');
  d.getElementById('ytcat-barra').querySelector('[data-filtro="todos"]').click();
  await esperar(50);
  confere(ocultos().length === 0, 'clicar em "Todos" com "Todos" ativo não muda nada');

  d.getElementById('ytcat-barra').querySelector('[data-acao="opcoes"]').click();
  confere(browser._mensagens.some((m) => m.tipo === 'abrirOpcoes'), 'engrenagem pede para abrir as configurações');

  // YouTube recria a grade: a barra precisa voltar.
  d.getElementById('ytcat-barra').remove();
  d.querySelector('#primary').append(d.createElement('span'));
  await esperar(400);
  confere(!!d.getElementById('ytcat-barra'), 'barra é recolocada se o YouTube a remover');
  dom.window.close();
}

// ---------------------------------------------------------------------------
async function testeImportacao() {
  console.log('\nImportação em /feed/channels');
  const canal = (href, nome, sub, desc) => `<ytd-channel-renderer>
    <div id="avatar-section"><a href="${href}"><img src="https://yt3.ggpht.com/${nome}.jpg"></a></div>
    <div id="info-section"><a id="main-link" href="${href}">
      <div id="channel-title"><ytd-channel-name><yt-formatted-string id="text">${nome}</yt-formatted-string></ytd-channel-name></div>
      <div id="metadata"><span id="subscribers">${sub}</span><span id="video-count">1,2 mi de inscritos</span></div>
      <yt-formatted-string id="description">${desc}</yt-formatted-string>
    </a></div></ytd-channel-renderer>`;
  const html = `<!doctype html><body><ytd-browse page-subtype="channels"><div id="contents">
    ${canal('/@canaltech', 'Canaltech', '@canaltech', 'Notícias de tecnologia')}
    ${canal('/@framedrs', 'Framed', '@framedrs', 'Old School RuneScape videos')}
    ${canal('/@primorico', 'Primo Rico', '@primorico', 'Investimentos e finanças')}
    ${canal('/@meteorobrasil', 'Meteoro Brasil', '@meteorobrasil', 'Política, cultura e sociedade')}
    ${canal('/@receitas', 'Receitas da Vó', '@receitas', 'Bolos e pães')}
    ${canal('/@coldplay', 'Coldplay', '@coldplay', '')}
    ${canal('/@anitta', 'Anitta', '@anitta', 'Site oficial')}
  </div></ytd-browse></body>`;
  const dom = new JSDOM(html, { url: 'https://www.youtube.com/feed/channels', runScripts: 'outside-only' });
  const browser = fakeBrowser({ importacaoPendente: Date.now() });
  const yt = youtubeFalso({
    '@canaltech': { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', cats: ['Science & Technology', 'Science & Technology', 'News & Politics'], tags: ['tecnologia'] },
    '@framedrs': { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', cats: ['Gaming', 'Gaming', 'Gaming'], tags: ['osrs'] },
    '@primorico': { id: 'UCcccccccccccccccccccccc', cats: ['Education', 'Education', 'Education'], tags: [] },
    '@meteorobrasil': { id: 'UCdddddddddddddddddddddd', cats: ['News & Politics', 'News & Politics', 'Entertainment'], tags: [] },
    '@receitas': { id: 'UCeeeeeeeeeeeeeeeeeeeeee', cats: ['Howto & Style'], tags: ['receita', 'bolo'] },
    '@coldplay': { id: 'UCffffffffffffffffffffff', cats: ['Music', 'Music', 'Music'], tags: [] },
    '@anitta': { id: 'UCgggggggggggggggggggggg', cats: ['Music', 'Music'], tags: ['funk'] }
  });
  carregarNaJanela(dom, browser, ['catalogo.js', 'shared.js', 'content.js'], yt.fetch);
  await esperar(4500);
  const canais = browser._dados.canais || {};
  const nomes = Object.values(canais).map((c) => c.nome).sort();
  confere(nomes.length === 7, `7 canais importados (${nomes.join(', ')})`);
  confere(canais['h:@framedrs'] && canais['h:@framedrs'].categorias.includes('runescape'), 'Framed classificado como RuneScape');
  confere(canais['h:@primorico'] && canais['h:@primorico'].categorias.includes('investimentos'), 'Primo Rico classificado como Investimentos');
  confere(canais['h:@receitas'] && canais['h:@receitas'].categorias.length === 0, 'canal fora das temáticas fica sem categoria');
  confere(canais['h:@canaltech'] && canais['h:@canaltech'].avatar.includes('yt3.ggpht.com'), 'avatar guardado');
  confere(!('importacaoPendente' in browser._dados), 'pedido de importação limpo');
  const status = dom.window.document.querySelector('.ytcat-imp-status');
  confere(status && /Pronto: 7 canais/.test(status.textContent), 'painel mostra o resultado: ' + (status && status.textContent));
  confere(canais['h:@coldplay'].yt && canais['h:@coldplay'].yt.categorias.join() === 'Music,Music,Music', 'categoria do YouTube lida dos 3 vídeos recentes');
  confere(canais['h:@canaltech'].yt.id === 'UCaaaaaaaaaaaaaaaaaaaaaa', 'redirecionamento do @ para o endereço antigo é seguido');
  confere(canais['h:@meteorobrasil'].categorias.includes('politica'), 'Meteoro entra em Política pela categoria do YouTube');
  confere(canais['h:@anitta'].yt.tags.includes('funk'), 'tags dos vídeos guardadas');
  confere(/Categoria do YouTube lida para 7 de 7/.test(status.textContent), 'painel informa quantos canais tiveram a categoria lida');
  confere(/temática\(s\) nova\(s\)/.test(status.textContent), 'painel avisa que há sugestões');
  const pedidos = yt.pedidos.length;
  confere(pedidos > 0 && yt.pedidos.every((u) => u.startsWith('https://www.youtube.com/')), `${pedidos} pedidos, todos para www.youtube.com`);
  dom.window.close();
}

// ---------------------------------------------------------------------------
async function testeOpcoes() {
  console.log('\nPágina de configurações');
  const html = ler('options.html').replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'safari-web-extension://x/options.html', runScripts: 'outside-only' });
  const browser = fakeBrowser({
    canais: {
      'h:@canaltech': { handle: '@canaltech', nome: 'Canaltech', descricao: 'tecnologia', categorias: ['tecnologia'], manual: false },
      'h:@receitas': { handle: '@receitas', nome: 'Receitas da Vó', descricao: '', categorias: [], manual: false }
    },
    ultimaImportacao: { quando: Date.now(), lidos: 2, novos: 2, origem: 'youtube' }
  });
  dom.window.confirm = () => true;
  dom.window.prompt = () => 'Culinária';
  carregarNaJanela(dom, browser, ['catalogo.js', 'shared.js', 'options.js']);
  await esperar(200);
  const d = dom.window.document;
  confere(d.querySelectorAll('.categoria').length === 4, '4 temáticas padrão desenhadas');
  confere(Array.isArray(browser._dados.categorias), 'temáticas padrão gravadas na primeira abertura');
  confere(d.querySelectorAll('.canal').length === 2, '2 canais na revisão');
  confere(/2 canais salvos · 1 sem categoria/.test(d.getElementById('status-canais').textContent), 'status: ' + d.getElementById('status-canais').textContent);
  confere(d.getElementById('boas-vindas').hidden, 'boas-vindas escondidas quando já há canais');

  // Ajuste manual.
  d.querySelector('.canal[data-chave="h:@receitas"] [data-cat="investimentos"]').click();
  await esperar(100);
  confere(browser._dados.canais['h:@receitas'].manual === true &&
    browser._dados.canais['h:@receitas'].categorias.join() === 'investimentos', 'clique na temática ajusta o canal e marca como manual');
  confere(!!d.querySelector('.canal[data-chave="h:@receitas"] .marca-manual'), 'marca "manual" aparece');

  // Nova temática + palavras + reclassificação sem mexer nos manuais.
  d.getElementById('btn-nova-categoria').click();
  await esperar(100);
  const ta = d.querySelector('.categoria[data-id="culinaria"] textarea');
  confere(!!ta, 'nova temática criada');
  ta.value = 'receita*, culinaria, bolo*';
  ta.dispatchEvent(new dom.window.Event('input'));
  d.getElementById('btn-classificar').click();
  await esperar(600);
  confere(browser._dados.categorias.some((c) => c.id === 'culinaria' && c.palavras.includes('receita*')), 'palavras-chave salvas');
  confere(browser._dados.canais['h:@receitas'].categorias.join() === 'investimentos', 'classificação automática respeita o ajuste manual');

  // Voltar para o automático.
  d.querySelector('.canal[data-chave="h:@receitas"] [data-acao="auto"]').click();
  await esperar(100);
  confere(browser._dados.canais['h:@receitas'].categorias.join() === 'culinaria' && !browser._dados.canais['h:@receitas'].manual, '↺ devolve ao automático (agora Culinária)');

  // Filtro da revisão.
  const sel = d.getElementById('filtro-lista');
  sel.value = 'tecnologia';
  sel.dispatchEvent(new dom.window.Event('change'));
  confere(d.querySelectorAll('.canal').length === 1, 'filtro da revisão por temática');

  // Importar do YouTube marca o pedido e abre a aba.
  d.getElementById('btn-importar-yt').click();
  await esperar(50);
  confere(browser._abas[0] && browser._abas[0].url === 'https://www.youtube.com/feed/channels' && browser._dados.importacaoPendente, 'botão de importar abre /feed/channels');
  dom.window.close();
}

// ---------------------------------------------------------------------------
async function testePermissao() {
  console.log('\nPedido de acesso ao YouTube');
  const html = ler('options.html').replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'safari-web-extension://x/options.html', runScripts: 'outside-only' });
  const browser = fakeBrowser();
  let concedido = false;
  const pedidos = [];
  browser.permissions = {
    contains: async () => concedido,
    request: (p) => { pedidos.push(p); concedido = true; return Promise.resolve(true); },
    onAdded: { addListener: () => {} },
    onRemoved: { addListener: () => {} }
  };
  carregarNaJanela(dom, browser, ['catalogo.js', 'shared.js', 'options.js']);
  await esperar(200);
  const d = dom.window.document;
  confere(!d.getElementById('permissao').hidden, 'aviso de acesso aparece quando falta permissão');

  d.getElementById('btn-importar-yt').click();
  confere(pedidos.length === 1, 'importar pede o acesso no próprio clique (antes de qualquer espera)');
  confere(JSON.stringify(pedidos[0]) === JSON.stringify({ origins: ['*://www.youtube.com/*'] }), 'pedido é só para www.youtube.com');
  await esperar(100);
  confere(d.getElementById('permissao').hidden, 'aviso some depois que o acesso é concedido');
  confere(browser._abas.length === 1, 'importação segue depois do pedido');

  // Recusado: mostra o caminho manual.
  concedido = false;
  browser.permissions.request = () => Promise.resolve(false);
  dom.window.dispatchEvent(new dom.window.Event('focus'));
  await esperar(50);
  confere(!d.getElementById('permissao').hidden, 'aviso volta se o acesso for retirado');
  d.getElementById('btn-permissao').click();
  await esperar(50);
  confere(!d.getElementById('ajuda-permissao').hidden, 'recusa mostra como liberar pelos Ajustes do Safari');

  // Sem a API de permissões, o aviso não aparece (não dá para saber o estado).
  const dom2 = new JSDOM(html, { url: 'safari-web-extension://x/options.html', runScripts: 'outside-only' });
  carregarNaJanela(dom2, fakeBrowser(), ['catalogo.js', 'shared.js', 'options.js']);
  await esperar(150);
  confere(dom2.window.document.getElementById('permissao').hidden, 'sem API de permissões o aviso fica escondido');
  dom.window.close();
  dom2.window.close();
}

// ---------------------------------------------------------------------------
async function testeSugestoesNaPagina() {
  console.log('\nSugestões na página de configurações');
  const html = ler('options.html').replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'safari-web-extension://x/options.html', runScripts: 'outside-only' });
  const yt = (cats) => ({ categorias: cats, tags: [], quando: 1 });
  const browser = fakeBrowser({
    canais: {
      'h:@coldplay': { handle: '@coldplay', nome: 'Coldplay', descricao: '', categorias: [], manual: false, yt: yt(['Music', 'Music']) },
      'h:@anitta': { handle: '@anitta', nome: 'Anitta', descricao: '', categorias: [], manual: false, yt: yt(['Music']) },
      'h:@timmaia': { handle: '@timmaia', nome: 'Tim Maia', descricao: '', categorias: [], manual: false, yt: yt(['Music']) },
      'h:@gaules': { handle: '@gaules', nome: 'Gaules', descricao: '', categorias: [], manual: false, yt: yt(['Gaming']) },
      'h:@alan': { handle: '@alan', nome: 'Alanzoka', descricao: '', categorias: [], manual: false, yt: yt(['Gaming']) }
    }
  });
  dom.window.confirm = () => true;
  carregarNaJanela(dom, browser, ['catalogo.js', 'shared.js', 'options.js']);
  await esperar(200);
  const d = dom.window.document;
  confere(!d.getElementById('sugestoes').hidden, 'bloco de sugestões aparece');
  const caixa = (id) => d.querySelector(`#lista-sugestoes input[data-id="${id}"]`);
  confere(caixa('musica') && caixa('musica').checked, 'Música vem marcada (3 canais)');
  confere(caixa('games') && !caixa('games').checked, 'Games vem desmarcada (2 canais)');
  confere(/2 de 5|5 de 5|Todos os canais/.test(d.getElementById('status-canais').textContent), 'status mostra os dados do YouTube');
  d.getElementById('btn-classificar').click();
  await esperar(150);
  const dados = browser._dados;
  confere(dados.categorias.some((c) => c.id === 'musica') && !dados.categorias.some((c) => c.id === 'games'), 'classificar cria só as sugestões marcadas');
  confere(dados.canais['h:@coldplay'].categorias.join() === 'musica', 'canais de música entram na temática nova');
  confere(/Criei Música/.test(d.getElementById('msg-classificacao').textContent), 'mensagem cita a temática criada');
  confere(!caixa('musica') && !!caixa('games'), 'Música sai das sugestões; Games continua');
  d.querySelector('#lista-sugestoes .ignorar').click();
  await esperar(100);
  confere((dados.config.sugestoesIgnoradas || []).includes('games') && !caixa('games'), 'Ignorar guarda a escolha e esconde a sugestão');
  dom.window.close();
}

// ---------------------------------------------------------------------------
async function testeCabecalho() {
  console.log('\nPosição da barra com o cabeçalho dentro da grade');
  // Caso visto no YouTube: "Mais recentes" + "Todas as inscrições" vêm numa
  // seção dentro de #contents, e chegam depois dos primeiros vídeos.
  const html = `<!doctype html><body><ytd-browse page-subtype="subscriptions"><div id="primary">
    <ytd-rich-grid-renderer><div id="contents">
      ${cardLegado('@canaltech', 'Canaltech', 'v1')}
      ${cardLegado('@framedrs', 'Framed', 'v2')}
    </div></ytd-rich-grid-renderer></div></ytd-browse></body>`;
  const dom = new JSDOM(html, { url: 'https://www.youtube.com/feed/subscriptions', runScripts: 'outside-only' });
  const browser = fakeBrowser({
    canais: {
      'h:@canaltech': { handle: '@canaltech', nome: 'Canaltech', categorias: ['tecnologia'] },
      'h:@framedrs': { handle: '@framedrs', nome: 'Framed', categorias: ['runescape'] }
    }
  });
  carregarNaJanela(dom, browser, ['catalogo.js', 'shared.js', 'content.js']);
  await esperar(400);
  const d = dom.window.document;
  confere(!!d.getElementById('ytcat-barra'), 'barra aparece antes de o cabeçalho existir');

  const secao = d.createElement('ytd-rich-section-renderer');
  secao.id = 'cabecalho-teste';
  const titulo = d.createElement('h2');
  titulo.textContent = 'Mais recentes';
  const link = d.createElement('a');
  link.setAttribute('href', '/feed/channels');
  link.textContent = 'Todas as inscrições';
  secao.append(titulo, link);
  d.querySelector('#contents').prepend(secao);
  await esperar(400);
  const barra = d.getElementById('ytcat-barra');
  confere(barra.previousElementSibling === secao, 'barra muda para logo depois de "Mais recentes"');
  confere(barra.nextElementSibling && barra.nextElementSibling.tagName === 'YTD-RICH-ITEM-RENDERER', 'e fica antes dos vídeos');

  barra.querySelector('[data-filtro="runescape"]').click();
  await esperar(300);
  confere(!secao.hasAttribute('data-ytcat-oculto'), 'cabeçalho continua visível com filtro ativo');
  confere(d.getElementById('ytcat-barra').previousElementSibling === secao, 'barra continua no lugar depois de filtrar');
  dom.window.close();
}

(async () => {
  await testeClassificador();
  await testeSugestoes();
  await testeFeed();
  await testeCabecalho();
  await testeImportacao();
  await testeOpcoes();
  await testePermissao();
  await testeSugestoesNaPagina();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
