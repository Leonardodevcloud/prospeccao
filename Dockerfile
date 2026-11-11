# Uma imagem por serviço, a partir do mesmo Dockerfile.
# No Railway, cada serviço define a variável SERVICO (api, worker-cnpj, worker-descoberta,
# worker-enriquecimento ou worker-videos); ela chega aqui como build arg.

FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS build
ARG SERVICO
RUN test -n "$SERVICO" || (echo "Defina SERVICO: api, worker-cnpj, worker-descoberta, worker-enriquecimento ou worker-videos" && exit 1)
COPY . .
RUN pnpm install --frozen-lockfile --filter "@prospeccao/${SERVICO}..."
RUN pnpm --filter "@prospeccao/${SERVICO}" build
# Pasta só com o serviço empacotado e as dependências de produção dele.
RUN pnpm --filter "@prospeccao/${SERVICO}" deploy --prod --legacy /saida

FROM node:22-slim
ARG SERVICO
# A api monta as gravações das reuniões (junta os pedaços que o navegador manda e arruma o arquivo
# para dar para pular no vídeo): precisa do ffmpeg. O worker-videos edita os vídeos: ffmpeg e o
# Chromium que o HyperFrames usa para desenhar a legenda e as animações quadro a quadro.
RUN if [ "$SERVICO" = "api" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*; \
    elif [ "$SERVICO" = "worker-videos" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ffmpeg chromium fonts-liberation ca-certificates \
      && rm -rf /var/lib/apt/lists/*; \
    fi
ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/migrations \
    HYPERFRAMES_NO_TELEMETRY=1 \
    HYPERFRAMES_NO_UPDATE_CHECK=1
WORKDIR /app
COPY --from=build /saida ./
COPY --from=build /repo/packages/db/migrations ./migrations
USER node
CMD ["node", "--enable-source-maps", "dist/main.js"]
