#!/bin/bash
#
# Gera o app de Mac que contém a extensão e o instala em ~/Applications,
# tudo pela linha de comando. O Xcode precisa estar instalado, mas não
# precisa ser aberto.
#
# Uso:
#   ./instalar.sh                 assina com seu Apple ID, se houver um certificado
#                                 "Apple Development" no Mac; senão gera sem assinatura
#   TEAM_ID=ABCDE12345 ./instalar.sh   força um time de assinatura específico
#   SEM_ASSINATURA=1 ./instalar.sh     gera sem assinatura
#
# Rode de novo sempre que atualizar os arquivos da pasta extensao/.

set -euo pipefail

RAIZ="$(cd "$(dirname "$0")" && pwd)"
APP_NOME="Subscriptions Filter"
BUNDLE_ID="${BUNDLE_ID:-io.github.yaskepalhares.subscriptions-filter}"
BUILD="$RAIZ/build"
PROJETO_DIR="$BUILD/xcode"
DERIVADOS="$BUILD/derivados"
DESTINO="$HOME/Applications"

passo() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
falha() { printf '\n\033[31mErro:\033[0m %s\n' "$1" >&2; exit 1; }

# -----------------------------------------------------------------------------
passo "Conferindo o Xcode"

[[ "$(uname)" == "Darwin" ]] || falha "este script só roda no macOS."
command -v xcodebuild >/dev/null || falha "xcodebuild não encontrado. Instale o Xcode pela App Store."

DEV_DIR="$(xcode-select -p 2>/dev/null || true)"
if [[ "$DEV_DIR" == *CommandLineTools* || -z "$DEV_DIR" ]]; then
  falha "o sistema está usando só as Command Line Tools, não o Xcode completo.
Rode uma vez:  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
e depois:      sudo xcodebuild -license accept"
fi

xcrun --find safari-web-extension-converter >/dev/null 2>&1 \
  || falha "o conversor de extensões do Safari não foi encontrado nesta versão do Xcode."
echo "Xcode em: $DEV_DIR"

# -----------------------------------------------------------------------------
passo "Gerando o projeto do Xcode"

rm -rf "$PROJETO_DIR"
mkdir -p "$PROJETO_DIR"

AJUDA="$(xcrun safari-web-extension-converter --help 2>&1 || true)"
tem_opcao() { grep -q -- "$1" <<<"$AJUDA"; }

OPCOES=(
  --project-location "$PROJETO_DIR"
  --app-name "$APP_NOME"
  --bundle-identifier "$BUNDLE_ID"
)
# As opções variam entre versões do Xcode; só usamos as que existem.
if tem_opcao '--macos-only'; then OPCOES+=(--macos-only)
elif tem_opcao '--mac-only'; then OPCOES+=(--mac-only); fi
for opcao in --swift --copy-resources --no-open --no-prompt --force; do
  if tem_opcao "$opcao"; then OPCOES+=("$opcao"); fi
done

# "yes" responde à confirmação nas versões que não têm --no-prompt.
{ yes || true; } | xcrun safari-web-extension-converter "${OPCOES[@]}" "$RAIZ/extensao" >/dev/null

PROJETO="$(find "$PROJETO_DIR" -maxdepth 3 -name '*.xcodeproj' | head -n 1)"
[[ -n "$PROJETO" ]] || falha "o conversor não gerou um projeto do Xcode."
echo "Projeto: $PROJETO"

