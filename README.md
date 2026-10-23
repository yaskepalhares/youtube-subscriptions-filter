# YouTube Subscriptions Filter

*A Safari extension (macOS) that adds topic pills to the top of the YouTube subscriptions feed,
so you can see only the videos from the channels in a given topic. Channels are imported from your
subscription list and classified automatically by keywords, with manual adjustments. The interface
is in Portuguese.*

---

Extensão do Safari para Mac que coloca pílulas de temática no topo do
[feed de inscrições do YouTube](https://www.youtube.com/feed/subscriptions) e mostra só os vídeos
dos canais da temática escolhida.

## Funcionalidades

- **Pílulas no feed**: *Todos*, uma por temática e *Sem categoria*, com o número de vídeos carregados
  em cada uma. Dá para marcar várias temáticas ao mesmo tempo (o feed mostra os vídeos de qualquer uma
  delas); desmarcar a última volta para *Todos*. A barra acompanha a rolagem e a seleção fica salva.
- **Importação dos canais**: o botão *Importar do YouTube* abre `youtube.com/feed/channels`, rola a
  lista sozinho e lê nome, @, descrição e foto de cada canal. Também aceita o `subscriptions.csv`
  do Google Takeout.
- **Categoria oficial do YouTube**: na importação, a extensão lê a categoria (Música, Jogos, Notícias e
  política…) e as tags dos 3 vídeos mais recentes de cada canal. São pedidos pequenos ao próprio
  YouTube, cerca de um minuto para 150 canais.
- **Classificação automática** que combina a categoria do YouTube com palavras-chave procuradas no
  nome, no @, na descrição e nas tags. Um canal pode ficar em mais de uma temática.
- **Sugestão de temáticas**: a partir dos seus canais, a extensão propõe temáticas de um catálogo de
  ~30 (Música, Games, Humor, Esportes, Culinária, Podcasts…) com o número de canais que cada uma
  pegaria; as marcadas são criadas ao clicar em *Classificar automaticamente*. Também mostra as
  palavras que mais se repetem entre os canais que sobraram sem categoria.
- **Ajuste manual**: na revisão, um clique inclui ou tira o canal de uma temática. Ajustes manuais não
  são desfeitos pela classificação automática nem por uma nova importação (↺ devolve ao automático).
- **Temáticas editáveis**: criar, renomear, remover e mudar palavras-chave. Vem com Tecnologia,
  RuneScape, Investimentos e Política como ponto de partida; o catálogo fica em `extensao/catalogo.js`.
- A barra de pílulas e as configurações seguem o modo claro/escuro do sistema.
- Opção de esconder os Shorts quando há filtro ativo, e backup/restauração em JSON.

Tudo fica salvo localmente no Safari (`browser.storage.local`). A extensão só conversa com
`www.youtube.com` (para ler a lista e as categorias dos canais) e não envia dados para nenhum outro lugar.

## Instalação

Precisa de um Mac com o **Xcode** instalado (gratuito na App Store). Não é preciso abrir o Xcode nem
ter a conta paga de desenvolvedor da Apple.

```bash
git clone https://github.com/yaskepalhares/youtube-subscriptions-filter.git
cd youtube-subscriptions-filter
./instalar.sh
```

O script gera o app que contém a extensão, compila e instala em `~/Applications`. Depois, no Safari:

1. *Safari › Ajustes… › Extensões*: marque **Filtro de Inscrições**.
2. Permita o acesso a **youtube.com** (em *Editar Sites…* ou pelo ícone da extensão na barra).
3. A página de configurações abre sozinha na primeira vez. Clique em *Importar do YouTube*, espere o
   “Pronto” na aba do YouTube e revise as temáticas.

**Assinatura.** Se o Mac tiver um certificado *Apple Development* (criado quando você entra com seu
Apple ID gratuito em *Xcode › Settings › Accounts*), o script assina com ele e a extensão fica
instalada de vez. Sem certificado, o app sai sem assinatura e o Safari exige *Permitir extensões não
assinadas* (em *Ajustes › Desenvolvedor*, depois de ativar *Mostrar recursos para desenvolvedores web*
em *Ajustes › Avançado*) toda vez que for aberto.

Se o script reclamar das *Command Line Tools*, rode uma vez:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
```

**Atualizar:** `git pull && ./instalar.sh`. Canais e temáticas continuam salvos.

### Só para testar, sem compilar

Em *Safari › Ajustes… › Desenvolvedor*, clique em *Adicionar Extensão Temporária…* e escolha a pasta
`extensao`. O Safari remove extensões temporárias depois de 24 horas ou quando é fechado.

## Desenvolvimento

```
extensao/
  manifest.json     Manifest V3
  catalogo.js       temáticas que podem ser sugeridas e categorias do YouTube
  shared.js         armazenamento, classificador, sugestões, identificação de canais
  content.js        pílulas e filtro em /feed/subscriptions; importação e leitura das
                    categorias em /feed/channels
  content.css
  options.html/js/css  página de configurações
  background.js     abre as configurações na instalação e pelo ícone da barra
testes/teste.js     testes com páginas simuladas (jsdom)
instalar.sh         compila e instala o app pela linha de comando
```

Testes: `npm install && npm test`.

O YouTube muda a estrutura das páginas de tempos em tempos. Os seletores ficam no começo de
`content.js` (`SEL_CARDS`, `SELETORES_NOME_CARD`, `SEL_CANAL_LISTA`). Para depurar, abra
*Desenvolvedor › Mostrar Console JavaScript* na aba do YouTube e procure as mensagens com
`[Filtro de Inscrições]`; para a página de configurações, use *Desenvolvedor › Inspetor de
Extensões Web*.

## Limitações conhecidas

- O feed carrega vídeos de todos os canais misturados. Numa temática com poucos vídeos recentes, a
  página fica curta e o YouTube vai carregando mais aos poucos; o contador "X de Y vídeos
  carregados" mostra isso.
- A classificação por palavras-chave erra em canais com descrição vaga; a revisão manual existe para
  isso.

## Licença

[MIT](LICENSE)
