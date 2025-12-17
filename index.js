import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import cron from "node-cron";
import FormData from "form-data";
import { v4 as uuidv4 } from "uuid";

import { migrate, run, get, all } from "./db.js";

dotenv.config();
migrate();

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8080;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;

function graphBase() {
  const v = process.env.META_GRAPH_VERSION || "v24.0";
  return `https://graph.facebook.com/${v}`;
}
async function graphGet(path, access_token, params = {}) {
  const url = `${graphBase()}${path}`;
  const res = await axios.get(url, { params: { ...params, access_token } });
  return res.data;
}
async function graphPostParams(path, access_token, params = {}) {
  const url = `${graphBase()}${path}`;
  const res = await axios.post(url, null, { params: { ...params, access_token } });
  return res.data;
}
async function graphPostMultipart(path, access_token, formData) {
  const url = `${graphBase()}${path}`;
  const res = await axios.post(url, formData, {
    headers: formData.getHeaders(),
    params: { access_token }
  });
  return res.data;
}

/** Auth */
function signJwt(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });
}
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
function latestMetaToken(client_id) {
  const row = get(
    "SELECT access_token FROM meta_connections WHERE client_id=? ORDER BY created_at DESC LIMIT 1",
    [client_id]
  );
  return row?.access_token || null;
}
function withUTMs(lp_url) {
  const u = new URL(lp_url);
  u.searchParams.set("utm_source", "meta");
  u.searchParams.set("utm_medium", "paid");
  u.searchParams.set("utm_campaign", "{{campaign.id}}");
  u.searchParams.set("utm_adset", "{{adset.id}}");
  u.searchParams.set("utm_ad", "{{ad.id}}");
  return u.toString();
}

