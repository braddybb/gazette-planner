'use strict';
// Gazette Studio — editor UI: canvas, selection, inspector, templates, auto-fill, export.
var SUPA_URL = 'https://asgyshkafnrqknnmkbfo.supabase.co', SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzZ3lzaGthZm5ycWtubm1rYmZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMjk1MzUsImV4cCI6MjA5NTYwNTUzNX0.ry-VmO4TDzGAQnLVPQfLzL9jjfJhSGOrqBD_8LRL8PM';
var sb = null, SESSION = null;
var DOC = { brand: 'em', size: 'portrait', pages: [], cur: 0, caption: '' };
var SEL = null, MODE = 'add', SCALE = 1, HIST = [], FUT = [], DRAG = null, GUIDES = [];
var $ = function (id) { return document.getElementById(id); };
var B = function () { return BRANDS[DOC.brand]; }, S = function () { return SIZES[DOC.size]; };
var PG = function () { return DOC.pages[DOC.cur]; };
var EL = function () { var p = PG(); return p && SEL ? p.els.filter(function (e) { return e.id === SEL; })[0] : null; };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

// ── history ──────────────────────────────────────────────────────────────────
function snap() { return JSON.stringify({ pages: DOC.pages, cur: DOC.cur, brand: DOC.brand, size: DOC.size, caption: DOC.caption }); }
function hist() { HIST.push(snap()); if (HIST.length > 80) HIST.shift(); FUT = []; updHist(); }
function restore(j) { var o = JSON.parse(j); DOC.pages = o.pages; DOC.cur = Math.min(o.cur, o.pages.length - 1); DOC.brand = o.brand; DOC.size = o.size; DOC.caption = o.caption || ''; SEL = null; syncTop(); drawAll(true); }
function undo() { if (!HIST.length) return; FUT.push(snap()); restore(HIST.pop()); updHist(); }
function redo() { if (!FUT.length) return; HIST.push(snap()); restore(FUT.pop()); updHist(); }
function updHist() { $('undoBtn').disabled = !HIST.length; $('redoBtn').disabled = !FUT.length; }

// ── drawing ──────────────────────────────────────────────────────────────────
var _raf = 0; function requestRender() { if (_raf) return; _raf = requestAnimationFrame(function () { _raf = 0; drawAll(false); }); }
_onImg = requestRender;
function fitScale() {
  var w = $('cwrap').clientWidth - 36, h = $('cwrap').clientHeight - 36; if (window.innerWidth <= 960) h = 9999;
  SCALE = Math.max(0.05, Math.min(w / S().w, h / S().h, 1.2));
}
function drawMain() {
  var P = PG(), cv = $('cv'); if (!P) return;
  fitScale(); if (cv.width !== S().w || cv.height !== S().h) { cv.width = S().w; cv.height = S().h; }
  cv.style.width = Math.round(S().w * SCALE) + 'px'; cv.style.height = Math.round(S().h * SCALE) + 'px';
  var ctx = cv.getContext('2d'); ctx.clearRect(0, 0, S().w, S().h); renderPage(ctx, P, S(), true); drawOverlay();
}
function drawAll(full) {
  if (!PG()) return; drawMain(); drawStrip(); if (full) { drawInspector(); drawLayers(); drawTemplates(); drawLogos(); }
}
function drawOverlay() {
  var ov = $('ov'), el = EL(); ov.innerHTML = '';
  GUIDES.forEach(function (g) { var d = document.createElement('div'); d.className = 'guide'; if (g.x != null) { d.style.cssText = 'left:' + g.x * SCALE + 'px;top:0;width:1px;height:100%'; } else { d.style.cssText = 'top:' + g.y * SCALE + 'px;left:0;height:1px;width:100%'; } ov.appendChild(d); });
  if (!el) return;
  var s = document.createElement('div'); s.className = 'sel'; s.style.cssText = 'left:' + el.x * SCALE + 'px;top:' + el.y * SCALE + 'px;width:' + el.w * SCALE + 'px;height:' + el.h * SCALE + 'px'; ov.appendChild(s);
  [['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5], ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5]].forEach(function (h) {
    var d = document.createElement('div'); d.className = 'hdl'; d.dataset.h = h[0]; d.style.left = (el.x + el.w * h[1]) * SCALE - 6 + 'px'; d.style.top = (el.y + el.h * h[2]) * SCALE - 6 + 'px'; d.style.cursor = h[0] + '-resize'; ov.appendChild(d);
  });
}
function drawStrip() {
  var st = $('strip'); st.innerHTML = '';
  DOC.pages.forEach(function (p, i) {
    var d = document.createElement('div'); d.className = 'pg' + (i === DOC.cur ? ' on' : ''); var c = document.createElement('canvas'), tw = 84, th = Math.round(tw * S().h / S().w); c.width = tw * 2; c.height = th * 2; c.style.width = tw + 'px'; c.style.height = th + 'px';
    var x = c.getContext('2d'); x.scale(c.width / S().w, c.width / S().w); renderPage(x, p, S(), false);
    d.appendChild(c); d.appendChild(document.createTextNode(String(i + 1))); d.onclick = function () { DOC.cur = i; SEL = null; drawAll(true); }; st.appendChild(d);
  });
  var add = document.createElement('div'); add.style.cssText = 'display:flex;gap:6px;flex:none;flex-wrap:wrap;max-width:240px';
  [['+ Blank', function () { hist(); DOC.pages.splice(DOC.cur + 1, 0, { id: uid(), tpl: '', content: null, bg: B().primary, els: [] }); DOC.cur++; SEL = null; drawAll(true); }],
   ['Duplicate', function () { hist(); var p = JSON.parse(JSON.stringify(PG())); p.id = uid(); p.els.forEach(function (e) { e.id = uid(); }); DOC.pages.splice(DOC.cur + 1, 0, p); DOC.cur++; SEL = null; drawAll(true); }],
   ['←', function () { if (DOC.cur < 1) return; hist(); var a = DOC.pages; var t = a[DOC.cur]; a[DOC.cur] = a[DOC.cur - 1]; a[DOC.cur - 1] = t; DOC.cur--; drawAll(true); }],
   ['→', function () { if (DOC.cur >= DOC.pages.length - 1) return; hist(); var a = DOC.pages; var t = a[DOC.cur]; a[DOC.cur] = a[DOC.cur + 1]; a[DOC.cur + 1] = t; DOC.cur++; drawAll(true); }],
   ['Delete', function () { if (DOC.pages.length < 2) return; if (!confirm('Delete this slide?')) return; hist(); DOC.pages.splice(DOC.cur, 1); DOC.cur = Math.max(0, DOC.cur - 1); SEL = null; drawAll(true); }]
  ].forEach(function (b) { var x = document.createElement('button'); x.className = 'btn sm'; x.textContent = b[0]; x.onclick = b[1]; add.appendChild(x); });
  st.appendChild(add);
}

