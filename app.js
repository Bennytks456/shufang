'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* ---------- 存储 ---------- */
const DB = (() => {
  let dbp;
  function open() {
    if (!dbp) dbp = new Promise((ok, no) => {
      const r = indexedDB.open('shufang', 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const s of ['books', 'content', 'covers']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((ok, no) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => ok(req && req.result);
      t.onerror = () => no(t.error);
    });
  }
  return {
    all: (s) => tx(s, 'readonly', (o) => o.getAll()),
    get: (s, k) => tx(s, 'readonly', (o) => o.get(k)),
    put: (s, v) => tx(s, 'readwrite', (o) => o.put(v)),
    del: (s, k) => tx(s, 'readwrite', (o) => o.delete(k)),
  };
})();

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};

const FONTS = [
  { id: 'sys', name: '苹方', css: '-apple-system, "PingFang SC", sans-serif' },
  { id: 'serif', name: '思源宋体', css: '"Noto Serif SC", "Songti SC", serif', href: 'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&display=swap' },
  { id: 'kai', name: '霞鹜文楷', css: '"LXGW WenKai Screen", "Kaiti SC", serif', href: 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.7.0/lxgwwenkaigbscreen.css' },
  { id: 'sans', name: '思源黑体', css: '"Noto Sans SC", "PingFang SC", sans-serif', href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap' },
  { id: 'xiaowei', name: '站酷小薇', css: '"ZCOOL XiaoWei", serif', href: 'https://fonts.googleapis.com/css2?family=ZCOOL+XiaoWei&display=swap' },
];
// 英文字体：只管英文字母和数字，中文标点（“”…·）仍用中文字体
const EN_FONTS = [
  { id: 'none', name: '跟中文' },
  { id: 'literata', name: 'Literata', g: 'Literata' },
  { id: 'lora', name: 'Lora', g: 'Lora' },
  { id: 'garamond', name: 'EB Garamond', g: 'EB+Garamond' },
  { id: 'merri', name: 'Merriweather', g: 'Merriweather' },
  { id: 'sourceserif', name: 'Source Serif', g: 'Source+Serif+4' },
  { id: 'crimson', name: 'Crimson Pro', g: 'Crimson+Pro' },
  { id: 'baskerville', name: 'Baskerville', g: 'Libre+Baskerville' },
  { id: 'inter', name: 'Inter', g: 'Inter' },
  { id: 'nunito', name: 'Nunito', g: 'Nunito' },
];
const EN_RANGE = { latin: 'U+0020-007E, U+00A0-00B6, U+00B8-00FF', 'latin-ext': 'U+0100-024F, U+1E00-1EFF' };
const enLoaded = new Set();
async function loadEnFont(f) {
  if (!f || !f.g || enLoaded.has(f.id)) return;
  enLoaded.add(f.id);
  try {
    const url = `https://fonts.googleapis.com/css2?family=${f.g}:ital,wght@0,400;0,700;1,400&display=swap`;
    const css = await (await fetch(url)).text();
    let out = '';
    for (const m of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
      if (!EN_RANGE[m[1]]) continue;
      out += '@font-face{' + m[2].replace(/font-family:[^;]+;/, `font-family:'EN-${f.id}';`)
        .replace(/unicode-range:[^;}]+;?/, `unicode-range:${EN_RANGE[m[1]]};`) + '}\n';
    }
    const st = document.createElement('style'); st.textContent = out; document.head.append(st);
  } catch (e) { enLoaded.delete(f.id); } // 没网：下次再试，先用中文字体里的英文
}

const THEMES = [
  { id: 'paper', name: '米黄', c: '#f6f1e7' }, { id: 'white', name: '纯白', c: '#ffffff' },
  { id: 'parch', name: '羊皮纸', c: '#e9dcc0' }, { id: 'green', name: '护眼绿', c: '#cfe3c9' },
  { id: 'blue', name: '淡蓝', c: '#dfe8f0' }, { id: 'gray', name: '浅灰', c: '#e4e4e1' },
  { id: 'night', name: '夜间', c: '#16161a', dark: true }, { id: 'black', name: '纯黑', c: '#000000', dark: true },
];
const TYPE_DEFAULTS = { fs: 19, lh: 1.85, pg: 0.7, ls: 0, pad: 22, font: 'serif', en: 'none' };
const DEFAULTS = { ...TYPE_DEFAULTS, theme: 'paper', lastDay: 'paper', auto: true, bright: 100, warm: false, warmLv: 18, mode: 'tap', flow: 'swipe' };
const savedSettings = LS.get('settings', {});
const settings = Object.assign({}, DEFAULTS, savedSettings);
if ('serif' in settings) { if (!savedSettings.font) settings.font = settings.serif ? 'serif' : 'sys'; delete settings.serif; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const isDark = (t) => !!(THEMES.find((x) => x.id === t) || {}).dark;
const effTheme = () => (settings.auto && darkMQ.matches && !isDark(settings.theme) ? 'night' : settings.theme);
const loadedFonts = new Set();
function loadFont(f) {
  if (!f.href || loadedFonts.has(f.id)) return;
  loadedFonts.add(f.id);
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = f.href; document.head.append(l);
}
function saveSettings() { LS.set('settings', settings); applySettings(); }
function applySettings() {
  const st = document.documentElement.style;
  const font = FONTS.find((f) => f.id === settings.font) || FONTS[0];
  const en = EN_FONTS.find((f) => f.id === settings.en) || EN_FONTS[0];
  loadFont(font); loadEnFont(en);
  st.setProperty('--fs', settings.fs + 'px');
  st.setProperty('--lh', settings.lh.toFixed(2));
  st.setProperty('--pg', settings.pg + 'em');
  st.setProperty('--ls', settings.ls + 'em');
  st.setProperty('--pad', settings.pad + 'px');
  st.setProperty('--face', (en.g ? `"EN-${en.id}", ` : '') + font.css);
  document.body.dataset.theme = effTheme();
  $('#dim').style.opacity = (1 - settings.bright / 100).toFixed(2);
  $('#warm').style.opacity = settings.warm ? (settings.warmLv / 100).toFixed(2) : '0';
  syncPanel();
  const meta = document.querySelector('meta[name=theme-color]');
  meta.content = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#f6f1e7';
}
darkMQ.addEventListener('change', applySettings);

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), ms);
}
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- 解析：txt ---------- */
const NUM = '0-9０-９零〇一二两三四五六七八九十百千万';
const CHAP_RE = new RegExp(`^(第[${NUM}]+[章回节集话篇]|序章|序言|楔子|引子|尾声|后记|番外|前言|终章)`);
const VOL_RE = new RegExp(`^第[${NUM}]+[卷部]`);

function decodeText(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8);
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); }
  catch { return new TextDecoder('gb18030').decode(u8); }
}

