(() => {
  'use strict';

  const Y = globalThis.YTCat;
  const api = Y.api;
  const $ = (id) => document.getElementById(id);

  const LIMITE_LISTA = 400; // linhas desenhadas de uma vez na revisão

  let estado = null;
  let gravacaoCategorias = null; // temporizador do salvamento das temáticas

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------

  function el(tag, attrs, filhos) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'texto') e.textContent = v;
      else if (k === 'classe') e.className = v;
      else if (k.includes('-') || k === 'role') e.setAttribute(k, v);
      else e[k] = v;
    }
    for (const f of filhos || []) if (f) e.append(f);
    return e;
  }

  function mensagem(id, texto, erro) {
    const m = $(id);
    m.textContent = texto;
    m.classList.toggle('erro', !!erro);
    m.hidden = !texto;
  }

  function formatarData(ms) {
    return new Date(ms).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function listaDeCanais() {
    return Object.entries(estado.canais)
      .map(([chave, canal]) => ({ chave, canal }))
      .sort((a, b) => (a.canal.nome || '').localeCompare(b.canal.nome || '', 'pt-BR'));
  }

  function lerArquivo(arquivo) {
    return new Promise((resolve, reject) => {
      const leitor = new FileReader();
      leitor.onload = () => resolve(String(leitor.result || ''));
      leitor.onerror = () => reject(leitor.error);
      leitor.readAsText(arquivo);
    });
  }

  async function salvarCanais() {
    await Y.salvar({ canais: estado.canais });
  }

  function salvarCategoriasDepois() {
    clearTimeout(gravacaoCategorias);
    gravacaoCategorias = setTimeout(async () => {
      gravacaoCategorias = null;
      await Y.salvar({ categorias: estado.categorias });
    }, 400);
  }

  // Remove de todos os canais as temáticas que não existem mais.
  function limparCategoriasOrfas() {
    const validas = new Set(estado.categorias.map((c) => c.id));
    for (const canal of Object.values(estado.canais)) {
      canal.categorias = (canal.categorias || []).filter((id) => validas.has(id));
    }
  }

  // ---------------------------------------------------------------------------
  // 1. Canais
  // ---------------------------------------------------------------------------

  function desenharStatus() {
    const total = Object.keys(estado.canais).length;
    const semCat = Object.values(estado.canais).filter((c) => !(c.categorias || []).length).length;
    const manuais = Object.values(estado.canais).filter((c) => c.manual).length;
    let texto = total === 0
      ? 'Nenhum canal importado ainda.'
      : `${total} canais salvos · ${semCat} sem categoria · ${manuais} ajustados à mão.`;
    const u = estado.ultimaImportacao;
    if (u && u.quando) {
      texto += ` Última importação: ${formatarData(u.quando)}` +
        (typeof u.lidos === 'number' ? ` (${u.lidos} canais lidos)` : '') + '.';
    }
    const comYoutube = Object.values(estado.canais).filter((c) => c.yt && c.yt.quando).length;
    if (total > 0) {
      texto += comYoutube < total
        ? ` Categoria do YouTube lida para ${comYoutube} de ${total} canais; importe do YouTube para completar.`
        : ' Todos os canais têm a categoria do YouTube.';
    }
    $('status-canais').textContent = texto;
    $('boas-vindas').hidden = total > 0;
  }

  // ---------------------------------------------------------------------------
  // Acesso ao YouTube
  // ---------------------------------------------------------------------------

  const ORIGENS = ['*://www.youtube.com/*'];
  // true/false quando o Safari informa; null quando a API não está disponível.
  let permissaoConcedida = null;

  async function consultarPermissao() {
    try {
      if (!api.permissions || !api.permissions.contains) return null;
      return !!(await api.permissions.contains({ origins: ORIGENS }));
    } catch (e) {
      return null;
    }
  }

  async function desenharPermissao() {
    permissaoConcedida = await consultarPermissao();
    $('permissao').hidden = permissaoConcedida !== false;
  }

  // Precisa ser chamada direto no clique (sem await antes), senão o Safari
  // não mostra a janela de permissão.
  function pedirPermissao() {
    let pedido;
    try {
      pedido = api.permissions.request({ origins: ORIGENS });
    } catch (e) {
      $('ajuda-permissao').hidden = false;
      return Promise.resolve(false);
    }
    return Promise.resolve(pedido)
      .then(async (ok) => {
        await desenharPermissao();
        if (!ok || permissaoConcedida === false) $('ajuda-permissao').hidden = false;
        return !!ok;
      })
      .catch(() => {
        $('ajuda-permissao').hidden = false;
        return false;
      });
  }

  function importarDoYoutube() {
    // Pede o acesso no mesmo clique, antes de qualquer espera.
    const pedido = permissaoConcedida === false ? pedirPermissao() : Promise.resolve(true);
    return pedido.then(abrirImportacao);
  }

  async function abrirImportacao() {
    await Y.salvar({ importacaoPendente: Date.now() });
    const url = 'https://www.youtube.com/feed/channels';
    try {
      await api.tabs.create({ url });
    } catch (e) {
      window.open(url, '_blank');
    }
    mensagem('msg-importacao', 'Abri a lista de canais do YouTube numa nova aba. Acompanhe o progresso no canto da página.');
  }

  async function importarCsv(arquivo) {
    try {
      const texto = await lerArquivo(arquivo);
      const lidos = Y.lerCsvTakeout(texto);
      if (!lidos.length) {
        mensagem('msg-importacao', 'Não encontrei canais nesse arquivo. Ele precisa ser o subscriptions.csv do Google Takeout.', true);
        return;
      }
      const r = Y.mesclarImportacao(estado.canais, lidos, estado.categorias);
      estado.ultimaImportacao = { quando: Date.now(), lidos: lidos.length, novos: r.novos, origem: 'takeout' };
      await Y.salvar({ canais: estado.canais, ultimaImportacao: estado.ultimaImportacao });
      mensagem(
        'msg-importacao',
        `${lidos.length} canais lidos do CSV (${r.novos} novos). O Takeout não traz descrições, então a ` +
        'classificação usa só nome e @; a importação pelo YouTube costuma acertar mais.'
      );
      desenharTudo();
    } catch (e) {
      mensagem('msg-importacao', 'Não consegui ler o arquivo: ' + e.message, true);
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Temáticas
  // ---------------------------------------------------------------------------

  function contarPorCategoria() {
    const n = {};
    for (const canal of Object.values(estado.canais)) {
      for (const id of canal.categorias || []) n[id] = (n[id] || 0) + 1;
    }
    return n;
  }

  function desenharCategorias() {
    const n = contarPorCategoria();
    const lista = $('lista-categorias');
    lista.replaceChildren(...estado.categorias.map((cat) => {
      const nome = el('input', { type: 'text', value: cat.nome, 'aria-label': 'Nome da temática' });
      nome.addEventListener('input', () => {
        cat.nome = nome.value.trim() || cat.nome;
        salvarCategoriasDepois();
        desenharFiltroLista();
        desenharCanais();
      });

      const palavras = el('textarea', {
        value: (cat.palavras || []).join(', '),
        'aria-label': 'Palavras-chave'
      });
      palavras.spellcheck = false;
      palavras.addEventListener('input', () => {
        cat.palavras = palavras.value.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
        salvarCategoriasDepois();
      });

      const remover = el('button', { type: 'button', classe: 'remover', texto: 'Remover' });
      remover.addEventListener('click', async () => {
        if (!confirm(`Remover a temática “${cat.nome}”? Os canais dela não serão apagados.`)) return;
        estado.categorias = estado.categorias.filter((c) => c !== cat);
        limparCategoriasOrfas();
        clearTimeout(gravacaoCategorias);
        await Y.salvar({ categorias: estado.categorias, canais: estado.canais });
        desenharTudo();
      });

      const yt = Y.youtubeDaTematica(cat);
      const textoYt = [...yt.forte, ...yt.fraco.map((c) => c + ' (só se nada mais encaixar)')].join(', ');
      return el('div', { classe: 'categoria', 'data-id': cat.id }, [
        el('div', { classe: 'linha' }, [nome]),
        palavras,
        textoYt ? el('div', { classe: 'youtube', texto: 'Categoria do YouTube: ' + textoYt }) : null,
        el('div', { classe: 'rodape' }, [
          el('span', { classe: 'contagem', texto: `${n[cat.id] || 0} canais` }),
          remover
        ])
      ]);
    }));
  }

  function atualizarContagensCategorias() {
    const n = contarPorCategoria();
    for (const card of document.querySelectorAll('.categoria')) {
      const span = card.querySelector('.contagem');
      if (span) span.textContent = `${n[card.dataset.id] || 0} canais`;
    }
  }

  async function novaCategoria() {
    const nome = (prompt('Nome da nova temática:') || '').trim();
    if (!nome) return;
    let id = Y.slug(nome);
    const usados = new Set(estado.categorias.map((c) => c.id));
    for (let i = 2; usados.has(id); i++) id = Y.slug(nome) + '-' + i;
    const palavra = Y.normalizar(nome);
    estado.categorias.push({ id, nome, palavras: [palavra] });
    clearTimeout(gravacaoCategorias);
    await Y.salvar({ categorias: estado.categorias });
    desenharTudo();
    const ultimo = document.querySelector(`.categoria[data-id="${CSS.escape(id)}"] textarea`);
    if (ultimo) ultimo.focus();
  }

  async function restaurarPadrao() {
    if (!confirm('Substituir suas temáticas e palavras-chave pelas padrão (Tecnologia, RuneScape, Investimentos, Política)?')) return;
    estado.categorias = Y.clonar(Y.CATEGORIAS_PADRAO);
    limparCategoriasOrfas();
    clearTimeout(gravacaoCategorias);
    await Y.salvar({ categorias: estado.categorias, canais: estado.canais });
    desenharTudo();
  }

  async function classificar() {
    const total = Object.keys(estado.canais).length;
    if (!total) {
      mensagem('msg-classificacao', 'Importe seus canais primeiro.', true);
      return;
    }
    const incluirManuais = $('chk-incluir-manuais').checked;
    if (incluirManuais && !confirm('Isso desfaz todos os ajustes manuais. Continuar?')) return;
    clearTimeout(gravacaoCategorias);
    const novas = sugestoesAtuais.filter((s) => marcadas.has(s.id));
    for (const s of novas) {
      const tema = Y.temaDoCatalogo(s.id);
      if (tema && !estado.categorias.some((c) => c.id === tema.id)) estado.categorias.push(tema);
    }
    const alterados = Y.classificarTodos(estado.canais, estado.categorias, incluirManuais);
    await Y.salvar({ categorias: estado.categorias, canais: estado.canais });
    const semCat = Object.values(estado.canais).filter((c) => !(c.categorias || []).length).length;
    mensagem(
      'msg-classificacao',
      (novas.length ? `Criei ${novas.map((s) => s.nome).join(', ')}. ` : '') +
      `${alterados} canais classificados` +
      (incluirManuais ? '' : ` (${total - alterados} ajustados à mão foram mantidos)`) +
      `. ${semCat} ficaram sem categoria.`
    );
    desenharTudo();
  }

  // ---------------------------------------------------------------------------
  // Sugestões de temáticas
  // ---------------------------------------------------------------------------

  let sugestoesAtuais = [];
  const marcadas = new Set();
  const jaSugeridas = new Set();

  function desenharSugestoes() {
    sugestoesAtuais = Y.sugerirTematicas(estado.canais, estado.categorias, estado.config.sugestoesIgnoradas);
    for (const s of sugestoesAtuais) {
      // Vem marcada na primeira vez que aparece, se pegar 3 canais ou mais.
      if (!jaSugeridas.has(s.id)) {
        jaSugeridas.add(s.id);
        if (s.total >= 3) marcadas.add(s.id);
      }
    }
    const palavras = Y.palavrasFrequentes(estado.canais, estado.categorias);

    $('lista-sugestoes').replaceChildren(...sugestoesAtuais.map((s) => {
      const caixa = el('input', { type: 'checkbox', checked: marcadas.has(s.id), 'data-id': s.id });
      caixa.addEventListener('change', () => {
        if (caixa.checked) marcadas.add(s.id); else marcadas.delete(s.id);
      });
      const ignorar = el('button', { type: 'button', classe: 'ignorar', texto: 'Ignorar', title: 'Não sugerir mais esta temática' });
      ignorar.addEventListener('click', async () => {
        marcadas.delete(s.id);
        estado.config.sugestoesIgnoradas = [...new Set([...(estado.config.sugestoesIgnoradas || []), s.id])];
        await Y.salvar({ config: estado.config });
        desenharSugestoes();
      });
      return el('div', { classe: 'sugestao' }, [
        el('label', {}, [
          caixa,
          el('span', { classe: 'nome-sugestao', texto: s.nome }),
          el('span', { classe: 'detalhe', texto: `${s.total} canais · ${s.exemplos.join(', ')}${s.total > s.exemplos.length ? '…' : ''}` })
        ]),
        ignorar
      ]);
    }));

    $('palavras-frequentes').replaceChildren(...palavras.map((p) => {
      const b = el('button', { type: 'button', classe: 'palavra', title: `${p.total} canais sem categoria têm esta palavra` }, [
        document.createTextNode(p.palavra),
        el('span', { texto: String(p.total) })
      ]);
      b.addEventListener('click', () => criarDaPalavra(p.palavra));
      return b;
    }));
    $('bloco-palavras').hidden = palavras.length === 0;
    $('sugestoes').hidden = sugestoesAtuais.length === 0 && palavras.length === 0;
  }

  async function criarDaPalavra(palavra) {
    const sugestao = palavra.charAt(0).toUpperCase() + palavra.slice(1);
    const nome = (prompt(`Nome da nova temática (vai procurar por “${palavra}”):`, sugestao) || '').trim();
    if (!nome) return;
    let id = Y.slug(nome);
    const usados = new Set(estado.categorias.map((c) => c.id));
    for (let i = 2; usados.has(id); i++) id = Y.slug(nome) + '-' + i;
    estado.categorias.push({ id, nome, palavras: [palavra] });
    clearTimeout(gravacaoCategorias);
    const alterados = Y.classificarTodos(estado.canais, estado.categorias, false);
    await Y.salvar({ categorias: estado.categorias, canais: estado.canais });
    mensagem('msg-classificacao', `Criei ${nome} e reclassifiquei ${alterados} canais.`);
    desenharTudo();
  }

  // ---------------------------------------------------------------------------
  // 3. Revisão
  // ---------------------------------------------------------------------------

  function desenharFiltroLista() {
    const select = $('filtro-lista');
    const atual = select.value || 'todos';
    const opcoes = [
      ['todos', 'Todos os canais'],
      ['__sem__', 'Sem categoria'],
      ['__manual__', 'Ajustados à mão'],
      ...estado.categorias.map((c) => [c.id, c.nome])
    ];
    select.replaceChildren(...opcoes.map(([v, t]) => el('option', { value: v, texto: t })));
    select.value = opcoes.some(([v]) => v === atual) ? atual : 'todos';
  }

  function passaNoFiltro(canal) {
    const filtro = $('filtro-lista').value || 'todos';
    const cats = canal.categorias || [];
    if (filtro === '__sem__' && cats.length) return false;
    if (filtro === '__manual__' && !canal.manual) return false;
    if (!['todos', '__sem__', '__manual__'].includes(filtro) && !cats.includes(filtro)) return false;
    const busca = Y.normalizar($('busca').value).trim();
    if (!busca) return true;
    return Y.normalizar(`${canal.nome} ${canal.handle} ${canal.descricao}`).includes(busca);
  }

  function linhaCanal(chave, canal) {
    const url = canal.handle
      ? 'https://www.youtube.com/' + canal.handle
      : canal.id ? 'https://www.youtube.com/channel/' + canal.id : null;

    const avatar = canal.avatar
      ? el('img', { classe: 'avatar', src: canal.avatar, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' })
      : el('div', { classe: 'avatar', texto: (canal.nome || '?').trim().charAt(0).toUpperCase() });

    const info = el('div', { classe: 'info' }, [
      url
        ? el('a', { classe: 'nome', href: url, target: '_blank', rel: 'noopener', texto: canal.nome || canal.handle })
        : el('span', { classe: 'nome', texto: canal.nome || '(sem nome)' }),
      canal.handle ? el('span', { classe: 'handle', texto: canal.handle }) : null,
      canal.descricao ? el('p', { classe: 'desc', texto: canal.descricao, title: canal.descricao }) : null
    ]);

    const cats = el('div', { classe: 'cats' });
    for (const cat of estado.categorias) {
      const ligado = (canal.categorias || []).includes(cat.id);
      cats.append(el('button', {
        type: 'button',
        classe: 'chip' + (ligado ? ' on' : ''),
        'data-cat': cat.id,
        'aria-pressed': String(ligado),
        texto: cat.nome
      }));
    }
    if (canal.manual) {
      cats.append(el('span', { classe: 'marca-manual', texto: 'manual' }, [
        el('button', { type: 'button', 'data-acao': 'auto', title: 'Voltar para a classificação automática', texto: '↺' })
      ]));
    }
    cats.append(el('button', { type: 'button', classe: 'apagar', 'data-acao': 'apagar', title: 'Apagar este canal da lista', texto: '✕' }));

    return el('div', { classe: 'canal', 'data-chave': chave }, [avatar, info, cats]);
  }

  function desenharCanais() {
    const container = $('lista-canais');
    const todos = listaDeCanais();
    const filtrados = todos.filter(({ canal }) => passaNoFiltro(canal));
    const mostrados = filtrados.slice(0, LIMITE_LISTA);
    if (!todos.length) {
      container.replaceChildren(el('p', { classe: 'vazio', texto: 'Os canais aparecem aqui depois da importação.' }));
    } else if (!filtrados.length) {
      container.replaceChildren(el('p', { classe: 'vazio', texto: 'Nenhum canal com esse filtro.' }));
    } else {
      container.replaceChildren(...mostrados.map(({ chave, canal }) => linhaCanal(chave, canal)));
    }
    $('contagem-lista').textContent = filtrados.length > LIMITE_LISTA
      ? `Mostrando ${LIMITE_LISTA} de ${filtrados.length}; use a busca para achar os demais.`
      : `${filtrados.length} de ${todos.length}`;
  }

  async function aoClicarNaLista(ev) {
    const botao = ev.target.closest('button');
    const linha = ev.target.closest('.canal');
    if (!botao || !linha) return;
    const chave = linha.dataset.chave;
    const canal = estado.canais[chave];
    if (!canal) return;

    if (botao.dataset.cat) {
      const id = botao.dataset.cat;
      const atuais = new Set(canal.categorias || []);
      if (atuais.has(id)) atuais.delete(id); else atuais.add(id);
      canal.categorias = estado.categorias.map((c) => c.id).filter((c) => atuais.has(c));
      canal.manual = true;
    } else if (botao.dataset.acao === 'auto') {
      canal.manual = false;
      canal.categorias = Y.classificarCanal(canal, Y.compilarCategorias(estado.categorias));
    } else if (botao.dataset.acao === 'apagar') {
      if (!confirm(`Apagar “${canal.nome}” da lista? Ele volta se você importar de novo e ainda for inscrito.`)) return;
      delete estado.canais[chave];
      linha.remove();
      await salvarCanais();
      desenharStatus();
      atualizarContagensCategorias();
      return;
    } else {
      return;
    }
    linha.replaceWith(linhaCanal(chave, canal));
    await salvarCanais();
    desenharStatus();
    atualizarContagensCategorias();
  }

  // ---------------------------------------------------------------------------
  // 4. Opções e backup
  // ---------------------------------------------------------------------------

  function desenharOpcoes() {
    $('opt-shorts').checked = !!estado.config.ocultarShorts;
    $('opt-sem-categoria').checked = !!estado.config.mostrarSemCategoria;
  }

  async function salvarOpcoes() {
    estado.config.ocultarShorts = $('opt-shorts').checked;
    estado.config.mostrarSemCategoria = $('opt-sem-categoria').checked;
    await Y.salvar({ config: estado.config });
  }

  function exportar() {
    const dados = {
      formato: 'filtro-inscricoes',
      versao: 1,
      exportadoEm: new Date().toISOString(),
      categorias: estado.categorias,
      canais: estado.canais,
      config: estado.config
    };
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `filtro-inscricoes-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function restaurarBackup(arquivo) {
    try {
      const dados = JSON.parse(await lerArquivo(arquivo));
      if (!dados || !Array.isArray(dados.categorias) || typeof dados.canais !== 'object') {
        throw new Error('o arquivo não parece ser um backup desta extensão');
      }
      if (!confirm('Substituir as temáticas, canais e opções atuais pelos do arquivo?')) return;
      estado.categorias = dados.categorias;
      estado.canais = dados.canais || {};
      estado.config = { ...Y.CONFIG_PADRAO, ...(dados.config || {}) };
      await Y.salvar({ categorias: estado.categorias, canais: estado.canais, config: estado.config });
      mensagem('msg-backup', `Backup restaurado: ${estado.categorias.length} temáticas e ${Object.keys(estado.canais).length} canais.`);
      desenharTudo();
    } catch (e) {
      mensagem('msg-backup', 'Não consegui restaurar: ' + e.message, true);
    }
  }

  // ---------------------------------------------------------------------------
  // Montagem
  // ---------------------------------------------------------------------------

  function desenharTudo() {
    desenharStatus();
    desenharCategorias();
    desenharSugestoes();
    desenharFiltroLista();
    desenharCanais();
    desenharOpcoes();
  }

  async function iniciar() {
    estado = await Y.carregarEstado();
    // Grava as temáticas padrão na primeira abertura, para o feed já ter as pílulas.
    const salvo = await api.storage.local.get('categorias');
    if (!salvo || !Array.isArray(salvo.categorias)) await Y.salvar({ categorias: estado.categorias });

    desenharTudo();
    await desenharPermissao();

    $('btn-permissao').addEventListener('click', pedirPermissao);
    if (api.permissions && api.permissions.onAdded) api.permissions.onAdded.addListener(desenharPermissao);
    if (api.permissions && api.permissions.onRemoved) api.permissions.onRemoved.addListener(desenharPermissao);
    // O acesso também pode ser liberado pelos Ajustes do Safari, fora desta página.
    window.addEventListener('focus', desenharPermissao);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) desenharPermissao();
    });

    $('btn-importar-yt').addEventListener('click', importarDoYoutube);
    $('btn-importar-csv').addEventListener('click', () => $('arquivo-csv').click());
    $('arquivo-csv').addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (f) importarCsv(f);
      ev.target.value = '';
    });
    $('btn-nova-categoria').addEventListener('click', novaCategoria);
    $('btn-restaurar').addEventListener('click', restaurarPadrao);
    $('btn-classificar').addEventListener('click', classificar);
    $('busca').addEventListener('input', desenharCanais);
    $('filtro-lista').addEventListener('change', desenharCanais);
    $('lista-canais').addEventListener('click', aoClicarNaLista);
    $('opt-shorts').addEventListener('change', salvarOpcoes);
    $('opt-sem-categoria').addEventListener('change', salvarOpcoes);
    $('btn-exportar').addEventListener('click', exportar);
    $('btn-restaurar-backup').addEventListener('click', () => $('arquivo-json').click());
    $('arquivo-json').addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (f) restaurarBackup(f);
      ev.target.value = '';
    });

    // Mudanças feitas em outra aba (ex.: importação no YouTube terminando).
    api.storage.onChanged.addListener(async (mudancas, area) => {
      if (area && area !== 'local') return;
      if (!mudancas.canais && !mudancas.ultimaImportacao && !mudancas.categorias) return;
      const novo = await Y.carregarEstado();
      const editandoCategorias = gravacaoCategorias !== null ||
        (document.activeElement && document.activeElement.closest('#lista-categorias'));
      estado.canais = novo.canais;
      estado.ultimaImportacao = novo.ultimaImportacao;
      if (!editandoCategorias) estado.categorias = novo.categorias;
      desenharStatus();
      if (editandoCategorias) atualizarContagensCategorias(); else desenharCategorias();
      desenharSugestoes();
      desenharFiltroLista();
      desenharCanais();
      if (mudancas.ultimaImportacao && novo.ultimaImportacao && novo.ultimaImportacao.origem === 'youtube') {
        const u = novo.ultimaImportacao;
        mensagem('msg-importacao', `Importação concluída: ${u.lidos} canais lidos (${u.novos} novos).`);
      }
    });
  }

  iniciar();
})();
