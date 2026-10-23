'use strict';

const api = globalThis.browser || globalThis.chrome;

// Na primeira instalação, abre a página de configurações para importar os canais.
api.runtime.onInstalled.addListener((detalhes) => {
  if (detalhes && detalhes.reason === 'install') {
    api.runtime.openOptionsPage();
  }
});

// Clicar no ícone da barra do Safari abre as configurações.
api.action.onClicked.addListener(() => {
  api.runtime.openOptionsPage();
});

// Pedidos vindos do YouTube (botão de engrenagem nas pílulas, fim da importação).
api.runtime.onMessage.addListener((mensagem) => {
  if (mensagem && mensagem.tipo === 'abrirOpcoes') {
    api.runtime.openOptionsPage();
  }
});
