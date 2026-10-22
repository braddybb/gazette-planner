'use strict';
// Gazette Studio — brand-locked templates. Every template is a function (brand, size, content) -> {bg, els}.
// Text elements carry a `role` so Auto-fill can pour a story into any template. Markup: *accent*  ==bar==
var DEFAULTS = {
  headline: 'Here is where the headline goes for our basic news story', emphasis: 'headline goes',
  deck: 'A focused way to end the carousel', quote: 'I’m going to put a powerful quote here and I might even accent it for emphasis.', speaker: 'Author name',
  label: 'What happened?', body: 'Here is where I will put my story.\n\nI will make sure to be short, but not too short, remembering that while people still read things they do like to read less.\n\nAnd then maybe I’ll put a little bit more info here.',
  stat: '39', statCaption: 'grape varieties grown on the property', cta: 'Read the full story', url: 'link in bio', photo: ''
};
function dims(S) { return { u: Math.sqrt(S.w * S.h / (1080 * 1350)), m: Math.round(Math.min(S.w, S.h * 0.8) * 0.07), land: S.w > S.h * 1.2 }; }
function clean(t) { return String(t || '').replace(/\*/g, '').replace(/==/g, ''); }
function emph(text, e, style) {
  text = clean(text); if (!e) return text; e = clean(e); var i = text.indexOf(e); if (i < 0) return text;
  var m = style === 'bar' ? '==' : '*'; return text.slice(0, i) + m + e + m + text.slice(i + e.length);
}
function get(c, k) { return (c && c[k]) ? c[k] : DEFAULTS[k]; }
function quoted(q) { q = clean(q).replace(/^[“"]|[”"]$/g, ''); return '“' + q + '”'; }

function furniture(B, S, onDark, o) {
  o = o || {}; var D = dims(S), u = D.u, m = D.m, ms = Math.round((o.big || 78) * u), els = [], edge = Math.round(m * 0.8);
  var my = o.top ? edge : S.h - edge - ms, hs = Math.round(19 * u);
  els.push(txt({ role: 'handle', text: B.handle.toUpperCase(), font: 'body', weight: 700, size: hs, fit: false, color: onDark ? B.cream : B.ink, x: m, y: S.h - edge - ms / 2 - hs * 0.8, w: Math.round(S.w * 0.55), h: Math.round(hs * 1.6), lh: 1.2 }));
  var lg = pickLogo(B, 'mascot', onDark);
  if (lg) els.push(img({ src: lg, logo: true, fit: 'contain', x: S.w - m - ms, y: my, w: ms, h: ms }));
  return els;
}
function coverBox(S, D, extraBottom) { return { x: D.m - Math.round(D.m * 0.1), y: D.m, w: S.w - D.m * 2 + Math.round(D.m * 0.2), h: S.h - D.m * 2 - Math.round(110 * D.u) - (extraBottom || 0) }; }

