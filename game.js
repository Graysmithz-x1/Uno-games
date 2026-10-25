'use strict';
/* UNO Offline — logika game, UI, dan registrasi service worker */

const SPEED = (typeof window !== 'undefined' && window.UNO_FAST) ? 0 : 1;
const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms * SPEED));
const rnd = n => Math.floor(Math.random() * n);
const pick = a => a[rnd(a.length)];

const COLORS = ['r', 'y', 'g', 'b'];
const CNAME = { r: 'Merah', y: 'Kuning', g: 'Hijau', b: 'Biru' };
const HEX = { r: '#e53935', y: '#f2a900', g: '#2e9e4f', b: '#1e7fe0' };
const SHAPE = { r: '●', y: '▲', g: '■', b: '◆', w: '' };
const LABEL = { S: '⊘', R: '⇄', D: '+2', W: '✦', F: '+4' };
const ACTION = ['S', 'R', 'D'];

const DIFFS = {
  easy:   { label: 'Mudah',  icon: '1', desc: 'Bot main acak, sering lupa menekan UNO. Cocok untuk santai.' },
  medium: { label: 'Sedang', icon: '2', desc: 'Bot menyimpan kartu wild dan menyerang saat lawan hampir menang.' },
  hard:   { label: 'Sulit',  icon: '3', desc: 'Bot menghitung giliran, membaca warna yang kamu tidak punya, dan tidak pernah lupa UNO.' }
};

/* ---------- penyimpanan ---------- */
function load(key, def) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { } }
const settings = Object.assign({ diff: 'medium', sound: true }, load('uno.settings', {}));
const stats = Object.assign({ easy: { w: 0, l: 0 }, medium: { w: 0, l: 0 }, hard: { w: 0, l: 0 } }, load('uno.stats', {}));

/* ---------- suara & getar ---------- */
let ac;
function tone(f, d, type = 'sine', v = .07, delay = 0) {
  if (!settings.sound) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f; o.connect(g); g.connect(ac.destination);
    const s = ac.currentTime + delay;
    g.gain.setValueAtTime(v, s); g.gain.exponentialRampToValueAtTime(.0001, s + d);
    o.start(s); o.stop(s + d + .03);
  } catch (e) { }
}
function sfx(t) {
  if (t === 'play') tone(520, .09, 'triangle');
  else if (t === 'draw') tone(300, .07, 'sine');
  else if (t === 'bad') { tone(150, .16, 'square', .05); vib(40); }
  else if (t === 'win') [523, 659, 784, 1047].forEach((f, i) => tone(f, .18, 'triangle', .08, i * .12));
  else if (t === 'lose') [392, 330, 262].forEach((f, i) => tone(f, .22, 'sawtooth', .04, i * .16));
  else if (t === 'uno') { tone(880, .1, 'square', .05); tone(1175, .14, 'square', .05, .1); }
}
function vib(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } }

