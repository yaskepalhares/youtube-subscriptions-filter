/*
 * Catálogo de temáticas que a extensão consegue sugerir.
 *
 * palavras      procuradas no nome, no @, na descrição e nas tags dos vídeos.
 *               Terminadas em * casam por prefixo; acentos e maiúsculas não importam.
 * youtube       categorias oficiais do YouTube que indicam a temática com força.
 * youtubeFraco  categorias amplas: só valem quando nada mais encaixou o canal.
 *
 * As quatro primeiras são as temáticas padrão da instalação.
 */
(function (global) {
  'use strict';

  // Categorias oficiais de vídeo do YouTube. A API devolve o nome em inglês;
  // os nomes em português ficam como apelidos, por garantia.
  const CATEGORIAS_YOUTUBE = {
    'Film & Animation': ['Filmes e animação', 'Filmes e desenhos'],
    'Autos & Vehicles': ['Automóveis e veículos', 'Carros e veículos'],
    'Music': ['Música'],
    'Pets & Animals': ['Animais de estimação e animais', 'Animais'],
    'Sports': ['Esportes'],
    'Travel & Events': ['Viagens e eventos'],
    'Gaming': ['Jogos'],
    'People & Blogs': ['Pessoas e blogs'],
    'Comedy': ['Comédia'],
    'Entertainment': ['Entretenimento'],
    'News & Politics': ['Notícias e política'],
    'Howto & Style': ['Guias e estilo', 'Instruções e estilo'],
    'Education': ['Educação'],
    'Science & Technology': ['Ciência e tecnologia'],
    'Nonprofits & Activism': ['ONGs e ativismo', 'Sem fins lucrativos e ativismo']
  };

  const CATALOGO = [
    {
      id: 'tecnologia',
      nome: 'Tecnologia',
      youtube: ['Science & Technology'],
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
      youtube: ['News & Politics'],
      palavras: [
        'politic*', 'eleic*', 'eleitora*', 'governo', 'congresso', 'senado', 'camara dos deputados',
        'deputad*', 'senador*', 'presidente', 'stf', 'democracia', 'esquerda', 'direita',
        'jornalismo', 'jornalista', 'jornal', 'noticia*', 'news', 'geopolitic*',
        'analise politica', 'brasilia', 'planalto'
      ]
    },
    {
      id: 'musica',
      nome: 'Música',
      youtube: ['Music'],
      palavras: [
        'musica', 'musicas', 'music', 'musical', 'musico', 'musicos', 'banda', 'band', 'cantor*',
        'singer', 'songwriter', 'rapper', 'rap', 'hip hop', 'trap', 'rock', 'metal', 'jazz', 'blues',
        'samba', 'pagode', 'sertanejo', 'funk', 'mpb', 'forro', 'guitarra', 'guitar*', 'violao',
        'piano', 'pianista', 'bateria', 'drums', 'baterista', 'baixista', 'dj', 'beats', 'lofi',
        'lo-fi', 'vevo', 'records', 'gravadora', 'orquestra', 'orchestra', 'album', 'discografia',
        'clipe oficial', 'official music video'
      ]
    },
    {
      id: 'games',
      nome: 'Games',
      youtube: ['Gaming'],
      palavras: [
        'games', 'game', 'gamer', 'gaming', 'jogos', 'gameplay*', 'playthrough', 'lets play',
        'detonado', 'zerando', 'minecraft', 'fortnite', 'nintendo', 'playstation', 'ps5', 'xbox',
        'steam', 'speedrun*', 'rpg', 'esports', 'e-sports', 'twitch'
      ]
    },
    {
      id: 'ciencia',
      nome: 'Ciência',
      palavras: [
        'ciencia', 'ciencias', 'science', 'cientific*', 'cientista*', 'fisica', 'physics', 'quimica',
        'chemistry', 'biologia', 'biology', 'astronomia', 'astronomy', 'astrofisica', 'universo',
        'matematica', 'math', 'mathematics', 'evolucao', 'divulgacao cientifica', 'neurociencia',
        'experimento*'
      ]
    },
    {
      id: 'educacao',
      nome: 'Educação',
      youtubeFraco: ['Education'],
      palavras: [
        'educacao', 'education', 'aula', 'aulas', 'curso', 'cursos', 'professor*', 'aprenda',
        'aprender', 'enem', 'vestibular', 'concurso*', 'escola', 'estudar', 'estudos', 'explicado'
      ]
    },
    {
      id: 'humor',
      nome: 'Humor',
      youtube: ['Comedy'],
      palavras: [
        'humor', 'comedia', 'comedy', 'comediante*', 'stand up', 'standup', 'stand-up', 'sketch*',
        'esquete*', 'piada*', 'zoeira', 'memes', 'meme', 'parodia*', 'parody', 'engracad*'
      ]
    },
    {
      id: 'esportes',
      nome: 'Esportes',
      youtube: ['Sports'],
      palavras: [
        'esporte*', 'sports', 'futebol', 'football', 'soccer', 'nba', 'nfl', 'basquete',
        'basketball', 'volei', 'tenis', 'formula 1', 'f1', 'automobilismo', 'ciclismo', 'skate',
        'surf', 'brasileirao', 'champions league'
      ]
    },
    {
      id: 'lutas',
      nome: 'Lutas',
      palavras: [
        'jiu jitsu', 'jiu-jitsu', 'jiujitsu', 'bjj', 'grappling', 'mma', 'ufc', 'muay thai', 'boxe',
        'boxing', 'judo', 'karate', 'wrestling', 'lutas', 'lutador*', 'artes marciais',
        'martial arts', 'kickboxing', 'no gi', 'nogi'
      ]
    },
    {
      id: 'fitness',
      nome: 'Fitness e treino',
      palavras: [
        'fitness', 'treino', 'treinos', 'academia', 'musculacao', 'bodybuilding', 'hipertrofia',
        'crossfit', 'workout', 'gym', 'calistenia', 'calisthenics', 'emagrec*', 'personal trainer',
        'powerlifting', 'running', 'maratona', 'corrida de rua'
      ]
    },
    {
      id: 'culinaria',
      nome: 'Culinária',
      palavras: [
        'culinaria', 'receita*', 'recipe*', 'cozinha', 'cozinhar', 'cooking', 'chef', 'gastronomia',
        'churrasco', 'bbq', 'confeitaria', 'padaria', 'food', 'comida*', 'restaurante*'
      ]
    },
    {
      id: 'cinema',
      nome: 'Cinema e séries',
      youtube: ['Film & Animation'],
      palavras: [
        'cinema', 'filme', 'filmes', 'film', 'films', 'movie', 'movies', 'serie', 'series', 'tv show',
        'netflix', 'hbo', 'critica de cinema', 'trailer*', 'oscar', 'hollywood', 'cinefilo*'
      ]
    },
    {
      id: 'anime',
      nome: 'Anime e mangá',
      palavras: ['anime', 'animes', 'manga', 'mangas', 'otaku', 'one piece', 'naruto', 'crunchyroll']
    },
    {
      id: 'podcasts',
      nome: 'Podcasts e entrevistas',
      palavras: [
        'podcast*', 'entrevista*', 'interview*', 'cortes', 'talk show', 'bate papo', 'bate-papo',
        'videocast'
      ]
    },
    {
      id: 'viagem',
      nome: 'Viagem',
      youtube: ['Travel & Events'],
      palavras: [
        'viagem', 'viagens', 'travel*', 'viajar', 'viajante*', 'mochilao', 'turismo',
        'nomade digital', 'destinos'
      ]
    },
    {
      id: 'carros',
      nome: 'Carros e motos',
      youtube: ['Autos & Vehicles'],
      palavras: [
        'carro', 'carros', 'cars', 'automovel', 'automoveis', 'automotiv*', 'moto', 'motos',
        'motocicl*', 'motorcycle*', 'mecanica', 'mechanic', 'supercarros', 'offroad', 'off-road'
      ]
    },
    {
      id: 'animais',
      nome: 'Animais e pets',
      youtube: ['Pets & Animals'],
      palavras: [
        'animais', 'animal', 'animals', 'pets', 'pet', 'cachorro*', 'dog', 'dogs', 'gato', 'gatos',
        'cats', 'veterinari*', 'wildlife', 'vida selvagem'
      ]
    },
    {
      id: 'arte',
      nome: 'Arte e design',
      palavras: [
        'arte', 'artes', 'art', 'artista*', 'artist', 'desenho*', 'drawing', 'ilustra*',
        'illustration', 'design', 'designer', 'pintura', 'painting', 'aquarela', 'escultura',
        'animacao', 'animation', 'blender', 'photoshop'
      ]
    },
    {
      id: 'diy',
      nome: 'Faça você mesmo',
      palavras: [
        'diy', 'faca voce mesmo', 'marcenaria', 'woodworking', 'maker', 'artesanato', 'bricolagem',
        'restauracao', 'restoration', 'oficina'
      ]
    },
    {
      id: 'saude',
      nome: 'Saúde',
      palavras: [
        'saude', 'health', 'medicina', 'medico', 'medica', 'doctor', 'nutricao', 'nutricionista',
        'nutrition', 'psicologia', 'psicolog*', 'terapia', 'bem estar', 'bem-estar', 'wellness'
      ]
    },
    {
      id: 'idiomas',
      nome: 'Idiomas',
      palavras: [
        'idioma', 'idiomas', 'aprender ingles', 'aulas de ingles', 'ingles fluente', 'language learning',
        'espanhol', 'frances', 'alemao', 'japones', 'coreano', 'fluencia', 'pronuncia'
      ]
    },
    {
      id: 'historia',
      nome: 'História',
      palavras: [
        'historia', 'history', 'historic*', 'historiador*', 'segunda guerra', 'idade media',
        'arqueologia', 'archaeology', 'imperio romano'
      ]
    },
    {
      id: 'livros',
      nome: 'Livros e filosofia',
      palavras: [
        'livro', 'livros', 'book', 'books', 'booktube', 'leitura*', 'literatura', 'literature',
        'filosofia', 'philosophy', 'filosofo*'
      ]
    },
    {
      id: 'moda',
      nome: 'Moda e beleza',
      palavras: [
        'moda', 'fashion', 'beleza', 'beauty', 'maquiagem', 'makeup', 'skincare', 'cabelo',
        'outfit*', 'estilista'
      ]
    },
    {
      id: 'vlogs',
      nome: 'Vlogs',
      youtubeFraco: ['People & Blogs'],
      palavras: ['vlog', 'vlogs', 'vlogger', 'dia a dia', 'rotina', 'daily vlog']
    },
    {
      id: 'entretenimento',
      nome: 'Entretenimento',
      youtubeFraco: ['Entertainment'],
      palavras: ['entretenimento', 'entertainment', 'reality', 'react', 'reacao', 'reagindo']
    }
  ];

  global.YTCatCatalogo = { CATALOGO, CATEGORIAS_YOUTUBE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
