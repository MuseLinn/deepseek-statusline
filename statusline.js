#!/usr/bin/env node
// ============================================================================
// Claude Code Statusline — Multi-Provider Edition
// Anthropic-warm palette, git porcelain, TrueColor gradient bar,
// DeepSeek ¥ tracking + opencode go subscription usage
// ============================================================================

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const HOME = os.homedir();
const CFG = path.join(HOME, '.claude', 'settings.json');
const CACHE = path.join(HOME, '.claude', 'deepseek-cache.json');
const SLCFG = path.join(HOME, '.claude', 'statusline-config.json');
const BAL_TTL  = 10 * 1000;       // balance API throttle (ms)
const BAL_STALE = 20 * 1000;      // show ~ indicator after this age (ms)
const GIT_TTL = 5 * 1000;
const IO_MIN = 1500;
const NC = !!process.env.NO_COLOR || !!process.env.CLAUDE_CODE_NO_COLOR;

// ---- provider detection ------------------------------------------------------
function detectProvider(env) {
  const base = (env.ANTHROPIC_BASE_URL || '').toLowerCase();
  if (base.includes('api.deepseek.com')) return 'deepseek';
  return 'anthropic';
}

// ---- DeepSeek pricing (¥/1M tokens) -----------------------------------------
const PRICE = {
  'deepseek-v4-flash': { i: 1, c: 0.02, o: 2 },
  'deepseek-v4-pro':   { i: 3, c: 0.025, o: 6 },
};

// ---- Anthropic-inspired warm palette -----------------------------------------
const C = {
  git:    '38;5;108',   // sage green
  gitM:   '38;5;215',   // modified amber
  gitA:   '38;5;114',   // added teal-green
  gitD:   '38;5;203',   // deleted warm red
  gitR:   '38;5;110',   // renamed blue
  gitU:   '38;5;144',   // untracked grey
  dir:    '38;5;110',   // muted blue
  tierS:  '38;5;110',   // sonnet blue
  tierO:  '38;5;215',   // opus peach
  tierF:  '38;5;177',   // fable lavender
  tierH:  '38;5;108',   // haiku sage
  efHi:   '38;5;203',   // max effort red
  efLo:   '38;5;108',   // high effort sage
  bag:    '38;5;229',   // cream text
  bbg:    '48;5;236',   // warm dark block bg
  sep:    '38;5;240',   // separator grey
  tIn:    '38;5;110',   // input blue
  tOut:   '38;5;174',   // output rose
  tCch:   '38;5;180',   // cache tan
  cost:   '38;5;215',   // cost amber
  bal:    '38;5;215',   // balance amber
  clock:  '38;5;144',   // warm grey
  muted:  '38;5;243',   // dim
  warn:   '38;5;203',   // rust
  add:    '38;5;114',   // added teal
  del:    '38;5;174',   // deleted rose
  prOk:   '38;5;108',
  prPend: '38;5;216',
  prChg:  '38;5;209',
  prDraft:'38;5;243',
};

// ---- helpers -----------------------------------------------------------------
const Z = NC ? '' : '\x1b[0m';
const S = (c, s) => NC ? s : '\x1b[' + c + 'm' + s + Z;
const R = c => NC ? '' : '\x1b[' + c + 'm';
const vlen = s => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\]8;;[^\x07]*\x07/g, '').length;

// ANSI-safe truncation: never cut in the middle of an escape sequence
// Handles SGR colors (\x1b[...m) and OSC 8 hyperlinks (\x1b]8;...\x07)
function visTrunc(s, max) {
  if (vlen(s) <= max) return s;
  let out = '', vis = 0;
  const re = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07|./g;
  let m;
  while ((m = re.exec(s)) && vis < max) {
    if (m[0].startsWith('\x1b')) out += m[0];
    else { out += m[0]; vis++; }
  }
  // Close any open OSC 8 link before appending ellipsis
  return out + '\x1b]8;;\x07\x1b[0m…';
}

// OSC 8 hyperlink: Cmd+click to open URL (terminal must support it)
function link(url, text) {
  return NC ? text : '\x1b]8;;' + url + '\x07' + text + '\x1b]8;;\x07';
}

// Visible display width: CJK chars count as 2, ASCII as 1
function visWidth(s) {
  let w = 0;
  for (const ch of s) w += /[\u{4e00}-\u{9fff}\u{3000}-\u{303f}\u{ff00}-\u{ffef}]/u.test(ch) ? 2 : 1;
  return w;
}