// ── selection + dragging ─────────────────────────────────────────────────────
function pt(ev) { var r = $('cv').getBoundingClientRect(); return { x: (ev.clientX - r.left) / SCALE, y: (ev.clientY - r.top) / SCALE }; }
function hit(p) { var P = PG(); for (var i = P.els.length - 1; i >= 0; i--) { var e = P.els[i]; if (e.hidden) continue; if (p.x >= e.x && p.x <= e.x + e.w && p.y >= e.y && p.y <= e.y + e.h) return e; } return null; }
function snapTo(el, dx, dy, mode, handle) {
  var S_ = S(), m = dims(S_).m, th = 8 / SCALE; GUIDES = [];
  var xs = [0, m, S_.w / 2, S_.w - m, S_.w], ys = [0, m, S_.h / 2, S_.h - m, S_.h];
  function near(v, arr) { var best = null; arr.forEach(function (a) { var d = Math.abs(a - v); if (d < th && (best === null || d < Math.abs(best - v))) best = a; }); return best; }
  if (mode === 'move') {
    var cands = [el.x, el.x + el.w / 2, el.x + el.w]; var bx = null; cands.forEach(function (c, i) { var n = near(c, xs); if (n !== null && bx === null) { bx = { off: n - c, at: n }; } });
    if (bx) { el.x += bx.off; GUIDES.push({ x: bx.at }); }
    var cy = [el.y, el.y + el.h / 2, el.y + el.h]; var by = null; cy.forEach(function (c) { var n = near(c, ys); if (n !== null && by === null) { by = { off: n - c, at: n }; } });
    if (by) { el.y += by.off; GUIDES.push({ y: by.at }); }
  }
}
function down(ev) {
  var P = PG(); if (!P) return; var p = pt(ev), h = ev.target.dataset && ev.target.dataset.h, el = EL();
  if (h && el) { hist(); DRAG = { mode: 'resize', h: h, start: p, orig: { x: el.x, y: el.y, w: el.w, h: el.h }, id: el.id }; }
  else { var t = hit(p); if (!t) { SEL = null; drawAll(true); return; }
    if (SEL !== t.id) { SEL = t.id; drawInspector(); drawLayers(); }
    hist(); DRAG = { mode: 'move', start: p, orig: { x: t.x, y: t.y }, id: t.id, moved: false }; }
  try { $('ov').setPointerCapture(ev.pointerId); } catch (e) { } drawMain(); ev.preventDefault();
}
function move(ev) {
  if (!DRAG) return; var el = EL(); if (!el) return; var p = pt(ev), dx = p.x - DRAG.start.x, dy = p.y - DRAG.start.y;
  if (DRAG.mode === 'move') { if (Math.abs(dx) + Math.abs(dy) > 1) DRAG.moved = true; el.x = Math.round(DRAG.orig.x + dx); el.y = Math.round(DRAG.orig.y + dy); snapTo(el, dx, dy, 'move'); }
  else {
    var o = DRAG.orig, h = DRAG.h, x = o.x, y = o.y, w = o.w, hh = o.h, keep = el.type === 'image' && h.length === 2 && !ev.shiftKey || (el.type !== 'image' && ev.shiftKey && h.length === 2);
    if (h.indexOf('e') > -1) w = o.w + dx; if (h.indexOf('s') > -1) hh = o.h + dy; if (h.indexOf('w') > -1) { w = o.w - dx; x = o.x + dx; } if (h.indexOf('n') > -1) { hh = o.h - dy; y = o.y + dy; }
    if (keep) { var r = o.w / o.h; if (Math.abs(w - o.w) > Math.abs(hh - o.h) * r) hh = w / r; else w = hh * r; if (h.indexOf('w') > -1) x = o.x + o.w - w; if (h.indexOf('n') > -1) y = o.y + o.h - hh; }
    if (w < 20) { if (h.indexOf('w') > -1) x -= 20 - w; w = 20; } if (hh < 20) { if (h.indexOf('n') > -1) y -= 20 - hh; hh = 20; }
    el.x = Math.round(x); el.y = Math.round(y); el.w = Math.round(w); el.h = Math.round(hh);
  }
  drawMain();
}
function up() { if (!DRAG) return; var was = DRAG; DRAG = null; GUIDES = []; if (was.mode === 'move' && !was.moved) { HIST.pop(); updHist(); } drawAll(true); }

