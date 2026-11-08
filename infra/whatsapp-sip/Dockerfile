# Ponte do WhatsApp (Z-API) para a telefonia do Prospect Team (LiveKit).
# Asterisk do Ubuntu 24.04; a configuração sai dos modelos com as variáveis do .env.
FROM ubuntu:24.04
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends asterisk asterisk-modules gettext-base ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY modelos/ /modelos/
COPY iniciar.sh /iniciar.sh
RUN chmod +x /iniciar.sh
ENTRYPOINT ["/iniciar.sh"]
