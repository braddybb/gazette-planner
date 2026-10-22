'use strict';
// Gazette Studio — core: brands, sizes, and the canvas renderer (text with bars/accents, images, shapes).
var FONT = { head: 'Calistoga, Georgia, serif', body: '"Source Sans Pro", "Source Sans 3", system-ui, sans-serif' };

var BRANDS = {
  em:  { code: 'em',  name: 'Eastern Melburnian',   handle: '@easternmelburnian',  primary: '#FBBD8D', secondary: '#E68587', ink: '#1B180B', cream: '#FEFBED', pubs: ['Eastern Melburnian'] },
  nsl: { code: 'nsl', name: 'North Shore Lorikeet', handle: '@northshorelorikeet', primary: '#75D6F1', secondary: '#FCDB3B', ink: '#1B180B', cream: '#FEFBED', pubs: ['North Shore Lorikeet'] },
  mnc: { code: 'mnc', name: 'Mid North Coaster',    handle: '@midnorthcoaster',    primary: '#90EFCF', secondary: '#FFEA8F', ink: '#1B180B', cream: '#FEFBED', pubs: ['Mid North Coaster'] },
  gm:  { code: 'gm',  name: 'Gippsland Monitor',    handle: '@gippslandmonitor',   primary: '#9CC2A8', secondary: '#DFB16A', ink: '#1B180B', cream: '#FEFBED', pubs: ['Gippsland Monitor'] },
  wvb: { code: 'wvb', name: 'West Vic Brolga',      handle: '@westvicbrolga',      primary: '#F1A59A', secondary: '#C5C9D2', ink: '#1B180B', cream: '#FEFBED', pubs: ['West Vic Brolga — Ballarat', 'West Vic Brolga — Wannon'] },
  na:  { code: 'na',  name: 'National Account',     handle: '@thenationalaccount', primary: '#F6F3F0', secondary: '#D73D40', ink: '#1C1809', cream: '#FFFFFF', pubs: ['National Account'], noLogos: true }
};
var SIZES = {
  portrait: { key: 'portrait', name: 'Instagram portrait 4:5', w: 1080, h: 1350 },
  square:   { key: 'square',   name: 'Square 1:1',             w: 1080, h: 1080 },
  story:    { key: 'story',    name: 'Story / Reel cover 9:16', w: 1080, h: 1920 },
  thumb:    { key: 'thumb',    name: 'Video thumbnail 16:9',   w: 1280, h: 720 },
  og:       { key: 'og',       name: 'Web / social share 1.91:1', w: 1200, h: 630 },
  header:   { key: 'header',   name: 'Newsletter header 3:1',  w: 1200, h: 400 }
};
var LOGO_MANIFEST = {};   // filled from studio-assets/logos/manifest.json
var UPL = {};             // uploaded images: id -> dataURL (elements refer to them as "u:<id>")
var _uid = 0; function uid() { return 'e' + Date.now().toString(36) + (++_uid); }

function brandPalette(B) { return [{ n: 'Ink', c: B.ink }, { n: 'Cream', c: B.cream }, { n: 'White', c: '#FFFFFF' }, { n: 'Primary', c: B.primary }, { n: 'Secondary', c: B.secondary }]; }

// Pick a logo file for a brand. kind: logo | mascot | mono. onDark: true when the background is dark.
function pickLogo(B, kind, onDark) {
  if (B.noLogos) return '';
  var has = function (k, v) { return LOGO_MANIFEST[B.code + '-' + k + '-' + v + '.png']; };
  var order;
  if (onDark) order = { logo: [['logo', 'white'], ['mascot', 'white']], mascot: [['mascot', 'white']], mono: [['mono', 'white'], ['mascot', 'white']] }[kind];
  else order = { logo: [['logo', 'colour'], ['logo', 'bw']], mascot: [['mascot', 'colour'], ['mascot', 'bw']], mono: [['mono', 'black'], ['mascot', 'colour']] }[kind];
  for (var i = 0; i < order.length; i++) if (has(order[i][0], order[i][1])) return 'studio-assets/logos/' + B.code + '-' + order[i][0] + '-' + order[i][1] + '.png';
  return '';
}
function logoSize(src) { var n = (src || '').split('/').pop(); return LOGO_MANIFEST[n] || [1, 1]; }

// ── element constructors ─────────────────────────────────────────────────────
function mk(type, o) { return Object.assign({ id: uid(), type: type, x: 0, y: 0, w: 100, h: 100 }, o); }
function txt(o) { return mk('text', Object.assign({ text: '', font: 'head', size: 64, weight: 400, color: '#000000', align: 'left', valign: 'top', lh: 1.1, fit: true, upper: false, barColor: '#FFFFFF', accentColor: '#E68587', role: '' }, o)); }
function rect(o) { return mk('rect', Object.assign({ fill: '#FFFFFF', radius: 0 }, o)); }
function img(o) { return mk('image', Object.assign({ src: '', fit: 'cover', zoom: 1, ox: 0, oy: 0, radius: 0, anchor: 'center', role: '' }, o)); }