function fnum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}
function fcny(n) {
  if (typeof n !== 'number' || isNaN(n)) return '0.00';
  if (n < 0.01) return n.toFixed(4);
  if (n < 1) return n.toFixed(3);
  return n.toFixed(2);
}
function pad(n, w) { return n.toString().padStart(w); }
function fmtReset(sec) {
  if (!sec || sec <= 0) return '';
  if (sec >= 86400) return Math.round(sec / 86400) + 'd';
  if (sec >= 3600) return Math.round(sec / 3600) + 'h';
  if (sec >= 60) return Math.round(sec / 60) + 'm';
  return sec + 's';
}

// ---- TrueColor gradient: sage → amber → rust (Anthropic warm) ----------------
function rgb(r, g, b, s) { return NC ? s : '\x1b[38;2;' + r + ';' + g + ';' + b + 'm' + s + Z; }
function barGrad(pct) {
  const t = pct / 100;
  // 100% rem = sage (good) → 0% rem = rust (danger)
  const r = Math.round(203 - t * 93);
  const g = Math.round(95 + t * 80);
  const b = Math.round(35 + t * 80);
  return [r, g, b];
}

// ---- HSV → RGB for rainbow animation ---------------------------------------
// Min-brightness boost (MIN=80) ensures all hues are readable on dark bg.
// Without this, pure blue (~rgb(0,0,255)) is illegible on 48;5;236 dark bg.
function hsvToRgb(h, s, v) {
  const MIN = 80;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const m = i % 6;
  const [r, g, b] = m === 0 ? [v, t, p] : m === 1 ? [q, v, p] : m === 2 ? [p, v, t] :
                      m === 3 ? [p, q, v] : m === 4 ? [t, p, v] : [v, p, q];
  return [Math.max(MIN, Math.round(r * 255)), Math.max(MIN, Math.round(g * 255)), Math.max(MIN, Math.round(b * 255))];
}

// Per-character rainbow gradient with background block support.
// Each non-space char gets (bgSeq + rainbowFG + char + reset) so the
// background seam is invisible — every char re-applies bgSeq.
function rainbowText(text, frame, bgSeq) {
  if (NC || !text) return text;
  const charsPerCycle = 12;
  const step = 360 / charsPerCycle;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ') { out += bgSeq + ' '; continue; }
    const hue = ((frame + i * step) % 360) / 360;
    const [r, g, b] = hsvToRgb(hue, 0.85, 1.0);
    out += bgSeq + '\x1b[38;2;' + r + ';' + g + ';' + b + 'm' + text[i] + Z;
  }
  return out;
}

// ---- I/O ---------------------------------------------------------------------
function rjson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function wjson(p, d) { try { fs.writeFileSync(p, JSON.stringify(d), 'utf8'); } catch {} }

// ---- WSL ---------------------------------------------------------------------
let _wsl = null;
function isWsl() {
  if (_wsl !== null) return _wsl;
  try { _wsl = fs.existsSync('/proc/version') && /microsoft|WSL/i.test(fs.readFileSync('/proc/version', 'utf8')); }
  catch { _wsl = false; }
  return _wsl;
}

// ---- cache -------------------------------------------------------------------
let _cache = null, _lw = 0;
function rcache() {
  if (_cache) return _cache;
  const c = rjson(CACHE);
  return _cache = (c && c.sessions) ? c : { sessions: {}, balance: '', balanceTs: 0, ocUsage: null, ocUsageTs: 0 };
}
function wcache(c) {
  const n = Date.now();
  if (!c._forceWrite && n - _lw < IO_MIN) return;
  _lw = n; c._forceWrite = false;
  wjson(CACHE, c);
}