/** ===== UI (Single-page) ===== */
const UI_HTML = `<!doctype html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Meta Ads SaaS</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:0;background:#fff;color:#111}
    header{display:flex;gap:12;align-items:center;padding:12px 16px;border-bottom:1px solid #eee;position:sticky;top:0;background:#fff}
    header b{font-size:16px}
    a{color:#0a66c2;text-decoration:none}
    .wrap{max-width:1100px;margin:0 auto;padding:16px}
    .card{border:1px solid #eee;border-radius:12px;padding:14px;background:#fff}
    .grid{display:grid;gap:12px}
    .grid2{display:grid;gap:12px;grid-template-columns:1fr 1fr}
    input,select,textarea,button{font:inherit;padding:10px;border:1px solid #ddd;border-radius:10px}
    textarea{min-height:90px}
    button{cursor:pointer}
    button.primary{background:#111;color:#fff;border-color:#111}
    button[disabled]{opacity:.55;cursor:not-allowed}
    .msg{white-space:pre-wrap;padding:10px;border-radius:10px}
    .err{background:#fff0f0;border:1px solid #ffd0d0;color:#b00020}
    .ok{background:#f0fff4;border:1px solid #c9f7d5;color:#116329}
    table{width:100%;border-collapse:collapse}
    th,td{padding:10px;border-top:1px solid #eee;text-align:left;font-size:14px}
    thead th{background:#fafafa;border-top:none}
    .muted{color:#666;font-size:13px}
    .row{display:flex;gap:10px;flex-wrap:wrap}
  </style>
</head>
<body>
<header>
  <b>Meta Ads SaaS</b>
  <a href="#login" onclick="nav('login')">Login</a>
  <a href="#register" onclick="nav('register')">Register</a>
  <a href="#meta" onclick="nav('meta')">Connect Meta</a>
  <a href="#launch" onclick="nav('launch')">Launch</a>
  <a href="#dashboard" onclick="nav('dashboard')">Dashboard</a>
  <span style="flex:1"></span>
  <button onclick="logout()">Logout</button>
</header>

<div class="wrap">
  <div id="banner"></div>

  <div id="view-login" class="card" style="display:none">
    <h2 style="margin-top:0">Login</h2>
    <div id="login-msg"></div>
    <div class="grid">
      <input id="login-email" placeholder="Email"/>
      <input id="login-pass" type="password" placeholder="Password"/>
      <button class="primary" onclick="doLogin()">Login</button>
      <div class="muted">No account? <a href="#register" onclick="nav('register')">Register</a></div>
    </div>
  </div>

  <div id="view-register" class="card" style="display:none">
    <h2 style="margin-top:0">Register</h2>
    <div id="register-msg"></div>
    <div class="grid">
      <input id="reg-client" placeholder="Client name (optional)"/>
      <input id="reg-email" placeholder="Email"/>
      <input id="reg-pass" type="password" placeholder="Password (min 8)"/>
      <button class="primary" onclick="doRegister()">Create account</button>
    </div>
  </div>

  <div id="view-meta" class="card" style="display:none">
    <h2 style="margin-top:0">Connect Meta</h2>
    <div class="muted">After connect, you can fetch Ad Accounts / Pixels / Pages.</div>
    <div id="meta-msg"></div>
    <div class="row" style="margin-top:10px">
      <button class="primary" onclick="startMeta()">Connect / Reconnect Meta</button>
      <button onclick="loadAssets()">Load Assets</button>
    </div>
    <h3>Ad Accounts</h3>
    <div id="adaccounts" class="grid"></div>
    <h3 style="margin-top:16px">Pages</h3>
    <div id="pages" class="grid"></div>
  </div>

  <div id="view-launch" class="card" style="display:none">
    <h2 style="margin-top:0">Launch Website Leads</h2>
    <div class="muted">This creates Campaign + AdSet + Ad automatically.</div>
    <div id="launch-msg"></div>

    <div class="grid">
      <input id="c-name" placeholder="Campaign name" value="Website Leads Campaign"/>

      <select id="c-adaccount" onchange="onAdAccountChange()">
        <option value="">Select Ad Account...</option>
      </select>

      <select id="c-pixel">
        <option value="">Select Pixel...</option>
      </select>

      <select id="c-page">
        <option value="">Select Page...</option>
      </select>

      <input id="c-lp" placeholder="Landing page URL (https://...)"/>

      <div class="grid2">
        <input id="c-country" placeholder="Country code" value="IN"/>
        <input id="c-budget" type="number" placeholder="Budget INR/day" value="500"/>
      </div>

      <select id="c-type">
        <option value="image">Image</option>
        <option value="video">Video</option>
      </select>

      <input id="c-file" type="file"/>

      <textarea id="c-text" placeholder="Primary text">Join our Telegram channel for updates.</textarea>
      <input id="c-headline" placeholder="Headline" value="Join Now"/>

      <button class="primary" onclick="launch()" id="btn-launch">Launch</button>
      <div class="muted">Note: Insights will update automatically every N minutes via cron.</div>
    </div>
  </div>

  <div id="view-dashboard" class="card" style="display:none">
    <h2 style="margin-top:0">Dashboard (Meta Insights)</h2>
    <div id="dash-msg"></div>
    <div class="row">
      <button onclick="loadDashboard()">Refresh</button>
    </div>

    <h3>Campaign level</h3>
    <div style="overflow:auto">
      <table>
        <thead><tr>
          <th>Name</th><th>Status</th><th>Spend</th><th>Impr</th><th>Clicks</th><th>CTR</th><th>CPC</th><th>CPM</th>
        </tr></thead>
        <tbody id="tbl-camps"></tbody>
      </table>
    </div>

    <h3 style="margin-top:18px">Ad level</h3>
    <div style="overflow:auto">
      <table>
        <thead><tr>
          <th>Name</th><th>Status</th><th>Spend</th><th>Impr</th><th>Clicks</th><th>CTR</th><th>CPC</th><th>CPM</th>
        </tr></thead>
        <tbody id="tbl-ads"></tbody>
      </table>
    </div>
  </div>

  <div class="muted" style="margin-top:14px">
    <div>App URL: <span id="appurl"></span></div>
  </div>
</div>

<script>
  const appUrlEl = document.getElementById('appurl');
  appUrlEl.textContent = location.origin;

  function token(){ return localStorage.getItem('token'); }
  function setToken(t){ localStorage.setItem('token', t); }
  function clearToken(){ localStorage.removeItem('token'); }

  function showMsg(el, type, text){
    el.innerHTML = text ? '<div class="msg '+(type==='err'?'err':'ok')+'">'+escapeHtml(text)+'</div>' : '';
  }
  function escapeHtml(s){
    return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  }

  async function api(path, opts={}){
    const headers = opts.headers || {};
    if(!(opts.body instanceof FormData)) headers['Content-Type']='application/json';
    const t = token();
    if(t) headers['Authorization']='Bearer '+t;
    const res = await fetch(path, {...opts, headers});
    const txt = await res.text();
    let j = {};
    try{ j = txt ? JSON.parse(txt) : {}; }catch{ j = { raw: txt }; }
    if(!res.ok) throw new Error(j.error || j.details || ('HTTP '+res.status));
    return j;
  }

  function nav(view){
    ['login','register','meta','launch','dashboard'].forEach(v=>{
      document.getElementById('view-'+v).style.display = (v===view) ? '' : 'none';
    });
    if(view==='meta') loadAssets();
    if(view==='dashboard') loadDashboard();
  }

  function logout(){
    clearToken();
    nav('login');
    showMsg(document.getElementById('banner'),'ok','Logged out');
    setTimeout(()=>showMsg(document.getElementById('banner'),'ok',''),1500);
  }

  async function doRegister(){
    const el = document.getElementById('register-msg');
    showMsg(el,'ok','');
    try{
      const clientName = document.getElementById('reg-client').value;
      const email = document.getElementById('reg-email').value;
      const password = document.getElementById('reg-pass').value;
      const r = await api('/auth/register',{method:'POST', body: JSON.stringify({clientName,email,password})});
      setToken(r.token);
      showMsg(el,'ok','Registered! Now connect Meta.');
      nav('meta');
    }catch(e){ showMsg(el,'err', e.message || e); }
  }

  async function doLogin(){
    const el = document.getElementById('login-msg');
    showMsg(el,'ok','');
    try{
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-pass').value;
      const r = await api('/auth/login',{method:'POST', body: JSON.stringify({email,password})});
      setToken(r.token);
      showMsg(el,'ok','Logged in!');
      nav('dashboard');
    }catch(e){ showMsg(el,'err', e.message || e); }
  }

  async function startMeta(){
    const el = document.getElementById('meta-msg');
    showMsg(el,'ok','');
    try{
      const r = await api('/meta/oauth/start');
      location.href = r.url;
    }catch(e){ showMsg(el,'err', e.message || e); }
  }

  async function loadAssets(){
    const el = document.getElementById('meta-msg');
    showMsg(el,'ok','');
    const adEl = document.getElementById('adaccounts');
    const pEl = document.getElementById('pages');
    adEl.innerHTML = ''; pEl.innerHTML='';
    try{
      const a = await api('/meta/ad-accounts');
      const pages = await api('/meta/pages');
      (a.ad_accounts||[]).forEach(x=>{
        const d = document.createElement('div');
        d.className='card';
        d.innerHTML = '<b>'+escapeHtml(x.name)+'</b><div class="muted">'+escapeHtml(x.id)+' · '+escapeHtml(x.currency||'')+'</div>';
        adEl.appendChild(d);
      });
      (pages.pages||[]).forEach(x=>{
        const d = document.createElement('div');
        d.className='card';
        d.innerHTML = '<b>'+escapeHtml(x.name)+'</b><div class="muted">'+escapeHtml(x.id)+'</div>';
        pEl.appendChild(d);
      });
      // Also fill launch selects
      fillLaunchSelects(a.ad_accounts||[], pages.pages||[]);
    }catch(e){
      showMsg(el,'err', e.message || e);
    }
  }

  function fillLaunchSelects(adAccounts, pages){
    const selA = document.getElementById('c-adaccount');
    const selP = document.getElementById('c-page');
    // keep first option
    selA.length = 1;
    selP.length = 1;
    adAccounts.forEach(a=>{
      const o=document.createElement('option');
      o.value=a.id; o.textContent = a.name+' ('+a.id+')';
      selA.appendChild(o);
    });
    pages.forEach(p=>{
      const o=document.createElement('option');
      o.value=p.id; o.textContent = p.name+' ('+p.id+')';
      selP.appendChild(o);
    });
  }

  async function onAdAccountChange(){
    const id = document.getElementById('c-adaccount').value;
    const sel = document.getElementById('c-pixel');
    sel.length = 1;
    if(!id) return;
    try{
      const r = await api('/meta/pixels?ad_account_id='+encodeURIComponent(id));
      (r.pixels||[]).forEach(p=>{
        const o=document.createElement('option');
        o.value=p.id; o.textContent = p.name+' ('+p.id+')';
        sel.appendChild(o);
      });
    }catch(e){
      showMsg(document.getElementById('launch-msg'),'err', e.message || e);
    }
  }

  async function launch(){
    const el = document.getElementById('launch-msg');
    showMsg(el,'ok','');
    const btn = document.getElementById('btn-launch');
    btn.disabled = true;
    try{
      const fd = new FormData();
      const name = document.getElementById('c-name').value;
      const ad_account_id = document.getElementById('c-adaccount').value;
      const pixel_id = document.getElementById('c-pixel').value;
      const page_id = document.getElementById('c-page').value;
      const lp_url = document.getElementById('c-lp').value;
      const country = document.getElementById('c-country').value.toUpperCase();
      const daily_budget_inr = document.getElementById('c-budget').value;
      const creative_type = document.getElementById('c-type').value;
      const primary_text = document.getElementById('c-text').value;
      const headline = document.getElementById('c-headline').value;
      const file = document.getElementById('c-file').files[0];

      if(!file) throw new Error('Select creative file');
      if(!ad_account_id || !pixel_id || !page_id || !lp_url) throw new Error('Fill all required fields');

      fd.append('name', name);
      fd.append('ad_account_id', ad_account_id);
      fd.append('pixel_id', pixel_id);
      fd.append('page_id', page_id);
      fd.append('lp_url', lp_url);
      fd.append('event_name', 'InitiateLead');
      fd.append('country_codes', JSON.stringify([country]));
      fd.append('daily_budget_inr', String(Number(daily_budget_inr)));
      fd.append('creative_type', creative_type);
      fd.append('primary_text', primary_text);
      fd.append('headline', headline);
      fd.append('file', file);

      const r = await api('/campaigns/launch', { method:'POST', body: fd });
      showMsg(el,'ok','Launched!\nMeta Campaign ID: '+r.campaign.meta_campaign_id+'\nMeta Ad ID: '+r.campaign.meta_ad_id);
      nav('dashboard');
    }catch(e){
      showMsg(el,'err', e.message || e);
    }finally{
      btn.disabled = false;
    }
  }

  function td(v){ return (v===null||v===undefined||v==='') ? '-' : String(v); }

  async function loadDashboard(){
    const el = document.getElementById('dash-msg');
    showMsg(el,'ok','');
    const tb1 = document.getElementById('tbl-camps');
    const tb2 = document.getElementById('tbl-ads');
    tb1.innerHTML=''; tb2.innerHTML='';
    try{
      const c = await api('/reports/campaigns');
      const a = await api('/reports/ads');
      (c.rows||[]).forEach(r=>{
        const tr=document.createElement('tr');
        tr.innerHTML = '<td>'+escapeHtml(r.name)+'</td><td>'+escapeHtml(r.status)+'</td><td>'+td(r.spend)+'</td><td>'+td(r.impressions)+'</td><td>'+td(r.clicks)+'</td><td>'+td(r.ctr)+'</td><td>'+td(r.cpc)+'</td><td>'+td(r.cpm)+'</td>';
        tb1.appendChild(tr);
      });
      if((c.rows||[]).length===0){ const tr=document.createElement('tr'); tr.innerHTML='<td colspan="8" class="muted">No data yet.</td>'; tb1.appendChild(tr); }

      (a.rows||[]).forEach(r=>{
        const tr=document.createElement('tr');
        tr.innerHTML = '<td>'+escapeHtml(r.name)+'</td><td>'+escapeHtml(r.status)+'</td><td>'+td(r.spend)+'</td><td>'+td(r.impressions)+'</td><td>'+td(r.clicks)+'</td><td>'+td(r.ctr)+'</td><td>'+td(r.cpc)+'</td><td>'+td(r.cpm)+'</td>';
        tb2.appendChild(tr);
      });
      if((a.rows||[]).length===0){ const tr=document.createElement('tr'); tr.innerHTML='<td colspan="8" class="muted">No data yet.</td>'; tb2.appendChild(tr); }
    }catch(e){
      showMsg(el,'err', e.message || e);
    }
  }

  // initial route
  const qs = new URLSearchParams(location.search);
  if(qs.get('meta')==='ok') showMsg(document.getElementById('banner'),'ok','Meta connected ✅');
  if(qs.get('meta')==='fail') showMsg(document.getElementById('banner'),'err','Meta connect failed ❌');
  if(!token()) nav('login'); else nav('dashboard');
</script>
</body>
</html>`;