function parseTxt(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const chapters = [];
  let vol = '', cur = null, pre = [];
  for (const raw of lines) {
    const line = raw.replace(/^[\s　]+|[\s　]+$/g, '').replace(/^#+\s*/, '');
    if (line && line.length <= 40 && VOL_RE.test(line) && !CHAP_RE.test(line)) {
      vol = line; continue;
    }
    if (line && line.length <= 40 && CHAP_RE.test(line)) {
      cur = { t: line, v: vol, x: '' }; chapters.push(cur); continue;
    }
    if (cur) cur.x += raw + '\n'; else pre.push(raw);
  }
  const preText = pre.join('\n').trim();
  if (!chapters.length) {
    // 没认出章节：按长度切
    const out = [];
    for (let i = 0, n = 1; i < preText.length; n++) {
      let end = Math.min(preText.length, i + 6000);
      const nl = preText.indexOf('\n', end);
      if (nl > 0 && nl - end < 2000) end = nl;
      out.push({ t: `第${n}节`, v: '', x: preText.slice(i, end) });
      i = end;
    }
    return out;
  }
  if (preText.length > 30) chapters.unshift({ t: '前言', v: '', x: preText });
  return chapters;
}

/* ---------- 解析：epub ---------- */
async function parseEpub(buf) {
  const zip = await readZip(buf);
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const container = xml(await zip.text('META-INF/container.xml'));
  const opfPath = container.querySelector('rootfile').getAttribute('full-path');
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opf = xml(await zip.text(opfPath));
  const resolve = (dir, href) => {
    const parts = (dir + decodeURIComponent(href.split('#')[0])).split('/');
    const out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); }
    return out.join('/');
  };
  const manifest = {};
  opf.querySelectorAll('manifest > item').forEach((it) => {
    manifest[it.getAttribute('id')] = { href: resolve(base, it.getAttribute('href')), props: it.getAttribute('properties') || '', type: it.getAttribute('media-type') };
  });
  const title = (opf.getElementsByTagName('dc:title')[0] || {}).textContent;

  // 目录标题
  const labels = {};
  const navItem = Object.values(manifest).find((m) => m.props.includes('nav'));
  const ncxItem = Object.values(manifest).find((m) => m.type === 'application/x-dtbncx+xml');
  try {
    if (navItem) {
      const d = new DOMParser().parseFromString(await zip.text(navItem.href), 'text/html');
      const dir = navItem.href.slice(0, navItem.href.lastIndexOf('/') + 1);
      d.querySelectorAll('nav a[href]').forEach((a) => {
        const k = resolve(dir, a.getAttribute('href'));
        if (!labels[k]) labels[k] = a.textContent.trim();
      });
    } else if (ncxItem) {
      const d = xml(await zip.text(ncxItem.href));
      const dir = ncxItem.href.slice(0, ncxItem.href.lastIndexOf('/') + 1);
      d.querySelectorAll('navPoint').forEach((np) => {
        const src = np.querySelector('content').getAttribute('src');
        const k = resolve(dir, src);
        if (!labels[k]) labels[k] = np.querySelector('navLabel').textContent.trim();
      });
    }
  } catch (e) { console.warn('目录解析失败', e); }

  const chapters = [];
  let vol = '';
  for (const ref of opf.querySelectorAll('spine > itemref')) {
    const m = manifest[ref.getAttribute('idref')];
    if (!m) continue;
    const html = await zip.text(m.href);
    if (!html) continue;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style').forEach((e) => e.remove());
    doc.querySelectorAll('br').forEach((e) => e.replaceWith('\n'));
    doc.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,section').forEach((e) => e.append('\n'));
    let lines = (doc.body ? doc.body.textContent : '').split('\n').map((s) => s.trim()).filter(Boolean);
    const head = ((doc.querySelector('h1,h2,h3') || {}).textContent || '').trim();
    let t = (labels[m.href] || head).trim();
    if (head && lines[0] === head && head.length <= 40 && lines.length > 1) lines = lines.slice(1);
    if (lines.join('').length < 20) {
      if (t && VOL_RE.test(t)) vol = t; // 卷首页
      continue;
    }
    if (!t) t = lines[0].length <= 40 ? lines[0] : `第${chapters.length + 1}节`;
    if (lines[0] === t) lines = lines.slice(1);
    chapters.push({ t, v: vol, x: lines.join('\n') });
  }
  if (!chapters.length) throw new Error('这本 epub 里没读到正文');
  return { title, chapters };
}

/* ---------- 导入 ---------- */
function newId() { return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

async function saveBook(meta, chapters) {
  meta.count = chapters.length;
  meta.updatedAt = Date.now();
  await DB.put('content', { id: meta.id, chapters });
  await DB.put('books', meta);
}

const VERSION = '15.6.0'; // 大功能升第一位，小改动升第二位，小修补升第三位

// 每本「我的书」的同步开关：true 同步，false 不同步，没记录 = 新书，还没决定
const choices = () => LS.get('syncChoice', {});
function setChoice(k, v) { const c = choices(); c[k] = v; LS.set('syncChoice', c); }
async function migrateChoices() {
  if (localStorage.getItem('syncChoice') != null) return;
  const c = {};
  for (const b of await DB.all('books')) if (b.source === 'pc') c[b.id.slice(3)] = true;
  for (const k of LS.get('hiddenPc', [])) c[k] = false;
  LS.set('syncChoice', c); localStorage.removeItem('hiddenPc');
}

// cloud=true：自动同步，只收开关打开的书；false：手动导入 .json，全部放上书架并打开开关
async function importLibrary(lib, cloud) {
  const books = await DB.all('books');
  const ch = choices();
  if (!cloud) { for (const b of lib.books || []) ch[b.key] = true; LS.set('syncChoice', ch); }
  const changed = [];
  for (const b of lib.books || []) {
    if (ch[b.key] !== true) continue;
    const id = 'pc:' + b.key;
    const old = books.find((x) => x.id === id);
    const size = b.chapters.reduce((n, c) => n + c.x.length, 0);
    const same = b.h ? old && old.h === b.h : old && old.count === b.chapters.length && old.size === size;
    if (same) continue;
    const added = old ? b.chapters.length - old.count : 0;
    // 红点：新加的章，和已经读过但被改过的章（没开始读的书不标）
    let upd = [], diffs = !old;
    if (old) {
      const oc = ((await DB.get('content', id)) || {}).chapters || [];
      const p = progOf(id);
      const set = new Set((old.upd || []).filter((i) => i < b.chapters.length));
      b.chapters.forEach((c, i) => {
        const o = oc[i];
        if (o && o.t === c.t && o.x === c.x) return;
        diffs = true;
        if (p && (i >= oc.length || i <= p.c)) set.add(i);
      });
      upd = [...set].sort((x, y) => x - y);
    }
    const meta = { id, title: b.title, source: 'pc', size, h: b.h, upd, addedAt: old ? old.addedAt : Date.now() };
    await saveBook(meta, b.chapters);
    const coverChanged = await syncPcCover(id, b.cover, b.coverId);
    if (R.book && R.book.id === id) { R.chapters = b.chapters; R.book = meta; }
    if (!diffs) { if (coverChanged && old) changed.push(`《${b.title}》换了封面`); continue; } // 内容一样：只提示封面
    changed.push(old ? (added > 0 ? `《${b.title}》+${added} 章` : `《${b.title}》有改动`) : `新书《${b.title}》`);
  }
  // 电脑上设为「不同步」的书：从书架移除，阅读进度留着
  for (const k of lib.excluded || []) {
    const b = books.find((x) => x.id === 'pc:' + k);
    if (!b) continue;
    await DB.del('books', b.id); await DB.del('content', b.id);
    changed.push(`《${b.title}》设为不同步，已移出书架`);
  }
  if (changed.length) toast('已同步：' + changed.join('，'), 3500);
  else if (!cloud) toast('书都是最新的');
  return changed.length;
}

async function importFile(file) {
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[《》]/g, '').trim();
  const ext = (file.name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
  const buf = await file.arrayBuffer();
  if (ext === 'json') {
    const lib = JSON.parse(decodeText(buf));
    if (!lib.books) throw new Error('不是书房导出的书包');
    return importLibrary(lib);
  }
  let title = name, chapters;
  if (ext === 'epub') {
    const r = await parseEpub(buf);
    title = r.title || name; chapters = r.chapters;
  } else {
    chapters = parseTxt(decodeText(buf));
  }
  await saveBook({ id: newId(), title, source: 'import', addedAt: Date.now() }, chapters);
  toast(`《${title}》已导入，共 ${chapters.length} 章`);
}

$('#fileInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    toast(`正在导入 ${f.name}…`, 60000);
    try { await importFile(f); }
    catch (err) { console.error(err); toast(`${f.name} 导入失败：${err.message}`, 4000); }
  }
  renderShelf();
});

