# Open Source Checklist

Use this checklist before pushing the project to GitHub.

## Keep

- `server.py`
- `openai_sentinel_token.cjs`
- `static/`
- `deploy/`
- `.env.example`
- `.gitignore`
- `README.md`
- `SECURITY.md`
- `CHANGELOG.md`
- `package.json`
- `package-lock.json`

## Do Not Commit

- `data/`
- `.cache/`
- `.ssh/`
- `node_modules/`
- `output/`
- `release/`
- `extensions/`
- `__pycache__/`
- `*.zip`
- `*.log`
- real `.env` files

## Secret Scan

Before upload, search the clean tree for:

```bash
rg -n "refresh_token|access_token|id_token|MAIL_PICKUP_ADMIN_TOKEN|Bearer |rt_|eyJ|password" .
```

Expected hits should be placeholders, field names, or documentation examples only. Remove any real mailbox credentials, JWTs, CPA management keys, proxy passwords, or admin tokens.

## Runtime Data

The app creates runtime files under `data/`. These files are private server data and can contain mailbox credentials, cached messages, login debug screenshots, and exported auth files. Keep only `data/.keep` in source control.
