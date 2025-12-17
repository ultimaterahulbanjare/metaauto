# Meta Ads SaaS (SQLite) — Single Service (UI + API in index.js)

This version matches your request:
- **Only 2 code files:** `index.js` + `db.js`
- UI is served from backend at `/` (no separate frontend)
- Deploy on Render from GitHub

## Local run
```bash
cp .env.example .env
npm install
npm run dev
```
Open: http://localhost:8080

## Render deploy (GitHub → Render)
1) Create Render Web Service from your repo
2) Build: `npm install`
3) Start: `npm start`

### IMPORTANT (SQLite persistence)
Add Render **Disk** (recommended):
- Mount path: `/var/data`
Set env:
- `SQLITE_PATH=/var/data/app.sqlite`

### Env Vars on Render
- `APP_BASE_URL=https://YOUR-SERVICE.onrender.com`
- `JWT_SECRET=...`
- `META_APP_ID=...`
- `META_APP_SECRET=...`
- `META_REDIRECT_URI=https://YOUR-SERVICE.onrender.com/meta/oauth/callback`

## Meta Developers settings
Facebook Login → Settings → Valid OAuth Redirect URIs:
- `https://YOUR-SERVICE.onrender.com/meta/oauth/callback`

## Usage
1) Open `/` → Register/Login
2) Connect Meta
3) Go to Launch → select Ad Account, Pixel, Page, LP URL, file, text → Launch
4) Dashboard → spend/clicks/ctr etc.
