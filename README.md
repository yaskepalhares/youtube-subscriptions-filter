# YouTube Subscriptions Filter

A Safari extension for macOS that sorts your YouTube **subscriptions feed** into themes. A row of
filter pills appears at the top of [youtube.com/feed/subscriptions](https://www.youtube.com/feed/subscriptions)
so you can see only the videos from, say, your *Music* and *Gaming* channels, without unsubscribing
from anything or reorganizing your account.

The extension reads your subscription list, looks up the official YouTube category of each
channel's recent videos, **suggests themes on its own** (Music, Gaming, Science, Comedy, Cooking,
Podcasts…), and sorts every channel into them. You can rename, create or remove themes and move any
channel by hand. Everything stays on your Mac.

The interface follows your system language. English and Brazilian Portuguese are included.

## Features

- **Filter pills on the subscriptions feed.** *All*, one pill per theme and *Uncategorized*, each
  with the number of loaded videos. Select several themes at once to see videos from any of them;
  unselecting the last one goes back to *All*. The bar stays in view while you scroll, follows the
  system light/dark mode, and remembers your selection.
- **Hide watched videos.** A switch in the pill bar hides the videos you have already watched,
  using the red progress bar YouTube draws under thumbnails (90% or more by default, adjustable in
  the settings). It works together with the theme filters and needs YouTube's watch history on.
- **Hide live and scheduled videos.** Two separate options in the settings hide streams that are
  live right now and scheduled streams or premieres. Finished streams stay, since they are regular
  videos by then.
- **One-click import.** *Import from YouTube* opens your channel list, scrolls through it and reads
  each channel's name, @handle, description and avatar. A Google Takeout `subscriptions.csv` also
  works.
- **Official YouTube categories.** During the import, the extension reads the category (Music,
  Gaming, News & Politics…) and tags of each channel's 3 most recent videos, using small requests to
  YouTube itself. It takes about two minutes for 150 channels.
- **Theme suggestions.** A catalog of ~30 themes is matched against your channels; the settings page
  shows the ones that fit, how many channels each would take, and examples. It also lists words that
  repeat among the channels that are still uncategorized, so you can turn them into new themes.
- **Automatic classification with manual control.** Channels are scored by category and by keywords
  in their name, @handle, description and video tags. A channel can belong to more than one theme.
  Adjusting a channel by hand locks it, so later imports and reclassifications don't undo your
  choice.
- **Backup.** Export and restore your themes and channels as JSON.

## Privacy

All data is kept in Safari's local extension storage. The extension only talks to
`www.youtube.com` (to read your channel list and the categories of public videos), has no
analytics, and sends nothing anywhere else.

## Installation

You need a Mac with **Xcode** installed (free on the Mac App Store). You don't need to open Xcode or
pay for an Apple Developer account.

```bash
git clone https://github.com/yaskepalhares/youtube-subscriptions-filter.git
cd youtube-subscriptions-filter
./install.sh
```

The script builds the macOS app that contains the extension and installs it in `~/Applications`.
Then, in Safari:

1. *Safari › Settings… › Extensions*: turn on **Subscriptions Filter**.
2. Allow access to **youtube.com** (in *Edit Websites…* or from the extension's toolbar icon).
3. The settings page opens on first launch. Click *Import from YouTube*, wait for *Done* in the
   YouTube tab, and review the suggested themes.

**Signing.** If you added your Apple ID to Xcode (*Xcode › Settings › Accounts*, a free account is
enough), the script signs the app with it and Safari keeps the extension enabled. Without an
account, the app is built unsigned and Safari requires *Allow unsigned extensions* (in
*Settings › Developer*, after turning on *Show features for web developers* in *Settings ›
Advanced*) every time it starts.

If the script complains about the *Command Line Tools*, run once:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
```

**Updating:** `git pull && ./install.sh`. Your themes and channels are kept.

### Trying it without building

In *Safari › Settings… › Developer*, click *Add Temporary Extension…* and choose the `extension`
folder. Safari removes temporary extensions after 24 hours or when it quits.

## Development

```
extension/
  manifest.json       Manifest V3
  catalog.js          themes that can be suggested, with keywords and YouTube categories
  shared.js           storage, translations, classifier, suggestions, channel lookup
  content.js          pill bar and filter on /feed/subscriptions; import on /feed/channels
  content.css
  options.html/js/css settings page
  background.js       opens the settings on install and from the toolbar icon
  _locales/           translations (generated, see below)
tools/build-locales.py  source of every interface text, in all languages
tests/test.js         tests on simulated pages (jsdom)
install.sh            builds and installs the app from the command line
```

Run the tests with `npm install && npm test`.

**Translations.** Every interface text lives in `tools/build-locales.py`. Edit it and run
`python3 tools/build-locales.py` to regenerate `extension/_locales`. To add a language, add a column
to the table and an entry to `LOCALES`.

**When YouTube changes its layout.** The selectors are at the top of `extension/content.js`
(`CARD_SELECTOR`, `CARD_CHANNEL_NAME_SELECTORS`, `CHANNEL_LIST_SELECTOR`). To debug, open
*Develop › Show JavaScript Console* in the YouTube tab and look for messages starting with
`[Subscriptions Filter]`; for the settings page use *Develop › Web Extension Inspector*.

## Known limitations

- The feed loads videos from all channels mixed together. With a theme that has few recent videos,
  the page gets short and YouTube loads more gradually; the "X of Y loaded videos" counter shows it.
- Keyword matching gets channels with vague descriptions wrong; that's what manual adjustments are
  for.
- Safari on macOS only for now. The code is a standard Web Extension, so Chrome, Edge and Firefox
  ports need little work.

## License

[MIT](LICENSE)
