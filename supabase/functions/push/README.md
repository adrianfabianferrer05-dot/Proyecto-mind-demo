# `push` Edge Function

Public health/config endpoint:

- `GET /functions/v1/push` → returns the VAPID public key.

Registration:

- `POST` body `{ "action": "subscribe", "code": "<one-time-code>", "subscription": {...} }`.
- The code is stored only as a SHA-256 hash in Postgres and becomes used after a successful test push.

Server-side send:

- `POST` body `{ "action": "send", "title": "...", "body": "...", "url": "/" }`.
- Requires `Authorization: Bearer <server-token>`.

Secrets are resolved from Supabase Vault. Never commit VAPID private keys or sender tokens.
