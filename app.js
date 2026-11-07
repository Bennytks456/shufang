'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* ---------- 存储 ---------- */
const DB = (() => {
  let dbp;
  function open() {
    if (!dbp) dbp = new Promise((ok, no) => {
      const r = indexedDB.open('shufang', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('books', { keyPath: 'id' });
        r.result.createObjectStore('content', { keyPath: 'id' });
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

const settings = Object.assign(
  { fs: 19, lh: 1.85, theme: 'paper', serif: true, mode: 'tap' },
  LS.get('settings', {})
);
function saveSettings() { LS.set('settings', settings); applySettings(); }
function applySettings() {
  document.documentElement.style.setProperty('--fs', settings.fs + 'px');
  document.documentElement.style.setProperty('--lh', settings.lh.toFixed(2));
  document.body.dataset.theme = settings.theme;
  document.body.classList.toggle('serif', settings.serif);
  $('#fontVal').textContent = settings.fs;
  $('#btnFace').textContent = settings.serif ? '宋体' : '黑体';
  $('#btnMode').textContent = settings.mode === 'tap' ? '点击翻页' : '上下滚动';
  $$('.swatch').forEach((b) => b.classList.toggle('on', b.dataset.theme === settings.theme));
  const meta = document.querySelector('meta[name=theme-color]');
  meta.content = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#f6f1e7';
}

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

const VERSION = 6;

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
    await saveBook({ id, title: b.title, source: 'pc', size, h: b.h, addedAt: old ? old.addedAt : Date.now() }, b.chapters);
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

async function decryptLib(buf, key) {
  const u8 = new Uint8Array(buf);
  if (String.fromCharCode(...u8.subarray(0, 3)) !== 'SF1') throw new Error('书包格式不对');
  const salt = u8.subarray(3, 19), iv = u8.subarray(19, 31), data = u8.subarray(31);
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(normKey(key)), 'PBKDF2', false, ['deriveKey']);
  const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  let plain;
  try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, data); }
  catch { throw new Error('密钥不对'); }
  const out = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(out).text());
}

let syncing = false, lastCheck = 0, lastLib = null, pendingPick = false;
async function cloudSync(manual, pick = true) {
  const key = LS.get('syncKey', '');
  if (!key) { if (manual) askKey(); return; }
  if (syncing || (!manual && Date.now() - lastCheck < 60000)) return;
  syncing = true; lastCheck = Date.now();
  const btn = $('#btnSync'); btn.textContent = '同步中…';
  try {
    const ver = await (await fetch(DATA + 'ver.json?' + Date.now(), { cache: 'no-store' })).json();
    if (ver.v === LS.get('cloudVer') && !manual) return;
    const buf = await (await fetch(DATA + 'lib.bin?' + ver.v, { cache: 'no-store' })).arrayBuffer();
    const lib = await decryptLib(buf, key);
    lastLib = lib;
    LS.set('cloudBooks', lib.books.map((b) => ({ key: b.key, title: b.title, count: b.chapters.length })));
    const n = await importLibrary(lib, true);
    LS.set('cloudVer', ver.v);
    const fresh = lib.books.filter((b) => !(b.key in choices()));
    if (manual && !n && !fresh.length && pick) toast('书都是最新的', 1500);
    if (!R.book) renderShelf();
    if (fresh.length && pick) { if (R.book) pendingPick = true; else openPick(); }
  } catch (e) {
    console.warn(e);
    if (manual || e.message === '密钥不对') toast(e.message === '密钥不对' ? '同步失败：密钥不对，在「管理」里重新填' : '同步失败，检查一下网络');
  } finally { syncing = false; btn.textContent = '同步'; }
}
$('#btnSync').onclick = () => cloudSync(true);

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
  $('#books').innerHTML = books.map((b) => {
    const p = progOf(b.id);
    const txt = p ? `读到 ${p.c + 1}/${b.count} 章` : `未读 · ${b.count} 章`;
    return `<div class="book" data-id="${esc(b.id)}">
      <div class="cover" style="${coverStyle(b.title)}"><div class="ct">${esc(b.title.slice(0, 12))}</div>
      <div class="cs">${b.source === 'pc' ? '我的书' : ''}</div></div>
      <div class="name">${esc(b.title)}</div><div class="prog">${txt}</div>
      <button class="del" data-del="${esc(b.id)}">×</button></div>`;
  }).join('');
  const last = books.find((b) => progOf(b.id));
  const rc = $('#recent');
  if (last) {
    const p = progOf(last.id);
    const c = await DB.get('content', last.id);
    const ct = c && c.chapters[p.c] ? c.chapters[p.c].t : '';
    rc.innerHTML = `<div class="lbl">继续阅读</div><div class="t">${esc(last.title)}</div><div class="c">${esc(ct)}</div>`;
    rc.dataset.id = last.id; rc.hidden = false;
  } else rc.hidden = true;
}

$('#recent').onclick = (e) => openBook(e.currentTarget.dataset.id);

/* 底部弹出菜单（不用系统 confirm，手机主屏 APP 里更可靠） */
function sheet(title, items) {
  return new Promise((done) => {
    const box = $('#sheet');
    box.querySelector('.sheet-title').textContent = title;
    const list = box.querySelector('.sheet-list');
    list.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('');
    const close = (v) => { document.body.classList.remove('sheet-open'); box.onclick = null; done(v); };
    box.onclick = (e) => {
      const b = e.target.closest('button[data-i]');
      if (b) close(items[+b.dataset.i].value);
      else if (e.target.closest('.sheet-cancel') || e.target === box) close(null);
    };
    document.body.classList.add('sheet-open');
  });
}

async function confirmDelete(b) {
  const pc = b.source === 'pc';
  const msg = pc ? `从书架删掉《${b.title}》？电脑更新了也不会再同步进来。想要回来，去「管理 → 选择同步哪些书」打开它。`
    : `从书架删掉《${b.title}》？阅读进度也会一起删。`;
  const ok = await sheet(msg, [{ label: '删除', value: 1, danger: true }]);
  if (!ok) return false;
  await DB.del('books', b.id); await DB.del('content', b.id);
  if (pc) setChoice(b.id.slice(3), false); else localStorage.removeItem('prog:' + b.id);
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
  const act = await sheet(`《${b.title}》 · ${b.count} 章`, [
    { label: '阅读', value: 'read' },
    { label: '导出 txt', value: 'export' },
    { label: '删除', value: 'del', danger: true },
  ]);
  if (act === 'read') openBook(id);
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
  const act = await sheet(`书架 · 版本 ${VERSION}`, items);
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
  if (needAdd) {
    if (lastLib) await importLibrary(lastLib, true);
    else { LS.set('cloudVer', ''); await cloudSync(true, false); }
  }
  if (removed.length) setTimeout(() => toast(`${removed.join('、')} 已移出书架，进度留着`, 3000), needAdd ? 3600 : 0);
  else if (!needAdd) toast('已保存');
  renderShelf();
};

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

function renderChapter(ratio = 0) {
  const ch = R.chapters[R.c];
  const last = R.c >= R.chapters.length - 1;
  $('#content').innerHTML =
    (ch.v ? `<div class="vol">${esc(ch.v)}</div>` : '') +
    `<h2>${esc(ch.t)}</h2>` + chapterHtml(ch) +
    `<div class="end">${last ? '<div class="done">— 已读到最后一章 —</div>' : '<button id="endNext">下一章</button>'}</div>`;
  $('#readTitle').textContent = R.book.title;
  $('#infoChap').textContent = ch.t;
  $('#chapSlider').max = R.chapters.length - 1;
  $('#chapSlider').value = R.c;
  const en = $('#endNext'); if (en) en.onclick = (e) => { e.stopPropagation(); goChapter(R.c + 1); };
  requestAnimationFrame(() => {
    scroller.scrollTop = ratio * (scroller.scrollHeight - scroller.clientHeight);
    updateInfo(); saveProgress();
  });
}

function curRatio() {
  const max = scroller.scrollHeight - scroller.clientHeight;
  return max > 0 ? Math.min(1, scroller.scrollTop / max) : 0;
}
function updateInfo() {
  $('#infoPct').textContent = `${R.c + 1}/${R.chapters.length} 章 · ${Math.round(curRatio() * 100)}%`;
}
function saveProgress() {
  if (!R.book) return;
  LS.set('prog:' + R.book.id, { c: R.c, r: curRatio(), at: Date.now() });
}
let saveT;
scroller.addEventListener('scroll', () => {
  updateInfo();
  clearTimeout(saveT); saveT = setTimeout(saveProgress, 300);
}, { passive: true });

function goChapter(i, ratio = 0) {
  if (i < 0 || i >= R.chapters.length) { toast(i < 0 ? '已经是第一章' : '已经是最后一章'); return; }
  R.c = i; renderChapter(ratio);
}

async function openBook(id) {
  const book = await DB.get('books', id);
  const c = await DB.get('content', id);
  if (!book || !c) { toast('这本书打不开了'); return; }
  R.book = book; R.chapters = c.chapters;
  const p = progOf(id) || { c: 0, r: 0 };
  R.c = Math.min(p.c, R.chapters.length - 1);
  $('#shelf').classList.remove('active');
  $('#reader').classList.add('active');
  document.body.classList.remove('menu-on');
  renderChapter(p.r);
  history.pushState({ reader: 1 }, '');
}
function closeBook() {
  saveProgress();
  R.book = null;
  closeToc();
  $('#reader').classList.remove('active');
  $('#shelf').classList.add('active');
  document.body.classList.remove('menu-on');
  renderShelf();
  if (pendingPick) { pendingPick = false; openPick(); }
}
$('#btnBack').onclick = () => { if (history.state && history.state.reader) history.back(); else closeBook(); };
window.addEventListener('popstate', () => { if (R.book) closeBook(); });

// 点按：左三分之一上翻，右三分之一下翻，中间呼出菜单
scroller.addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  if (document.body.classList.contains('menu-on')) { document.body.classList.remove('menu-on'); return; }
  const x = e.clientX / window.innerWidth;
  if (settings.mode === 'tap' && (x < 0.33 || x > 0.67)) {
    const step = scroller.clientHeight - settings.fs * settings.lh * 1.5;
    const max = scroller.scrollHeight - scroller.clientHeight;
    if (x > 0.67) {
      if (scroller.scrollTop >= max - 2) goChapter(R.c + 1);
      else scroller.scrollTop = Math.min(max, scroller.scrollTop + step);
    } else {
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

function keepRatio(fn) { const r = curRatio(); fn(); requestAnimationFrame(() => { scroller.scrollTop = r * (scroller.scrollHeight - scroller.clientHeight); }); }
$$('[data-font]').forEach((b) => b.onclick = () => keepRatio(() => {
  settings.fs = Math.max(13, Math.min(32, settings.fs + +b.dataset.font)); saveSettings();
}));
$$('[data-lh]').forEach((b) => b.onclick = () => keepRatio(() => {
  settings.lh = Math.max(1.3, Math.min(2.6, settings.lh + +b.dataset.lh)); saveSettings();
}));
$$('.swatch').forEach((b) => b.onclick = () => { settings.theme = b.dataset.theme; saveSettings(); });
$('#btnFace').onclick = () => keepRatio(() => { settings.serif = !settings.serif; saveSettings(); });
$('#btnMode').onclick = () => {
  settings.mode = settings.mode === 'tap' ? 'scroll' : 'tap'; saveSettings();
  toast(settings.mode === 'tap' ? '点屏幕左右两边翻页，中间呼出菜单' : '上下滑动阅读，点屏幕呼出菜单');
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
  let html = '', vol = null;
  R.chapters.forEach((ch, i) => {
    if (ch.v !== vol) { vol = ch.v; if (vol) html += `<li class="vol">${esc(vol)}</li>`; }
    html += `<li data-i="${i}" class="${i === R.c ? 'cur' : i < R.c ? 'read' : ''}">${esc(ch.t)}</li>`;
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

/* ---------- 启动 ---------- */
document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(); });
applySettings();
renderShelf();
updateSyncBtn();
migrateChoices().then(() => cloudSync(false));
document.addEventListener('visibilitychange', () => { if (!document.hidden) cloudSync(false); });
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