// 云同步：电脑把书加密后放到 shufang-data，手机用密钥解开
const DATA = new URL('../shufang-data/', location.href).href;
const normKey = (k) => k.toUpperCase().replace(/[^A-Z0-9]/g, '');

// 从密钥算出解密钥匙很费时（故意的，防暴力破解），同一个盐算一次就记住
const keyCache = new Map();
function getKeys(key, salt) {
  const id = normKey(key) + ':' + Array.from(salt).join(',');
  if (!keyCache.has(id)) keyCache.set(id, (async () => {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(normKey(key)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, 256);
    return {
      aes: await crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['decrypt']),
      mac: await crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    };
  })().catch((e) => { keyCache.delete(id); throw e; }));
  return keyCache.get(id);
}
async function gunzipText(buf) {
  const out = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(out).text();
}
async function aesOpen(k, iv, data) {
  try { return await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k.aes, data); }
  catch { throw new Error('密钥不对'); }
}
// 整包（旧格式）
async function decryptLib(buf, key) {
  const u8 = new Uint8Array(buf);
  if (String.fromCharCode(...u8.subarray(0, 3)) !== 'SF1') throw new Error('书包格式不对');
  const k = await getKeys(key, u8.slice(3, 19));
  return JSON.parse(await gunzipText(await aesOpen(k, u8.subarray(19, 31), u8.subarray(31))));
}
// 按章：目录
async function fetchIdx(key, v) {
  const r = await fetch(DATA + 'idx.bin?' + v, { cache: 'no-store' });
  if (!r.ok) throw new Error('no-idx');
  const u8 = new Uint8Array(await r.arrayBuffer());
  if (String.fromCharCode(...u8.subarray(0, 3)) !== 'SF2') throw new Error('no-idx');
  const k = await getKeys(key, u8.slice(3, 19));
  return { idx: JSON.parse(await gunzipText(await aesOpen(k, u8.subarray(19, 31), u8.subarray(31)))), k };
}
// 按章：一章（或一张封面）
async function fetchPart(k, f) {
  const r = await fetch(DATA + 'c/' + f + '.bin', { cache: 'force-cache' }); // 文件名就是内容编号，内容不会变，可以放心用缓存
  if (!r.ok) throw new Error('下载失败 ' + f);
  const u8 = new Uint8Array(await r.arrayBuffer());
  return gunzipText(await aesOpen(k, u8.subarray(0, 12), u8.subarray(12)));
}
// 本地章节的编号（跟电脑上一样的算法），用来认出哪些章不用重新下载
async function partId(k, ch) {
  const sig = await crypto.subtle.sign('HMAC', k.mac, new TextEncoder().encode(JSON.stringify({ t: ch.t, v: ch.v, x: ch.x })));
  return Array.from(new Uint8Array(sig).subarray(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}
// 同时最多下 n 个
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// 自动同步最多 20 分钟一次（关掉重开也算）；点「同步」按钮不受限制
const AUTO_SYNC_MS = 20 * 60000;
let syncing = false, lastLib = null, pendingPick = false;
async function cloudSync(manual, pick = true) {
  const key = LS.get('syncKey', '');
  if (!key) { if (manual) askKey(); return; }
  if (syncing || (!manual && Date.now() - LS.get('lastAutoSync', 0) < AUTO_SYNC_MS)) return;
  syncing = true;
  const btn = $('#btnSync'); btn.textContent = '同步中…';
  try {
    const ver = await (await fetch(DATA + 'ver.json?' + Date.now(), { cache: 'no-store' })).json();
    LS.set('lastAutoSync', Date.now()); // 连得上才算一次；没网的话下次打开再试
    if (ver.v === LS.get('cloudVer')) { if (manual && pick) toast('书都是最新的', 1500); return; }
    let lib = null;
    if (ver.s === 2) {
      try { lib = await syncByChapter(key, ver.v, btn); }
      catch (e) { if (e.message === '密钥不对') throw e; console.warn('按章同步失败，改用整包', e); }
    }
    if (!lib) {
      btn.textContent = '同步中…';
      const buf = await (await fetch(DATA + 'lib.bin?' + ver.v, { cache: 'no-store' })).arrayBuffer();
      lib = await decryptLib(buf, key);
      for (const b of lib.books) if (!('cover' in b)) b.cover = null; // 整包里没封面 = 电脑上没放封面
      LS.set('cloudBooks', lib.books.map((b) => ({ key: b.key, title: b.title, count: b.chapters.length })));
    }
    lastLib = lib;
    const n = await importLibrary(lib, true);
    LS.set('cloudVer', ver.v);
    const fresh = LS.get('cloudBooks', []).filter((b) => !(b.key in choices()));
    if (manual && !n && !fresh.length && pick) toast('书都是最新的', 1500);
    if (!R.book) renderShelf();
    if (fresh.length && pick) { if (R.book) pendingPick = true; else openPick(); }
  } catch (e) {
    console.warn(e);
    if (manual || e.message === '密钥不对') toast(e.message === '密钥不对' ? '同步失败：密钥不对，在「管理」里重新填' : '同步失败，检查一下网络');
  } finally { syncing = false; btn.textContent = '同步'; }
}
$('#btnSync').onclick = () => cloudSync(true);

// 按章同步：拿目录 → 对出要的书里哪些章本地没有 → 只下载这些 → 拼成跟整包一样的格式交给 importLibrary
async function syncByChapter(key, v, btn) {
  const { idx, k } = await fetchIdx(key, v);
  LS.set('cloudBooks', idx.books.map((b) => ({ key: b.key, title: b.title, count: b.chapters.length })));
  const ch = choices();
  const todo = [], need = new Set();
  for (const b of idx.books) {
    if (ch[b.key] !== true) continue; // 没选同步的书，不下载
    const id = 'pc:' + b.key;
    const meta = await DB.get('books', id);
    if (meta && meta.h === b.h) continue; // 没变
    const old = meta ? (((await DB.get('content', id)) || {}).chapters || []) : [];
    const have = new Map();
    for (const c of old) have.set(c.f || await partId(k, c), c);
    for (const c of b.chapters) if (!have.has(c.f)) need.add(c.f);
    let coverOk = true;
    if (b.cover) { const cv = await DB.get('covers', id); coverOk = !!(cv && cv.pcId === b.cover); if (!coverOk) need.add(b.cover); }
    todo.push({ b, have, coverOk });
  }
  const got = new Map(), list = [...need];
  let done = 0;
  if (list.length) btn.textContent = `同步中 0/${list.length}`;
  await pool(list, 6, async (f) => { got.set(f, await fetchPart(k, f)); btn.textContent = `同步中 ${++done}/${list.length}`; });
  const books = todo.map(({ b, have, coverOk }) => ({
    key: b.key, title: b.title, h: b.h,
    chapters: b.chapters.map((c) => ({ t: c.t, v: c.v, x: have.has(c.f) ? have.get(c.f).x : JSON.parse(got.get(c.f)).x, f: c.f })),
    cover: !b.cover ? null : coverOk ? undefined : got.get(b.cover), // undefined = 封面没变，不动它
    coverId: b.cover || null,
  }));
  return { books, excluded: idx.excluded || [], exportedAt: idx.exportedAt };
}

function askKey() {
  const dlg = $('#keyDlg'), inp = $('#keyInput');
  inp.value = LS.get('syncKey', '');
  document.body.classList.add('key-open');
  setTimeout(() => inp.focus(), 100);
  $('#keyCancel').onclick = () => document.body.classList.remove('key-open');
  $('#keyOk').onclick = async () => {
    const k = inp.value.trim();
    if (normKey(k).length < 10) { toast('密钥不完整'); return; }
    LS.set('syncKey', k); LS.set('cloudVer', '');
    document.body.classList.remove('key-open');
    updateSyncBtn();
    await cloudSync(true);
  };
}
function updateSyncBtn() { $('#btnSync').hidden = !LS.get('syncKey', ''); }

/* ---------- 书架 ---------- */
function coverStyle(title) {
  let h = 0;
  for (const c of title) h = (h * 31 + c.codePointAt(0)) % 360;
  return `background: linear-gradient(160deg, hsl(${h} 38% 42%), hsl(${(h + 30) % 360} 45% 26%))`;
}
const progOf = (id) => LS.get('prog:' + id, null);

async function renderShelf() {
  const books = await DB.all('books');
  const key = (b) => { const p = progOf(b.id); return p ? [1, p.at] : [0, b.addedAt]; };
  books.sort((a, b) => { const x = key(a), y = key(b); return y[0] - x[0] || y[1] - x[1]; });
  $('#empty').hidden = books.length > 0;
  $('#emptyBtn').textContent = LS.get('syncKey', '') ? '选择要同步的书' : '填同步密钥，拿电脑上的书';
  const covers = Object.fromEntries((await DB.all('covers')).map((c) => [c.id, c.phone || c.pc]));
  $('#books').innerHTML = books.map((b) => {
    const p = progOf(b.id);
    const dc = doneCount(b.id);
    const unread = dc !== null ? Math.max(0, b.count - dc) : p ? Math.max(0, b.count - p.c - (p.r >= DONE ? 1 : 0)) : b.count;
    const txt = unread ? `${unread} 章未读` : '已读完';
    const dot = b.upd && b.upd.length ? '<i class="dot"></i>' : '';
    return `<div class="book" data-id="${esc(b.id)}">
      ${covers[b.id] ? `<div class="cover img" style="background-image:url(${covers[b.id]})">${dot}</div>`
        : `<div class="cover" style="${coverStyle(b.title)}">${dot}<div class="ct ${b.title.length > 9 ? 'xl' : b.title.length > 6 ? 'l' : ''}">${esc(b.title.slice(0, 16))}</div>
      <div class="cs">${b.source === 'pc' ? '我的书' : ''}</div></div>`}
      <div class="name">${esc(b.title)}</div><div class="prog${unread && p ? ' unread' : ''}">${txt}</div>
      <button class="del" data-del="${esc(b.id)}">×</button></div>`;
  }).join('');
  const last = books.find((b) => progOf(b.id));
  const rc = $('#recent');
  if (last) {
    const p = progOf(last.id);
    const c = await DB.get('content', last.id);
    const ct = c && c.chapters[p.c] ? c.chapters[p.c].t : '';
    const ldc = doneCount(last.id);
    const left = ldc !== null ? Math.max(0, last.count - ldc) : Math.max(0, last.count - p.c - (p.r >= DONE ? 1 : 0));
    rc.innerHTML = `<div class="lbl">继续阅读</div><div class="t">${esc(last.title)}</div><div class="c">${esc(ct)}${left ? ` · 还有 ${left} 章未读` : ''}</div>`;
    rc.dataset.id = last.id; rc.hidden = false;
  } else rc.hidden = true;
}

$('#recent').onclick = (e) => openBook(e.currentTarget.dataset.id);

/* 底部弹出菜单（不用系统 confirm，手机主屏 APP 里更可靠） */
let releaseSheet = () => {};
function sheet(title, items) {
  return new Promise((done) => {
    const box = $('#sheet');
    box.querySelector('.sheet-title').textContent = title;
    const list = box.querySelector('.sheet-list');
    list.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('');
    const close = (v) => { document.body.classList.remove('sheet-open'); box.onclick = null; releaseSheet = () => {}; done(v); };
    box.onclick = (e) => {
      const b = e.target.closest('button[data-i]');
      if (b) {
        const it = items[+b.dataset.i];
        if (it.now) it.now();
        if (it.hold) { // 先不收：让 iPhone 的选图菜单贴着这一行弹出
          list.querySelectorAll('button').forEach((x) => x.classList.toggle('held', x === b));
          releaseSheet = () => close(it.value);
          return;
        }
        close(it.value);
      }
      else if (e.target.closest('.sheet-cancel') || e.target === box) close(null);
    };
    document.body.classList.add('sheet-open');
  });
}

/* ---------- 封面 ----------
   covers 表：{ id, pc: 电脑带来的, phone: 手机上换的 }，显示时手机的优先 */
async function setCover(id, field, data) {
  const c = (await DB.get('covers', id)) || { id };
  if (data) c[field] = data; else delete c[field];
  if (c.pc || c.phone) await DB.put('covers', c); else await DB.del('covers', id);
}
// 电脑同步来的封面，返回有没有变
async function syncPcCover(id, data, pcId) {
  if (data === undefined) return false; // 按章同步时：封面没变
  const c = await DB.get('covers', id);
  if ((c && c.pc) === (data || undefined)) return false;
  await setCover(id, 'pc', data);
  if (data && pcId) { const c2 = await DB.get('covers', id); if (c2) { c2.pcId = pcId; await DB.put('covers', c2); } }
  return !(c && c.phone); // 手机上自己换过的，就看不出变化
}
async function makeCover(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const W = 600, H = 800, ratio = W / H;
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (sw / sh > ratio) { const nw = sh * ratio; sx = (sw - nw) / 2; sw = nw; }
    else { const nh = sw / ratio; sy = (sh - nh) / 2; sh = nh; }
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
    return cv.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

/* 书下方的小菜单（长按书本）。
   iPhone 的选图菜单总是在手指点的地方弹出，所以「换封面」直接做成这里的选文件按钮，
   选图菜单就会出现在书的下方。 */
function popMenu(anchor, title, items) {
  return new Promise((done) => {
    const mask = $('#popMask'), menu = $('#popMenu');
    menu.innerHTML = `<div class="pm-title">${esc(title)}</div>` + items.map((it, i) => it.file
      ? `<label class="pm-item" data-i="${i}">${esc(it.label)}<input type="file" accept="image/*" hidden></label>`
      : `<button class="pm-item${it.danger ? ' danger' : ''}" data-i="${i}">${esc(it.label)}</button>`).join('');
    let finished = false;
    const finish = (v) => {
      if (finished) return; finished = true;
      document.body.classList.remove('pop-open');
      if (anchor) anchor.classList.remove('lift');
      menu.classList.remove('picking');
      mask.onclick = null; menu.onclick = null; $('#shelf').onscroll = null;
      done(v);
    };
    menu.onclick = (e) => { const b = e.target.closest('button.pm-item'); if (b) finish({ value: items[+b.dataset.i].value }); };
    menu.querySelectorAll('input[type=file]').forEach((inp) => {
      const it = items[+inp.parentElement.dataset.i];
      inp.addEventListener('change', () => finish(inp.files[0] ? { value: it.value, file: inp.files[0] } : null));
      inp.addEventListener('cancel', () => finish(null));
      inp.parentElement.addEventListener('click', () => menu.classList.add('picking'));
    });
    mask.onclick = () => finish(null);
    $('#shelf').onscroll = () => finish(null);
    // 摆在书的正下方；下面放不下就放上面
    menu.classList.remove('picking');
    document.body.classList.add('pop-open');
    if (anchor) anchor.classList.add('lift');
    const r = anchor ? (anchor.querySelector('.cover') || anchor).getBoundingClientRect() : null;
    const vw = innerWidth, vh = innerHeight, mw = Math.min(240, vw - 24);
    menu.style.width = mw + 'px';
    const mh = menu.offsetHeight;
    let left = r ? r.left + r.width / 2 - mw / 2 : (vw - mw) / 2;
    left = clamp(left, 12, vw - mw - 12);
    let top = r ? r.bottom + 10 : (vh - mh) / 2;
    if (r && top + mh > vh - 24) top = r.top - 10 - mh;
    top = clamp(top, 24, Math.max(24, vh - mh - 24));
    menu.style.left = left + 'px'; menu.style.top = top + 'px';
    menu.classList.toggle('above', !!r && top < r.top);
  });
}

async function confirmDelete(b) {
  const pc = b.source === 'pc';
  const msg = pc ? `从书架删掉《${b.title}》？电脑更新了也不会再同步进来。想要回来，去「管理 → 选择同步哪些书」打开它。`
    : `从书架删掉《${b.title}》？阅读进度也会一起删。`;
  const ok = await sheet(msg, [{ label: '删除', value: 1, danger: true }]);
  if (!ok) return false;
  await DB.del('books', b.id); await DB.del('content', b.id);
  if (pc) setChoice(b.id.slice(3), false); else { localStorage.removeItem('prog:' + b.id); localStorage.removeItem('pos:' + b.id); await DB.del('covers', b.id); }
  toast(`已删除《${b.title}》`);
  return true;
}
async function deleteBook(b) { if (await confirmDelete(b)) renderShelf(); }

function bookToTxt(title, chapters) {
  let out = title + '\n\n', vol = '';
  for (const ch of chapters) {
    if (ch.v && ch.v !== vol) { vol = ch.v; out += '\n' + vol + '\n\n'; }
    out += ch.t + '\n\n' + ch.x.trim() + '\n\n';
  }
  return out;
}

async function shareFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function exportBook(b) {
  const c = await DB.get('content', b.id);
  await shareFile(`${b.title}.txt`, bookToTxt(b.title, c.chapters), 'text/plain');
}

async function exportAll() {
  const books = await DB.all('books');
  if (!books.length) { toast('书架是空的'); return; }
  const out = [];
  for (const b of books) {
    const c = await DB.get('content', b.id);
    out.push({ key: b.source === 'pc' ? b.id.slice(3) : b.id, title: b.title, chapters: c.chapters });
  }
  const d = new Date();
  await shareFile(`书房备份_${d.getMonth() + 1}月${d.getDate()}日.json`,
    JSON.stringify({ format: 'shufang', exportedAt: Math.floor(d / 1000), books: out }), 'application/json');
}

async function bookMenu(id) {
  const b = await DB.get('books', id);
  if (!b) return;
  const items = [{ label: '阅读', value: 'read' }];
  if (b.upd && b.upd.length) items.push({ label: `去掉更新红点（${b.upd.length} 章有更新）`, value: 'seen' });
  const cv = await DB.get('covers', id);
  items.push({ label: '封面', value: 'cover', file: true });
  if (cv && cv.phone) items.push({ label: cv.pc ? '换回电脑上的封面' : '恢复默认封面', value: 'uncover' });
  items.push({ label: '导出 txt', value: 'export' }, { label: '删除', value: 'del', danger: true });
  const bookEl = $$('#books .book').find((x) => x.dataset.id === id);
  const res = await popMenu(bookEl, `《${b.title}》 · ${b.count} 章`, items);
  const act = res && res.value;
  if (act === 'cover') {
    try { await setCover(id, 'phone', await makeCover(res.file)); toast('封面换好了'); renderShelf(); }
    catch (err) { console.error(err); toast('这张图打不开，换一张试试'); }
  }
  if (act === 'uncover') { await setCover(id, 'phone', null); renderShelf(); }
  if (act === 'read') openBook(id);
  if (act === 'seen') { await clearUpd(b, b.upd.slice()); renderShelf(); }
  if (act === 'export') exportBook(b);
  if (act === 'del') deleteBook(b);
}

// 长按书本弹菜单（menuAt：刚弹过菜单，紧跟着的那次点击不算点书）
let pressT = null, menuAt = 0;
$('#books').addEventListener('touchstart', (e) => {
  const bk = e.target.closest('.book'); if (!bk) return;
  clearTimeout(pressT);
  pressT = setTimeout(() => { menuAt = Date.now(); if (navigator.vibrate) navigator.vibrate(10); bookMenu(bk.dataset.id); }, 450);
}, { passive: true });
['touchend', 'touchmove', 'touchcancel'].forEach((t) => $('#books').addEventListener(t, () => clearTimeout(pressT), { passive: true }));
$('#books').addEventListener('contextmenu', (e) => {
  const bk = e.target.closest('.book'); if (!bk) return;
  e.preventDefault();
  if (Date.now() - menuAt > 800) { menuAt = Date.now(); bookMenu(bk.dataset.id); }
});

$('#books').addEventListener('click', async (e) => {
  if (Date.now() - menuAt < 800) return;
  const del = e.target.closest('[data-del]');
  if (del) { const b = await DB.get('books', del.dataset.del); if (b) deleteBook(b); return; }
  const bk = e.target.closest('.book');
  if (!bk) return;
  if ($('#shelf').classList.contains('managing')) bookMenu(bk.dataset.id);
  else openBook(bk.dataset.id);
});
$('#btnManage').onclick = async () => {
  const hasKey = !!LS.get('syncKey', '');
  const items = [{ label: '编辑书架（点书删除或导出）', value: 'edit' }];
  if (hasKey) items.push({ label: '选择同步哪些书', value: 'pick' });
  items.push({ label: hasKey ? '同步密钥（已设置）' : '设置同步密钥', value: 'key' });
  items.push({ label: '备份全部书（导出 .json）', value: 'all' });
  items.push({ label: `检查更新（现在是 V${VERSION}）`, value: 'update' });
  const act = await sheet(`书架 · V${VERSION}`, items);
  if (act === 'update') checkUpdate(true);
  if (act === 'all') exportAll();
  if (act === 'edit') setManaging(true);
  if (act === 'key') askKey();
  if (act === 'pick') openPick();
};

// 选择同步哪些书：列出电脑上的书，每本一个开关
function renderPick(keep = {}) {
  const ch = choices();
  const list = LS.get('cloudBooks', []);
  const rows = list.map((b) => ({ ...b, isNew: !(b.key in ch), on: b.key in keep ? keep[b.key] : ch[b.key] === true }));
  rows.sort((x, y) => y.isNew - x.isNew);
  $('#pickList').innerHTML = rows.length ? rows.map((b) => `<label class="pickrow">
      <span class="pt">${esc(b.title)}${b.isNew ? '<em>新</em>' : ''}<small>${b.count} 章</small></span>
      <input type="checkbox" class="sw" data-k="${esc(b.key)}" ${b.on ? 'checked' : ''}></label>`).join('')
    : '<div class="pickempty">还没扫描到电脑上的书，点「重新扫描」</div>';
}
async function openPick() {
  if (!LS.get('cloudBooks', null)) await cloudSync(true, false);
  renderPick();
  document.body.classList.add('pick-open');
}
const pickState = () => Object.fromEntries($$('#pickList .sw').map((i) => [i.dataset.k, i.checked]));
$('#pickRescan').onclick = async () => {
  const keep = pickState();
  $('#pickRescan').textContent = '扫描中…';
  LS.set('cloudVer', '');
  await cloudSync(true, false);
  $('#pickRescan').textContent = '重新扫描';
  renderPick(keep);
};
$('#pickLater').onclick = () => document.body.classList.remove('pick-open');
$('#pickOk').onclick = async () => {
  const state = pickState();
  document.body.classList.remove('pick-open');
  const ch = choices(), removed = [];
  let needAdd = false;
  for (const [k, on] of Object.entries(state)) {
    ch[k] = on;
    const b = await DB.get('books', 'pc:' + k);
    if (!on && b) { await DB.del('books', b.id); await DB.del('content', b.id); removed.push(`《${b.title}》`); }
    if (on && !b) needAdd = true;
  }
  LS.set('syncChoice', ch);
  if (needAdd) { LS.set('cloudVer', ''); await cloudSync(true, false); }
  if (removed.length) setTimeout(() => toast(`${removed.join('、')} 已移出书架，进度留着`, 3000), needAdd ? 3600 : 0);
  else if (!needAdd) toast('已保存');
  renderShelf();
};

$('#emptyBtn').onclick = () => (LS.get('syncKey', '') ? openPick() : askKey());

function setManaging(on) {
  $('#shelf').classList.toggle('managing', on);
  $('#btnDone').hidden = !on; $('#btnManage').hidden = on;
}
$('#btnDone').onclick = () => setManaging(false);

/* ---------- 阅读 ---------- */
const R = { book: null, chapters: [], c: 0 };
const scroller = $('#scroller');

function chapterHtml(ch) {
  const out = [];
  for (let line of ch.x.split('\n')) {
    line = line.replace(/^[\s　]+|[\s　]+$/g, '');
    if (!line) continue;
    if (/^([-*_]\s*){3,}$|^[*＊※◇◆○●☆★·]+(\s*[*＊※◇◆○●☆★·]+)*$/.test(line)) { out.push('<p class="sep">＊　＊　＊</p>'); continue; }
    line = line.replace(/^#+\s*/, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
    out.push(`<p>${esc(line)}</p>`);
  }
  return out.join('');
}

const flowScroll = () => settings.flow === 'scroll'; // 上下连着读
const secEl = (i) => $(`#content .chap[data-i="${i}"]`);
const secs = () => $$('#content .chap');

function secHtml(i) {
  const ch = R.chapters[i], last = i >= R.chapters.length - 1;
  const end = last ? '<div class="end"><div class="done">— 已读到最后一章 —</div></div>'
    : flowScroll() ? '' : '<div class="end"><button class="endNext">下一章</button></div>';
  return `<section class="chap" data-i="${i}">${ch.v ? `<div class="vol">${esc(ch.v)}</div>` : ''}<h2>${esc(ch.t)}</h2>${chapterHtml(ch)}${end}</section>`;
}

function renderChapter(ratio = 0) {
  R.moved = false;
  $('#content').innerHTML = secHtml(R.c);
  $('#readTitle').textContent = R.book.title;
  setCur(R.c, true);
  requestAnimationFrame(() => {
    setRatio(ratio);
    updateInfo(); saveProgress();
    fillDown(); fillUp();
  });
}

// 当前章变了：底部章名、滑条、更新红点
function setCur(i, force) {
  if (!force && i === R.c) return;
  R.c = i;
  $('#infoChap').textContent = R.chapters[i].t;
  $('#chapSlider').max = R.chapters.length - 1;
  $('#chapSlider').value = i;
  clearUpd(R.book, [i]);
}

// 连着读：快到底就把下一章接在后面
function fillDown() {
  if (!flowScroll() || !R.book) return;
  for (let k = 0; k < 3; k++) {
    const all = secs(), lastI = +all[all.length - 1].dataset.i;
    if (lastI >= R.chapters.length - 1) return;
    if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > scroller.clientHeight * 2) return;
    $('#content').insertAdjacentHTML('beforeend', secHtml(lastI + 1));
  }
}
// 连着读：快到顶就把上一章接在前面（停下来再接，免得滚动时跳）
function fillUp() {
  if (!flowScroll() || !R.book) return;
  const first = secs()[0], firstI = +first.dataset.i;
  if (firstI <= 0 || scroller.scrollTop > scroller.clientHeight) return;
  const before = scroller.scrollHeight;
  $('#content').insertAdjacentHTML('afterbegin', secHtml(firstI - 1));
  scroller.scrollTop += scroller.scrollHeight - before;
}
// 连着读：离当前章太远的章拿掉，页面不会越来越长
function trimFar() {
  if (!flowScroll()) return;
  for (const s of secs()) {
    const i = +s.dataset.i;
    if (i > R.c + 3) s.remove();
    else if (i < R.c - 2) { const h = s.offsetHeight; s.remove(); scroller.scrollTop -= h; }
  }
}
// 连着读：屏幕上方四分之一处是哪一章，就算读到哪一章
function trackCur() {
  const probe = scroller.scrollTop + scroller.clientHeight * 0.25;
  let cur = null;
  for (const s of secs()) { if (s.offsetTop <= probe) cur = s; else break; }
  if (!cur) return;
  const ni = +cur.dataset.i;
  if (ni > R.c && R.moved) recordPos(R.c, 1);
  setCur(ni);
}

async function clearUpd(book, idx) {
  if (!book || !book.upd || !book.upd.some((i) => idx.includes(i))) return;
  book.upd = book.upd.filter((i) => !idx.includes(i));
  const m = await DB.get('books', book.id);
  if (m) { m.upd = (m.upd || []).filter((i) => !idx.includes(i)); await DB.put('books', m); }
}

// 当前章在页面里占的滚动范围：从这章开头到下一章开头（最后一章就到底）
function secSpan(i) {
  const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const s = secEl(i);
  if (!s) return { a: 0, b: max };
  const a = s.previousElementSibling ? s.offsetTop : 0;
  const b = s.nextElementSibling ? Math.min(s.nextElementSibling.offsetTop, max) : max;
  return { a, b };
}
// 这一章读到几成
function curRatio() {
  const { a, b } = secSpan(R.c);
  return b > a ? clamp((scroller.scrollTop - a) / (b - a), 0, 1) : 0;
}
function setRatio(r) {
  const { a, b } = secSpan(R.c);
  scroller.scrollTop = a + r * Math.max(0, b - a);
}
function updateInfo() {
  $('#infoPct').textContent = `${R.c + 1}/${R.chapters.length} 章 · ${Math.round(curRatio() * 100)}%`;
}
function saveProgress() {
  if (!R.book) return;
  const r = curRatio();
  LS.set('prog:' + R.book.id, { c: R.c, r, at: Date.now() });
  if (R.moved) recordPos(R.c, r); // 真的读过（滑过、翻过页）才记；单纯跳进跳出不算
}

/* 每章各自记住读到哪里：pos:<书> = { 章名: [读到最远的比例, 读完过没有] }
   跳着看时，回到某一章就接着上次的地方；读完的章再点进去从章首开始 */
const DONE = 0.97;
const getPos = (id) => LS.get('pos:' + id, null);
function ensurePos(book, chapters) {
  let pos = getPos(book.id);
  if (!pos) { // 第一次用：照旧的进度推出来，之前的章都算读完
    pos = {};
    const p = progOf(book.id);
    if (p) chapters.forEach((c, i) => { if (i < p.c) pos[c.t] = [1, 1]; else if (i === p.c) pos[c.t] = [p.r, p.r >= DONE ? 1 : 0]; });
    LS.set('pos:' + book.id, pos);
  }
  return pos;
}
function recordPos(i, r) {
  if (!R.book || !R.chapters[i]) return;
  const pos = ensurePos(R.book, R.chapters);
  const t = R.chapters[i].t, old = pos[t] || [0, 0];
  const nr = Math.max(old[0], Math.round(r * 1000) / 1000);
  const nd = old[1] || (r >= DONE ? 1 : 0);
  if (nr === old[0] && nd === old[1]) return;
  pos[t] = [nr, nd];
  LS.set('pos:' + R.book.id, pos);
}
function resumeRatio(i) {
  const e = (getPos(R.book.id) || {})[R.chapters[i].t];
  return e && !e[1] && e[0] < DONE ? e[0] : 0;
}
// 读完了几章（没有记录就返回 null，用旧算法）
function doneCount(id) {
  const pos = getPos(id);
  return pos ? Object.values(pos).filter((v) => v[1]).length : null;
}
let saveT;
scroller.addEventListener('scroll', () => {
  if (flowScroll() && R.book) { trackCur(); fillDown(); }
  updateInfo();
  clearTimeout(saveT);
  saveT = setTimeout(() => { if (!R.book) return; saveProgress(); fillUp(); trimFar(); }, 150);
}, { passive: true });
['touchmove', 'wheel'].forEach((t) => scroller.addEventListener(t, () => { R.moved = true; }, { passive: true }));
// 「下一章」按钮（左右滑动模式时每章末尾才有）
$('#content').addEventListener('click', (e) => {
  const b = e.target.closest('.endNext'); if (!b) return;
  e.stopPropagation(); goChapter(+b.closest('.chap').dataset.i + 1);
});

function goChapter(i, ratio) {
  if (i < 0 || i >= R.chapters.length) { toast(i < 0 ? '已经是第一章' : '已经是最后一章'); return; }
  saveProgress(); // 先记下正在读的这一章读到哪
  R.c = i; renderChapter(ratio === undefined ? resumeRatio(i) : ratio);
}

async function openBook(id) {
  const book = await DB.get('books', id);
  const c = await DB.get('content', id);
  if (!book || !c) { toast('这本书打不开了'); return; }
  R.book = book; R.chapters = c.chapters;
  ensurePos(book, c.chapters);
  const p = progOf(id) || { c: 0, r: 0 };
  R.c = Math.min(p.c, R.chapters.length - 1);
  $('#shelf').classList.remove('active');
  $('#reader').classList.add('active');
  document.body.classList.remove('menu-on');
  renderChapter(p.r);
  history.pushState({ reader: 1 }, '');
  if (!LS.get('swipeHint', false)) { LS.set('swipeHint', true); setTimeout(() => toast(flowScroll() ? '小提示：读到章末继续往下滚，会接着读下一章' : '小提示：左右滑动可以换章', 3000), 600); }
}
function closeBook() {
  saveProgress();
  R.book = null;
  closeToc(); closePanel();
  $('#reader').classList.remove('active');
  $('#shelf').classList.add('active');
  document.body.classList.remove('menu-on');
  renderShelf();
  if (pendingPick) { pendingPick = false; openPick(); }
}
$('#btnBack').onclick = () => { if (history.state && history.state.reader) history.back(); else closeBook(); };
window.addEventListener('popstate', () => { if (R.book) closeBook(); });

// 左右滑动换章：手指往左滑 = 下一章，往右滑 = 上一章（都从章首读起）
let swipe = null;
scroller.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) { swipe = null; return; }
  const t = e.touches[0];
  swipe = { x: t.clientX, y: t.clientY, at: Date.now() };
}, { passive: true });
scroller.addEventListener('touchend', (e) => {
  if (!swipe) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y, dt = Date.now() - swipe.at;
  swipe = null;
  const busy = ['menu-on', 'panel-open', 'toc-open', 'sheet-open'].some((c) => document.body.classList.contains(c));
  if (busy || flowScroll() || dt > 700 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
  const next = dx < 0;
  const to = R.c + (next ? 1 : -1);
  if (to < 0 || to >= R.chapters.length) { toast(next ? '已经是最后一章' : '已经是第一章'); return; }
  goChapter(to);
  const c = $('#content');
  c.classList.remove('slide-next', 'slide-prev'); void c.offsetWidth;
  c.classList.add(next ? 'slide-next' : 'slide-prev');
}, { passive: true });
scroller.addEventListener('touchcancel', () => { swipe = null; }, { passive: true });

// 点按：左三分之一上翻，右三分之一下翻，中间呼出菜单
scroller.addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  if (document.body.classList.contains('panel-open')) { closePanel(); return; }
  if (document.body.classList.contains('menu-on')) { document.body.classList.remove('menu-on'); return; }
  const x = e.clientX / window.innerWidth;
  if (settings.mode === 'tap' && (x < 0.33 || x > 0.67)) {
    R.moved = true;
    const step = scroller.clientHeight - settings.fs * settings.lh * 1.5;
    const max = scroller.scrollHeight - scroller.clientHeight;
    if (x > 0.67) {
      if (scroller.scrollTop >= max - 2) goChapter(R.c + 1);
      else scroller.scrollTop = Math.min(max, scroller.scrollTop + step);
    } else {
      if (flowScroll()) fillUp();
      if (scroller.scrollTop <= 2) { if (R.c > 0) goChapter(R.c - 1, 1); }
      else scroller.scrollTop = Math.max(0, scroller.scrollTop - step);
    }
    return;
  }
  document.body.classList.add('menu-on');
});

