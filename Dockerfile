# Uma imagem por serviço, a partir do mesmo Dockerfile.
# No Railway, cada serviço define a variável SERVICO (api, worker-cnpj ou
# worker-descoberta); ela chega aqui como build arg.

FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS build
ARG SERVICO
RUN test -n "$SERVICO" || (echo "Defina SERVICO: api, worker-cnpj ou worker-descoberta" && exit 1)
COPY . .
RUN pnpm install --frozen-lockfile --filter "@prospeccao/${SERVICO}..."
RUN pnpm --filter "@prospeccao/${SERVICO}" build
# Pasta só com o serviço empacotado e as dependências de produção dele.
RUN pnpm --filter "@prospeccao/${SERVICO}" deploy --prod --legacy /saida

FROM node:22-slim
ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/migrations
WORKDIR /app
COPY --from=build /saida ./
COPY --from=build /repo/packages/db/migrations ./migrations
USER node
CMD ["node", "--enable-source-maps", "dist/main.js"]