// ---- opencode go usage (HTML scraping) --------------------------------------
let _ocf = false;
function getOCUsage(authCookie, wsId) {
  if (!authCookie || !wsId) return null;
  const c = rcache();
  if (c.ocUsage && c.ocUsageTs && Date.now() - c.ocUsageTs < BAL_TTL) return c.ocUsage;
  if (_ocf) return c.ocUsage || null;
  _ocf = true;
  const cookie = authCookie.startsWith('auth=') ? authCookie : 'auth=' + authCookie;
  require('https').get({
    hostname: 'opencode.ai', path: '/workspace/' + wsId + '/go',
    headers: { Cookie: cookie, Accept: 'text/html', 'User-Agent': 'Mozilla/5.0' }, timeout: 8000
  }, r => {
    let ck = []; r.on('data', d => ck.push(d)); r.on('end', () => {
      _ocf = false;
      try {
        const html = Buffer.concat(ck).toString();
        const get = (w) => {
          const m = html.match(new RegExp(w + 'Usage[^}]*?usagePercent:(\\d+)'));
          const r = html.match(new RegExp(w + 'Usage[^}]*?resetInSec:(\\d+)'));
          return m ? { status: 'ok', usagePercent: parseInt(m[1]), resetsInSeconds: parseInt(r?.[1] || '0') } : null;
        };
        const u = { rolling: get('rolling'), weekly: get('weekly'), monthly: get('monthly') };
        if (u.rolling || u.weekly || u.monthly) {
          const c2 = rcache(); c2.ocUsage = u; c2.ocUsageTs = Date.now(); c2._forceWrite = true; wcache(c2);
        }
      } catch {}
    });
  }).on('error', () => { _ocf = false; }).end();
  return c.ocUsage || null;
}
let _bf = false;
function getBal(apiKey) {
  if (!apiKey || apiKey === 'PROXY_MANAGED') return '';
  const c = rcache();
  if (c.balance && c.balanceTs && Date.now() - c.balanceTs < BAL_TTL) return c.balance;
  const key = process.env.DEEP_SEEK_API_KEY_FOR_BALANCE || apiKey;
  if (!key || key === 'PROXY_MANAGED') return c.balance || '';
  if (_bf) return c.balance || '';
  _bf = true;
  require('https').get({
    hostname: 'api.deepseek.com', path: '/user/balance',
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + key }, timeout: 3000
  }, r => {
    let ck = []; r.on('data', d => ck.push(d)); r.on('end', () => {
      _bf = false;
      try {
        const b = JSON.parse(Buffer.concat(ck)).balance_infos?.[0]?.total_balance;
        if (b != null) { const c2 = rcache(); c2.balance = '¥' + parseFloat(b).toFixed(2); c2.balanceTs = Date.now(); c2._forceWrite = true; wcache(c2); }
      } catch {}
    });
  }).on('error', () => { _bf = false; }).end();
  return c.balance || '';
}

// ---- settings (once) ---------------------------------------------------------
let _st = undefined;
function sets() {
  if (_st !== undefined) return _st;
  _st = rjson(CFG) || {};
  // Merge statusline-config.json (persists across /model switches)
  const slc = rjson(SLCFG);
  if (slc) {
    _st.env = { ...(_st.env || {}), ...slc };
  }
  return _st;
}

// ---- git ---------------------------------------------------------------------
let _gt = { ts: 0, data: null };
function getGit() {
  const n = Date.now();
  if (_gt.data && n - _gt.ts < GIT_TTL) return _gt.data;
  try {
    const cwd = process.cwd();
    // Support git worktrees where .git is a file (not a directory)
    const gitPath = path.join(cwd, '.git');
    let headContent;
    if (!fs.existsSync(gitPath)) {
      return _gt = { ts: n, data: { branch: '', st: {} } }, _gt.data;
    }
    if (fs.statSync(gitPath).isFile()) {
      // Worktree: .git is a file containing "gitdir: /path/to/.git/worktrees/name"
      // The worktree-specific HEAD is at that path
      const gitdir = fs.readFileSync(gitPath, 'utf8').trim().replace(/^gitdir:\s*/, '');
      const headFile = path.join(gitdir, 'HEAD');
      headContent = fs.existsSync(headFile) ? fs.readFileSync(headFile, 'utf8').trim() : '';
    } else {
      // Normal repo: .git is a directory
      const headFile = path.join(gitPath, 'HEAD');
      headContent = fs.existsSync(headFile) ? fs.readFileSync(headFile, 'utf8').trim() : '';
    }
    const branch = headContent.startsWith('ref: refs/heads/')
      ? headContent.slice(16) : headContent.slice(0, 12);
    const raw = execSync('git status --porcelain', { encoding: 'utf8', timeout: 2000, cwd });
    const st = { M: 0, A: 0, D: 0, R: 0, U: 0 };
    if (raw.trim()) {
      for (const l of raw.trim().split('\n')) {
        const x = l[0] || ' ', y = l[1] || ' ';
        if (x === '?' && y === '?') { st.U++; continue; }
        if (x === '!' || y === '!') continue;
        if (x === 'M' || y === 'M') st.M++;
        else if (x === 'A' || y === 'A') st.A++;
        else if (x === 'D' || y === 'D') st.D++;
        else if (x === 'R' || y === 'R') st.R++;
      }
    }
    return _gt = { ts: n, data: { branch, st } }, _gt.data;
  } catch {
    return _gt = { ts: n, data: { branch: '', st: {} } }, _gt.data;
  }
}