// ── inspector ────────────────────────────────────────────────────────────────
function swatches(prop, cur, extra) {
  var pal = brandPalette(B()).concat(extra || []);
  return '<div class="sw">' + pal.map(function (c) { return '<button title="' + esc(c.n) + '" data-prop="' + prop + '" data-val="' + c.c + '" class="' + ((cur || '').toLowerCase() === c.c.toLowerCase() ? 'on' : '') + '" style="background:' + c.c + '"></button>'; }).join('') + '</div>' +
    '<details style="margin-top:4px"><summary class="hint" style="cursor:pointer">Other colour</summary><input type="color" data-prop="' + prop + '" value="' + (/^#[0-9a-f]{6}$/i.test(cur || '') ? cur : '#000000') + '"></details>';
}
function drawInspector() {
  var el = EL(), P = PG(), h = '';
  if (!P) { $('inspector').innerHTML = ''; return; }
  if (!el) {
    h += '<div class="grp">Slide ' + (DOC.cur + 1) + ' of ' + DOC.pages.length + '</div><label class="f">Background</label>' + swatches('page.bg', P.bg);
    h += '<div class="hint">Click anything on the slide to edit it. Drag to move, drag the handles to resize. Arrow keys nudge it, Delete removes it.</div>';
    if (P.tpl) h += '<div class="hint">Template: <b>' + esc(TPL[P.tpl] ? TPL[P.tpl].name : P.tpl) + '</b></div>';
    if (DOC.caption) h += '<div class="grp">Caption</div><div class="capbox" id="capbox">' + esc(DOC.caption) + '</div><button class="btn sm" style="margin-top:6px" id="capCopy">Copy caption</button>';
    $('inspector').innerHTML = h; var cc = $('capCopy'); if (cc) cc.onclick = function () { navigator.clipboard && navigator.clipboard.writeText(DOC.caption); cc.textContent = 'Copied'; }; return;
  }
  h += '<div class="grp">' + (el.type === 'text' ? 'Text' : el.type === 'image' ? 'Photo / logo' : 'Shape') + '</div>';
  if (el.type === 'text') {
    h += '<textarea id="txtIn" data-prop="text">' + esc(el.text) + '</textarea>';
    h += '<div class="tbtn" style="margin-top:6px"><button id="mAcc">*Accent*</button><button id="mBar">==Bar==</button></div><div class="hint">Select words, then press Accent or Bar to highlight them.</div>';
    h += '<div class="row"><label class="f">Font<select data-prop="font"><option value="head"' + (el.font === 'head' ? ' selected' : '') + '>Calistoga</option><option value="body"' + (el.font === 'body' ? ' selected' : '') + '>Source Sans Pro</option></select></label>' +
      '<label class="f">Weight<select data-prop="weight">' + [400, 600, 700, 900].map(function (w) { return '<option value="' + w + '"' + (el.weight === w ? ' selected' : '') + '>' + { 400: 'Regular', 600: 'Semibold', 700: 'Bold', 900: 'Black' }[w] + '</option>'; }).join('') + '</select></label></div>';
    h += '<label class="f">Size <input type="number" data-prop="size" data-num="1" value="' + el.size + '"></label>';
    h += '<label class="f">Text colour</label>' + swatches('color', el.color);
    h += '<label class="f">Accent colour</label>' + swatches('accentColor', el.accentColor);
    h += '<label class="f">Bar colour</label>' + swatches('barColor', el.barColor);
    h += '<label class="f">Align</label><div class="tbtn">' + ['left', 'center', 'right'].map(function (a) { return '<button data-prop="align" data-val="' + a + '" class="' + (el.align === a ? 'on' : '') + '">' + a + '</button>'; }).join('') + '</div>';
    h += '<label class="f">Vertical</label><div class="tbtn">' + [['top', 'top'], ['middle', 'middle'], ['bottom', 'bottom']].map(function (a) { return '<button data-prop="valign" data-val="' + a[0] + '" class="' + (el.valign === a[0] ? 'on' : '') + '">' + a[1] + '</button>'; }).join('') + '</div>';
    h += '<label class="f">Line spacing <input type="range" min="0.8" max="1.8" step="0.02" data-prop="lh" data-num="1" value="' + el.lh + '"></label>';
    h += '<label class="f"><input type="checkbox" data-prop="upper" data-bool="1"' + (el.upper ? ' checked' : '') + '> ALL CAPS</label><label class="f"><input type="checkbox" data-prop="fit" data-bool="1"' + (el.fit ? ' checked' : '') + '> Shrink to fit the box</label>';
  } else if (el.type === 'image') {
    h += '<div class="tbtn"><button id="imgReplace">' + (el.src ? 'Replace photo' : 'Add a photo') + '</button>' + (el.src && !el.logo ? '<button id="imgClear">Clear</button>' : '') + '</div>';
    h += '<label class="f">Fit<select data-prop="fit"><option value="cover"' + (el.fit === 'cover' ? ' selected' : '') + '>Fill the box</option><option value="contain"' + (el.fit === 'contain' ? ' selected' : '') + '>Show all of it</option></select></label>';
    h += '<label class="f">Zoom <input type="range" min="0.5" max="3" step="0.02" data-prop="zoom" data-num="1" value="' + el.zoom + '"></label><label class="f">Move left / right <input type="range" min="-0.6" max="0.6" step="0.01" data-prop="ox" data-num="1" value="' + (el.ox || 0) + '"></label><label class="f">Move up / down <input type="range" min="-0.6" max="0.6" step="0.01" data-prop="oy" data-num="1" value="' + (el.oy || 0) + '"></label>';
    h += '<label class="f">Rounded corners <input type="range" min="0" max="200" step="2" data-prop="radius" data-num="1" value="' + (el.radius || 0) + '"></label><label class="f"><input type="checkbox" data-prop="circle" data-bool="1"' + (el.circle ? ' checked' : '') + '> Circle crop</label>';
  } else {
    h += '<label class="f">Colour</label>' + swatches('fill', el.fill);
    h += '<label class="f">Rounded corners <input type="range" min="0" max="200" step="2" data-prop="radius" data-num="1" value="' + (el.radius || 0) + '"></label><label class="f"><input type="checkbox" data-prop="circle" data-bool="1"' + (el.circle ? ' checked' : '') + '> Circle</label>';
    h += '<label class="f">Shadow <input type="range" min="0" max="60" step="2" data-prop="shadow" data-num="1" value="' + (el.shadow || 0) + '"></label>';
  }
  h += '<div class="grp">Position</div><div class="row"><label class="f">X<input type="number" data-prop="x" data-num="1" value="' + Math.round(el.x) + '"></label><label class="f">Y<input type="number" data-prop="y" data-num="1" value="' + Math.round(el.y) + '"></label></div><div class="row"><label class="f">Width<input type="number" data-prop="w" data-num="1" value="' + Math.round(el.w) + '"></label><label class="f">Height<input type="number" data-prop="h" data-num="1" value="' + Math.round(el.h) + '"></label></div>';
  h += '<div class="tbtn" style="margin-top:10px"><button id="elDup">Duplicate</button><button id="elFwd">Bring forward</button><button id="elBack">Send back</button><button id="elDel">Delete</button></div>';
  $('inspector').innerHTML = h;
  var ti = $('txtIn'); if (ti) { var wrap = function (m) { var a = ti.selectionStart, b = ti.selectionEnd; if (a === b) return; hist(); el.text = el.text.slice(0, a) + m + el.text.slice(a, b) + m + el.text.slice(b); drawAll(true); }; $('mAcc').onclick = function () { wrap('*'); }; $('mBar').onclick = function () { wrap('=='); }; }
  var ir = $('imgReplace'); if (ir) ir.onclick = function () { pickFile(function (ref) { hist(); el.src = ref; if (el.fit === 'cover' || !el.fit) { } drawAll(true); }); };
  var ic = $('imgClear'); if (ic) ic.onclick = function () { hist(); el.src = ''; drawAll(true); };
  $('elDup').onclick = function () { hist(); var c = JSON.parse(JSON.stringify(el)); c.id = uid(); c.x += 30; c.y += 30; PG().els.push(c); SEL = c.id; drawAll(true); };
  $('elDel').onclick = delSel; $('elFwd').onclick = function () { reorder(1); }; $('elBack').onclick = function () { reorder(-1); };
}
function reorder(d) { var P = PG(), i = P.els.findIndex(function (e) { return e.id === SEL; }), j = i + d; if (i < 0 || j < 0 || j >= P.els.length) return; hist(); var t = P.els[i]; P.els[i] = P.els[j]; P.els[j] = t; drawAll(true); }
function delSel() { var P = PG(); if (!SEL) return; hist(); P.els = P.els.filter(function (e) { return e.id !== SEL; }); SEL = null; drawAll(true); }
var _typing = 0;
function onInspect(ev) {
  var t = ev.target, prop = t.dataset && t.dataset.prop; if (!prop) return;
  if (ev.type === 'click' && t.tagName !== 'BUTTON') return; if (ev.type === 'input' && t.tagName === 'BUTTON') return;
  var val = t.dataset.val !== undefined ? t.dataset.val : t.type === 'checkbox' ? t.checked : t.value; if (t.dataset.num) val = parseFloat(val) || 0; if (prop === 'weight') val = parseInt(val, 10);
  if (t.type === 'range' || t.type === 'number' || t.tagName === 'TEXTAREA') { var now = Date.now(); if (now - _typing > 900) hist(); _typing = now; } else hist();
  if (prop === 'page.bg') { PG().bg = val; } else { var el = EL(); if (!el) return; el[prop] = val; if (prop === 'font' && val === 'head') el.weight = 400; }
  if (prop === 'text' || t.type === 'range' || t.type === 'number') { drawAll(false); if (t.type !== 'range') { } } else drawAll(true);
  if (t.tagName === 'BUTTON' || t.type === 'checkbox') drawAll(true);
}
function drawLayers() {
  var P = PG(), l = $('layerList'); l.innerHTML = ''; if (!P) return;
  P.els.slice().reverse().forEach(function (e) {
    var d = document.createElement('div'); d.className = 'layer' + (e.id === SEL ? ' on' : ''); var nm = e.type === 'text' ? (e.text || 'Text').replace(/[*=]/g, '').slice(0, 28) : e.type === 'image' ? (e.logo ? 'Logo' : 'Photo') : 'Shape';
    d.innerHTML = '<span>' + (e.type === 'text' ? 'T ' : e.type === 'image' ? '▣ ' : '▢ ') + esc(nm) + '</span><button title="Hide/show">' + (e.hidden ? '○' : '●') + '</button>';
    d.onclick = function () { SEL = e.id; drawAll(true); }; d.querySelector('button').onclick = function (ev) { ev.stopPropagation(); hist(); e.hidden = !e.hidden; drawAll(true); }; l.appendChild(d);
  });
}

// ── templates / elements ─────────────────────────────────────────────────────
function drawTemplates() {
  if (!$('pane-tpl').classList.contains('on') && $('tplList').dataset.k === DOC.brand + DOC.size) return;
  var box = $('tplList'); box.dataset.k = DOC.brand + DOC.size; box.innerHTML = ''; var groups = {};
  TEMPLATES.forEach(function (t) { (groups[t.group] = groups[t.group] || []).push(t); });
  Object.keys(groups).forEach(function (g) {
    var h = document.createElement('div'); h.className = 'grp'; h.textContent = g; box.appendChild(h); var grid = document.createElement('div'); grid.className = 'tgrid';
    groups[g].forEach(function (t) {
      var b = document.createElement('button'); b.className = 'tcard'; var c = document.createElement('canvas'), tw = 130, th = Math.round(tw * S().h / S().w); c.width = tw * 2; c.height = th * 2;
      var pg = t.make(B(), S(), null), x = c.getContext('2d'); x.scale(c.width / S().w, c.width / S().w); renderPage(x, pg, S(), true);
      b.appendChild(c); var sp = document.createElement('span'); sp.textContent = t.name; b.appendChild(sp); b.onclick = function () { applyTemplate(t.key); }; grid.appendChild(b);
    }); box.appendChild(grid);
  });
}
function applyTemplate(key) {
  hist(); var cur = PG(), c = cur && cur.content ? cur.content : null, pg = buildPage(key, B(), S(), c);
  if (MODE === 'replace' && cur) DOC.pages[DOC.cur] = pg; else { DOC.pages.splice(DOC.cur + 1, 0, pg); if (DOC.pages.length > 1) DOC.cur++; }
  SEL = null; drawAll(true);
}
function drawLogos() {
  var l = $('logoList'); l.innerHTML = ''; var names = Object.keys(LOGO_MANIFEST).filter(function (n) { return n.indexOf(DOC.brand + '-') === 0; }).sort();
  if (!names.length) { l.innerHTML = '<div class="hint">No logo files for this masthead yet.</div>'; return; }
  names.forEach(function (n) { var b = document.createElement('button'); var dark = /white/.test(n); b.style.background = dark ? '#1B180B' : '#E9E6DC'; b.innerHTML = '<img src="studio-assets/logos/' + n + '" alt="' + n + '">'; b.onclick = function () { var sz = LOGO_MANIFEST[n], w = Math.round(S().w * (sz[0] / sz[1] > 2 ? 0.4 : 0.2)); addEl(img({ src: 'studio-assets/logos/' + n, logo: true, fit: 'contain', x: Math.round(S().w * 0.06), y: Math.round(S().h * 0.06), w: w, h: Math.round(w * sz[1] / sz[0]) })); }; l.appendChild(b); });
}
function addEl(e) { if (!PG()) return; hist(); PG().els.push(e); SEL = e.id; drawAll(true); }
function pickFile(cb) {
  var f = $('fileIn'); f.value = ''; f.onchange = function () { if (f.files[0]) readImage(f.files[0], cb); }; f.click();
}
function readImage(file, cb) {
  var r = new FileReader(); r.onload = function () { var im = new Image(); im.onload = function () { // keep uploads a sensible size
      var max = 2400, s = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      var id = 'p' + Date.now().toString(36) + Math.floor(Math.random() * 999); UPL[id] = c.toDataURL(/png/i.test(file.type) ? 'image/png' : 'image/jpeg', 0.92); cb('u:' + id); }; im.src = r.result; }; r.readAsDataURL(file);
}
function setupAdd() {
  document.querySelectorAll('[data-add]').forEach(function (b) {
    b.onclick = function () {
      var k = b.dataset.add, Sz = S(), u = dims(Sz).u, m = dims(Sz).m, Bd = B();
      if (k === 'head') addEl(txt({ text: 'New heading', size: Math.round(90 * u), color: Bd.ink, x: m, y: m, w: Sz.w - m * 2, h: Math.round(200 * u) }));
      else if (k === 'sub') addEl(txt({ text: 'Subheading', font: 'body', weight: 700, size: Math.round(46 * u), color: Bd.ink, x: m, y: m, w: Sz.w - m * 2, h: Math.round(80 * u) }));
      else if (k === 'body') addEl(txt({ text: 'Body text goes here.', font: 'body', size: Math.round(36 * u), color: Bd.ink, x: m, y: m, w: Sz.w - m * 2, h: Math.round(220 * u), lh: 1.3 }));
      else if (k === 'rect') addEl(rect({ fill: Bd.secondary, x: m, y: m, w: Math.round(Sz.w * 0.5), h: Math.round(Sz.h * 0.2), radius: 0 }));
      else if (k === 'circle') { var d = Math.round(Math.min(Sz.w, Sz.h) * 0.25); addEl(rect({ fill: Bd.secondary, circle: true, x: m, y: m, w: d, h: d })); }
      else if (k === 'bar') addEl(rect({ fill: Bd.ink, x: m, y: m, w: Math.round(Sz.w * 0.3), h: Math.round(10 * u) }));
      else if (k === 'slot') addEl(img({ role: 'photo', x: m, y: m, w: Math.round(Sz.w * 0.5), h: Math.round(Sz.h * 0.35) }));
      else if (k === 'upload') pickFile(function (ref) { var s0 = Math.round(Sz.w * 0.5); addEl(img({ src: ref, x: m, y: m, w: s0, h: Math.round(s0 * 0.75) })); });
    };
  });
}

// ── brand / size ─────────────────────────────────────────────────────────────
function syncTop() { $('brandSel').value = DOC.brand; $('sizeSel').value = DOC.size; $('afBrand').value = DOC.brand; }
function rebuildAll() {
  DOC.pages = DOC.pages.map(function (p) { if (!p.tpl) return p; var n = buildPage(p.tpl, B(), S(), p.content); n.id = p.id; return n; });
  SEL = null; drawAll(true);
}
function changeTheme(kind, val) {
  var tplPages = DOC.pages.filter(function (p) { return p.tpl; }).length;
  if (tplPages && !confirm('Switching ' + kind + ' rebuilds the template slides, so any manual edits on them will be reset (you can Undo).')) { syncTop(); return; }
  hist(); var old = S(); DOC[kind === 'masthead' ? 'brand' : 'size'] = val; $('tplList').dataset.k = '';
  if (kind === 'size') { var sx = S().w / old.w, sy = S().h / old.h, sm = Math.min(sx, sy); DOC.pages.forEach(function (p) { if (p.tpl) return; p.els.forEach(function (e) { e.x = Math.round(e.x * sx); e.w = Math.round(e.w * sx); e.y = Math.round(e.y * sy); e.h = Math.round(e.h * sy); if (e.size) e.size = Math.round(e.size * sm); }); }); }
  rebuildAll(); syncTop();
}

// ── export ───────────────────────────────────────────────────────────────────
async function fontsReady() { try { await Promise.all([document.fonts.load('400 40px Calistoga'), document.fonts.load('400 40px "Source Sans Pro"'), document.fonts.load('600 40px "Source Sans Pro"'), document.fonts.load('700 40px "Source Sans Pro"'), document.fonts.load('900 40px "Source Sans Pro"')]); } catch (e) { } }
async function pageCanvas(p) { await preload(pageSources(p)); var c = document.createElement('canvas'); c.width = S().w; c.height = S().h; renderPage(c.getContext('2d'), p, S(), false); return c; }
function blobOf(c, type, q) { return new Promise(function (r) { c.toBlob(r, type, q); }); }
function dl(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); }); }
function baseName() { var h = ''; DOC.pages.forEach(function (p) { p.els.forEach(function (e) { if (!h && e.role === 'headline') h = e.text; }); }); return B().code + '-' + slug(clean(h || 'graphic')); }
async function doExport(kind) {
  if (!kind || !DOC.pages.length) return; await fontsReady(); var sel = $('exportSel'); sel.disabled = true;
  try {
    if (kind === 'png') dl(await blobOf(await pageCanvas(PG()), 'image/png'), baseName() + '-' + (DOC.cur + 1) + '.png');
    else if (kind === 'zip') { if (!window.JSZip) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'); var z = new JSZip(); for (var i = 0; i < DOC.pages.length; i++) z.file(baseName() + '-' + (i + 1) + '.png', await blobOf(await pageCanvas(DOC.pages[i]), 'image/png')); dl(await z.generateAsync({ type: 'blob' }), baseName() + '.zip'); }
    else if (kind === 'pdf') { if (!window.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'); var w = S().w, h = S().h, pdf = new jspdf.jsPDF({ orientation: w > h ? 'l' : 'p', unit: 'px', format: [w, h], hotfixes: ['px_scaling'] }); for (var j = 0; j < DOC.pages.length; j++) { if (j) pdf.addPage([w, h], w > h ? 'l' : 'p'); pdf.addImage((await pageCanvas(DOC.pages[j])).toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, w, h); } dl(pdf.output('blob'), baseName() + '.pdf'); }
  } catch (e) { alert('Export failed: ' + e.message); }
  sel.value = ''; sel.disabled = false;
}

// ── save / open a draft file (includes uploaded photos) ─────────────────────
function saveDraft() {
  var used = {}; DOC.pages.forEach(function (p) { p.els.forEach(function (e) { if (e.type === 'image' && e.src && e.src.indexOf('u:') === 0) used[e.src.slice(2)] = UPL[e.src.slice(2)]; }); DOC.pages.forEach(function (pp) { if (pp.content && pp.content.photo && pp.content.photo.indexOf('u:') === 0) used[pp.content.photo.slice(2)] = UPL[pp.content.photo.slice(2)]; }); });
  var blob = new Blob([JSON.stringify({ studio: 1, doc: JSON.parse(snap()), uploads: used })], { type: 'application/json' }); dl(blob, baseName() + '.studio.json');
}
function openDraft() {
  var f = $('draftIn'); f.value = ''; f.onchange = function () {
    var r = new FileReader(); r.onload = function () { try { var o = JSON.parse(r.result); if (!o.studio || !o.doc) throw 0; hist(); Object.keys(o.uploads || {}).forEach(function (k) { UPL[k] = o.uploads[k]; delete IMGC['u:' + k]; }); restore(JSON.stringify(o.doc)); $('tplList').dataset.k = ''; drawAll(true); } catch (e) { alert('That isn\u2019t a Studio draft file.'); } }; if (f.files[0]) r.readAsText(f.files[0]);
  }; f.click();
}

// ── auto-fill ────────────────────────────────────────────────────────────────
function showCheck(list) { var c = $('check'); if (!list || !list.length) { c.style.display = 'none'; return; } c.style.display = 'block'; c.innerHTML = '<b>Check before posting.</b> Auto-fill reads the story but a person must confirm it.<ul>' + list.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul> <button class="btn sm" id="chkX">Dismiss</button>'; $('chkX').onclick = function () { c.style.display = 'none'; drawAll(false); }; }
async function token() { var r = await sb.auth.getSession(); return r.data && r.data.session ? r.data.session.access_token : ''; }
function brandFromPub(pub) { for (var k in BRANDS) if (BRANDS[k].pubs.indexOf(pub) > -1) return k; return null; }
var PLANNER = [];
async function loadPlanner() {
  var sel = $('afPlanner'); try {
    var r = await sb.from('planner_stories').select('reporter,publication,week_of,story_num,headline').neq('headline', '').order('week_of', { ascending: false }).limit(80);
    PLANNER = (r.data || []).filter(function (x) { return x.headline && x.headline.trim(); });
    sel.innerHTML = '<option value="">Choose a story…</option>' + PLANNER.map(function (x, i) { return '<option value="' + i + '">' + esc(x.reporter.split(' ')[0] + ' — ' + x.headline.slice(0, 70)) + '</option>'; }).join('');
  } catch (e) { }
}
function openAuto() { $('afErr').textContent = ''; $('afBrand').value = DOC.brand; $('autoModal').classList.add('on'); loadPlanner(); }
async function runAuto() {
  var url = $('afUrl').value.trim(), pi = $('afPlanner').value, err = $('afErr'), go = $('afGo'), brand = $('afBrand').value, out = $('afOut').value, st = pi !== '' ? PLANNER[+pi] : null;
  if (!url && !st) { err.textContent = 'Paste the published story link, or choose a planner story.'; return; }
  go.disabled = true; err.innerHTML = '<span class="spin"></span>' + (url ? 'Reading the story… this takes about 10–20 seconds.' : 'Building…'); var c, warnings = [];
  try {
    if (url) {
      var r = await fetch('/.netlify/functions/studio-extract', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await token() }, body: JSON.stringify({ url: url }) });
      var d = await r.json(); if (!r.ok || d.error) throw new Error(d.error || 'Something went wrong (' + r.status + ')');
      var ref = ''; if (d.image && $('afPhoto').checked) { var id = 'a' + Date.now().toString(36); UPL[id] = d.image; ref = 'u:' + id; }
      var host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { }
      c = { headline: d.headline, emphasis: d.emphasis || '', deck: d.deck, quote: d.pullQuote || '', speaker: d.quoteSpeaker || '', stat: d.stat || '', statCaption: d.statCaption || '', slides: d.slides || [], cta: 'Read the full story', url: host || 'link in bio', photo: ref, byline: d.byline || '' };
      DOC.caption = d.caption || ''; warnings = d.warnings || [];
      if (d.image === '' && $('afPhoto').checked) warnings.push('No usable lead photo came through, so photo slots are empty. Upload one.');
    } else { c = { headline: st.headline, emphasis: '', slides: [], cta: 'Read the full story', url: 'link in bio', photo: '' }; warnings.push('Built from the planner headline only. Add the published link and run it again to fill the rest.'); DOC.caption = ''; }
    hist(); if (brand !== DOC.brand) DOC.brand = brand; if (out === 'thumb') DOC.size = 'thumb'; else if (DOC.size === 'thumb' || DOC.size === 'header' || DOC.size === 'og') DOC.size = 'portrait';
    var pages;
    if (out === 'carousel') { pages = buildCarousel(B(), S(), c); if (!url) pages = pages.slice(0, 1); }
    else if (out === 'cover') pages = [buildPage(c.photo ? 'cover_photo' : 'cover_bars', B(), S(), c)];
    else if (out === 'thumb') pages = [buildPage('thumb_bars', B(), S(), c)];
    else if (out === 'quote') { if (!c.quote) { warnings.push('The story has no quote that can be used word-for-word, so no quote card was made.'); pages = [buildPage(c.photo ? 'cover_photo' : 'cover_bars', B(), S(), c)]; } else pages = [buildPage(c.photo ? 'quote_photo' : 'quote_dark', B(), S(), c)]; }
    else { if (!c.stat) { warnings.push('No standout number found in the story.'); pages = [buildPage('cover_bars', B(), S(), c)]; } else pages = [buildPage('stat_card', B(), S(), c)]; }
    DOC.pages = pages; DOC.cur = 0; SEL = null; $('autoModal').classList.remove('on'); syncTop(); $('tplList').dataset.k = ''; showCheck(warnings); drawAll(true); err.textContent = '';
  } catch (e) { err.textContent = e.message; }
  go.disabled = false;
}

// ── auth ─────────────────────────────────────────────────────────────────────
async function boot() {
  try { await fetch('studio-assets/logos/manifest.json').then(function (r) { return r.json(); }).then(function (j) { LOGO_MANIFEST = j; }); } catch (e) { }
  sb = window.supabase.createClient(SUPA_URL, SUPA_KEY); var r = await sb.auth.getSession(); SESSION = r.data && r.data.session;
  if (!SESSION) { $('loginModal').classList.add('on'); return new Promise(function (res) { $('lgGo').onclick = async function () { $('lgErr').textContent = ''; var x = await sb.auth.signInWithPassword({ email: $('lgEmail').value.trim(), password: $('lgPass').value }); if (x.error) { $('lgErr').textContent = 'That login didn’t work.'; return; } SESSION = x.data.session; $('loginModal').classList.remove('on'); res(); }; }); }
}
function init() {
  $('brandSel').innerHTML = Object.keys(BRANDS).map(function (k) { return '<option value="' + k + '">' + BRANDS[k].name + '</option>'; }).join(''); $('afBrand').innerHTML = $('brandSel').innerHTML;
  $('sizeSel').innerHTML = Object.keys(SIZES).map(function (k) { return '<option value="' + k + '">' + SIZES[k].name + '</option>'; }).join('');
  $('brandSel').onchange = function () { changeTheme('masthead', this.value); }; $('sizeSel').onchange = function () { changeTheme('size', this.value); };
  $('autoBtn').onclick = openAuto; $('afCancel').onclick = function () { $('autoModal').classList.remove('on'); }; $('afGo').onclick = runAuto;
  $('afPlanner').onchange = function () { var i = this.value; if (i === '') return; var b = brandFromPub(PLANNER[+i].publication); if (b) $('afBrand').value = b; };
  $('saveBtn').onclick = saveDraft; $('openBtn').onclick = openDraft;
  $('undoBtn').onclick = undo; $('redoBtn').onclick = redo; $('exportSel').onchange = function () { doExport(this.value); };
  document.querySelectorAll('.tabs button').forEach(function (b) { b.onclick = function () { document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.toggle('on', x === b); }); document.querySelectorAll('.pane').forEach(function (p) { p.classList.toggle('on', p.id === 'pane-' + b.dataset.tab); }); if (b.dataset.tab === 'tpl') drawTemplates(); if (b.dataset.tab === 'layers') drawLayers(); }; });
  $('applyMode').onclick = function (e) { var m = e.target.dataset && e.target.dataset.m; if (!m) return; MODE = m; this.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.m === m); }); };
  var ov = $('ov'); ov.addEventListener('pointerdown', down); ov.addEventListener('pointermove', move); ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
  ov.addEventListener('dblclick', function (ev) { var t = hit(pt(ev)); if (t && t.type === 'text') { SEL = t.id; drawAll(true); var ti = $('txtIn'); if (ti) { ti.focus(); ti.select(); } } else if (t && t.type === 'image' && !t.logo) { SEL = t.id; drawAll(true); var ir = $('imgReplace'); if (ir) ir.click(); } });
  var cb = $('cvbox'); cb.addEventListener('dragover', function (e) { e.preventDefault(); }); cb.addEventListener('drop', function (e) { e.preventDefault(); var f = e.dataTransfer.files[0]; if (!f || !/^image\//.test(f.type)) return; var t = hit(pt(e)); readImage(f, function (ref) { hist(); if (t && t.type === 'image' && !t.logo) { t.src = ref; SEL = t.id; } else { var s0 = Math.round(S().w * 0.5), n = img({ src: ref, x: Math.round(S().w * 0.25), y: Math.round(S().h * 0.25), w: s0, h: Math.round(s0 * 0.75) }); PG().els.push(n); SEL = n.id; } drawAll(true); }); });
  $('inspector').addEventListener('input', onInspect); $('inspector').addEventListener('click', onInspect);
  document.addEventListener('keydown', function (e) {
    var tg = e.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    var el = EL(); if (!el) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); delSel(); } else if (e.key === 'Escape') { SEL = null; drawAll(true); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); var d = $('elDup'); if (d) d.click(); }
    else if (e.key.indexOf('Arrow') === 0) { e.preventDefault(); var st = e.shiftKey ? 10 : 1; hist(); if (e.key === 'ArrowLeft') el.x -= st; if (e.key === 'ArrowRight') el.x += st; if (e.key === 'ArrowUp') el.y -= st; if (e.key === 'ArrowDown') el.y += st; drawAll(true); }
  });
  window.addEventListener('resize', function () { drawAll(false); }); window.addEventListener('beforeunload', function (e) { if (HIST.length > 3) { e.preventDefault(); e.returnValue = ''; } });
  setupAdd(); syncTop();
}
(async function () {
  init(); await boot(); await fontsReady(); drawLogos();
  DOC.pages = [buildPage('cover_bars', B(), S(), null)]; DOC.cur = 0; drawAll(true); updHist(); setTimeout(function () { drawAll(true); }, 400);
})();
