# Meta Ads Automation (Single Service) — v4

## Fixes in v4
- UI hash routing fixed: `/#register` now actually opens Register (older build forced Login).
- Fixed JS parse crash in error message containing ["IN"].

## Free mode (no paid disk)
Use:
SQLITE_PATH=/tmp/app.sqlite
(DB resets on redeploy/restart — ok for testing)

## Meta OAuth settings (must match exactly)
Valid OAuth Redirect URI:
https://metaauto.onrender.com/meta/oauth/callback

App Domains:
metaauto.onrender.com

Website URL:
https://metaauto.onrender.com
