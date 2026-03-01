# Warhex Discord Bot

Bot de Discord separado para `Warhex.io` com foco em ranking.

- `/rank` -> Top 10 atual/global
- `w!rank` -> comando por prefixo (texto)

## Setup

1. Copie `.env.example` para `.env`
2. Preencha:
   - `DISCORD_BOT_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_GUILD_ID` (recomendado para testes)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Instale deps:
   - `npm install`
4. Registre comandos:
   - `npm run register`
5. Inicie:
   - `npm start`

## Observacoes

- Use `SUPABASE_SERVICE_ROLE_KEY` apenas no servidor/bot (nunca no client).
- Se definir `GAME_STATUS_URL`, o `/rank atual` tenta consultar esse endpoint JSON.