app.get("/", (req, res) => res.type("html").send(UI_HTML));

app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

/** ===== AUTH APIs ===== */
app.post("/auth/register", async (req, res) => {
  const { email, password, clientName } = req.body || {};
  if (!email || !password || String(password).length < 8) {
    return res.status(400).json({ error: "email + password(min 8) required" });
  }
  const exists = get("SELECT id FROM users WHERE email=?", [String(email).toLowerCase()]);
  if (exists) return res.status(409).json({ error: "Email already registered" });

  const user_id = uuidv4();
  const client_id = uuidv4();
  const hash = await bcrypt.hash(String(password), 10);

  run("INSERT INTO users (id, email, password_hash, role) VALUES (?,?,?,?)", [
    user_id, String(email).toLowerCase(), hash, "client"
  ]);
  run("INSERT INTO clients (id, name) VALUES (?,?)", [
    client_id, clientName || (String(email).split("@")[0] || "Client")
  ]);
  run("INSERT INTO user_clients (user_id, client_id) VALUES (?,?)", [user_id, client_id]);

  const token = signJwt({ user_id, client_id, role: "client", email: String(email).toLowerCase() });
  res.json({ token });
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Missing email/password" });

  const row = get(
    `SELECT u.id as user_id, u.password_hash, u.role, uc.client_id
     FROM users u JOIN user_clients uc ON uc.user_id=u.id
     WHERE u.email=?`,
    [String(email).toLowerCase()]
  );
  if (!row) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(String(password), row.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = signJwt({ user_id: row.user_id, client_id: row.client_id, role: row.role, email: String(email).toLowerCase() });
  res.json({ token });
});

/** ===== META OAUTH ===== */
app.get("/meta/oauth/start", requireAuth, (req, res) => {
  const state = uuidv4();
  run("INSERT INTO oauth_states (state, client_id) VALUES (?,?)", [state, req.user.client_id]);

  const scope = ["ads_management", "ads_read", "pages_show_list"].join(",");
  const authUrl = new URL("https://www.facebook.com/v24.0/dialog/oauth");
  authUrl.searchParams.set("client_id", process.env.META_APP_ID);
  authUrl.searchParams.set("redirect_uri", process.env.META_REDIRECT_URI);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", scope);

  res.json({ url: authUrl.toString() });
});

app.get("/meta/oauth/callback", async (req, res) => {
  const { code, state } = req.query || {};
  if (!code || !state) return res.status(400).send("Missing code/state");

  const st = get("SELECT state, client_id FROM oauth_states WHERE state=?", [String(state)]);
  if (!st) return res.status(400).send("Invalid state");
  run("DELETE FROM oauth_states WHERE state=?", [String(state)]);

  const tokenUrl = new URL("https://graph.facebook.com/v24.0/oauth/access_token");
  tokenUrl.searchParams.set("client_id", process.env.META_APP_ID);
  tokenUrl.searchParams.set("client_secret", process.env.META_APP_SECRET);
  tokenUrl.searchParams.set("redirect_uri", process.env.META_REDIRECT_URI);
  tokenUrl.searchParams.set("code", String(code));

  try {
    const tokenRes = await axios.get(tokenUrl.toString());
    const tokenData = tokenRes.data;
    const expiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString() : null;

    run(
      "INSERT INTO meta_connections (id, client_id, access_token, token_type, expires_at, raw_json) VALUES (?,?,?,?,?,?)",
      [uuidv4(), st.client_id, tokenData.access_token, tokenData.token_type || null, expiresAt, JSON.stringify(tokenData)]
    );

    res.redirect(`${APP_BASE_URL}/?meta=ok`);
  } catch (e) {
    console.error(e?.response?.data || e);
    res.redirect(`${APP_BASE_URL}/?meta=fail`);
  }
});

/** ===== META ASSETS ===== */
app.get("/meta/ad-accounts", requireAuth, async (req, res) => {
  const token = latestMetaToken(req.user.client_id);
  if (!token) return res.status(400).json({ error: "Meta not connected" });

  const me = await graphGet("/me", token, { fields: "id,name" });
  const accounts = await graphGet("/me/adaccounts", token, { fields: "id,name,account_status,currency", limit: 200 });
  res.json({ me, ad_accounts: accounts?.data || [] });
});

app.get("/meta/pixels", requireAuth, async (req, res) => {
  const token = latestMetaToken(req.user.client_id);
  if (!token) return res.status(400).json({ error: "Meta not connected" });

  const { ad_account_id } = req.query || {};
  if (!ad_account_id) return res.status(400).json({ error: "Missing ad_account_id" });

  const pixels = await graphGet(`/${ad_account_id}/owned_pixels`, token, { fields: "id,name", limit: 200 });
  res.json({ pixels: pixels?.data || [] });
});

app.get("/meta/pages", requireAuth, async (req, res) => {
  const token = latestMetaToken(req.user.client_id);
  if (!token) return res.status(400).json({ error: "Meta not connected" });

  const pages = await graphGet("/me/accounts", token, { fields: "id,name,category", limit: 200 });
  res.json({ pages: pages?.data || [] });
});

/** ===== LAUNCH ===== */
app.post("/campaigns/launch", requireAuth, upload.single("file"), async (req, res) => {
  const token = latestMetaToken(req.user.client_id);
  if (!token) return res.status(400).json({ error: "Meta not connected" });

  const file = req.file;
  if (!file) return res.status(400).json({ error: "Missing creative file" });

  const {
    name, ad_account_id, pixel_id, page_id, lp_url, event_name,
    country_codes, daily_budget_inr, creative_type, primary_text, headline
  } = req.body || {};

  if (!name || !ad_account_id || !pixel_id || !page_id || !lp_url || !daily_budget_inr || !creative_type || !primary_text || !headline) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  let countries;
  try { countries = typeof country_codes === "string" ? JSON.parse(country_codes) : country_codes; }
  catch { return res.status(400).json({ error: "country_codes must be JSON array like [\"IN\"]" }); }
  if (!Array.isArray(countries) || countries.length === 0) return res.status(400).json({ error: "country_codes empty" });

  const id = uuidv4();
  run(
    `INSERT INTO campaigns
     (id, client_id, name, ad_account_id, pixel_id, page_id, lp_url, event_name, country_codes, daily_budget_inr, creative_type, primary_text, headline, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, req.user.client_id, String(name), String(ad_account_id), String(pixel_id), String(page_id),
      String(lp_url), event_name ? String(event_name) : null, JSON.stringify(countries), Number(daily_budget_inr),
      String(creative_type), String(primary_text), String(headline), "draft"
    ]
  );

  try {
    // 1) Upload creative
    let imageHash = null;
    let videoId = null;

    if (String(creative_type) === "image") {
      const fd = new FormData();
      fd.append("bytes", file.buffer, { filename: file.originalname, contentType: file.mimetype });
      const imgRes = await graphPostMultipart(`/${ad_account_id}/adimages`, token, fd);
      const key = Object.keys(imgRes.images || {})[0];
      imageHash = imgRes.images?.[key]?.hash;
      if (!imageHash) throw new Error("Image upload failed");
    } else {
      const fd = new FormData();
      fd.append("source", file.buffer, { filename: file.originalname, contentType: file.mimetype });
      const vRes = await graphPostMultipart(`/${ad_account_id}/advideos`, token, fd);
      videoId = vRes.id;
      if (!videoId) throw new Error("Video upload failed");
    }

    // 2) Create Campaign
    const camp = await graphPostParams(`/${ad_account_id}/campaigns`, token, {
      name: String(name),
      objective: "OUTCOME_LEADS",
      status: "PAUSED",
      special_ad_categories: JSON.stringify(["NONE"])
    });

    // 3) Create Adset (Website leads)
    const dailyBudgetMinor = Number(daily_budget_inr) * 100;
    const adset = await graphPostParams(`/${ad_account_id}/adsets`, token, {
      name: `${name} - AdSet`,
      campaign_id: camp.id,
      billing_event: "IMPRESSIONS",
      optimization_goal: "LEAD_GENERATION",
      destination_type: "WEBSITE",
      promoted_object: JSON.stringify({ pixel_id: String(pixel_id) }),
      daily_budget: String(dailyBudgetMinor),
      targeting: JSON.stringify({
        geo_locations: { countries },
        age_min: 18,
        age_max: 55
      }),
      status: "PAUSED"
    });

    // 4) Creative
    const link = withUTMs(String(lp_url));
    const creativePayload =
      String(creative_type) === "image"
        ? {
            name: `${name} - Creative`,
            object_story_spec: JSON.stringify({
              page_id: String(page_id),
              link_data: {
                link,
                message: String(primary_text),
                name: String(headline),
                call_to_action: { type: "LEARN_MORE", value: { link } },
                image_hash: imageHash
              }
            })
          }
        : {
            name: `${name} - Creative`,
            object_story_spec: JSON.stringify({
              page_id: String(page_id),
              video_data: {
                video_id: videoId,
                message: String(primary_text),
                title: String(headline),
                call_to_action: { type: "LEARN_MORE", value: { link } }
              }
            })
          };

    const creative = await graphPostParams(`/${ad_account_id}/adcreatives`, token, creativePayload);

    // 5) Ad
    const ad = await graphPostParams(`/${ad_account_id}/ads`, token, {
      name: `${name} - Ad`,
      adset_id: adset.id,
      creative: JSON.stringify({ creative_id: creative.id }),
      status: "PAUSED"
    });

    // 6) Activate
    await graphPostParams(`/${camp.id}`, token, { status: "ACTIVE" });
    await graphPostParams(`/${adset.id}`, token, { status: "ACTIVE" });
    await graphPostParams(`/${ad.id}`, token, { status: "ACTIVE" });

    run(
      "UPDATE campaigns SET status='launched', meta_campaign_id=?, meta_adset_id=?, meta_ad_id=? WHERE id=?",
      [camp.id, adset.id, ad.id, id]
    );

    res.json({ ok: true, campaign: { id, meta_campaign_id: camp.id, meta_ad_id: ad.id } });
  } catch (e) {
    const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e));
    console.error("Launch failed:", msg);
    run("UPDATE campaigns SET status='error', error_message=? WHERE id=?", [msg, id]);
    res.status(500).json({ error: "Launch failed", details: msg });
  }
});

/** ===== REPORTS ===== */
app.get("/reports/campaigns", requireAuth, (req, res) => {
  const rows = all(
    `SELECT c.id, c.name, c.status, c.meta_campaign_id,
            i.spend, i.impressions, i.clicks, i.inline_link_clicks, i.ctr, i.cpc, i.cpm
     FROM campaigns c
     LEFT JOIN meta_insights_daily i
       ON i.client_id=c.client_id AND i.level='campaign' AND i.meta_id=c.meta_campaign_id
     WHERE c.client_id=?
     ORDER BY c.created_at DESC
     LIMIT 200`,
    [req.user.client_id]
  );
  res.json({ rows });
});

app.get("/reports/ads", requireAuth, (req, res) => {
  const rows = all(
    `SELECT c.id, c.name, c.status, c.meta_ad_id,
            i.spend, i.impressions, i.clicks, i.inline_link_clicks, i.ctr, i.cpc, i.cpm
     FROM campaigns c
     LEFT JOIN meta_insights_daily i
       ON i.client_id=c.client_id AND i.level='ad' AND i.meta_id=c.meta_ad_id
     WHERE c.client_id=?
     ORDER BY c.created_at DESC
     LIMIT 200`,
    [req.user.client_id]
  );
  res.json({ rows });
});

/** ===== INSIGHTS CRON ===== */
async function upsertInsight(client_id, level, meta_id, insight) {
  const id = uuidv4();
  run(
    `INSERT INTO meta_insights_daily
      (id, client_id, level, meta_id, date_start, date_stop, spend, impressions, clicks, inline_link_clicks, ctr, cpc, cpm, raw_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (client_id, level, meta_id, date_start, date_stop)
     DO UPDATE SET
       spend=excluded.spend,
       impressions=excluded.impressions,
       clicks=excluded.clicks,
       inline_link_clicks=excluded.inline_link_clicks,
       ctr=excluded.ctr,
       cpc=excluded.cpc,
       cpm=excluded.cpm,
       raw_json=excluded.raw_json,
       created_at=datetime('now')`,
    [
      id, client_id, level, meta_id,
      insight.date_start, insight.date_stop,
      insight.spend ?? null,
      insight.impressions ? Number(insight.impressions) : null,
      insight.clicks ? Number(insight.clicks) : null,
      insight.inline_link_clicks ? Number(insight.inline_link_clicks) : null,
      insight.ctr ? Number(insight.ctr) : null,
      insight.cpc ? Number(insight.cpc) : null,
      insight.cpm ? Number(insight.cpm) : null,
      JSON.stringify(insight)
    ]
  );
}

async function pullInsightsForClient(client_id) {
  const token = latestMetaToken(client_id);
  if (!token) return;

  const rows = all(
    "SELECT meta_campaign_id, meta_ad_id FROM campaigns WHERE client_id=? AND status='launched' AND meta_campaign_id IS NOT NULL",
    [client_id]
  );

  const fields = [
    "spend","impressions","clicks","inline_link_clicks","ctr","cpc","cpm","date_start","date_stop"
  ].join(",");

  const since = new Date(); since.setDate(since.getDate() - 7);
  const until = new Date();

  const time_range = JSON.stringify({
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10)
  });

  for (const r of rows) {
    if (r.meta_campaign_id) {
      const ins = await graphGet(`/${r.meta_campaign_id}/insights`, token, { fields, time_range, limit: 100 });
      const first = (ins?.data || [])[0];
      if (first) await upsertInsight(client_id, "campaign", r.meta_campaign_id, first);
    }
    if (r.meta_ad_id) {
      const ins = await graphGet(`/${r.meta_ad_id}/insights`, token, { fields, time_range, limit: 100 });
      const first = (ins?.data || [])[0];
      if (first) await upsertInsight(client_id, "ad", r.meta_ad_id, first);
    }
  }
}

function startInsightsCron() {
  const minutes = Number(process.env.INSIGHTS_CRON_MINUTES || "30");
  const pattern = `*/${minutes} * * * *`;
  console.log("Insights cron:", pattern);

  cron.schedule(pattern, async () => {
    try {
      const clients = all("SELECT id FROM clients WHERE is_active=1");
      for (const c of clients) await pullInsightsForClient(c.id);
    } catch (e) {
      console.error("Insights cron error:", e?.response?.data || e);
    }
  });
}

startInsightsCron();

app.listen(PORT, () => {
  console.log(`✅ Running: ${APP_BASE_URL}`);
});