// ── images ───────────────────────────────────────────────────────────────────
var IMGC = {}; var _onImg = function () { };
function resolveSrc(s) { return s && s.indexOf('u:') === 0 ? (UPL[s.slice(2)] || '') : s; }
function getImg(src) {
  if (!src) return null; var e = IMGC[src];
  if (e) return e.ok ? e.img : null;
  var real = resolveSrc(src); if (!real) return null;
  e = IMGC[src] = { ok: false, img: new Image() };
  e.img.onload = function () { e.ok = true; _onImg(); };
  e.img.onerror = function () { e.err = true; };
  e.img.src = real; return null;
}
function preload(srcs) {
  return Promise.all(srcs.filter(Boolean).map(function (s) {
    return new Promise(function (res) {
      var real = resolveSrc(s); if (!real) return res();
      var e = IMGC[s]; if (e && e.ok) return res();
      if (!e) { e = IMGC[s] = { ok: false, img: new Image() }; e.img.onload = function () { e.ok = true; _onImg(); }; e.img.src = real; }
      if (e.ok) return res();
      e.img.addEventListener('load', function () { res(); }); e.img.addEventListener('error', function () { res(); });
    });
  }));
}

// ── text layout ──────────────────────────────────────────────────────────────
// Markup inside text:  *word*  = accent colour,   ==phrase==  = highlight bar,   blank line / Enter = new line.
function parseRuns(str) {
  var a = false, b = false, paras = [[]], cur = '';
  function flush() { if (cur) { paras[paras.length - 1].push({ t: cur, a: a, b: b }); cur = ''; } }
  for (var i = 0; i < str.length; i++) {
    var ch = str[i];
    if (ch === '*') { flush(); a = !a; continue; }
    if (ch === '=' && str[i + 1] === '=') { flush(); b = !b; i++; continue; }
    if (ch === '\n') { flush(); paras.push([]); continue; }
    if (ch === ' ') { flush(); paras[paras.length - 1].push({ sp: true, a: a, b: b }); continue; }
    cur += ch;
  }
  flush(); return paras;
}
function fontStr(el, size) { return (el.weight || 400) + ' ' + size + 'px ' + (FONT[el.font] || FONT.body); }
function layoutText(ctx, el, size) {
  var s = el.upper ? el.text.toUpperCase() : el.text;
  var padX = s.indexOf('==') >= 0 ? size * 0.12 : 0;
  ctx.font = fontStr(el, size); var maxW = Math.max(10, el.w - padX * 2); var spW = ctx.measureText(' ').width;
  var lines = [];
  parseRuns(s).forEach(function (para) {
    var line = { items: [], w: 0 };
    function push() { while (line.items.length && line.items[line.items.length - 1].sp) { line.w -= line.items.pop().w; } lines.push(line); line = { items: [], w: 0 }; }
    para.forEach(function (tok) {
      if (tok.sp) { if (line.items.length) { line.items.push({ sp: true, w: spW, a: tok.a, b: tok.b }); line.w += spW; } return; }
      var w = ctx.measureText(tok.t).width;
      if (line.items.length && line.w + w > maxW) push();
      line.items.push({ t: tok.t, w: w, a: tok.a, b: tok.b }); line.w += w;
    });
    push();
  });
  return { lines: lines, padX: padX };
}
function fitSize(ctx, el) {
  var size = el.grow ? Math.round(el.size * 1.5) : el.size, min = Math.max(10, Math.round(el.size * 0.35));
  if (!el.fit) return el.size;
  for (; size > min; size -= 2) { var L = layoutText(ctx, el, size); if (L.lines.length * size * el.lh <= el.h + 1) return size; }
  return min;
}
function drawText(ctx, el) {
  if (!el.text) return;
  var size = fitSize(ctx, el), L = layoutText(ctx, el, size), lh = size * el.lh, total = L.lines.length * lh;
  ctx.font = fontStr(el, size); ctx.textBaseline = 'alphabetic';
  var m = ctx.measureText('Hg'), asc = m.fontBoundingBoxAscent || size * 0.92, desc = m.fontBoundingBoxDescent || size * 0.25;
  var top = el.y + (el.valign === 'middle' ? (el.h - total) / 2 : el.valign === 'bottom' ? el.h - total : 0);
  L.lines.forEach(function (line, i) {
    var y0 = top + i * lh, x0 = el.align === 'center' ? el.x + (el.w - line.w) / 2 : el.align === 'right' ? el.x + el.w - L.padX - line.w : el.x + L.padX;
    // bars first
    var x = x0, run = null;
    function close(end) { if (run) { ctx.fillStyle = el.barColor; ctx.fillRect(run - L.padX * 0.85, y0 + (lh - lh * 0.98) / 2, end - run + L.padX * 1.7, lh * 0.98); run = null; } }
    line.items.forEach(function (it) { if (it.b) { if (run === null) run = x; } else close(x); x += it.w; });
    close(x);
    var base = y0 + (lh - (asc + desc)) / 2 + asc; x = x0;
    line.items.forEach(function (it) { if (!it.sp) { ctx.fillStyle = it.a ? el.accentColor : (it.b && el.barText ? el.barText : el.color); ctx.fillText(it.t, x, base); } x += it.w; });
  });
}