/* ---------- kartu ---------- */
function buildDeck() {
  const d = []; let id = 0;
  for (const c of COLORS) {
    d.push({ id: id++, c, v: '0' });
    for (let n = 1; n <= 9; n++) { d.push({ id: id++, c, v: String(n) }); d.push({ id: id++, c, v: String(n) }); }
    for (const v of ACTION) { d.push({ id: id++, c, v }); d.push({ id: id++, c, v }); }
  }
  for (let i = 0; i < 4; i++) { d.push({ id: id++, c: 'w', v: 'W' }); d.push({ id: id++, c: 'w', v: 'F' }); }
  return d;
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const isWild = c => c.c === 'w';
const lab = c => LABEL[c.v] || c.v;

function cardEl(card, cls = '') {
  const el = document.createElement('div');
  el.className = `card c-${card.c} ${cls}` + ((card.v === '6' || card.v === '9') ? ' u' : '');
  const l = lab(card);
  el.innerHTML = `<div class="face"><span class="corner tl">${l}</span><span class="mid">${l}</span><span class="corner br">${l}</span><i class="shape">${SHAPE[card.c]}</i></div>`;
  return el;
}
const SORT_C = { r: 0, y: 1, g: 2, b: 3, w: 4 };
const SORT_V = v => ({ S: 10, R: 11, D: 12, W: 13, F: 14 }[v] ?? +v);
function sortHand(h) { h.sort((a, b) => SORT_C[a.c] - SORT_C[b.c] || SORT_V(a.v) - SORT_V(b.v)); }

/* ---------- state ---------- */
let G = null;
const BOTS = [
  { name: 'Rani', col: '#8e44ad' },
  { name: 'Budi', col: '#d35400' },
  { name: 'Sari', col: '#16a085' }
];

function top() { return G.discard[G.discard.length - 1]; }
function canPlay(card) {
  const t = top();
  return isWild(card) || card.c === G.color || (!isWild(t) && card.v === t.v);
}
function drawOne() {
  if (!G.deck.length) {
    if (G.discard.length <= 1) return undefined;
    const t = G.discard.pop();
    G.deck = shuffle(G.discard); G.discard = [t];
  }
  return G.deck.pop();
}
function giveCards(pi, n) {
  const got = [];
  for (let i = 0; i < n; i++) { const c = drawOne(); if (!c) break; G.players[pi].hand.push(c); got.push(c); }
  if (pi === 0) sortHand(G.players[0].hand);
  return got;
}
function step() { G.cur = (G.cur + G.dir + G.players.length) % G.players.length; }
function advance(skip) { step(); if (skip) step(); }

function newGame() {
  const deck = shuffle(buildDeck());
  G = {
    diff: settings.diff, deck, discard: [], dir: 1, cur: 0, color: 'r', over: false, busy: true,
    drawn: null, unoCalled: false, humanWeak: { r: 0, y: 0, g: 0, b: 0 },
    players: [{ name: 'Kamu', hand: [], human: true }, ...BOTS.map(b => ({ name: b.name, col: b.col, hand: [] }))]
  };
  for (let r = 0; r < 7; r++) for (let p = 0; p < 4; p++) G.players[p].hand.push(G.deck.pop());
  sortHand(G.players[0].hand);
  // kartu pembuka harus kartu angka
  let first = G.deck.pop();
  while (isWild(first) || ACTION.includes(first.v)) { G.deck.unshift(first); first = G.deck.pop(); }
  G.discard.push(first); G.color = first.c;
  G.cur = rnd(4);
}

/* ---------- UI ---------- */
let toastT;
function toast(msg, ms = 1500) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms * (SPEED || .01));
}
function setStatus(txt, me) { const s = $('#status'); s.textContent = txt; s.classList.toggle('me', !!me); }

function render() {
  if (!G) return;
  // lawan
  const oppsEl = $('#opps'); oppsEl.innerHTML = '';
  for (let i = 1; i < 4; i++) {
    const p = G.players[i];
    const d = document.createElement('div');
    d.className = 'opp' + (G.cur === i && !G.over ? ' active' : '');
    d.innerHTML = `<div class="av" style="background:${p.col}">${p.name[0]}</div><div class="nm">${p.name}</div>
      <div class="ct"><span class="mini"></span><b>${p.hand.length}</b></div>` +
      (p.hand.length === 1 ? '<span class="uno-tag">UNO!</span>' : '');
    oppsEl.appendChild(d);
  }
  // meja
  const disc = $('#discard'); disc.innerHTML = '';
  disc.className = 'discard ring-' + G.color;
  disc.appendChild(cardEl(top(), 'pop'));
  $('#drawCount').textContent = G.deck.length;
  $('#dirBadge').textContent = G.dir === 1 ? '↻' : '↺';
  const cb = $('#colorBadge'); cb.querySelector('i').style.background = HEX[G.color]; cb.querySelector('span').textContent = CNAME[G.color];

  const myTurn = G.cur === 0 && !G.busy && !G.over;
  $('#draw').classList.toggle('can', myTurn && !G.drawn);
  // tangan
  const hand = $('#hand'); const sl = hand.scrollLeft; hand.innerHTML = '';
  const me = G.players[0];
  for (const c of me.hand) {
    const ok = myTurn && canPlay(c) && (!G.drawn || G.drawn === c);
    const el = cardEl(c, ok ? 'playable' : (myTurn ? 'dim' : ''));
    el.addEventListener('click', () => onCardTap(c, el));
    hand.appendChild(el);
  }
  hand.scrollLeft = sl;
  $('#handInfo').textContent = `Kartumu: ${me.hand.length}`;
  // tombol aksi
  const uno = $('#btnUno');
  const showUno = myTurn && me.hand.length <= 2;
  uno.classList.toggle('hidden', !showUno);
  uno.classList.toggle('on', G.unoCalled);
  uno.classList.toggle('pulse', showUno && !G.unoCalled);
  uno.textContent = G.unoCalled ? 'UNO ✓' : 'UNO!';
  $('#btnPass').classList.toggle('hidden', !(myTurn && G.drawn));
}