var TEMPLATES = [
  { key: 'cover_bars', name: 'Headline with bars', group: 'Covers', make: function (B, S, c) {
    var D = dims(S), bx = coverBox(S, D);
    return { bg: B.primary, els: [txt({ role: 'headline', text: emph(get(c, 'headline'), c && c.emphasis !== undefined ? c.emphasis : DEFAULTS.emphasis, 'bar'), x: bx.x, y: bx.y, w: bx.w, h: bx.h, size: Math.round(156 * D.u), color: B.ink, barColor: '#FFFFFF', valign: S.h > S.w * 1.5 ? 'middle' : 'top' })].concat(furniture(B, S, false)) };
  } },
  { key: 'cover_cutout', name: 'Headline + cutout photo', group: 'Covers', make: function (B, S, c) {
    var D = dims(S), bx = coverBox(S, D);
    return { bg: B.primary, els: [txt({ role: 'headline', text: emph(get(c, 'headline'), c && c.emphasis !== undefined ? c.emphasis : DEFAULTS.emphasis, 'bar'), x: bx.x, y: bx.y, w: bx.w, h: Math.round(S.h * 0.55), size: Math.round(140 * D.u), color: B.ink, barColor: '#FFFFFF' }),
      img({ role: 'photo', src: (c && c.photo) || '', fit: 'contain', anchor: 'bottom', x: Math.round(S.w * 0.42), y: Math.round(S.h * 0.5), w: Math.round(S.w * 0.58), h: Math.round(S.h * 0.5) })].concat(furniture(B, S, false)) };
  } },
  { key: 'cover_photo', name: 'Full photo cover', group: 'Covers', make: function (B, S, c) {
    var D = dims(S), m = D.m;
    return { bg: B.ink, els: [img({ role: 'photo', src: (c && c.photo) || '', x: 0, y: 0, w: S.w, h: S.h }),
      rect({ fill: B.ink, grad: { from: 0, to: 0.9 }, x: 0, y: Math.round(S.h * 0.3), w: S.w, h: Math.round(S.h * 0.7) }),
      txt({ role: 'headline', text: emph(get(c, 'headline'), c && c.emphasis !== undefined ? c.emphasis : DEFAULTS.emphasis, 'accent'), x: m, y: Math.round(S.h * 0.42), w: S.w - m * 2, h: Math.round(S.h * 0.58) - m * 2 - Math.round(60 * D.u), size: Math.round(120 * D.u), color: B.cream, accentColor: B.primary, valign: 'bottom' })].concat(furniture(B, S, true)) };
  } },
  { key: 'cover_dark', name: 'Dark headline', group: 'Covers', make: function (B, S, c) {
    var D = dims(S), bx = coverBox(S, D);
    return { bg: B.ink, els: [txt({ role: 'headline', text: emph(get(c, 'headline'), c && c.emphasis !== undefined ? c.emphasis : DEFAULTS.emphasis, 'accent'), x: bx.x, y: bx.y, w: bx.w, h: bx.h, size: Math.round(150 * D.u), color: B.cream, accentColor: B.primary, valign: 'middle' })].concat(furniture(B, S, true)) };
  } },
  { key: 'slide_panel', name: 'Heading + text panel', group: 'Slides', make: function (B, S, c) {
    var D = dims(S), m = D.m, u = D.u, top = Math.round(m * 0.85), lh = Math.round(60 * u), py = top + Math.round(86 * u), pb = S.h - Math.round(m * 0.8) - Math.round(70 * u);
    var els = [txt({ role: 'label', text: get(c, 'label'), font: 'body', weight: 700, size: Math.round(44 * u), color: B.ink, x: m, y: top, w: S.w - m * 2 - Math.round(110 * u), h: lh, fit: true, valign: 'middle' }),
      rect({ fill: '#FFFFFF', radius: Math.round(14 * u), x: m, y: py, w: S.w - m * 2, h: pb - py }),
      txt({ role: 'body', text: get(c, 'body'), font: 'body', weight: 400, size: Math.round(54 * u), grow: true, color: B.ink, x: m + Math.round(34 * u), y: py + Math.round(30 * u), w: S.w - m * 2 - Math.round(68 * u), h: pb - py - Math.round(60 * u), lh: 1.3 })];
    return { bg: B.primary, els: els.concat(furniture(B, S, false, { top: true, big: 74 })) };
  } },
  { key: 'slide_takeaway', name: 'Takeaway panel', group: 'Slides', make: function (B, S, c) {
    var D = dims(S), m = D.m, u = D.u, px = Math.round(m * 1.1), py = Math.round(m * 1.1), pb = S.h - Math.round(m * 1.1) - Math.round(80 * u);
    return { bg: B.ink, els: [rect({ fill: '#FFFFFF', radius: Math.round(10 * u), x: px, y: py, w: S.w - px * 2, h: pb - py }),
      txt({ role: 'deck', text: emph(get(c, 'deck'), c && c.emphasis ? '' : 'end the carousel', 'bar'), size: Math.round(78 * u), color: B.ink, barColor: B.primary, align: 'center', valign: 'middle', x: px + Math.round(30 * u), y: py + Math.round(40 * u), w: S.w - px * 2 - Math.round(60 * u), h: Math.round((pb - py) * 0.5) }),
      txt({ role: 'body', text: get(c, 'body'), font: 'body', size: Math.round(32 * u), color: B.ink, align: 'center', x: px + Math.round(50 * u), y: py + Math.round((pb - py) * 0.58), w: S.w - px * 2 - Math.round(100 * u), h: Math.round((pb - py) * 0.34), lh: 1.3 })].concat(furniture(B, S, true)) };
  } },
  { key: 'slide_end', name: 'Read the full story', group: 'Slides', make: function (B, S, c) {
    var D = dims(S), m = D.m, u = D.u, lg = pickLogo(B, 'mascot', true), els = [];
    var sz = Math.round(Math.min(S.w, S.h) * 0.32);
    if (lg) els.push(img({ src: lg, logo: true, fit: 'contain', x: Math.round((S.w - sz) / 2), y: Math.round(S.h * 0.14), w: sz, h: sz }));
    els.push(txt({ role: 'cta', text: get(c, 'cta'), size: Math.round(96 * u), color: B.cream, align: 'center', valign: 'middle', x: m, y: Math.round(S.h * 0.14) + sz + Math.round(40 * u), w: S.w - m * 2, h: Math.round(190 * u) }));
    els.push(txt({ role: 'url', text: get(c, 'url'), font: 'body', weight: 700, size: Math.round(40 * u), color: B.primary, align: 'center', valign: 'middle', x: m, y: Math.round(S.h * 0.14) + sz + Math.round(240 * u), w: S.w - m * 2, h: Math.round(70 * u) }));
    var f = furniture(B, S, true).filter(function (e) { return e.role === 'handle'; }); f[0].x = 0; f[0].w = S.w; f[0].align = 'center'; f[0].y = S.h - Math.round(m * 1.1);
    return { bg: B.ink, els: els.concat(f) };
  } },
  { key: 'quote_dark', name: 'Quote — dark', group: 'Quotes & numbers', make: function (B, S, c) {
    var D = dims(S), m = D.m, u = D.u, chipY = Math.round(S.h * 0.66);
    return { bg: B.ink, els: [txt({ role: 'quote', text: quoted(get(c, 'quote')), size: Math.round(84 * u), color: B.cream, accentColor: B.primary, align: 'center', valign: 'bottom', x: m, y: Math.round(S.h * 0.1), w: S.w - m * 2, h: chipY - Math.round(S.h * 0.1) - Math.round(40 * u) }),
      rect({ fill: B.primary, x: Math.round(S.w / 2 - 300 * u), y: chipY, w: Math.round(600 * u), h: Math.round(54 * u) }),
      txt({ role: 'speaker', text: get(c, 'speaker'), font: 'body', weight: 700, upper: true, size: Math.round(24 * u), color: B.ink, align: 'center', valign: 'middle', x: Math.round(S.w / 2 - 290 * u), y: chipY, w: Math.round(580 * u), h: Math.round(54 * u), lh: 1.1 })].concat(furniture(B, S, true)) };
  } },
  { key: 'quote_brand', name: 'Quote — brand colour', group: 'Quotes & numbers', make: function (B, S, c) {
    var D = dims(S), m = D.m, u = D.u, chipY = Math.round(S.h * 0.66);
    return { bg: B.primary, els: [txt({ role: 'quote', text: quoted(get(c, 'quote')), size: Math.round(84 * u), color: B.ink, accentColor: B.ink, align: 'center', valign: 'bottom', x: m, y: Math.round(S.h * 0.1), w: S.w - m * 2, h: chipY - Math.round(S.h * 0.1) - Math.round(40 * u) }),
      rect({ fill: B.ink, x: Math.round(S.w / 2 - 300 * u), y: chipY, w: Math.round(600 * u), h: Math.round(54 * u) }),
      txt({ role: 'speaker', text: get(c, 'speaker'), font: 'body', weight: 700, upper: true, size: Math.round(24 * u), color: B.cream, align: 'center', valign: 'middle', x: Math.round(S.w / 2 - 290 * u), y: chipY, w: Math.round(580 * u), h: Math.round(54 * u), lh: 1.1 })].concat(furniture(B, S, false)) };
  } },
  { key: 'quote_photo', name: 'Quote — over photo', group: 'Quotes & numbers', make: function (B, S, c) {
    var D = dims(S), m = D.m, u = D.u;
    return { bg: B.ink, els: [img({ role: 'photo', src: (c && c.photo) || '', x: 0, y: 0, w: S.w, h: S.h }), rect({ fill: B.ink, grad: { from: 0.55, to: 0.72 }, x: 0, y: 0, w: S.w, h: S.h }),
      txt({ role: 'quote', text: quoted(get(c, 'quote')), size: Math.round(80 * u), color: B.cream, accentColor: B.primary, align: 'center', valign: 'middle', x: m, y: Math.round(S.h * 0.12), w: S.w - m * 2, h: Math.round(S.h * 0.56) }),
      txt({ role: 'speaker', text: get(c, 'speaker'), font: 'body', weight: 700, upper: true, size: Math.round(26 * u), color: B.primary, align: 'center', valign: 'middle', x: m, y: Math.round(S.h * 0.7), w: S.w - m * 2, h: Math.round(50 * u) })].concat(furniture(B, S, true)) };
  } },
  { key: 'stat_card', name: 'Big number', group: 'Quotes & numbers', make: function (B, S, c) {
    var D = dims(S), m = D.m, u = D.u;
    return { bg: B.ink, els: [txt({ role: 'stat', text: get(c, 'stat'), size: Math.round(300 * u), color: B.primary, align: 'center', valign: 'bottom', x: m, y: Math.round(S.h * 0.14), w: S.w - m * 2, h: Math.round(S.h * 0.38) }),
      txt({ role: 'statCaption', text: get(c, 'statCaption'), font: 'body', weight: 600, size: Math.round(52 * u), color: B.cream, align: 'center', x: Math.round(m * 1.4), y: Math.round(S.h * 0.55), w: S.w - Math.round(m * 2.8), h: Math.round(S.h * 0.2), lh: 1.25 })].concat(furniture(B, S, true)) };
  } },
  { key: 'thumb_bars', name: 'Thumbnail — photo + headline', group: 'Video', make: function (B, S, c) {
    var D = dims(S), m = D.m, u = D.u, w = D.land ? Math.round(S.w * 0.72) : S.w - m * 2;
    return { bg: B.ink, els: [img({ role: 'photo', src: (c && c.photo) || '', x: 0, y: 0, w: S.w, h: S.h }), rect({ fill: B.ink, grad: { from: 0, to: 0.82 }, x: 0, y: Math.round(S.h * 0.2), w: S.w, h: Math.round(S.h * 0.8) }),
      txt({ role: 'headline', text: emph(get(c, 'headline'), c && c.emphasis !== undefined ? c.emphasis : DEFAULTS.emphasis, 'bar'), x: m, y: Math.round(S.h * 0.3), w: w, h: Math.round(S.h * 0.7) - m - Math.round(90 * u), size: Math.round(132 * u), color: B.cream, barColor: B.primary, barText: B.ink, valign: 'bottom' })].concat(furniture(B, S, true, { big: D.land ? 92 : 78 })) };
  } },
  { key: 'thumb_split', name: 'Thumbnail — split', group: 'Video', make: function (B, S, c) {
    var D = dims(S), m = D.m, u = D.u, els;
    if (D.land) els = [img({ role: 'photo', src: (c && c.photo) || '', x: Math.round(S.w * 0.5), y: 0, w: Math.round(S.w * 0.5), h: S.h }), txt({ role: 'headline', text: emph(get(c, 'headline'), c && c.emphasis !== undefined ? c.emphasis : DEFAULTS.emphasis, 'bar'), x: m, y: m, w: Math.round(S.w * 0.5) - m * 1.5, h: S.h - m * 2 - Math.round(90 * u), size: Math.round(118 * u), color: B.ink, barColor: '#FFFFFF', valign: 'middle' })];
    else els = [img({ role: 'photo', src: (c && c.photo) || '', x: 0, y: 0, w: S.w, h: Math.round(S.h * 0.5) }), txt({ role: 'headline', text: emph(get(c, 'headline'), c && c.emphasis !== undefined ? c.emphasis : DEFAULTS.emphasis, 'bar'), x: m, y: Math.round(S.h * 0.5) + m * 0.6, w: S.w - m * 2, h: Math.round(S.h * 0.5) - m * 1.6 - Math.round(90 * u), size: Math.round(112 * u), color: B.ink, barColor: '#FFFFFF', valign: 'middle' })];
    return { bg: B.primary, els: els.concat(furniture(B, S, false)) };
  } },
  { key: 'header_banner', name: 'Newsletter header', group: 'Newsletter & web', make: function (B, S, c) {
    var D = dims(S), m = D.m, u = D.u, lg = pickLogo(B, 'logo', false), els = [], lh = Math.round(S.h * 0.6), sz = logoSize(lg), lw = Math.round(lh * sz[0] / sz[1]);
    if (lg) els.push(img({ src: lg, logo: true, fit: 'contain', x: m, y: Math.round((S.h - lh) / 2), w: lw, h: lh }));
    else els.push(txt({ role: 'handle', text: B.name, size: Math.round(64 * u * 1.6), color: B.ink, x: m, y: Math.round(S.h * 0.2), w: Math.round(S.w * 0.55), h: Math.round(S.h * 0.6), valign: 'middle' }));
    els.push(txt({ role: 'deck', text: (c && c.tagline) || 'Tagline goes here', font: 'body', weight: 700, size: Math.round(36 * u * 1.4), color: B.ink, align: 'right', valign: 'middle', x: S.w - m - Math.round(S.w * 0.3), y: Math.round(S.h * 0.25), w: Math.round(S.w * 0.3), h: Math.round(S.h * 0.5), lh: 1.2 }));
    return { bg: B.primary, els: els };
  } },
  { key: 'promo_card', name: 'Story promo (web / share)', group: 'Newsletter & web', make: function (B, S, c) {
    var D = dims(S), m = D.m, u = D.u, lg = pickLogo(B, 'logo', false), els = [], lh = Math.round(52 * u * 1.3), sz = logoSize(lg), lw = Math.round(lh * sz[0] / sz[1]);
    var wide = D.land || S.w > S.h;
    var tx = m, ty = wide ? m : Math.round(S.h * 0.5) + Math.round(m * 0.6), tw = wide ? Math.round(S.w * 0.5) - m * 1.5 : S.w - m * 2, th = wide ? S.h - m * 2 - lh - Math.round(30 * u) : Math.round(S.h * 0.5) - m * 1.6 - lh - Math.round(30 * u);
    els.push(img({ role: 'photo', src: (c && c.photo) || '', x: wide ? Math.round(S.w * 0.5) : 0, y: 0, w: wide ? Math.round(S.w * 0.5) : S.w, h: wide ? S.h : Math.round(S.h * 0.5) }));
    els.push(txt({ role: 'headline', text: emph(get(c, 'headline'), c && c.emphasis !== undefined ? c.emphasis : DEFAULTS.emphasis, 'bar'), x: tx, y: ty, w: tw, h: th, size: Math.round(100 * u), color: B.ink, barColor: '#FFFFFF', valign: 'middle' }));
    if (lg) els.push(img({ src: lg, logo: true, fit: 'contain', x: m, y: S.h - m - lh, w: lw, h: lh }));
    return { bg: B.primary, els: els };
  } }
];
var TPL = {}; TEMPLATES.forEach(function (t) { TPL[t.key] = t; });
function buildPage(key, B, S, c) { var r = TPL[key].make(B, S, c || {}); return { id: uid(), tpl: key, content: c ? JSON.parse(JSON.stringify(c)) : null, bg: r.bg, els: r.els }; }