// ── shapes / images ──────────────────────────────────────────────────────────
function rrPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2)); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function hexA(hex, a) { var h = hex.replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')'; }
function drawRect(ctx, el) {
  ctx.save();
  if (el.shadow) { ctx.shadowColor = 'rgba(0,0,0,.22)'; ctx.shadowBlur = el.shadow; ctx.shadowOffsetY = el.shadow / 3; }
  if (el.grad) { var g = ctx.createLinearGradient(0, el.y, 0, el.y + el.h); g.addColorStop(0, hexA(el.fill, el.grad.from)); g.addColorStop(1, hexA(el.fill, el.grad.to)); ctx.fillStyle = g; ctx.fillRect(el.x, el.y, el.w, el.h); }
  else { ctx.fillStyle = el.fill; if (el.radius) { rrPath(ctx, el.x, el.y, el.w, el.h, el.circle ? 9999 : el.radius); ctx.fill(); } else if (el.circle) { ctx.beginPath(); ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, el.w / 2, el.h / 2, 0, 0, 7); ctx.fill(); } else ctx.fillRect(el.x, el.y, el.w, el.h); }
  ctx.restore();
}
function drawImage(ctx, el, editor) {
  var im = getImg(el.src);
  ctx.save();
  rrPath(ctx, el.x, el.y, el.w, el.h, el.circle ? 9999 : el.radius || 0); ctx.clip();
  if (!im) {
    if (editor && !el.logo) {
      ctx.fillStyle = 'rgba(27,24,11,.07)'; ctx.fillRect(el.x, el.y, el.w, el.h);
      ctx.strokeStyle = 'rgba(27,24,11,.35)'; ctx.setLineDash([14, 10]); ctx.lineWidth = 3; ctx.strokeRect(el.x + 6, el.y + 6, el.w - 12, el.h - 12); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(27,24,11,.55)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; var fs = Math.max(14, Math.min(34, el.w / 12)); ctx.font = '600 ' + fs + 'px ' + FONT.body;
      ctx.fillText('Add a photo', el.x + el.w / 2, el.y + el.h / 2 - fs * 0.7); ctx.font = '400 ' + (fs * 0.72) + 'px ' + FONT.body; ctx.fillText('click, or drop one here', el.x + el.w / 2, el.y + el.h / 2 + fs * 0.6); ctx.textAlign = 'left';
    }
    ctx.restore(); return;
  }
  var iw = im.naturalWidth, ih = im.naturalHeight, sc = (el.fit === 'contain' ? Math.min(el.w / iw, el.h / ih) : Math.max(el.w / iw, el.h / ih)) * (el.zoom || 1), dw = iw * sc, dh = ih * sc;
  var dx = el.x + (el.w - dw) / 2 + (el.ox || 0) * el.w, dy = el.y + (el.h - dh) / 2 + (el.oy || 0) * el.h;
  if (el.fit === 'contain' && el.anchor === 'bottom') dy = el.y + el.h - dh + (el.oy || 0) * el.h;
  ctx.drawImage(im, dx, dy, dw, dh); ctx.restore();
}
function renderPage(ctx, page, S, editor) {
  ctx.save(); ctx.fillStyle = page.bg || '#FFFFFF'; ctx.fillRect(0, 0, S.w, S.h);
  page.els.forEach(function (el) {
    if (el.hidden) return;
    if (el.type === 'rect') drawRect(ctx, el); else if (el.type === 'image') drawImage(ctx, el, editor); else if (el.type === 'text') drawText(ctx, el);
  });
  ctx.restore();
}
function pageSources(page) { return page.els.filter(function (e) { return e.type === 'image' && e.src; }).map(function (e) { return e.src; }); }
function slug(s) { return String(s || 'graphic').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '') || 'graphic'; }