function pickColor() {
  return new Promise(res => {
    showModal(`<h3>Pilih warna</h3><p>Kartu wild dimainkan. Warna apa selanjutnya?</p>
      <div class="colors">${COLORS.map(c => `<button data-c="${c}" style="background:${HEX[c]}">${CNAME[c]}</button>`).join('')}</div>
      <div class="btns"><button class="btn ghost" data-c="">Batal</button></div>`, null);
    $('#sheet').querySelectorAll('[data-c]').forEach(b => b.onclick = () => { hideModal(); res(b.dataset.c || null); });
  });
}

function showModal(html, onClose) {
  $('#sheet').innerHTML = html; $('#modal').classList.remove('hidden');
  $('#modal').onclick = e => { if (e.target.id === 'modal' && onClose !== null) { hideModal(); onClose && onClose(); } };
}
function hideModal() { $('#modal').classList.add('hidden'); $('#sheet').innerHTML = ''; }

/* ---------- alur permainan ---------- */
async function loop() {
  while (!G.over) {
    if (G.cur === 0) {
      G.busy = false; G.drawn = null; render();
      setStatus('Giliranmu', true); return;
    }
    G.busy = true; render();
    setStatus(`Giliran ${G.players[G.cur].name}…`);
    await sleep(750 + rnd(500));
    await botTurn(G.cur);
  }
}

async function resolvePlay(pi, card, color) {
  const p = G.players[pi];
  p.hand.splice(p.hand.indexOf(card), 1);
  G.discard.push(card);
  G.color = isWild(card) ? color : card.c;
  sfx('play');
  let skip = false;
  const n = G.players.length;
  if (card.v === 'R') { G.dir *= -1; toast('Arah berbalik'); }
  else if (card.v === 'S') { skip = true; toast(`${G.players[(pi + G.dir + n) % n].name} dilewati`); }
  else if (card.v === 'D') { const t = (pi + G.dir + n) % n; giveCards(t, 2); skip = true; toast(`${G.players[t].name} ambil 2 kartu`); }
  else if (card.v === 'F') { const t = (pi + G.dir + n) % n; giveCards(t, 4); skip = true; toast(`${G.players[t].name} ambil 4 kartu`); }
  if (isWild(card)) toast(`${p.name} memilih ${CNAME[color]}`);
  if (card.v === 'R' && n === 2) skip = true;

  if (p.hand.length === 0) { render(); await endGame(pi); return { skip, done: true }; }

  if (p.hand.length === 1) {
    if (pi === 0) {
      if (!G.unoCalled) { toast('Lupa tekan UNO! Ambil 2 kartu', 2000); sfx('bad'); giveCards(0, 2); }
      else sfx('uno');
    } else {
      const forget = { easy: .35, medium: .12, hard: 0 }[G.diff];
      if (Math.random() < forget) { toast(`${p.name} lupa UNO! Ambil 2 kartu`, 2000); giveCards(pi, 2); }
      else { toast(`${p.name}: UNO!`); sfx('uno'); }
    }
  }
  render();
  return { skip, done: false };
}