$('#btnPrev').onclick = () => goChapter(R.c - 1);
$('#btnNext').onclick = () => goChapter(R.c + 1);
$('#chapSlider').oninput = (e) => { $('#infoChap').textContent = R.chapters[+e.target.value].t; };
$('#chapSlider').onchange = (e) => goChapter(+e.target.value);

// 设置面板里的控件随设置刷新
function syncPanel() {
  $('#fsVal').textContent = settings.fs;
  const set = (id, v, txt) => { $(id).value = v; const t = $('#v' + id.slice(2)); if (t) t.textContent = txt; };
  set('#sLh', settings.lh, settings.lh.toFixed(2));
  set('#sPg', settings.pg, settings.pg.toFixed(1));
  set('#sLs', settings.ls, settings.ls.toFixed(2));
  set('#sPad', settings.pad, settings.pad);
  $('#sBright').value = settings.bright;
  $('#sWarm').checked = settings.warm;
  $('#sWarmLv').value = settings.warmLv; $('#sWarmLv').disabled = !settings.warm;
  $('#sAuto').checked = settings.auto;
  $('#fontList').innerHTML = FONTS.map((f) => `<button data-f="${f.id}" class="${f.id === settings.font ? 'on' : ''}" style='font-family:${f.css}'>${f.name}</button>`).join('');
  $('#enList').innerHTML = EN_FONTS.map((f) => `<button data-en="${f.id}" class="${f.id === settings.en ? 'on' : ''}" style='font-family:${f.g ? `"EN-${f.id}", ` : ''}-apple-system, sans-serif'>${f.name}</button>`).join('');
  $('#themeList').innerHTML = THEMES.map((t) => `<button data-t="${t.id}" class="${t.id === settings.theme ? 'on' : ''}" style="background:${t.c}"><span>${t.name}</span></button>`).join('');
  $$('.seg button[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === settings.mode));
  $$('.seg button[data-flow]').forEach((b) => b.classList.toggle('on', b.dataset.flow === settings.flow));
  const dark = isDark(effTheme());
  $('#tNightIco').textContent = dark ? '☀' : '☾';
  $('#tNightTxt').textContent = dark ? '日间' : '夜间';
}

function keepRatio(fn) { const r = curRatio(); fn(); requestAnimationFrame(() => setRatio(r)); }
const keepSave = (fn) => keepRatio(() => { fn(); saveSettings(); });
$$('[data-fs]').forEach((b) => b.onclick = () => keepSave(() => { settings.fs = clamp(settings.fs + +b.dataset.fs, 13, 34); }));
function bindRange(sel, key, layout) {
  $(sel).oninput = (e) => {
    const f = () => { settings[key] = parseFloat(e.target.value); saveSettings(); };
    if (layout) keepRatio(f); else f();
  };
}
bindRange('#sLh', 'lh', true); bindRange('#sPg', 'pg', true); bindRange('#sLs', 'ls', true); bindRange('#sPad', 'pad', true);
bindRange('#sBright', 'bright', false); bindRange('#sWarmLv', 'warmLv', false);
$('#sWarm').onchange = (e) => { settings.warm = e.target.checked; saveSettings(); };
$('#sAuto').onchange = (e) => { settings.auto = e.target.checked; saveSettings(); };
$('#fontList').onclick = (e) => {
  const b = e.target.closest('[data-f]'); if (!b) return;
  keepSave(() => { settings.font = b.dataset.f; });
};
$('#enList').onclick = (e) => {
  const b = e.target.closest('[data-en]'); if (!b) return;
  keepSave(() => { settings.en = b.dataset.en; });
};
$('#themeList').onclick = (e) => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  settings.theme = b.dataset.t;
  if (!isDark(settings.theme)) settings.lastDay = settings.theme;
  saveSettings();
  if (settings.auto && darkMQ.matches && !isDark(settings.theme)) toast('手机现在是深色模式，跟随系统会先用夜间；要用这个背景，关掉「跟随系统」');
};
$$('.seg button[data-mode]').forEach((b) => b.onclick = () => {
  settings.mode = b.dataset.mode; saveSettings();
  toast(settings.mode === 'tap' ? '点屏幕左右两边翻页，中间呼出菜单' : '只用手指上下滑，点屏幕任何地方呼出菜单');
});
$$('.seg button[data-flow]').forEach((b) => b.onclick = () => {
  if (settings.flow === b.dataset.flow) return;
  const r = R.book ? curRatio() : 0;
  settings.flow = b.dataset.flow; saveSettings();
  if (R.book) renderChapter(r);
  toast(flowScroll() ? '读到章末继续往下滚，会接着读下一章' : '左滑下一章，右滑上一章');
});
$('#sReset').onclick = () => keepSave(() => Object.assign(settings, TYPE_DEFAULTS));

