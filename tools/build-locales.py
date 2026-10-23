#!/usr/bin/env python3
"""Generates extension/_locales/*/messages.json from the table below.

Run it after changing any text:  python3 tools/build-locales.py
In the strings, $1, $2... are replaced by the values passed to t(key, ...).
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'extension' / '_locales'

# key: (English, Brazilian Portuguese)
MESSAGES = {
    # Manifest
    'extName': ('Subscriptions Filter', 'Filtro de Inscrições'),
    'extDescription': ('Sort your YouTube subscriptions feed into themes, with filter pills at the top of the page.',
                       'Separa o feed de inscrições do YouTube por temáticas, com pílulas de filtro no topo da página.'),
    'actionTitle': ('Subscriptions Filter: settings', 'Filtro de Inscrições: configurações'),

    # Pill bar
    'pillAll': ('All', 'Todos'),
    'pillUncategorized': ('Uncategorized', 'Sem categoria'),
    'pillTooltip': ('$1: $2 loaded videos', '$1: $2 vídeos carregados'),
    'barImportHint': ('Import your channels to get started', 'Importe seus canais para começar'),
    'barLoadedStatus': ('$1 of $2 loaded videos', '$1 de $2 vídeos carregados'),
    'barSettings': ('Theme settings', 'Configurar temáticas'),

    # Import panel on YouTube
    'importerIntro': ('Import this channel list to sort your channels into themes.',
                      'Importe esta lista de canais para classificá-los por temática.'),
    'importerImport': ('Import channels', 'Importar canais'),
    'importerRetry': ('Try again', 'Tentar de novo'),
    'importerClose': ('Close', 'Fechar'),
    'importerOpenSettings': ('Open settings', 'Abrir configurações'),
    'importerWaiting': ('Waiting for the channel list to load…', 'Esperando a lista de canais carregar…'),
    'importerNoList': ("Couldn't find the channel list on this page. Make sure you're signed in to YouTube.",
                       'Não encontrei a lista de canais nesta página. Confira se você está conectado ao YouTube.'),
    'importerScrolling': ('Scrolling to load every channel… $1 found.',
                          'Rolando a página para carregar todos os canais… $1 encontrados.'),
    'importerNoChannels': ("Couldn't find any channels on this page. YouTube may have changed its layout.",
                           'Não encontrei canais nesta página. O YouTube pode ter mudado o layout.'),
    'importerReadingCategories': ("Reading each channel's YouTube category… $1 of $2.",
                                  'Lendo a categoria de cada canal no YouTube… $1 de $2.'),
    'importerDone': ('Done: $1 channels read ($2 new).', 'Pronto: $1 canais lidos ($2 novos).'),
    'importerCategoriesRead': ('YouTube category read for $1 of $2.', 'Categoria do YouTube lida para $1 de $2.'),
    'importerStoppedEarly': ('Stopped before the end ($1); import again later to finish.',
                             'Parei antes do fim ($1); importe de novo mais tarde para completar.'),
    'importerSuggestions': ('Found $1 new themes to suggest; see the settings.',
                            'Encontrei $1 temáticas novas para sugerir; veja nas configurações.'),
    'importerUncategorized': ('$1 channels are uncategorized; review them in the settings.',
                              '$1 canais ficaram sem categoria; revise nas configurações.'),
    'importerError': ('Something went wrong during the import: $1', 'Algo deu errado na importação: $1'),
    'errorRateLimited': ('YouTube asked for a pause', 'o YouTube pediu uma pausa'),
    'errorTooManyFailures': ('too many failures in a row', 'muitas falhas seguidas'),

    # Settings page: static texts
    'optSubtitle': ('Sort your YouTube subscriptions feed into themes.',
                    'Separe o feed de inscrições do YouTube por temática.'),
    'optPermissionTitle': ('Access to YouTube is still needed', 'Falta liberar o acesso ao YouTube'),
    'optPermissionText': ("Without it the extension can't show the pills or import your channels. In Safari's prompt, choose “Always Allow on This Website”.",
                          'Sem ele a extensão não consegue mostrar as pílulas nem importar seus canais. Na janela do Safari, escolha “Sempre Permitir Neste Site”.'),
    'optPermissionHelp': ("If no prompt appeared, allow it manually: Safari › Settings › Extensions › Subscriptions Filter › Edit Websites…, and set youtube.com to Allow.",
                          'Se a janela não apareceu, libere manualmente: Safari › Ajustes › Extensões › Filtro de Inscrições › Editar Sites…, e marque Permitir para youtube.com.'),
    'optPermissionButton': ('Allow access to YouTube', 'Permitir acesso ao YouTube'),
    'optWelcomeTitle': ('Getting started', 'Primeiros passos'),
    'optWelcomeStep1': ('Import the channels you are subscribed to.', 'Importe a lista de canais em que você é inscrito.'),
    'optWelcomeStep2': ('Check the suggested themes and their keywords.', 'Confira as temáticas sugeridas e as palavras-chave de cada uma.'),
    'optWelcomeStep3': ('Review the automatic classification and adjust what you need.',
                        'Revise a classificação automática e ajuste o que precisar.'),
    'optWelcomeThen': ('Then open your', 'Depois, abra o seu'),
    'optWelcomeFeedLink': ('subscriptions feed', 'feed de inscrições'),
    'optChannelsTitle': ('Your channels', 'Seus canais'),
    'optImportYoutube': ('Import from YouTube', 'Importar do YouTube'),
    'optImportCsv': ('Import Google Takeout CSV', 'Importar CSV do Google Takeout'),
    'optImportHelp': ("“Import from YouTube” opens your channel list in a new tab. The extension scrolls through it, reads each channel's name, @handle and description, and then the official YouTube category of its recent videos (about two minutes for 150 channels). Keep the tab open until it says “Done”. Importing again updates the list without undoing your manual changes.",
                      '“Importar do YouTube” abre a lista dos seus canais numa nova aba. A extensão rola a lista sozinha, lê nome, @ e descrição de cada canal e depois a categoria oficial do YouTube dos vídeos recentes (cerca de dois minutos para 150 canais). Deixe a aba aberta até aparecer “Pronto”. Importar de novo atualiza a lista sem desfazer seus ajustes manuais.'),
    'optThemesTitle': ('Themes', 'Temáticas'),
    'optThemesHelp': ("Each theme has comma-separated keywords, searched in the channel's name, @handle, description and video tags, and can use the official YouTube category. Accents and case don't matter. End a keyword with * to accept continuations: invest* matches “investing” and “investor”.",
                      'Cada temática tem palavras-chave, separadas por vírgula, procuradas no nome, no @, na descrição e nas tags dos vídeos dos canais, e pode usar a categoria oficial do YouTube. Acentos e maiúsculas não importam. Termine com * para aceitar continuações: invest* casa “investimentos” e “investidor”.'),
    'optNewTheme': ('+ New theme', '+ Nova temática'),
    'optRestoreDefaults': ('Restore default themes', 'Restaurar temáticas padrão'),
    'optSuggestionsTitle': ('Suggestions based on your channels', 'Sugestões a partir dos seus canais'),
    'optSuggestionsHelp': ('Checked themes are created when you click “Classify automatically”.',
                           'As temáticas marcadas são criadas quando você clicar em “Classificar automaticamente”.'),
    'optWordsHelp': ('Words repeated among uncategorized channels. Click one to create a theme from it:',
                     'Palavras que se repetem entre os canais sem categoria. Clique numa para criar uma temática com ela:'),
    'optClassify': ('Classify automatically', 'Classificar automaticamente'),
    'optIncludeManual': ('Also redo the channels I adjusted by hand', 'Refazer também os canais que ajustei à mão'),
    'optReviewTitle': ('Channel review', 'Revisão dos canais'),
    'optReviewHelp': ("Click a theme to add the channel to it or remove it. Channels adjusted by hand are marked and aren't changed by the automatic classification; use ↺ to send them back to automatic.",
                      'Clique numa temática para incluir ou tirar o canal dela. Canais ajustados à mão ficam marcados e não são alterados pela classificação automática; use ↺ para devolvê-los ao automático.'),
    'optSearchPlaceholder': ('Search channels…', 'Buscar canal…'),
    'optListFilterLabel': ('Show', 'Mostrar'),
    'optOptionsTitle': ('Options', 'Opções'),
    'optHideShorts': ('Hide the Shorts shelf while a filter is on', 'Esconder a prateleira de Shorts quando um filtro estiver ativo'),
    'optShowUncategorized': ('Show the “Uncategorized” pill', 'Mostrar a pílula “Sem categoria”'),
    'optBackupTitle': ('Backup', 'Backup'),
    'optExport': ('Export settings (.json)', 'Exportar configurações (.json)'),
    'optRestoreBackup': ('Restore from a file', 'Restaurar de um arquivo'),

    # Settings page: dynamic texts
    'statusNoChannels': ('No channels imported yet.', 'Nenhum canal importado ainda.'),
    'statusSummary': ('$1 channels saved · $2 uncategorized · $3 adjusted by hand.',
                      '$1 canais salvos · $2 sem categoria · $3 ajustados à mão.'),
    'statusLastImport': ('Last import: $1.', 'Última importação: $1.'),
    'statusLastImportCount': ('Last import: $1 ($2 channels read).', 'Última importação: $1 ($2 canais lidos).'),
    'statusYoutubePartial': ('YouTube category read for $1 of $2 channels; import from YouTube to complete it.',
                             'Categoria do YouTube lida para $1 de $2 canais; importe do YouTube para completar.'),
    'statusYoutubeComplete': ('Every channel has its YouTube category.', 'Todos os canais têm a categoria do YouTube.'),
    'msgImportOpened': ('Opened your YouTube channel list in a new tab. Follow the progress in the corner of the page.',
                        'Abri a lista de canais do YouTube numa nova aba. Acompanhe o progresso no canto da página.'),
    'msgImportFinished': ('Import finished: $1 channels read ($2 new).', 'Importação concluída: $1 canais lidos ($2 novos).'),
    'msgCsvEmpty': ("Couldn't find channels in this file. It must be the subscriptions.csv from Google Takeout.",
                    'Não encontrei canais nesse arquivo. Ele precisa ser o subscriptions.csv do Google Takeout.'),
    'msgCsvImported': ("$1 channels read from the CSV ($2 new). Takeout has no descriptions, so classification uses only the name and @handle; importing from YouTube is usually more accurate.",
                       '$1 canais lidos do CSV ($2 novos). O Takeout não traz descrições, então a classificação usa só nome e @; a importação pelo YouTube costuma acertar mais.'),
    'msgFileError': ("Couldn't read the file: $1", 'Não consegui ler o arquivo: $1'),
    'msgImportFirst': ('Import your channels first.', 'Importe seus canais primeiro.'),
    'msgCreatedThemes': ('Created $1.', 'Criei $1.'),
    'msgClassified': ('$1 channels classified.', '$1 canais classificados.'),
    'msgClassifiedKeptManual': ('$1 channels classified ($2 adjusted by hand were kept).',
                                '$1 canais classificados ($2 ajustados à mão foram mantidos).'),
    'msgUncategorizedLeft': ('$1 left uncategorized.', '$1 ficaram sem categoria.'),
    'msgCreatedFromWord': ('Created $1 and reclassified $2 channels.', 'Criei $1 e reclassifiquei $2 canais.'),
    'msgBackupRestored': ('Backup restored: $1 themes and $2 channels.', 'Backup restaurado: $1 temáticas e $2 canais.'),
    'msgRestoreError': ("Couldn't restore: $1", 'Não consegui restaurar: $1'),
    'errorNotABackup': ("the file doesn't look like a backup from this extension",
                        'o arquivo não parece ser um backup desta extensão'),
    'themeNameLabel': ('Theme name', 'Nome da temática'),
    'themeKeywordsLabel': ('Keywords', 'Palavras-chave'),
    'themeRemove': ('Remove', 'Remover'),
    'themeChannelCount': ('$1 channels', '$1 canais'),
    'themeYoutubeCategory': ('YouTube category: $1', 'Categoria do YouTube: $1'),
    'themeYoutubeWeak': ('$1 (only if nothing else fits)', '$1 (só se nada mais encaixar)'),
    'suggestionDismiss': ('Dismiss', 'Ignorar'),
    'suggestionDismissTitle': ('Stop suggesting this theme', 'Não sugerir mais esta temática'),
    'suggestionDetail': ('$1 channels · $2', '$1 canais · $2'),
    'wordTitle': ('$1 uncategorized channels have this word', '$1 canais sem categoria têm esta palavra'),
    'listAllChannels': ('All channels', 'Todos os canais'),
    'listUncategorized': ('Uncategorized', 'Sem categoria'),
    'listManual': ('Adjusted by hand', 'Ajustados à mão'),
    'listCount': ('$1 of $2', '$1 de $2'),
    'listShowingLimit': ('Showing $1 of $2; use the search to find the rest.',
                         'Mostrando $1 de $2; use a busca para achar os demais.'),
    'listEmptyNoImport': ('Channels show up here after the import.', 'Os canais aparecem aqui depois da importação.'),
    'listEmptyFilter': ('No channels match this filter.', 'Nenhum canal com esse filtro.'),
    'channelNoName': ('(no name)', '(sem nome)'),
    'channelManual': ('manual', 'manual'),
    'channelBackToAuto': ('Back to automatic classification', 'Voltar para a classificação automática'),
    'channelDelete': ('Delete this channel from the list', 'Apagar este canal da lista'),
    'promptNewTheme': ('Name of the new theme:', 'Nome da nova temática:'),
    'promptThemeFromWord': ('Name of the new theme (it will search for “$1”):', 'Nome da nova temática (vai procurar por “$1”):'),
    'confirmRemoveTheme': ('Remove the theme “$1”? Its channels won\'t be deleted.',
                           'Remover a temática “$1”? Os canais dela não serão apagados.'),
    'confirmRestoreDefaults': ('Replace your themes and keywords with the default ones (Technology, RuneScape, Investing, Politics)?',
                               'Substituir suas temáticas e palavras-chave pelas padrão (Tecnologia, RuneScape, Investimentos, Política)?'),
    'confirmIncludeManual': ('This undoes all manual adjustments. Continue?', 'Isso desfaz todos os ajustes manuais. Continuar?'),
    'confirmDeleteChannel': ('Delete “$1” from the list? It comes back if you import again and are still subscribed.',
                             'Apagar “$1” da lista? Ele volta se você importar de novo e ainda for inscrito.'),
    'confirmRestoreBackup': ('Replace the current themes, channels and options with the ones in the file?',
                             'Substituir as temáticas, canais e opções atuais pelos do arquivo?'),

    # Theme names (catalog ids, with "-" as "_")
    'theme_technology': ('Technology', 'Tecnologia'),
    'theme_runescape': ('RuneScape', 'RuneScape'),
    'theme_investing': ('Investing', 'Investimentos'),
    'theme_politics': ('Politics', 'Política'),
    'theme_music': ('Music', 'Música'),
    'theme_gaming': ('Gaming', 'Games'),
    'theme_science': ('Science', 'Ciência'),
    'theme_education': ('Education', 'Educação'),
    'theme_comedy': ('Comedy', 'Humor'),
    'theme_sports': ('Sports', 'Esportes'),
    'theme_combat_sports': ('Combat sports', 'Lutas'),
    'theme_fitness': ('Fitness', 'Fitness e treino'),
    'theme_cooking': ('Cooking', 'Culinária'),
    'theme_movies_tv': ('Movies & TV', 'Cinema e séries'),
    'theme_anime': ('Anime & manga', 'Anime e mangá'),
    'theme_podcasts': ('Podcasts & interviews', 'Podcasts e entrevistas'),
    'theme_travel': ('Travel', 'Viagem'),
    'theme_cars': ('Cars & motorcycles', 'Carros e motos'),
    'theme_animals': ('Animals & pets', 'Animais e pets'),
    'theme_art_design': ('Art & design', 'Arte e design'),
    'theme_diy': ('DIY', 'Faça você mesmo'),
    'theme_health': ('Health', 'Saúde'),
    'theme_languages': ('Languages', 'Idiomas'),
    'theme_history': ('History', 'História'),
    'theme_books': ('Books & philosophy', 'Livros e filosofia'),
    'theme_fashion_beauty': ('Fashion & beauty', 'Moda e beleza'),
    'theme_vlogs': ('Vlogs', 'Vlogs'),
    'theme_entertainment': ('Entertainment', 'Entretenimento'),
}

LOCALES = {'en': 0, 'pt_BR': 1}


def entry(text):
    """Turns $1, $2... into named placeholders, which every browser supports."""
    numbers = sorted(set(re.findall(r'\$(\d)', text)))
    out = {'message': re.sub(r'\$(\d)', r'$P\1$', text)}
    if numbers:
        out['placeholders'] = {f'p{n}': {'content': f'${n}'} for n in numbers}
    return out


for locale, column in LOCALES.items():
    folder = ROOT / locale
    folder.mkdir(parents=True, exist_ok=True)
    data = {key: entry(texts[column]) for key, texts in MESSAGES.items()}
    (folder / 'messages.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{locale}: {len(data)} messages')
