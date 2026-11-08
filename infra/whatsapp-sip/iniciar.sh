#!/bin/sh
# Gera a configuração do Asterisk a partir dos modelos (com as variáveis do .env) e liga.
set -eu
for v in ZAPI_INSTANCIA ZAPI_SIP_TOKEN NUMERO_WHATSAPP LIVEKIT_SIP_HOST IP_PUBLICO SAIDA_USUARIO SAIDA_SENHA; do
  eval "valor=\${$v:-}"
  if [ -z "$valor" ]; then
    echo "Falta $v no .env (veja o LEIAME.md)." >&2
    exit 1
  fi
done
# O número do WhatsApp sempre com +55 (como o LiveKit e o CRM esperam).
NUMERO_WHATSAPP="+55$(echo "$NUMERO_WHATSAPP" | tr -cd '0-9' | sed 's/^55\([0-9]\{10,11\}\)$/\1/')"
export NUMERO_WHATSAPP
: "${RTP_INICIO:=10000}" "${RTP_FIM:=10200}"
export RTP_INICIO RTP_FIM
VARS='$ZAPI_INSTANCIA $ZAPI_SIP_TOKEN $NUMERO_WHATSAPP $LIVEKIT_SIP_HOST $IP_PUBLICO $SAIDA_USUARIO $SAIDA_SENHA $RTP_INICIO $RTP_FIM'
for f in /modelos/*.conf; do
  envsubst "$VARS" < "$f" > "/etc/asterisk/$(basename "$f")"
done
echo "Ponte do WhatsApp: $NUMERO_WHATSAPP (Z-API $ZAPI_INSTANCIA) ↔ LiveKit $LIVEKIT_SIP_HOST"
exec asterisk -f -U asterisk -G asterisk -vvv