function openPanel(which) {
  document.body.classList.remove('menu-on');
  $('#pLight').hidden = which !== 'light';
  $('#pType').hidden = which !== 'type';
  if (which === 'type') { FONTS.forEach(loadFont); EN_FONTS.forEach(loadEnFont); } // 让字体按钮显示各自的字形
  document.body.classList.add('panel-open');
}
function closePanel() { document.body.classList.remove('panel-open'); }
$('#tLight').onclick = () => openPanel('light');
$('#tFont').onclick = () => openPanel('type');
$('#tToc').onclick = () => { document.body.classList.remove('menu-on'); openToc(); };
$('#tNight').onclick = () => {
  if (isDark(effTheme())) {
    if (isDark(settings.theme)) settings.theme = settings.lastDay || 'paper';
    if (settings.auto && darkMQ.matches) { settings.auto = false; toast('已关掉「跟随系统」，现在用日间'); }
  } else {
    if (!isDark(settings.theme)) settings.lastDay = settings.theme;
    settings.theme = 'night';
  }
  saveSettings();
};

$('#btnReadMore').onclick = async () => {
  const b = R.book;
  const act = await sheet(`《${b.title}》`, [
    { label: '导出 txt', value: 'export' },
    { label: '删除这本书', value: 'del', danger: true },
  ]);
  if (act === 'export') exportBook(b);
  if (act === 'del') {
    saveProgress();
    if (await confirmDelete(b)) { R.book = null; closeBook(); }
  }
};