// A ready-to-post carousel from one story's content: cover, three beats, quote or number, then the link slide.
// Long beats are split across extra slides at sentence breaks rather than shortened.
function splitBody(body, max) {
  body = String(body || '').trim(); if (!body || body.split(/\s+/).length <= max) return [body];
  var chunks = [], cur = '', words = 0;
  body.split(/\n\n+/).forEach(function (para, pi) {
    para.split(/(?<=[.!?]["\u201D\u2019]?)\s+(?=["\u201C\u2018]?[A-Z0-9$])/).forEach(function (sent, si) {
      var w = sent.split(/\s+/).length;
      if (cur && words + w > max) { chunks.push(cur); cur = ''; words = 0; }
      cur += (cur ? (si === 0 && pi > 0 ? '\n\n' : ' ') : '') + sent; words += w;
    });
  });
  if (cur) chunks.push(cur); return chunks;
}
function buildCarousel(B, S, c) {
  var pages = [buildPage(c.photo ? 'cover_photo' : 'cover_bars', B, S, c)];
  (c.slides || []).slice(0, 3).forEach(function (s) {
    splitBody(s.body, 95).forEach(function (part, i) { pages.push(buildPage('slide_panel', B, S, Object.assign({}, c, { label: i ? s.label + ' (cont.)' : s.label, body: part }))); });
  });
  if (c.quote) pages.push(buildPage('quote_dark', B, S, c)); else if (c.stat) pages.push(buildPage('stat_card', B, S, c));
  pages.push(buildPage('slide_end', B, S, c));
  return pages;
}
