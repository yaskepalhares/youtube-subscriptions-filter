#!/bin/bash
#
# Builds the macOS app that contains the extension and installs it in
# ~/Applications, all from the command line. Xcode must be installed, but it
# does not need to be opened.
#
# Usage:
#   ./install.sh                       signs with your Apple ID if Xcode has an
#                                      account; otherwise builds unsigned
#   TEAM_ID=ABCDE12345 ./install.sh    forces a specific signing team
#   NO_SIGNING=1 ./install.sh          builds unsigned
#
# Run it again whenever the files in extension/ change.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="Subscriptions Filter"
BUNDLE_ID="${BUNDLE_ID:-io.github.yaskepalhares.subscriptions-filter}"
BUILD="$ROOT/build"
PROJECT_DIR="$BUILD/xcode"
DERIVED="$BUILD/derived"
DEST="$HOME/Applications"
NO_SIGNING="${NO_SIGNING:-${SEM_ASSINATURA:-}}"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mError:\033[0m %s\n' "$1" >&2; exit 1; }

# -----------------------------------------------------------------------------
step "Checking Xcode"

[[ "$(uname)" == "Darwin" ]] || fail "this script only runs on macOS."
command -v xcodebuild >/dev/null || fail "xcodebuild not found. Install Xcode from the App Store."

DEV_DIR="$(xcode-select -p 2>/dev/null || true)"
if [[ "$DEV_DIR" == *CommandLineTools* || -z "$DEV_DIR" ]]; then
  fail "the system is using only the Command Line Tools, not the full Xcode.
Run once:  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
and then:  sudo xcodebuild -license accept"
fi

xcrun --find safari-web-extension-converter >/dev/null 2>&1 \
  || fail "the Safari extension converter was not found in this Xcode version."
echo "Xcode at: $DEV_DIR"

# -----------------------------------------------------------------------------
step "Generating the Xcode project"

rm -rf "$PROJECT_DIR"
mkdir -p "$PROJECT_DIR"

HELP="$(xcrun safari-web-extension-converter --help 2>&1 || true)"
has_option() { grep -q -- "$1" <<<"$HELP"; }

OPTIONS=(
  --project-location "$PROJECT_DIR"
  --app-name "$APP_NAME"
  --bundle-identifier "$BUNDLE_ID"
)
# Options vary between Xcode versions; only the ones that exist are used.
if has_option '--macos-only'; then OPTIONS+=(--macos-only)
elif has_option '--mac-only'; then OPTIONS+=(--mac-only); fi
for option in --swift --copy-resources --no-open --no-prompt --force; do
  if has_option "$option"; then OPTIONS+=("$option"); fi
done

# "yes" answers the confirmation in versions without --no-prompt.
{ yes || true; } | xcrun safari-web-extension-converter "${OPTIONS[@]}" "$ROOT/extension" >/dev/null

PROJECT="$(find "$PROJECT_DIR" -maxdepth 3 -name '*.xcodeproj' | head -n 1)"
[[ -n "$PROJECT" ]] || fail "the converter did not create an Xcode project."
echo "Project: $PROJECT"

# The converter derives the app identifier from the app name ("...Subscriptions-Filter")
# and the extension's from --bundle-identifier, so they stop matching.
# Align them: app = $BUNDLE_ID and extension = $BUNDLE_ID.Extension.
BID="$BUNDLE_ID" perl -pi -e '
  if (/PRODUCT_BUNDLE_IDENTIFIER = /) {
    if (/\.Extension"?;/) { s/(PRODUCT_BUNDLE_IDENTIFIER = ).*;/$1"$ENV{BID}.Extension";/ }
    else                  { s/(PRODUCT_BUNDLE_IDENTIFIER = ).*;/$1"$ENV{BID}";/ }
  }' "$PROJECT/project.pbxproj"

SCHEMES="$(xcodebuild -list -project "$PROJECT" 2>/dev/null | sed -n '/Schemes:/,$p' | tail -n +2 | sed 's/^ *//' | grep -v '^$' || true)"
SCHEME="$(grep -i 'macos' <<<"$SCHEMES" | head -n 1 || true)"
[[ -n "$SCHEME" ]] || SCHEME="$(head -n 1 <<<"$SCHEMES")"
[[ -n "$SCHEME" ]] || fail "could not find the app's build scheme."
echo "Scheme: $SCHEME"

# -----------------------------------------------------------------------------
step "Choosing the signing identity"

if [[ -z "${TEAM_ID:-}" && -z "$NO_SIGNING" ]]; then
  # 1) Teams of the accounts added to Xcode (Settings › Accounts). The key name
  #    changes between Xcode versions, so all preferences are searched.
  TEAM_ID="$(defaults read com.apple.dt.Xcode 2>/dev/null \
    | sed -n 's/.*teamID = "*\([A-Z0-9]\{10\}\)"*;.*/\1/p' | head -n 1 || true)"
fi
if [[ -z "${TEAM_ID:-}" && -z "$NO_SIGNING" ]]; then
  # 2) OU field of an existing "Apple Development" certificate.
  TEAM_ID="$(security find-certificate -a -c "Apple Development" -p 2>/dev/null \
    | openssl x509 -noout -subject 2>/dev/null \
    | sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p' | head -n 1 || true)"
fi

if [[ -n "${TEAM_ID:-}" && -z "$NO_SIGNING" ]]; then
  echo "Signing with team $TEAM_ID."
  SIGNING=(-allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic)
else
  echo "No developer account found: building unsigned."
  echo "Safari will require 'Allow unsigned extensions' every time it is opened."
  echo "To avoid that, add your Apple ID to Xcode (Settings › Accounts) and run this again."
  SIGNING=(CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER=)
fi

# -----------------------------------------------------------------------------
step "Building (this can take a minute)"

# Version shown in Safari's settings, taken from the extension's manifest.
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/extension/manifest.json" | head -n 1)"
VERSION="${VERSION:-1.0}"

LOG="$BUILD/build.log"
build() {
  xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration Release \
    -destination 'generic/platform=macOS' \
    -derivedDataPath "$DERIVED" \
    MARKETING_VERSION="$VERSION" \
    CURRENT_PROJECT_VERSION="$VERSION" \
    "$@" \
    build >"$LOG" 2>&1
}

if ! build "${SIGNING[@]}"; then
  if [[ -n "${TEAM_ID:-}" && -z "$NO_SIGNING" ]]; then
    echo "The signed build failed; trying again without signing."
    grep -E 'error:' "$LOG" | head -n 5 || true
    NO_SIGNING=1
    build CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= \
      || { grep -E 'error:' "$LOG" | head -n 15 >&2 || true; fail "the build failed. Full log: $LOG"; }
  else
    grep -E 'error:' "$LOG" | head -n 15 >&2 || true
    fail "the build failed. Full log: $LOG"
  fi
fi

APP="$(find "$DERIVED/Build/Products/Release" -maxdepth 1 -name '*.app' | head -n 1)"
[[ -n "$APP" ]] || fail "could not find the built app in $DERIVED."

# -----------------------------------------------------------------------------
step "Installing version $VERSION in $DEST"

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
EXTENSION_ID="$BUNDLE_ID.Extension"

# Unregisters a copy of the app (and its extension) from macOS, so Safari
# stops loading it.
unregister() {
  local app="$1"
  for appex in "$app"/Contents/PlugIns/*.appex; do
    [[ -d "$appex" ]] && pluginkit -r "$appex" >/dev/null 2>&1 || true
  done
  [[ -x "$LSREGISTER" ]] && "$LSREGISTER" -u "$app" >/dev/null 2>&1 || true
}

mkdir -p "$DEST"
APP_FILE="$(basename "$APP")"
INSTALLED="$DEST/$APP_FILE"
pkill -x "${APP_FILE%.app}" 2>/dev/null || true
rm -rf "${INSTALLED:?}"
cp -R "$APP" "$DEST/"

# Removes every other copy of this extension known to macOS (older installs,
# Xcode build folders), otherwise Safari runs two versions at the same time.
OTHERS="$(pluginkit -mAvvv -i "$EXTENSION_ID" 2>/dev/null \
  | sed -n 's/^ *Path = \(.*\.app\)\/Contents\/PlugIns\/.*\.appex$/\1/p' | sort -u || true)"
# Build products from this script, including the folder used by version 0.4.
for app in "$APP" "$BUILD"/derivados/Build/Products/*/*.app; do
  [[ -d "$app" ]] && OTHERS+=$'\n'"$app"
done
REMOVED=0
while IFS= read -r app; do
  [[ -z "$app" || "$app" == "$INSTALLED" ]] && continue
  unregister "$app"
  REMOVED=$((REMOVED + 1))
  # Copies inside this project's build folder are deleted; others are only
  # unregistered and reported.
  if [[ "$app" == "$BUILD"/* ]]; then
    rm -rf "${app:?}"
  else
    echo "Unregistered an older copy at: $app (you can delete it)"
  fi
done < <(printf '%s\n' "$OTHERS" | sort -u)
rm -rf "${BUILD:?}/derivados"
[[ "$REMOVED" -gt 0 ]] && echo "Removed $REMOVED older copy/copies of the extension."

# Registers the installed app with the system and opens it once so Safari sees
# the extension. Right after replacing the app, "open" sometimes fails (error
# -600); retry, and if it still fails just warn: the extension is registered.
[[ -x "$LSREGISTER" ]] && "$LSREGISTER" -f "$INSTALLED" >/dev/null 2>&1 || true
OPENED=""
for _ in 1 2 3; do
  sleep 1
  if open "$DEST/$APP_FILE" 2>/dev/null; then OPENED=1; break; fi
done
[[ -n "$OPENED" ]] || echo "Note: could not open the app automatically. Open \"$APP_FILE\" in $DEST once."

cat <<END

Done! "$APP_FILE" was installed in $DEST.

Now, in Safari:
  1. Safari › Settings… › Extensions: turn on "Subscriptions Filter".
  2. Allow access to youtube.com (in "Edit Websites…" or from the extension's icon).
END
if [[ -z "${TEAM_ID:-}" || -n "$NO_SIGNING" ]]; then
  cat <<END
  If the extension does not show up: Settings › Advanced › "Show features for
  web developers"; then Settings › Developer › "Allow unsigned extensions".
END
fi