/* --- giliran manusia --- */
async function onCardTap(card, el) {
  if (G.over || G.busy || G.cur !== 0) return;
  if (G.drawn && G.drawn !== card) { toast('Mainkan kartu yang baru diambil, atau Lewati'); return; }
  if (!canPlay(card)) { el && el.classList.add('shake'); sfx('bad'); return; }
  let color = null;
  if (isWild(card)) { G.busy = true; color = await pickColor(); G.busy = false; if (!color) { render(); return; } }
  G.busy = true; G.drawn = null;
  const r = await resolvePlay(0, card, color);
  G.unoCalled = false;
  if (r.done) return;
  advance(r.skip);
  await sleep(350);
  await loop();
}
async function onDraw() {
  if (!G || G.over || G.busy || G.cur !== 0 || G.drawn) return;
  G.busy = true;
  const had = G.players[0].hand.some(canPlay);
  const [c] = giveCards(0, 1);
  sfx('draw'); render();
  if (!c) { toast('Tumpukan habis'); await sleep(500); advance(false); await loop(); return; }
  if (!had) G.humanWeak[G.color]++;
  if (canPlay(c)) {
    G.drawn = c; G.busy = false; render();
    toast('Bisa dimainkan — atau tekan Lewati');
  } else {
    toast('Kartu tidak cocok'); await sleep(750);
    advance(false); await loop();
  }
}
async function onPass() {
  if (G.busy || G.cur !== 0 || !G.drawn) return;
  G.busy = true; G.drawn = null; advance(false); render(); await loop();
}
function onUno() { if (G.cur === 0 && !G.busy) { G.unoCalled = !G.unoCalled; if (G.unoCalled) sfx('uno'); render(); } }

/* --- bot --- */
function bestColor(pi) {
  const hand = G.players[pi].hand;
  const own = { r: 0, y: 0, g: 0, b: 0 };
  hand.forEach(c => { if (!isWild(c)) own[c.c]++; });
  if (G.diff === 'easy') return pick(COLORS);
  let best = [], bs = -1;
  for (const c of COLORS) {
    let s = own[c] * 2 + Math.random() * .4;
    if (G.diff === 'hard') s += G.humanWeak[c] * 2;
    if (s > bs + 1e-9) { bs = s; best = [c]; }
  }
  return best[0] || pick(COLORS);
}

function botChoose(pi) {
  const hand = G.players[pi].hand;
  const opts = hand.filter(canPlay);
  if (!opts.length) return null;
  if (G.diff === 'easy') { const c = pick(opts); return { card: c, color: isWild(c) ? bestColor(pi) : null }; }

  const n = G.players.length;
  const nextIdx = (pi + G.dir + n) % n, prevIdx = (pi - G.dir + n) % n;
  const nextLen = G.players[nextIdx].hand.length, prevLen = G.players[prevIdx].hand.length;
  const own = { r: 0, y: 0, g: 0, b: 0 };
  hand.forEach(c => { if (!isWild(c)) own[c.c]++; });
  const hasNonWild = opts.some(c => !isWild(c));
  const hard = G.diff === 'hard';

  let best = null, bs = -1e9;
  for (const c of opts) {
    let s = Math.random() * .6;
    const act = ACTION.includes(c.v) || c.v === 'F';
    if (!isWild(c)) {
      s += isNaN(+c.v) ? 3 : (+c.v) * .3;               // buang kartu bernilai tinggi dulu
      if (c.c !== G.color) s += own[c.c] * .5;            // pindah ke warna yang kita kuasai
    } else {
      s -= hasNonWild ? 8 : 0;                            // simpan wild
      if (c.v === 'F') s -= 2;
    }
    const strike = (c.v === 'S' || c.v === 'D' || c.v === 'F');
    if (strike && nextLen <= 3) s += hard ? 7 : 5;
    if (strike && nextLen <= 2) s += hard ? 8 : 3;
    if (c.v === 'F' && nextLen <= 2) s += 6;
    if (hard) {
      if (c.v === 'R' && nextLen <= 2 && prevLen > 2) s += 9;
      if (hand.length <= 3 && isWild(c)) s += 6;
      if (hand.length === 2) {
        const other = hand.find(x => x !== c);
        if (other && isWild(other)) s += 6;
        else if (other && (other.c === c.c || other.v === c.v)) s += 3;
      }
    }
    if (s > bs) { bs = s; best = c; }
  }
  return { card: best, color: isWild(best) ? bestColor(pi) : null };
}