/* ---------- 目录 ---------- */
function openToc() {
  $('#tocBook').textContent = R.book.title;
  saveProgress();
  const pos = getPos(R.book.id) || {};
  let html = '', vol = null;
  R.chapters.forEach((ch, i) => {
    if (ch.v !== vol) { vol = ch.v; if (vol) html += `<li class="vol">${esc(vol)}</li>`; }
    const upd = R.book.upd && R.book.upd.includes(i) ? ' upd' : '';
    const e = pos[ch.t];
    const tag = !e ? '' : e[1] ? '读完' : e[0] > 0.02 ? `${Math.round(e[0] * 100)}%` : '';
    const cls = i === R.c ? 'cur' : e && e[1] ? 'read' : '';
    html += `<li data-i="${i}" class="${cls}${upd}"><span class="tt">${esc(ch.t)}</span>${tag ? `<span class="tp${e[1] ? '' : ' part'}">${tag}</span>` : ''}</li>`;
  });
  $('#tocList').innerHTML = html;
  document.body.classList.add('toc-open');
  jumpToc();
}
function jumpToc() { const cur = $('#tocList .cur'); if (cur) cur.scrollIntoView({ block: 'center' }); }
function closeToc() { document.body.classList.remove('toc-open'); }
$('#btnToc').onclick = openToc;
$('#tocJump').onclick = jumpToc;
$('#tocMask').onclick = closeToc;
$('#tocList').onclick = (e) => {
  const li = e.target.closest('li[data-i]'); if (!li) return;
  closeToc(); document.body.classList.remove('menu-on'); goChapter(+li.dataset.i);
};

