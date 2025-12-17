# Meta Ads SaaS (SQLite) — Single Service v3 (Verified)

## What’s fixed vs v2
- ✅ Node syntax error fixed (`["IN"]` string escaping)
- ✅ Added `npm run check` (Node parse check)
- ✅ Pinned Node engines to avoid version surprises

## Render (FREE mode — no paid disk)
Use:
- SQLITE_PATH=/tmp/app.sqlite

Note: DB can reset on redeploy/restart (ok for testing).

## Required ENV on Render
APP_BASE_URL=https://metaauto.onrender.com
META_REDIRECT_URI=https://metaauto.onrender.com/meta/oauth/callback
META_APP_ID=...
META_APP_SECRET=...
JWT_SECRET=...

## Meta Developers
Facebook Login → Settings → Valid OAuth Redirect URIs:
https://metaauto.onrender.com/meta/oauth/callback
