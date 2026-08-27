# Release Dock

Воспроизводимый локальный кейс выпуска Node.js-приложения: hardened Docker runtime, healthcheck, writable state volume, SHA-256 backup verification и явный runbook с rollback.

## Локальная проверка

```bash
npm test
docker compose up --build -d
npm run backup
npm run verify
```

Продукт: `http://127.0.0.1:3240/`.

## Честная граница

Кейс подтверждает локальную контейнеризацию и проверяемую резервную копию. Он не заявляет registry push, CI/CD provider, удалённый сервер, домен, TLS, ingress, zero-downtime deployment или проверенный restore в production.