// ---- progress bar: Pac-Man eats rainbow beans ----------------------------
// Eaten: ● (rainbow per position+frame), Pac-Man: ᗧ (yellow), Uneaten: · (dim)
// At 100% all beans eaten, Pac-Man disappears
function bar(pct, frame) {
  const rainbowBean = (i) => {
    const hue = ((frame + i * 30) % 360) / 360;
    const [rr, gg, bb] = hsvToRgb(hue, 0.85, 1.0);
    return rgb(rr, gg, bb, '●');
  };
  if (pct >= 100) {
    let out = '';
    for (let i = 0; i < 10; i++) out += rainbowBean(i);
    return out;
  }
  const eaten = Math.min(9, Math.round(pct / 10));
  let out = '';
  for (let i = 0; i < eaten; i++) out += rainbowBean(i);
  out += '\x1b[38;2;255;204;0mᗧ' + Z;
  for (let i = eaten; i < 9; i++) out += S('38;5;237', '·');
  return out;
}

// ---- braille dot bar for subscription quota (frameless, 7-step per char) ----
// Each braille char has 8 states: ⠀ ⠃ ⠇ ⡇ ⡏ ⡟ ⡿ ⣿ (0→7 dots filled)
// width=3 → 21 discrete steps, ~4.8%/step granularity
function brailleBar(pct, width, r, g, b) {
  const brailleSteps = ['⠀', '⠃', '⠇', '⡇', '⡏', '⡟', '⡿', '⣿'];
  const maxPerChar = brailleSteps.length - 1;
  const totalSteps = width * maxPerChar;
  const curStep = Math.min(Math.round((pct / 100) * totalSteps), totalSteps);
  const full = Math.floor(curStep / maxPerChar);
  const part = curStep % maxPerChar;
  const empty = width - full - (part > 0 ? 1 : 0);
  const filled = '⣿'.repeat(full) + (part > 0 ? brailleSteps[part] : '');
  return (filled ? rgb(r, g, b, filled) : '') + S('38;5;237', '⠀'.repeat(Math.max(0, empty)));
}