async function botTurn(pi) {
  const p = G.players[pi];
  let ch = botChoose(pi);
  if (!ch) {
    const [c] = giveCards(pi, 1); sfx('draw'); render();
    toast(`${p.name} mengambil kartu`); await sleep(750);
    if (c && canPlay(c) && (G.diff !== 'easy' || Math.random() < .6)) {
      ch = { card: c, color: isWild(c) ? bestColor(pi) : null };
    } else { advance(false); return; }
  }
  const r = await resolvePlay(pi, ch.card, ch.color);
  if (r.done) return;
  advance(r.skip);
  await sleep(350);
}

async function endGame(wi) {
  G.over = true; G.busy = true;
  const won = wi === 0;
  stats[G.diff][won ? 'w' : 'l']++; save('uno.stats', stats);
  sfx(won ? 'win' : 'lose'); render();
  setStatus(won ? 'Kamu menang!' : `${G.players[wi].name} menang`, won);
  await sleep(900);
  const left = G.players.map(p => `<div class="stat-row"><span>${p.name}</span><span>${p.hand.length} kartu</span></div>`).join('');
  showModal(`<div class="win-emoji">${won ? '🏆' : '😵'}</div>
    <h3 style="text-align:center">${won ? 'Kamu menang!' : G.players[wi].name + ' menang'}</h3>
    <p style="text-align:center">Tingkat: ${DIFFS[G.diff].label}</p>${left}
    <div class="btns"><button class="btn primary" id="again">Main lagi</button><button class="btn ghost" id="toMenu">Menu utama</button></div>`, null);
  $('#again').onclick = () => { hideModal(); startGame(); };
  $('#toMenu').onclick = () => { hideModal(); toMenu(); };
}

/* ---------- navigasi ---------- */
async function startGame() {
  newGame();
  $('#menu').classList.add('hidden'); $('#game').classList.remove('hidden');
  $('#diffChip').textContent = DIFFS[settings.diff].label;
  $('#btnSound').textContent = settings.sound ? '🔊' : '🔇';
  render();
  const first = G.players[G.cur].name;
  setStatus(G.cur === 0 ? 'Kamu jalan duluan' : `${first} jalan duluan`);
  await sleep(700);
  await loop();
}
function toMenu() { G = null; $('#game').classList.add('hidden'); $('#menu').classList.remove('hidden'); renderDiffs(); }

function renderDiffs() {
  const box = $('#diffList'); box.innerHTML = '';
  for (const k of Object.keys(DIFFS)) {
    const b = document.createElement('button');
    b.className = 'diff' + (settings.diff === k ? ' sel' : ''); b.dataset.d = k;
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', settings.diff === k);
    b.innerHTML = `<span class="dot">${DIFFS[k].icon}</span><span><b>${DIFFS[k].label}</b><small>${DIFFS[k].desc}</small></span>`;
    b.onclick = () => { settings.diff = k; save('uno.settings', settings); renderDiffs(); };
    box.appendChild(b);
  }
}