if ('serviceWorker' in navigator) {
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && !R.book) { reloaded = true; location.reload(); } });
}

/* ---------- 检查更新 ---------- */
// 比版本号：'15.10.0' > '15.2.0'
function cmpVer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}
let lastUpdCheck = 0, newVer = null;
async function checkUpdate(manual) {
  if (!manual && Date.now() - lastUpdCheck < 5 * 60000) return;
  lastUpdCheck = Date.now();
  if (manual) toast('正在检查更新…', 8000);
  try {
    const info = await (await fetch('version.json?t=' + Date.now(), { cache: 'no-store' })).json();
    if (cmpVer(info.v, VERSION) > 0) {
      newVer = info;
      if (manual) { applyUpdate(); return; }
      showUpdBar();
    } else if (manual) toast(`已经是最新版 V${VERSION}`);
  } catch (e) {
    if (manual) toast('检查不了更新，看看有没有联网');
  }
}
function showUpdBar() {
  if (!newVer) return;
  const bar = $('#updBar');
  bar.innerHTML = `<b>有新版本 V${esc(newVer.v)}</b>${newVer.note ? `<span>${esc(newVer.note)}</span>` : ''}<i>点这里更新</i>`;
  bar.hidden = false;
}
async function applyUpdate() {
  toast(newVer ? `正在更新到 V${newVer.v}…` : '正在更新…', 8000);
  saveProgress();
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
    for (const k of await caches.keys()) if (k !== 'shufang-fonts') await caches.delete(k); // 字体留着
  } catch (e) { console.warn(e); }
  location.reload();
}
$('#updBar').onclick = applyUpdate;
$('#ver').onclick = () => checkUpdate(true);

/* ---------- 启动 ---------- */
$('#ver').innerHTML = `书房 V${VERSION} · <u>检查更新</u>`;
document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(); });
applySettings();
renderShelf();
updateSyncBtn();
migrateChoices().then(() => cloudSync(false));
document.addEventListener('visibilitychange', () => { if (!document.hidden) { cloudSync(false); checkUpdate(false); } });
setInterval(() => { if (!document.hidden) cloudSync(false); }, 60000);
setTimeout(() => checkUpdate(false), 1500);
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