// ==============================================================================
// RENDER
// ==============================================================================
let buf = '';
process.stdin.on('data', c => buf += c);
process.stdin.on('end', () => {
  try {
    const I = JSON.parse(buf);
const model = I.model?.display_name || '';
    const mid = I.model?.id || '';
    const sid = I.session_id || 'default';
    const cw = I.context_window || {};

    const env = sets().env || {};

    // ── provider detection ──────────────────────────────────────────────────
    const provider = detectProvider(env);
    const isDeepSeek = provider === 'deepseek';

    // ── model ───────────────────────────────────────────────────────────────
    const short = model.includes(',') ? model.split(',')[1].trim() : model.replace(/\[.*?\]/g, '').trim();
    const TM = [
      { t: 'Fable',  name: env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME || '',  id: env.ANTHROPIC_DEFAULT_FABLE_MODEL || '',  c: C.tierF || C.tierO },
      { t: 'Sonnet', name: env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME || '', id: env.ANTHROPIC_DEFAULT_SONNET_MODEL || '', c: C.tierS },
      { t: 'Opus',   name: env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME || '',   id: env.ANTHROPIC_DEFAULT_OPUS_MODEL || '',   c: C.tierO },
      { t: 'Haiku',  name: env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME || '',  id: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '',  c: C.tierH },
    ];
    // Match against display_name, model.id, _MODEL_NAME, and _MODEL
    const loName = short.toLowerCase();
    const loMid  = mid.toLowerCase().replace(/\[.*?\]/g, '');
    const tm = TM.find(m => {
      const candidates = [m.name.toLowerCase(), m.id.toLowerCase().replace(/\[.*?\]/g, '')].filter(Boolean);
      return candidates.some(c => loName.includes(c) || c.includes(loName) || loMid.includes(c) || c.includes(loMid));
    });
    const mlab = tm ? tm.t + ' → ' + (tm.name || short) : short;

    // ── effort ──────────────────────────────────────────────────────────────
    const ef = I.effort?.level || '';
    const efTxt = ef ? S(ef === 'max' || ef === 'xhigh' ? C.efHi : C.efLo, ' ⚡' + (ef === 'max' || ef === 'xhigh' ? 'max' : 'high')) : '';

    // ── session metadata ────────────────────────────────────────────────────
    const sessionName = I.session_name || '';
    const agentName = I.agent?.name || '';
    const repoHost = I.workspace?.repo?.host || '';
    const repoOwner = I.workspace?.repo?.owner || '';
    const repoName = I.workspace?.repo?.name || '';

    // ── pricing ─────────────────────────────────────────────────────────────
    let p = PRICE['deepseek-v4-flash'];
    for (const k in PRICE) if (Object.hasOwn(PRICE, k) && (mid.includes(k) || model.toLowerCase().includes(k))) { p = PRICE[k]; break; }

    const cache = rcache();
    let s = cache.sessions[sid] || { in: 0, out: 0, cache: 0 };

    // ── rainbow animation frame (persistent cumulative counter) ───────────────
    // _animFrame advances at 20fps within a process; across invocations the
    // value read from cache ensures seamless hue continuity.
    let _animFrame = cache.rainbowFrame || 0;
    cache.rainbowFrame = _animFrame + 15;

    // ── context (used %) ───────────────────────────────────────────────────
    // Primary: used_percentage from API. Fallback: total_input_tokens/window_size.
    // Null when no API response yet — show empty state instead of 100%.
    // Cache last valid pct in sessions JSON to suppress transient 0% blips
    // (occurs during context compression or model switches).
    let usedPct = null;
    const ctxTokens = cw.total_input_tokens || 0;
    const ctxMax = cw.context_window_size || 0;
    if (cw.used_percentage != null && cw.used_percentage >= 0) usedPct = Math.round(cw.used_percentage);
    else if (cw.remaining_percentage != null) usedPct = Math.round(100 - cw.remaining_percentage);
    else if (cw.total_input_tokens && cw.context_window_size && cw.context_window_size > 0) {
      usedPct = Math.round(cw.total_input_tokens / cw.context_window_size * 100);
    }
    // Guard: if API briefly reset to 0 but we know better from cache, keep the cached value.
    if (usedPct === 0 && s.ctxPct > 0 && ctxMax > 0) usedPct = s.ctxPct;

    // ── tokens ──────────────────────────────────────────────────────────────
    const cu = cw.current_usage || {};
    const ti = cu.input_tokens || 0, tc = cu.cache_read_input_tokens || 0, to = cu.output_tokens || 0;

    if (s.paid === undefined && (s.in || s.cache || s.out)) {
      const ec = Math.min(s.cache, s.in); // clamp: cache can't exceed input (corrupted data)
      s.paid = ((s.in - ec) * p.i + ec * p.c + s.out * p.o) / 1e6;
    }
    if (s.paid === undefined) s.paid = 0;
    const pi = s.in || 0, po = s.out || 0, pc = s.cache || 0;
    const hl = '_lastIn' in s;
    const ic = !hl || ti !== s._lastIn || tc !== s._lastCache;
    const oc = hl && !ic && to !== s._lastOut;

    if (ic) {
      if (hl && ti < s._lastIn) {
        // Context compression: cumulative counts reset, just skip addition
      } else {
        // Guard: cache reads cannot exceed input tokens; if they do the API
        // data is inconsistent (compression artifact), so clamp
        const effCache = Math.min(tc, ti);
        s.in = pi + ti; s.out = po + to; s.cache = pc + effCache;
        s.turns = (s.turns || 0) + 1;
        s.paid = (s.paid || 0) + ((ti - effCache) * p.i + effCache * p.c + to * p.o) / 1e6;
      }
    } else if (oc) {
      const d = Math.max(0, to - (s._lastOut || 0));
      s.out = po + d; s.paid = (s.paid || 0) + (d * p.o) / 1e6;
    }
    s._lastIn = ti; s._lastOut = to; s._lastCache = tc; s.ts = Date.now();
    // Persist last valid context percentage to suppress transient 0% on next poll
    if (usedPct !== null && usedPct > 0 && ctxMax > 0) s.ctxPct = usedPct;
    cache.sessions[sid] = s;
    const wk = 7 * 864e5;
    for (const k in cache.sessions) if (Object.hasOwn(cache.sessions, k) && Date.now() - (cache.sessions[k].ts || 0) > wk) delete cache.sessions[k];
    wcache(cache);

    const sessCost = s.paid || 0;
    const turnCost = ((Math.max(0, ti - tc)) * p.i + Math.min(tc, ti) * p.c + to * p.o) / 1e6;
    const cr = s.in > 0 ? Math.min(100, s.cache / s.in * 100).toFixed(1) : '0.0';
    const turns = s.turns || 0;

    // ── balance / usage (provider-aware) ─────────────────────────────────────
    let bal = '', balText = '', line3 = '';
    if (isDeepSeek) {
      bal = getBal(env.ANTHROPIC_AUTH_TOKEN || '');
      const balAge = Date.now() - (rcache().balanceTs || 0);
      balText = balAge > BAL_STALE ? bal + S(C.muted, '~') : bal;
    }

    // opencode go subscription usage (opt-in via OPENCODE_GO_ENABLED=true)
    if (env.OPENCODE_GO_ENABLED === 'true') {
      const ocAuth = env.OPENCODE_GO_AUTH_COOKIE || '';
      const ocWsid = env.OPENCODE_GO_WORKSPACE_ID || '';
      const usage = getOCUsage(ocAuth, ocWsid);
      if (usage) {
        const parts = [];
        for (const w of ['rolling', 'weekly', 'monthly']) {
          const win = usage[w];
          if (!win || win.status !== 'ok') continue;
          const lbl = { rolling: '5h', weekly: 'wk', monthly: 'mo' }[w] || w;
          const pct = Math.min(100, Math.max(0, win.usagePercent));
          // 8-seg bar: ▐████░░░░▌ with gradient
          const filled = Math.round(pct * 0.08);
          const empty = 8 - filled;
          const [r, g, b] = barGrad(100 - pct);
          const barStr = brailleBar(pct, 3, r, g, b);
          const pctStr = rgb(r, g, b, pad(pct, 2) + '%');
          const resetStr = win.resetsInSeconds ? ' ' + S(C.clock, '⇢' + fmtReset(win.resetsInSeconds)) : '';
          parts.push(S(C.muted, lbl + ' ') + barStr + ' ' + pctStr + resetStr);
        }
        if (parts.length) line3 = parts.join(' ');
      }
    }

    // ── dir ─────────────────────────────────────────────────────────────────
    const raw = I.workspace?.project_dir || I.workspace?.current_dir || I.cwd || process.cwd();
    let dir;
    // Normalize to forward slashes
    const np = raw.replace(/\\/g, '/');
    if (np.startsWith(HOME.replace(/\\/g, '/'))) {
      dir = '~' + np.slice(HOME.replace(/\\/g, '/').length);
      if (dir === '~') dir = '~';
    } else if (isWsl() && np.startsWith('/home/')) {
      const t = np.split('/').filter(Boolean);
      dir = '~' + (t[1] || '') + (t.length > 3 ? '/' + t.slice(3).join('/') : '');
    } else if (isWsl() && np.startsWith('/mnt/')) {
      dir = 'win:' + np.replace('/mnt/', '').replace('/', ':/').split('/').filter(Boolean).slice(-2).join('/');
    } else {
      dir = np.split('/').filter(Boolean).slice(-2).join('/');
    }
    // Truncate very long segments
    dir = dir.split('/').map(s => s.length > 24 ? s.slice(0, 22) + '…' : s).join('/');

    // ── duration ────────────────────────────────────────────────────────────
    let dur = '';
    const dm = I.cost?.total_duration_ms;
    if (dm > 0) {
      const ss = Math.floor(dm / 1000), h = Math.floor(ss / 3600), m = Math.floor((ss % 3600) / 60), s2 = ss % 60;
      dur = h > 0 ? h + 'h' + pad(m, 2) + 'm' : m > 0 ? m + 'm' + pad(s2, 2) + 's' : s2 + 's';
    }

    // ── clock ───────────────────────────────────────────────────────────────
    const now = new Date();
    const clock = pad(now.getHours(), 2) + ':' + pad(now.getMinutes(), 2);

    // ── git (bg block, Anthropic warm) ──────────────────────────────────────
    const git = getGit();
    let gitTag = '';
    if (git.branch) {
      const st = git.st;
      const dirty = st.M || st.A || st.D || st.R || st.U;
      let content = git.branch;
      if (dirty) {
        const parts = [];
        if (st.M) parts.push(S(C.gitM, pad(st.M, 1) + 'M'));
        if (st.A) parts.push(S(C.gitA, pad(st.A, 1) + 'A'));
        if (st.D) parts.push(S(C.gitD, pad(st.D, 1) + 'D'));
        if (st.R) parts.push(S(C.gitR, pad(st.R, 1) + 'R'));
        if (st.U) parts.push(S(C.gitU, pad(st.U, 1) + 'N'));
        content += ' ' + parts.join(S(C.muted, '·'));
      }
      gitTag = S(C.git, content);
    }

    // ── conditionals ────────────────────────────────────────────────────────
    // Vim mode
    const vim = I.vim?.mode || '';
    const vimTag = vim ? S(C.muted, ' ' + vim.toLowerCase()) : '';

    // Worktree
    const wt = I.worktree?.name || '';
    const wtTag = wt ? S(C.muted, ' wt:' + wt) : '';

    // PR
    let prTag = '';
    if (I.pr?.number) {
      let clr = C.prPend;
      if (I.pr.review_state === 'approved') clr = C.prOk;
      else if (I.pr.review_state === 'changes_requested') clr = C.prChg;
      else if (I.pr.review_state === 'draft') clr = C.prDraft;
      prTag = S(clr, ' PR#' + I.pr.number + (I.pr.review_state ? ' ' + I.pr.review_state : ''));
    }

    // Code churn (Anthropic Δ symbol)
    const added = I.cost?.total_lines_added || 0;
    const removed = I.cost?.total_lines_removed || 0;
    let churn = '';
    if (added > 0 || removed > 0) {
      churn = (added > 0 ? S(C.add, '+' + added) : '') + (added > 0 && removed > 0 ? S(C.muted, ' ') : '') + (removed > 0 ? S(C.del, '-' + removed) : '');
    }

    // ── width ───────────────────────────────────────────────────────────────
    const col = parseInt(process.env.COLUMNS || '120', 10);
    const SEP = S(C.sep, '│');

    // ═════════════════════════════════════════════════════════════════════════
    // LINE 1 — tagged elements for priority-based collapse
    // ═════════════════════════════════════════════════════════════════════════
    const L1 = []; // { pri: 0-4, text: '' } — lower pri dropped first on overflow

    if (gitTag) L1.push({ pri: 4, text: gitTag + wtTag + prTag });

    // Repo link (clickable via OSC 8 — Cmd+click to open browser)
    const hasRepo = repoHost && repoOwner && repoName;
    if (hasRepo) {
      const repoUrl = 'https://' + repoHost + '/' + repoOwner + '/' + repoName;
      let repoLabel = repoOwner + '/' + repoName;
      if (vlen(repoLabel) > 35) repoLabel = repoOwner + '/' + repoName.slice(0, 24) + '…';
      L1.push({ pri: 2, text: link(repoUrl, S(C.muted, repoLabel)) });
    }

    // Dir: when repo link visible, shorten to last segment (avoids redundancy)
    if (dir) {
      if (hasRepo) {
        const base = dir.split('/').pop() || dir;
        if (base !== '~') L1.push({ pri: 2, text: S(C.muted, base) });
      } else {
        L1.push({ pri: 3, text: S(C.dir, dir) });
      }
    }

    // Session name (only when set via --name or /rename); truncate if >20 visible
    if (sessionName) {
      let sn = sessionName;
      if (visWidth(sn) > 20) {
        while (visWidth(sn) > 18) sn = sn.slice(0, -1);
        sn += '…';
      }
      L1.push({ pri: 1, text: S(C.muted, sn) });
    }

    // Agent prefix
    const agentPrefix = agentName ? S(C.muted, '[' + agentName + '] ') : '';

    // Model badge — tier label in official Claude color, actual model name rainbow
    const _bg = R(C.bbg);
    let _badgeInner;
    if (tm) {
      // Tier label: Fable lavender, Sonnet blue, Opus peach, Haiku sage
      const _tierTag = '\x1b[' + tm.c + 'm' + tm.t + Z;
      const _arrow = _bg + '\x1b[' + C.muted + 'm → ' + Z;
      const _mRainbow = rainbowText(tm.name || short, _animFrame, _bg);
      _badgeInner = _bg + ' ' + _tierTag + _arrow + _mRainbow + _bg + ' ';
    } else {
      _badgeInner = _bg + ' ' + rainbowText(short, _animFrame, _bg) + _bg + ' ';
    }
    const L1model = agentPrefix + _badgeInner + Z + efTxt + vimTag;

    // Right side items (bal is lowest priority for collapse)
    const L1r = []; // { pri: 0-4, text }
    if (bal) L1r.push({ pri: 4, text: S(C.bal, balText) });
    L1r.push({ pri: 3, text: S(C.clock, clock) });
    if (dur) L1r.push({ pri: 3, text: S(C.muted, dur) });

    // Priority collapse: build line1 within column width
    function assembleL1(minPri) {
      const parts = L1.filter(e => e.pri >= minPri).map(e => e.text);
      parts.push(L1model);
      parts.push(...L1r.filter(e => e.pri >= minPri).map(e => e.text));
      return parts.join(SEP);
    }
    let line1 = assembleL1(1);
    let _collapsePri = 1;
    if (vlen(line1) > col) { line1 = assembleL1(2); _collapsePri = 2; }   // drop session name + bal
    if (vlen(line1) > col) { line1 = assembleL1(3); _collapsePri = 3; }   // drop repo + dir too
    if (vlen(line1) > col) { line1 = visTrunc(line1, col); _collapsePri = 4; }  // hard cut

    // ═════════════════════════════════════════════════════════════════════════
    // LINE 2
    // ═════════════════════════════════════════════════════════════════════════
    const L2 = [];

    // Progress bar: used % (fills left→right as context fills up)
    // When usedPct is null (no API response yet), show empty state
    let prog, ctxWarn = '';
    if (usedPct !== null) {
      // barGrad: 0% used = sage (safe) → 100% used = rust (danger)
      // barGrad input is "remaining %" so we pass (100 - usedPct)
      prog = S('38;5;240', '⦗') + bar(usedPct, _animFrame) + S('38;5;240', '⦘') + (() => {
        const [r, g, b] = barGrad(100 - usedPct);
        return rgb(r, g, b, pad(usedPct, 3) + '%');
      })();
      ctxWarn = usedPct >= 85 ? S(C.warn, ' ⚠') : '';
    } else {
      prog = S('38;5;240', '⦗') + bar(0, _animFrame) + S('38;5;240', '⦘') + S('38;5;243', ' ...');
    }
    L2.push(prog + ctxWarn);

    // Context detail: 263K/1M tokens (matching /context display)
    if (ctxTokens > 0 && ctxMax > 0) {
      L2.push(S(C.tIn, fnum(ctxTokens) + '/' + fnum(ctxMax)));
    } else {
      // Fallback: session-level token counts
      let tks;
      if (isDeepSeek) {
        tks = S(C.tIn, fnum(s.in) + ' in');
        if (pc > 0) tks += ' ' + S(C.tCch, '📦 ' + fnum(pc) + ' ' + cr + '%');
        tks += ' ' + S(C.tOut, fnum(s.out) + ' out');
      } else {
        tks = S(C.tIn, fnum(s.in) + ' in') + ' ' + S(C.tOut, fnum(s.out) + ' out');
      }
      L2.push(tks);
    }

    // Cost (DeepSeek only — ¥ pricing)
    if (isDeepSeek) L2.push(S(C.cost, '¥' + fcny(turnCost)));

    // Turns
    if (turns > 0) L2.push(S(C.clock, turns + ' turns'));

    // Total (DeepSeek only)
    if (isDeepSeek && sessCost > 0.001) L2.push(S(C.tCch, 'Total ¥' + fcny(sessCost)));

    // Churn
    if (churn) L2.push(churn);
    let line2 = L2.join(SEP);
    if (vlen(line2) > col) {
      // drop churn, then total, then turns — keep progress + tokens + cost
      const fb = [L2[0], L2[1], L2[2]];
      if (L2[3]) fb.push(L2[3]);
      line2 = fb.join(SEP);
      if (vlen(line2) > col) line2 = visTrunc(line2, col);
    }

    const output = '\r\x1b[K' + line1 + '\n\r\x1b[K' + line2 + '\n' + (line3 ? '\r\x1b[K' + line3 + '\n' : '');
    process.stdout.write(output);
    // Persist last successful output + rainbow frame for cross-invocation continuity
    const _c = rcache(); _c._lastStatus = output; _c._forceWrite = true; wcache(_c);

  } catch (e) {
    // Keep previous output on error — prevents blank flicker
    const c2 = rcache();
    if (c2._lastStatus) { process.stdout.write(c2._lastStatus); }
    else { process.stdout.write('\r\x1b[K\n\r\x1b[K\n'); }
  }

});