function showRules() {
  showModal(`<h3>Aturan singkat</h3><ul>
    <li>Tiap pemain dapat 7 kartu. Mainkan kartu yang sama <b>warna</b> atau sama <b>angka/simbol</b> dengan kartu teratas.</li>
    <li><b>⊘</b> melewati lawan berikutnya, <b>⇄</b> membalik arah, <b>+2</b> membuat lawan ambil 2 kartu dan terlewati.</li>
    <li><b>✦</b> Wild: pilih warna bebas. <b>+4</b>: pilih warna, lawan berikutnya ambil 4 kartu dan terlewati.</li>
    <li>Tidak punya kartu cocok? Ketuk tumpukan <b>Ambil</b>. Jika kartunya cocok, boleh langsung dimainkan.</li>
    <li>Saat tersisa 2 kartu, tekan <b>UNO!</b> sebelum memainkan kartu kedua dari akhir. Lupa = ambil 2 kartu.</li>
    <li>Pemenang adalah yang pertama menghabiskan kartu.</li>
    <li>Penyederhanaan: +2 dan +4 tidak bisa ditumpuk, dan +4 boleh dimainkan kapan saja.</li>
    <li>Tanda bentuk kecil di kartu (● ▲ ■ ◆) membantu membedakan warna.</li></ul>
    <div class="btns"><button class="btn primary" onclick="hideModal()">Mengerti</button></div>`);
}
function showStats() {
  const rows = Object.keys(DIFFS).map(k => {
    const s = stats[k], t = s.w + s.l;
    return `<div class="stat-row"><span>${DIFFS[k].label}</span><span>${s.w} menang · ${s.l} kalah${t ? ' (' + Math.round(s.w / t * 100) + '%)' : ''}</span></div>`;
  }).join('');
  showModal(`<h3>Statistik</h3><p>Disimpan di perangkat ini saja.</p>${rows}
    <div class="btns"><button class="btn ghost" id="resetStats">Reset statistik</button><button class="btn primary" onclick="hideModal()">Tutup</button></div>`);
  $('#resetStats').onclick = () => { for (const k in stats) stats[k] = { w: 0, l: 0 }; save('uno.stats', stats); showStats(); };
}
function showPause() {
  showModal(`<h3>Jeda</h3><p>Tingkat: ${DIFFS[G.diff].label}</p><div class="btns">
    <button class="btn primary" onclick="hideModal()">Lanjut</button>
    <button class="btn ghost" id="pRestart">Ulangi permainan</button>
    <button class="btn ghost" id="pMenu">Ganti tingkat / menu</button></div>`);
  $('#pRestart').onclick = () => { hideModal(); startGame(); };
  $('#pMenu').onclick = () => { hideModal(); toMenu(); };
}

/* ---------- init ---------- */
function init() {
  renderDiffs();
  $('#btnStart').onclick = startGame;
  $('#btnRules').onclick = showRules;
  $('#btnStats').onclick = showStats;
  $('#btnPause').onclick = showPause;
  $('#btnSound').onclick = () => { settings.sound = !settings.sound; save('uno.settings', settings); $('#btnSound').textContent = settings.sound ? '🔊' : '🔇'; };
  $('#draw').onclick = onDraw;
  $('#btnPass').onclick = onPass;
  $('#btnUno').onclick = onUno;

  const net = () => { $('#netState').textContent = navigator.onLine ? '' : 'Mode offline — game tetap bisa dimainkan'; };
  window.addEventListener('online', net); window.addEventListener('offline', net); net();

  let deferred;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#btnInstall').classList.remove('hidden'); });
  $('#btnInstall').onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('#btnInstall').classList.add('hidden'); };
  window.addEventListener('appinstalled', () => $('#btnInstall').classList.add('hidden'));

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
}
init();

// hook uji (tidak dipakai saat bermain biasa)
if (typeof window !== 'undefined') window.__uno = { get G() { return G; }, canPlay, onCardTap, onDraw, onPass, onUno, startGame };
