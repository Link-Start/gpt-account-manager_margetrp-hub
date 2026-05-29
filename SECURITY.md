# Security Policy

## Credential Storage

Normal user credentials are stored in the current browser by default:

- Outlook password / client_id / refresh_token
- Temp-mail address JWT
- Mailbox categories
- Cached received messages
- Ignored/deleted local message keys
- CPA warehouse address and management key

These values live in `localStorage`. They are not written to the server by the normal front-page receive-mail flow.

## Server-Side Secrets

Set `MAIL_PICKUP_ADMIN_TOKEN` on any public deployment. Admin pages and admin APIs require this token or a login cookie created through `/login.html`.

Do not commit real values for:

- `MAIL_PICKUP_ADMIN_TOKEN`
- `GPT_ACCOUNT_MANAGER_TEMP_SITE_PASSWORD`
- `GPT_ACCOUNT_MANAGER_PUBLIC_POOL_TOKEN`
- CPA management keys
- Outlook refresh tokens
- temp-mail JWTs

## Public Deployment

Use HTTPS and keep the Python service bound to `127.0.0.1` behind Nginx or another reverse proxy. Do not expose the raw Python server port directly unless you understand the risk.

`/health`, `/network-health`, and `/health.html` are private when `MAIL_PICKUP_ADMIN_TOKEN` is set.

## Mail Deletion

The front-end delete action hides/deletes local cached messages and records ignored message keys so the same cached message does not reappear. It does not delete mail from Microsoft or the temp-mail provider.

## Reporting

If you publish this project, add your preferred security contact here before release.
