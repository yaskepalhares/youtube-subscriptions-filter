/*
 * Catalog of themes the extension can suggest.
 *
 * keywords     searched in the channel name, @handle, description and video tags.
 *              A trailing * matches as a prefix; accents and case are ignored.
 *              Keywords are multilingual on purpose (English and Portuguese).
 * youtube      official YouTube categories that strongly indicate the theme.
 * youtubeWeak  broad categories that only count when nothing else matched.
 *
 * Display names live in _locales/<lang>/messages.json as theme_<id>
 * (with '-' replaced by '_'). The first four entries are the default themes.
 */
(function (global) {
  'use strict';

  // Official YouTube video categories. The API returns the English name; the
  // Portuguese names are kept as aliases just in case.
  const YOUTUBE_CATEGORIES = {
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

  const CATALOG = [
    {
      id: 'technology',
      youtube: ['Science & Technology'],
      keywords: [
        'tecnologia', 'tech', 'tecno*', 'gadget*', 'smartphone*', 'celular*', 'iphone', 'ipad',
        'android', 'apple', 'samsung', 'xiaomi', 'unboxing', 'hardware', 'software', 'computador*',
        'notebook*', 'pc', 'setup', 'linux', 'windows', 'macos', 'macbook', 'programacao',
        'programador*', 'codigo', 'coding', 'developer', 'dev', 'javascript', 'python',
        'inteligencia artificial', 'chatgpt', 'processador*', 'placa de video', 'gpu', 'nvidia',
        'eletronic*', 'informatica', 'startup*', 'technology', 'gadgets', 'reviews tech'
      ]
    },
    {
      id: 'runescape',
      keywords: [
        'runescape', 'rune*', 'osrs', 'rs3', 'old school', 'oldschool', 'gielinor', 'ironman',
        'hcim', 'uim', 'gim', 'pvm', 'skilling', 'zulrah', 'jagex', 'deadman', 'gnome child'
      ]
    },
    {
      id: 'investing',
      keywords: [
        'invest*', 'acoes', 'bolsa de valores', 'bolsa', 'b3', 'dividend*', 'fii', 'fiis',
        'fundos imobiliarios', 'renda fixa', 'renda variavel', 'renda passiva', 'tesouro direto',
        'financ*', 'dinheiro', 'patrimonio', 'aposentadoria', 'economi*', 'mercado financeiro',
        'trader', 'trading', 'day trade', 'stocks', 'etf', 'etfs', 'cripto*', 'bitcoin',
        'valuation', 'educacao financeira', 'riqueza', 'investing', 'investment*',
        'personal finance', 'stock market'
      ]
    },
    {
      id: 'politics',
      youtube: ['News & Politics'],
      keywords: [
        'politic*', 'eleic*', 'eleitora*', 'governo', 'congresso', 'senado',
        'camara dos deputados', 'deputad*', 'senador*', 'presidente', 'stf', 'democracia',
        'esquerda', 'direita', 'jornalismo', 'jornalista', 'jornal', 'noticia*', 'news',
        'geopolitic*', 'analise politica', 'brasilia', 'planalto', 'politics', 'election*',
        'congress', 'government'
      ]
    },
    {
      id: 'music',
      youtube: ['Music'],
      keywords: [
        'musica', 'musicas', 'music', 'musical', 'musico', 'musicos', 'banda', 'band', 'cantor*',
        'singer', 'songwriter', 'rapper', 'rap', 'hip hop', 'trap', 'rock', 'metal', 'jazz',
        'blues', 'samba', 'pagode', 'sertanejo', 'funk', 'mpb', 'forro', 'guitarra', 'guitar*',
        'violao', 'piano', 'pianista', 'bateria', 'drums', 'baterista', 'baixista', 'dj', 'beats',
        'lofi', 'lo-fi', 'vevo', 'records', 'gravadora', 'orquestra', 'orchestra', 'album',
        'discografia', 'clipe oficial', 'official music video', 'songs', 'official audio'
      ]
    },
    {
      id: 'gaming',
      youtube: ['Gaming'],
      keywords: [
        'games', 'game', 'gamer', 'gaming', 'jogos', 'gameplay*', 'playthrough', 'lets play',
        'detonado', 'zerando', 'minecraft', 'fortnite', 'nintendo', 'playstation', 'ps5', 'xbox',
        'steam', 'speedrun*', 'rpg', 'esports', 'e-sports', 'twitch'
      ]
    },
    {
      id: 'science',
      keywords: [
        'ciencia', 'ciencias', 'science', 'cientific*', 'cientista*', 'fisica', 'physics',
        'quimica', 'chemistry', 'biologia', 'biology', 'astronomia', 'astronomy', 'astrofisica',
        'universo', 'matematica', 'math', 'mathematics', 'evolucao', 'divulgacao cientifica',
        'neurociencia', 'experimento*', 'scientist*'
      ]
    },
    {
      id: 'education',
      youtubeWeak: ['Education'],
      keywords: [
        'educacao', 'education', 'aula', 'aulas', 'curso', 'cursos', 'professor*', 'aprenda',
        'aprender', 'enem', 'vestibular', 'concurso*', 'escola', 'estudar', 'estudos', 'explicado'
      ]
    },
    {
      id: 'comedy',
      youtube: ['Comedy'],
      keywords: [
        'humor', 'comedia', 'comedy', 'comediante*', 'stand up', 'standup', 'stand-up', 'sketch*',
        'esquete*', 'piada*', 'zoeira', 'memes', 'meme', 'parodia*', 'parody', 'engracad*'
      ]
    },
    {
      id: 'sports',
      youtube: ['Sports'],
      keywords: [
        'esporte*', 'sports', 'futebol', 'football', 'soccer', 'nba', 'nfl', 'basquete',
        'basketball', 'volei', 'tenis', 'formula 1', 'f1', 'automobilismo', 'ciclismo', 'skate',
        'surf', 'brasileirao', 'champions league'
      ]
    },
    {
      id: 'combat-sports',
      keywords: [
        'jiu jitsu', 'jiu-jitsu', 'jiujitsu', 'bjj', 'grappling', 'mma', 'ufc', 'muay thai',
        'boxe', 'boxing', 'judo', 'karate', 'wrestling', 'lutas', 'lutador*', 'artes marciais',
        'martial arts', 'kickboxing', 'no gi', 'nogi'
      ]
    },
    {
      id: 'fitness',
      keywords: [
        'fitness', 'treino', 'treinos', 'academia', 'musculacao', 'bodybuilding', 'hipertrofia',
        'crossfit', 'workout', 'gym', 'calistenia', 'calisthenics', 'emagrec*', 'personal trainer',
        'powerlifting', 'running', 'maratona', 'corrida de rua', 'training', 'exercise*'
      ]
    },
    {
      id: 'cooking',
      keywords: [
        'culinaria', 'receita*', 'recipe*', 'cozinha', 'cozinhar', 'cooking', 'chef',
        'gastronomia', 'churrasco', 'bbq', 'confeitaria', 'padaria', 'food', 'comida*',
        'restaurante*', 'kitchen', 'baking'
      ]
    },
    {
      id: 'movies-tv',
      youtube: ['Film & Animation'],
      keywords: [
        'cinema', 'filme', 'filmes', 'film', 'films', 'movie', 'movies', 'serie', 'series',
        'tv show', 'netflix', 'hbo', 'critica de cinema', 'trailer*', 'oscar', 'hollywood',
        'cinefilo*'
      ]
    },
    {
      id: 'anime',
      keywords: [
        'anime', 'animes', 'manga', 'mangas', 'otaku', 'one piece', 'naruto', 'crunchyroll'
      ]
    },
    {
      id: 'podcasts',
      keywords: [
        'podcast*', 'entrevista*', 'interview*', 'cortes', 'talk show', 'bate papo', 'bate-papo',
        'videocast'
      ]
    },
    {
      id: 'travel',
      youtube: ['Travel & Events'],
      keywords: [
        'viagem', 'viagens', 'travel*', 'viajar', 'viajante*', 'mochilao', 'turismo',
        'nomade digital', 'destinos'
      ]
    },
    {
      id: 'cars',
      youtube: ['Autos & Vehicles'],
      keywords: [
        'carro', 'carros', 'cars', 'automovel', 'automoveis', 'automotiv*', 'moto', 'motos',
        'motocicl*', 'motorcycle*', 'mecanica', 'mechanic', 'supercarros', 'offroad', 'off-road',
        'motorcycles'
      ]
    },
    {
      id: 'animals',
      youtube: ['Pets & Animals'],
      keywords: [
        'animais', 'animal', 'animals', 'pets', 'pet', 'cachorro*', 'dog', 'dogs', 'gato', 'gatos',
        'cats', 'veterinari*', 'wildlife', 'vida selvagem'
      ]
    },
    {
      id: 'art-design',
      keywords: [
        'arte', 'artes', 'art', 'artista*', 'artist', 'desenho*', 'drawing', 'ilustra*',
        'illustration', 'design', 'designer', 'pintura', 'painting', 'aquarela', 'escultura',
        'animacao', 'animation', 'blender', 'photoshop'
      ]
    },
    {
      id: 'diy',
      keywords: [
        'diy', 'faca voce mesmo', 'marcenaria', 'woodworking', 'maker', 'artesanato', 'bricolagem',
        'restauracao', 'restoration', 'oficina'
      ]
    },
    {
      id: 'health',
      keywords: [
        'saude', 'health', 'medicina', 'medico', 'medica', 'doctor', 'nutricao', 'nutricionista',
        'nutrition', 'psicologia', 'psicolog*', 'terapia', 'bem estar', 'bem-estar', 'wellness',
        'medicine', 'mental health'
      ]
    },
    {
      id: 'languages',
      keywords: [
        'idioma', 'idiomas', 'aprender ingles', 'aulas de ingles', 'ingles fluente',
        'language learning', 'espanhol', 'frances', 'alemao', 'japones', 'coreano', 'fluencia',
        'pronuncia', 'learn english', 'learn spanish', 'language lessons'
      ]
    },
    {
      id: 'history',
      keywords: [
        'historia', 'history', 'historic*', 'historiador*', 'segunda guerra', 'idade media',
        'arqueologia', 'archaeology', 'imperio romano', 'historian'
      ]
    },
    {
      id: 'books',
      keywords: [
        'livro', 'livros', 'book', 'books', 'booktube', 'leitura*', 'literatura', 'literature',
        'filosofia', 'philosophy', 'filosofo*', 'reading'
      ]
    },
    {
      id: 'fashion-beauty',
      keywords: [
        'moda', 'fashion', 'beleza', 'beauty', 'maquiagem', 'makeup', 'skincare', 'cabelo',
        'outfit*', 'estilista'
      ]
    },
    {
      id: 'vlogs',
      youtubeWeak: ['People & Blogs'],
      keywords: [
        'vlog', 'vlogs', 'vlogger', 'dia a dia', 'rotina', 'daily vlog'
      ]
    },
    {
      id: 'entertainment',
      youtubeWeak: ['Entertainment'],
      keywords: [
        'entretenimento', 'entertainment', 'reality', 'react', 'reacao', 'reagindo'
      ]
    }
  ];

  // Theme ids used before version 0.5 (Portuguese) -> current ids.
  const LEGACY_THEME_IDS = {
    'tecnologia': 'technology',
    'runescape': 'runescape',
    'investimentos': 'investing',
    'politica': 'politics',
    'musica': 'music',
    'games': 'gaming',
    'ciencia': 'science',
    'educacao': 'education',
    'humor': 'comedy',
    'esportes': 'sports',
    'lutas': 'combat-sports',
    'fitness': 'fitness',
    'culinaria': 'cooking',
    'cinema': 'movies-tv',
    'anime': 'anime',
    'podcasts': 'podcasts',
    'viagem': 'travel',
    'carros': 'cars',
    'animais': 'animals',
    'arte': 'art-design',
    'diy': 'diy',
    'saude': 'health',
    'idiomas': 'languages',
    'historia': 'history',
    'livros': 'books',
    'moda': 'fashion-beauty',
    'vlogs': 'vlogs',
    'entretenimento': 'entertainment'
  };

  global.YTCatCatalog = { CATALOG, YOUTUBE_CATEGORIES, LEGACY_THEME_IDS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
