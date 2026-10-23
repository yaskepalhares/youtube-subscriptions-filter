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

function carregarNaJanela(dom, browser, arquivos) {
  const w = dom.window;
  w.browser = browser;
  w.scrollTo = () => {};
  w.CSS = w.CSS || { escape: (s) => s };
  for (const f of arquivos) w.eval(ler(f));
}

// ---------------------------------------------------------------------------
async function testeClassificador() {
  console.log('\nClassificador');
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://www.youtube.com/', runScripts: 'outside-only' });
  carregarNaJanela(dom, fakeBrowser(), ['shared.js']);
  const Y = dom.window.YTCat;
  const comp = Y.compilarCategorias(Y.CATEGORIAS_PADRAO);
  const casos = [
    [{ nome: 'Canaltech', handle: '@canaltech', descricao: 'Notícias de tecnologia, reviews de celulares' }, ['tecnologia']],
    [{ nome: 'Coisa de Nerd', handle: '@coisadenerd', descricao: 'Games e tecnologia' }, ['tecnologia']],
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
      <ytd-rich-grid-renderer><div id="contents">
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
  carregarNaJanela(dom, browser, ['shared.js', 'content.js']);
  await esperar(400);
  const d = dom.window.document;
  const barra = d.getElementById('ytcat-barra');
  confere(!!barra, 'barra inserida');
  confere(barra && barra.nextElementSibling && barra.nextElementSibling.tagName === 'YTD-RICH-GRID-RENDERER', 'barra fica logo acima da grade');
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

  d.getElementById('ytcat-barra').querySelector('[data-filtro="todos"]').click();
  await esperar(50);
  confere(ocultos().length === 0, 'voltar para "Todos" mostra tudo');

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
  </div></ytd-browse></body>`;
  const dom = new JSDOM(html, { url: 'https://www.youtube.com/feed/channels', runScripts: 'outside-only' });
  const browser = fakeBrowser({ importacaoPendente: Date.now() });
  carregarNaJanela(dom, browser, ['shared.js', 'content.js']);
  await esperar(4500);
  const canais = browser._dados.canais || {};
  const nomes = Object.values(canais).map((c) => c.nome).sort();
  confere(nomes.length === 5, `5 canais importados (${nomes.join(', ')})`);
  confere(canais['h:@framedrs'] && canais['h:@framedrs'].categorias.includes('runescape'), 'Framed classificado como RuneScape');
  confere(canais['h:@primorico'] && canais['h:@primorico'].categorias.includes('investimentos'), 'Primo Rico classificado como Investimentos');
  confere(canais['h:@receitas'] && canais['h:@receitas'].categorias.length === 0, 'canal fora das temáticas fica sem categoria');
  confere(canais['h:@canaltech'] && canais['h:@canaltech'].avatar.includes('yt3.ggpht.com'), 'avatar guardado');
  confere(!('importacaoPendente' in browser._dados), 'pedido de importação limpo');
  const status = dom.window.document.querySelector('.ytcat-imp-status');
  confere(status && /Pronto: 5 canais/.test(status.textContent), 'painel mostra o resultado: ' + (status && status.textContent));
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
  carregarNaJanela(dom, browser, ['shared.js', 'options.js']);
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

(async () => {
  await testeClassificador();
  await testeFeed();
  await testeImportacao();
  await testeOpcoes();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