# O conversor monta o identificador do app a partir do nome ("…Subscriptions-Filter")
# e o da extensão a partir do --bundle-identifier, e os dois deixam de casar.
# Aqui alinhamos: app = $BUNDLE_ID e extensão = $BUNDLE_ID.Extension.
BID="$BUNDLE_ID" perl -pi -e '
  if (/PRODUCT_BUNDLE_IDENTIFIER = /) {
    if (/\.Extension"?;/) { s/(PRODUCT_BUNDLE_IDENTIFIER = ).*;/$1"$ENV{BID}.Extension";/ }
    else                  { s/(PRODUCT_BUNDLE_IDENTIFIER = ).*;/$1"$ENV{BID}";/ }
  }' "$PROJETO/project.pbxproj"

ESQUEMAS="$(xcodebuild -list -project "$PROJETO" 2>/dev/null | sed -n '/Schemes:/,$p' | tail -n +2 | sed 's/^ *//' | grep -v '^$' || true)"
ESQUEMA="$(grep -i 'macos' <<<"$ESQUEMAS" | head -n 1 || true)"
[[ -n "$ESQUEMA" ]] || ESQUEMA="$(head -n 1 <<<"$ESQUEMAS")"
[[ -n "$ESQUEMA" ]] || falha "não encontrei o esquema de build do app."
echo "Esquema: $ESQUEMA"

# -----------------------------------------------------------------------------
passo "Escolhendo a assinatura"

if [[ -z "${TEAM_ID:-}" && -z "${SEM_ASSINATURA:-}" ]]; then
  # 1) Times das contas cadastradas no Xcode (Settings › Accounts). O nome da
  #    chave muda entre versões do Xcode, então procuramos em todas as preferências.
  TEAM_ID="$(defaults read com.apple.dt.Xcode 2>/dev/null \
    | sed -n 's/.*teamID = "*\([A-Z0-9]\{10\}\)"*;.*/\1/p' | head -n 1 || true)"
fi
if [[ -z "${TEAM_ID:-}" && -z "${SEM_ASSINATURA:-}" ]]; then
  # 2) Campo OU de um certificado "Apple Development" já existente.
  TEAM_ID="$(security find-certificate -a -c "Apple Development" -p 2>/dev/null \
    | openssl x509 -noout -subject 2>/dev/null \
    | sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p' | head -n 1 || true)"
fi

if [[ -n "${TEAM_ID:-}" && -z "${SEM_ASSINATURA:-}" ]]; then
  echo "Assinando com o time $TEAM_ID (a extensão fica instalada de vez)."
  ASSINATURA=(-allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic)
else
  echo "Sem certificado de desenvolvedor: gerando sem assinatura."
  echo "O Safari vai exigir 'Permitir extensões não assinadas' a cada vez que for aberto."
  echo "Para evitar isso, entre com seu Apple ID no Xcode (Settings › Accounts) e rode de novo."
  ASSINATURA=(CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER=)
fi

# -----------------------------------------------------------------------------
passo "Compilando (pode levar um minuto)"

LOG="$BUILD/build.log"
compilar() {
  xcodebuild \
    -project "$PROJETO" \
    -scheme "$ESQUEMA" \
    -configuration Release \
    -destination 'generic/platform=macOS' \
    -derivedDataPath "$DERIVADOS" \
    "$@" \
    build >"$LOG" 2>&1
}

if ! compilar "${ASSINATURA[@]}"; then
  if [[ -n "${TEAM_ID:-}" && -z "${SEM_ASSINATURA:-}" ]]; then
    echo "A compilação assinada falhou; tentando de novo sem assinatura."
    grep -E 'error:' "$LOG" | head -n 5 || true
    SEM_ASSINATURA=1
    compilar CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= \
      || { grep -E 'error:' "$LOG" | head -n 15 >&2 || true; falha "a compilação falhou. Log completo: $LOG"; }
  else
    grep -E 'error:' "$LOG" | head -n 15 >&2 || true
    falha "a compilação falhou. Log completo: $LOG"
  fi
fi

APP="$(find "$DERIVADOS/Build/Products/Release" -maxdepth 1 -name '*.app' | head -n 1)"
[[ -n "$APP" ]] || falha "não encontrei o app compilado em $DERIVADOS."

# -----------------------------------------------------------------------------
passo "Instalando em $DESTINO"

mkdir -p "$DESTINO"
NOME_APP="$(basename "$APP")"
pkill -x "${NOME_APP%.app}" 2>/dev/null || true
rm -rf "${DESTINO:?}/${NOME_APP:?}"
cp -R "$APP" "$DESTINO/"
# Abrir o app uma vez registra a extensão no Safari.
open "$DESTINO/$NOME_APP"

cat <<FIM

Pronto! O app "$NOME_APP" foi instalado em $DESTINO.

Agora, no Safari:
  1. Safari › Ajustes… › Extensões: marque "Filtro de Inscrições".
  2. Permita o acesso a youtube.com (em "Editar Sites…" ou pelo ícone da extensão).
FIM
if [[ -z "${TEAM_ID:-}" || -n "${SEM_ASSINATURA:-}" ]]; then
  cat <<FIM
  Se a extensão não aparecer: Ajustes › Avançado › "Mostrar recursos para
  desenvolvedores web"; depois Ajustes › Desenvolvedor › "Permitir extensões
  não assinadas".
FIM
fi
