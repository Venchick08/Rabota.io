// Касса · основной код приложения. Подключается из index.html.
'use strict';
const CUR = '₽'; // поменяй на свою валюту
const $ = id => document.getElementById(id);
const tg = window.Telegram && Telegram.WebApp;
tg?.ready(); tg?.expand();
try { tg?.setHeaderColor('#0b0b16'); tg?.setBackgroundColor('#0b0b16'); } catch {}
const buzz = t => { try { tg?.HapticFeedback.notificationOccurred(t); } catch {} };
const tap = () => { try { tg?.HapticFeedback.impactOccurred('light'); } catch {} };

/* ---------- Помощники ---------- */
const num = s => { const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? Math.max(-1e12, Math.min(1e12, n)) : 0; };
const r2 = n => Math.round(n * 100) / 100 + 0;                 // округление; «+ 0» убирает -0
const fmt = n => r2(n).toLocaleString('ru-RU') + ' ' + CUR;
const sgn = n => (r2(n) > 0 ? '+' : '') + fmt(n);
const v = id => num($(id).value);
const esc = x => String(x).replace(/[&<>"']/g, c => '&#' + c.charCodeAt() + ';');
const dmy = d => d.split('-').reverse().join('.');
const plural = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? b : c;
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const restart = (el, cls) => { el.classList.remove('shake', 'pop'); void el.offsetWidth; el.classList.add(cls); };
const uniqueId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- Окно подтверждения ---------- */
let onYes = null;
const closeAsk = () => { $('modal').classList.add('hide'); onYes = null; };
function ask(text, yes) { $('mTxt').textContent = text; onYes = yes; $('modal').classList.remove('hide'); buzz('warning'); }
$('mNo').onclick = closeAsk;
$('mYes').onclick = () => { const f = onYes; closeAsk(); f?.(); };
$('modal').onclick = e => { if (e.target === $('modal')) closeAsk(); };

/* ---------- Профиль и хранилище (у каждого аккаунта свои данные) ---------- */
const U = tg?.initDataUnsafe?.user;
const uid = U?.id ? String(U.id) : 'guest';
try { // одноразовый перенос данных, сохранённых до появления профилей
  for (const k of ['shifts_v1', 'tasks_v1']) {
    const old = localStorage.getItem(k);
    if (old !== null && localStorage.getItem(k + '_' + uid) === null) { localStorage.setItem(k + '_' + uid, old); localStorage.removeItem(k); }
  }
} catch {}
/* ВАЖНО для будущих версий: не переименовывай ключи shifts_v1 / tasks_v1 / mood_v1 —
   иначе новая версия не найдёт старые данные. Новые поля добавляй, старые не удаляй. */
const lk = k => k + '_' + uid;
const ltime = k => { try { return +localStorage.getItem(lk(k) + '_t') || 0; } catch { return 0; } };
const saveLocal = (k, s, t) => { try { localStorage.setItem(lk(k), s); localStorage.setItem(lk(k) + '_t', String(t)); } catch { $('warn').hidden = false; } };
const load = (k, fix) => { try { const a = JSON.parse(localStorage.getItem(lk(k))); return Array.isArray(a) ? fix(a) : []; } catch { return []; } };
const store = (k, a) => { const s = JSON.stringify(a), t = Date.now(); saveLocal(k, s, t); push(k, s, t); };

/* ---------- Облако Telegram: данные лежат на серверах Telegram у каждого пользователя
   и переживают обновление сайта, смену адреса, очистку кэша и смену телефона ---------- */
const CS = (() => { try { return U && tg.isVersionAtLeast('6.9') && tg.CloudStorage ? tg.CloudStorage : null; } catch { return null; } })();
const cb = (fn, args) => new Promise(res => {
  const tm = setTimeout(() => res(undefined), 8000);
  try { CS[fn](...args, (e, r) => { clearTimeout(tm); res(e ? undefined : r); }); } catch { clearTimeout(tm); res(undefined); }
});
const cget = async keys => { const out = {}; for (let i = 0; i < keys.length; i += 50) { const r = await cb('getItems', [keys.slice(i, i + 50)]); if (!r) return undefined; Object.assign(out, r); } return out; };
const cset = (k, val) => cb('setItem', [k, val]);
const cdel = keys => keys.length ? cb('removeItems', [keys]) : Promise.resolve(true);
const CH = 4000; // в одну ячейку облака влезает до 4096 символов — режем на куски
async function cloudSave(k, str, t) {
  // пишем в «запасной» комплект ячеек (a/b) и только потом переключаем указатель — обрыв связи не испортит данные
  const m = await cget([k + '_m']); if (!m) return false;
  const [oldG, oldN] = (m[k + '_m'] || '').split(':');
  const g = oldG === 'a' ? 'b' : 'a', parts = [];
  for (let i = 0; i < str.length; i += CH) parts.push(str.slice(i, i + CH));
  for (let i = 0; i < parts.length; i++) if (!await cset(`${k}_${g}${i}`, parts[i])) return false;
  if (!await cset(k + '_m', `${g}:${parts.length}:${t}`)) return false;
  if (oldG) await cdel(Array.from({ length: +oldN || 0 }, (_, i) => `${k}_${oldG}${i}`));
  return true;
}
async function cloudLoad(k) {
  const m = await cget([k + '_m']); if (!m) return undefined;
  if (!m[k + '_m']) return { str: null, t: 0 };              // в облаке пока пусто
  const [g, n, t] = m[k + '_m'].split(':');
  const keys = Array.from({ length: +n || 0 }, (_, i) => `${k}_${g}${i}`);
  const r = await cget(keys); if (!r || keys.some(x => !r[x])) return undefined;
  return { str: keys.map(x => r[x]).join(''), t: +t || 0 };
}
const SYNC = { ok: '☁ Сохранено в Telegram', wait: '☁ Сохраняю…', err: '☁ Нет связи · сохранено на телефоне', local: 'Сохранено только на этом телефоне' };
function setSync(s) { document.querySelectorAll('.syncs').forEach(el => { el.textContent = SYNC[s]; el.dataset.s = s; }); }
const pend = {}, timers = {}; let chain = Promise.resolve();
function push(k, s, t) {
  if (!CS) return;
  pend[k] = { s, t }; setSync('wait');
  clearTimeout(timers[k]); timers[k] = setTimeout(() => run(k), 700);
}
function run(k) {
  clearTimeout(timers[k]);
  chain = chain.then(async () => {
    const p = pend[k]; if (!p) return;
    const ok = await cloudSave(k, p.s, p.t);
    if (ok && pend[k] === p) delete pend[k];
    setSync(ok ? (Object.keys(pend).length ? 'wait' : 'ok') : 'err');
  });
}
const flush = () => Object.keys(pend).forEach(run);
async function pull(k, fix, cur) { // сравниваем облако и телефон, побеждает более свежее
  const c = await cloudLoad(k); if (!c) return undefined;
  const lt = ltime(k);
  if (c.str != null && c.t > lt) {
    try { const a = JSON.parse(c.str); if (Array.isArray(a)) { const f = fix(a); saveLocal(k, JSON.stringify(f), c.t); return f; } } catch {}
    return undefined;
  }
  if ((c.str == null || lt > c.t) && (cur().length || lt)) { const s = JSON.stringify(cur()), t = lt || Date.now(); saveLocal(k, s, t); push(k, s, t); }
  return null;
}
let synced = false;
async function syncCloud() {
  if (!CS) return setSync('local');
  setSync('wait');
  const s = await pull('shifts_v1', fixShifts, () => shifts), t = await pull('tasks_v1', fixTasks, () => tasks);
  if (s) shifts = s; if (t) tasks = t;
  await syncMood();
  synced = s !== undefined && t !== undefined;
  if (!synced) setSync('err'); else if (!Object.keys(pend).length) setSync('ok');
  renderTerm(false);
  if (s || t) {
    if (!['cash', 'card', 'tr', 'bank', 'act'].some(i => $(i).value)) resetForm();
    if (!$('v2').classList.contains('hide')) renderMonth();
    if (!$('v3').classList.contains('hide')) renderTasks();
  }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); else if (CS && !synced) syncCloud(); });
addEventListener('online', () => { flush(); if (CS && !synced) syncCloud(); });
/* Проверка данных при загрузке: всё, что пришло из памяти или облака, приводится к «чистому» виду —
   только числа, даты нужного формата и строки ограниченной длины. Подсунуть код через данные нельзя. */
const N = x => { const n = Number(x); return Number.isFinite(n) ? Math.max(-1e12, Math.min(1e12, n)) : 0; };
const okNum = x => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));
const okShift = s => s && typeof s === 'object' && typeof s.date === 'string' && /^\d{4}-\d\d-\d\d$/.test(s.date) && ['cash', 'card', 'tr', 'bal'].every(k => okNum(s[k]));
const cleanShift = s => ({
  id: String(s.id ?? uniqueId()).slice(0, 40), date: s.date,
  prev: okNum(s.prev) ? N(s.prev) : r2(N(s.bal) - N(s.cash) + N(s.bank)), // у старых записей «прошлую» восстанавливаем из остатка
  cash: N(s.cash), bank: N(s.bank), card: N(s.card), tr: N(s.tr), bal: N(s.bal), act: okNum(s.act) ? N(s.act) : null });
const okTask = t => t && typeof t === 'object' && typeof t.title === 'string';
const cleanTask = t => ({ id: String(t.id ?? uniqueId()).slice(0, 40), title: t.title.slice(0, 80), price: okNum(t.price) ? N(t.price) : null,
  done: t.done === true, del: okNum(t.del) && +t.del > 0 ? +t.del : null });
const fixShifts = a => a.filter(okShift).map(cleanShift), fixTasks = a => a.filter(okTask).map(cleanTask);
let shifts = load('shifts_v1', fixShifts), tasks = load('tasks_v1', fixTasks);

(function profile() {
  const name = U ? [U.first_name, U.last_name].filter(Boolean).join(' ') || 'Без имени' : 'Гость';
  $('nm').textContent = U?.username ? '@' + U.username : name;
  $('un').textContent = U ? (U.username ? name : 'ID ' + U.id) : 'Открыто вне Telegram';
  const av = $('av');
  av.textContent = (name[0] || '?').toUpperCase();
  if (U?.photo_url?.startsWith('https://')) {
    const im = new Image(); im.alt = ''; im.referrerPolicy = 'no-referrer';
    im.onload = () => { av.textContent = ''; av.appendChild(im); }; im.src = U.photo_url;
  }
})();

/* ---------- Настроение дня (выбирается один раз в сутки) ---------- */
const MOODS = ['😀','😂','🥲','😎','🤩','😍','🥰','😇','🥳','🤑','🤔','🙃','😴','🤯','😤','😡','🥶','🥵','🤒','😭','😱','🫠','🤡','💀','👻','🔥','⚡','💪','🙏','👍','👎','❤️','💔','🌈','☀️','🌧️','☕','🍕','💸','🚀','🐱','🎉'];
const MKEY = 'mood_v1_' + uid;
const isEmoji = s => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s);
const firstChar = s => {
  s = s.trim(); if (!s) return '';
  try { return new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(s)[Symbol.iterator]().next().value.segment; }
  catch { return Array.from(s)[0]; }
};
const okMood = m => m && m.d === today() && typeof m.e === 'string' && m.e.length <= 16 && firstChar(m.e) === m.e && isEmoji(m.e);
const getMood = () => { try { const m = JSON.parse(localStorage.getItem(MKEY)); return okMood(m) ? m.e : null; } catch { return null; } };
let pick = null;
function renderMood() {
  const e = getMood();
  $('mood').classList.toggle('lk', !!e);
  $('moodE').textContent = e || '?';
  $('moodNote').textContent = e ? 'Настроение на сегодня выбрано · сменить можно завтра' : 'Выбери настроение на сегодня ▸';
}
$('emo').innerHTML = MOODS.map(e => `<button data-e="${e}">${e}</button>`).join('');
const markPick = () => $('emo').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.e === pick));
$('emo').onclick = e => { const b = e.target.closest('button'); if (!b) return; tap(); pick = b.dataset.e; $('moodIn').value = ''; markPick(); };
$('moodIn').addEventListener('input', () => { const c = firstChar($('moodIn').value); pick = isEmoji(c) ? c : null; markPick(); });
const closeMood = () => $('moodM').classList.add('hide');
$('mood').onclick = () => {
  if (getMood()) { restart($('mood'), 'shake'); restart($('moodNote'), 'pop'); buzz('warning'); return; }
  tap(); pick = null; $('moodIn').value = ''; markPick(); $('moodM').classList.remove('hide');
};
$('moodNo').onclick = closeMood;
$('moodM').onclick = e => { if (e.target === $('moodM')) closeMood(); };
async function syncMood() { // настроение дня тоже хранится в облаке — блокировка работает и после обновления сайта
  if (!CS) return;
  const r = await cget(['mood_v1']); if (!r) return;
  let c = null; try { c = JSON.parse(r.mood_v1 || 'null'); } catch {}
  const local = getMood();
  if (okMood(c)) {
    if (local !== c.e) { try { localStorage.setItem(MKEY, JSON.stringify({ d: c.d, e: c.e })); } catch {} renderMood(); renderTerm(false); }
  } else if (local) cset('mood_v1', JSON.stringify({ d: today(), e: local }));
}
let moodBusy = false;
$('moodOk').onclick = async () => {
  if (!pick) { restart($('moodOk'), 'shake'); buzz('warning'); return; }
  if (moodBusy) return; moodBusy = true;
  await syncMood(); // вдруг уже выбрано сегодня на другом телефоне
  if (!getMood()) {
    const m = JSON.stringify({ d: today(), e: pick });
    try { localStorage.setItem(MKEY, m); } catch { $('warn').hidden = false; }
    if (CS) cset('mood_v1', m);
  }
  moodBusy = false;
  closeMood(); renderMood(); renderTerm(false); restart($('mood'), 'pop'); burst(true); buzz('success');
};
addEventListener('keydown', e => { if (e.key === 'Escape') { closeAsk(); closeMood(); } });

/* ---------- Неделя: сегодняшний день светится ---------- */
function week() {
  const now = (new Date().getDay() + 6) % 7;
  $('week').innerHTML = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((n, i) =>
    `<div class="day${i > 4 ? ' we' : ''}${i === now ? ' on' : ''}"><i></i>${n}</div>`).join('');
}
document.addEventListener('visibilitychange', () => { week(); renderMood(); }); // если приложение открыто через полночь

/* ---------- Переход: главный экран ↔ касса ---------- */
function go(k) {
  const on = k === 'kassa';
  $('home').classList.toggle('hide', on); $('kassa').classList.toggle('hide', !on);
  try { on ? tg?.BackButton.show() : tg?.BackButton.hide(); } catch {}
  scrollTo(0, 0); tap();
  if (on && !$('v2').classList.contains('hide')) renderMonth();
  if (!on) renderTerm(false);
}
$('work').onclick = () => go('kassa');
$('back').onclick = () => go('home');
try { tg?.BackButton.onClick(() => go('home')); } catch {}

/* ---------- Подсчёт смены ---------- */
const sorted = () => shifts.slice().sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
let shown = 0, raf;
function countTo(el, to) { // плавный «накрут» числа
  cancelAnimationFrame(raf);
  const from = shown, t0 = performance.now();
  const step = t => {
    const k = Math.min(1, (t - t0) / 500);
    shown = k < 1 ? from + (to - from) * (1 - Math.pow(1 - k, 3)) : to;
    el.textContent = sgn(shown);
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
function calc() {
  const bal = r2(v('prev') + v('cash') - v('bank'));
  $('exp').textContent = fmt(bal);
  const big = $('bal');
  if (!$('act').value) {
    cancelAnimationFrame(raf); shown = 0;
    big.textContent = '—'; big.className = 'big';
    $('tag').textContent = 'Введи «по факту в кассе»';
    return;
  }
  const d = r2(v('act') - bal);
  countTo(big, d);
  big.className = 'big ' + (d > 0 ? 'p' : d < 0 ? 'm' : '');
  $('tag').textContent = d > 0 ? 'В плюсе на ' + fmt(d) : d < 0 ? 'В минусе на ' + fmt(-d) : 'Ровно в ноль ★';
}
function resetForm() {
  $('date').value = today();
  $('prev').value = shifts.length ? sorted().pop().bal : '';
  ['cash', 'card', 'tr', 'bank', 'act'].forEach(i => $(i).value = '');
  calc();
}
['prev', 'cash', 'card', 'tr', 'bank', 'act'].forEach(i => $(i).addEventListener('input', calc));
document.querySelectorAll('.pm').forEach(b => b.onclick = () => {
  tap(); const el = $(b.dataset.t), s = el.value.trim();
  el.value = s.startsWith('-') ? s.slice(1) : '-' + s; calc();
});

/* ---------- Конфетти ---------- */
const cv = $('fx'), cx = cv.getContext('2d');
let parts = [], running = false;
const fit = () => { cv.width = innerWidth; cv.height = innerHeight; };
addEventListener('resize', fit); fit();
function burst(good) {
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  const cols = good ? ['#3226c8', '#dcdcff', '#ffffff', '#6f66ff', '#8affc1'] : ['#ff5470', '#8a2a3a', '#dcdcff'];
  for (let i = 0; i < (good ? 140 : 50); i++) {
    const a = Math.random() * 6.28, sp = 5 + Math.random() * 9;
    parts.push({ x: innerWidth / 2, y: innerHeight * .6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (good ? 7 : 2),
      s: 5 + Math.random() * 7, c: cols[i % cols.length], life: 90 + Math.random() * 40 });
  }
  if (!running) { running = true; requestAnimationFrame(loop); }
}
function loop() {
  cx.clearRect(0, 0, cv.width, cv.height);
  parts = parts.filter(p => p.life-- > 0);
  for (const p of parts) {
    p.x += p.vx; p.y += p.vy; p.vy += .35; p.vx *= .99;
    cx.globalAlpha = Math.min(1, p.life / 30); cx.fillStyle = p.c;
    cx.fillRect(Math.round(p.x / 4) * 4, Math.round(p.y / 4) * 4, p.s, p.s); // квадратные «пиксели»
  }
  cx.globalAlpha = 1;
  if (parts.length) requestAnimationFrame(loop); else running = false;
}

/* ---------- Закрыть смену ---------- */
let busy = false; // защита от двойного нажатия (иначе смена запишется дважды)
$('save').onclick = () => {
  if (busy) return;
  if (!['cash', 'card', 'tr', 'bank'].some(i => $(i).value)) { restart($('save'), 'shake'); buzz('warning'); return; }
  busy = true;
  const prev = v('prev'), cash = v('cash'), bank = v('bank'), bal = r2(prev + cash - bank);
  const has = !!$('act').value, act = has ? v('act') : null;
  const res = has ? r2(act - bal) : bal, good = res >= 0;
  shifts.push({ id: uniqueId(), date: $('date').value || today(), prev, cash, bank, card: v('card'), tr: v('tr'), bal, act });
  store('shifts_v1', shifts);
  burst(good); buzz(good ? 'success' : 'error'); restart($('hero'), good ? 'pop' : 'shake');
  $('tag').textContent = (good ? 'ACCESS GRANTED' : 'ERROR') + (has ? ' · касса ' + sgn(res) : ' · смена сохранена');
  setTimeout(() => { resetForm(); busy = false; }, 1600);
};

/* ---------- Месяц ---------- */
const row = (l, x) => `<div class="sum"><span>${l}</span><b>${x}</b></div>`;
function monthStats(ym) {
  const L = sorted().filter(s => s.date.startsWith(ym));
  const sum = k => r2(L.reduce((a, s) => a + (Number(s[k]) || 0), 0));
  const carry = L.length ? N(L[0].prev) : 0;           // прошлая смена, с которой начался месяц
  const run = {}; let acc = carry;                     // наличка нарастающим итогом
  L.forEach(s => { acc = r2(acc + s.cash); run[s.id] = acc; });
  const C = L.filter(s => s.act != null);
  return { L, carry, run, cashAll: acc, cash: sum('cash'), card: sum('card'), tr: sum('tr'), bank: sum('bank'), C,
    kassa: r2(C.reduce((a, s) => a + s.act - s.bal, 0)) };
}
function renderMonth() {
  const m = monthStats($('month').value), L = m.L, cash = m.cash, card = m.card, tr = m.tr;
  // Наличка = прошлая смена (на начало месяца) + вся полученная наличка за смены месяца
  $('mCash').textContent = fmt(m.cashAll);
  $('mCashN').textContent = L.length ? 'прошлая смена ' + fmt(m.carry) + ' + наличка за ' + L.length + ' ' + plural(L.length, 'смену', 'смены', 'смен') + ' ' + fmt(cash) : 'смен пока нет';
  $('mCard').textContent = fmt(card); $('mTr').textContent = fmt(tr);
  $('mAll').textContent = fmt(cash + card + tr); $('mBank').textContent = fmt(m.bank);
  const C = m.C, kk = m.kassa;
  $('mK').textContent = !C.length ? '—' : kk ? sgn(kk) : '0 · Идеально ★';
  $('mK').style.color = !C.length ? '' : kk > 0 ? 'var(--plus)' : kk < 0 ? 'var(--minus)' : 'var(--gold)';
  $('mBal').textContent = sgn(L.length ? L[L.length - 1].bal : 0);
  $('list').innerHTML = L.length ? L.slice().reverse().map(s => {
    const r = r2(s.act != null ? s.act - s.bal : s.bal), c = r > 0 ? 'p' : r < 0 ? 'm' : 'z';
    return `<div class="sh ${c}">
      <div class="shh"><b>Смена от ${esc(dmy(s.date))}</b><button class="del" data-id="${esc(s.id)}" aria-label="Удалить смену">✕</button></div>
      ${row('Прошлая смена', sgn(s.prev))}
      ${row('Наличка', fmt(s.cash))}
      ${row('Наличка с начала месяца', fmt(m.run[s.id]))}
      ${row('Карта', fmt(s.card))}
      ${row('Переводы', fmt(s.tr))}
      ${s.bank ? row('Банк', fmt(s.bank)) : ''}
      ${row('Всего за смену', fmt(s.cash + s.card + s.tr))}
      ${row('Остаток', sgn(s.bal))}
      ${s.act != null ? row('Касса (факт − должно быть)', r ? sgn(r) : '0 · Идеально ★') : ''}
    </div>`;
  }).join('') : '<div class="empty">В этом месяце смен пока нет. Закрой первую.</div>';
}
$('month').addEventListener('change', renderMonth);
$('list').onclick = e => {
  const b = e.target.closest('.del'); if (!b) return;
  ask('Удалить эту смену?', () => { shifts = shifts.filter(s => String(s.id) !== b.dataset.id); store('shifts_v1', shifts); renderMonth(); resetForm(); });
};

/* ---------- Задачи и корзина (удалённые хранятся 7 дней) ---------- */
const WEEK = 7 * 864e5;
let view = 'list';
function renderTasks() {
  const n = tasks.length;
  tasks = tasks.filter(t => !t.del || Date.now() - t.del < WEEK);
  if (tasks.length !== n) store('tasks_v1', tasks);
  const act = tasks.filter(t => !t.del), bin = tasks.filter(t => t.del);
  $('s1').textContent = 'Задачи' + (act.length ? ' (' + act.length + ')' : '');
  $('s2').textContent = 'Корзина' + (bin.length ? ' (' + bin.length + ')' : '');
  $('s1').classList.toggle('on', view === 'list'); $('s2').classList.toggle('on', view === 'bin');
  const price = t => Number(t.price) || 0;
  $('tList').innerHTML = view === 'list'
    ? (act.length ? '<div class="tsum"><span>Осталось на сумму</span><b>' + fmt(act.filter(t => !t.done).reduce((a, t) => a + price(t), 0)) + '</b></div>'
        + act.slice().reverse().map(t => `
        <div class="item${t.done ? ' done' : ''}"><button class="chk" data-a="c" data-id="${esc(t.id)}" aria-label="Готово">${t.done ? '✓' : ''}</button>
          <div class="d"><b>${esc(t.title)}</b></div>${price(t) ? `<div class="pr">${fmt(price(t))}</div>` : ''}
          <button class="del" data-a="x" data-id="${esc(t.id)}" aria-label="В корзину">✕</button></div>`).join('')
      : '<div class="empty">Задач пока нет. Добавь первую.</div>')
    : (bin.length ? bin.slice().sort((a, b) => b.del - a.del).map(t => `
        <div class="item"><div class="d"><b>${esc(t.title)}</b><span>${price(t) ? fmt(price(t)) + ' · ' : ''}удалится через ${Math.max(1, Math.ceil((t.del + WEEK - Date.now()) / 864e5))} дн.</span></div>
          <button class="rs" data-a="r" data-id="${esc(t.id)}">Вернуть</button>
          <button class="del" data-a="f" data-id="${esc(t.id)}" aria-label="Удалить навсегда">DEL</button></div>`).join('')
      : '<div class="empty">Корзина пуста. Удалённые задачи лежат здесь 7 дней.</div>');
}
$('tList').onclick = e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  tap();
  const t = tasks.find(x => String(x.id) === b.dataset.id), a = b.dataset.a;
  if (!t) return;
  if (a === 'f') return ask('Удалить «' + t.title + '» навсегда? Вернуть будет нельзя.', () => { tasks = tasks.filter(x => x !== t); store('tasks_v1', tasks); renderTasks(); });
  if (a === 'c') t.done = !t.done;
  if (a === 'x') t.del = Date.now();
  if (a === 'r') t.del = null;
  store('tasks_v1', tasks); renderTasks();
};
$('tAdd').onclick = () => {
  const title = $('tTitle').value.trim().slice(0, 80);
  if (!title) { restart($('tAdd'), 'shake'); buzz('warning'); return; }
  tasks.push({ id: uniqueId(), title, price: v('tPrice') || null, done: false, del: null });
  store('tasks_v1', tasks); $('tTitle').value = ''; $('tPrice').value = ''; view = 'list'; buzz('success'); renderTasks();
};
$('tTitle').addEventListener('keydown', e => { if (e.key === 'Enter') $('tAdd').click(); });
$('s1').onclick = () => { tap(); view = 'list'; renderTasks(); };
$('s2').onclick = () => { tap(); view = 'bin'; renderTasks(); };

/* ---------- Вкладки и запуск ---------- */
function tab(n) {
  tap();
  [1, 2, 3].forEach(i => { $('v' + i).classList.toggle('hide', n !== i); $('t' + i).classList.toggle('on', n === i); });
  if (n === 2) renderMonth();
  if (n === 3) renderTasks();
}
[1, 2, 3].forEach(i => $('t' + i).onclick = () => tab(i));

/* ---------- Главный экран: часы, терминал со сводкой и прогнозом дня ---------- */
const FORTUNES = ['Касса сойдётся до копейки', 'Чаевые: CRITICAL HIT ×2', 'Баги сегодня обходят тебя стороной', 'Обнаружен вирус хорошего настроения',
  'Шанс идеальной смены: 97%', 'Клиенты сегодня вежливые (бета-версия)', 'Перезагрузка не потребуется', 'Удача загружена на 100%',
  'Сегодня всё по плану. Почти', 'Кофе + смена = +10 к скорости', 'Ошибок не найдено. Продолжай', 'Секретный бонус: улыбка клиента',
  'Звёзды говорят: сдай банк вовремя', 'Энергия: FULL · Лень: 404 Not Found', 'Сегодня ты — главный администратор'];
const MONTHS = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; };
let target = '', typed = 0, typing = 0, booted = false;
function termText() {
  const h = new Date().getHours(), name = U?.first_name || 'гость';
  const hi = h < 5 ? 'Ночная смена' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
  const ym = today().slice(0, 7), m = monthStats(ym), mood = getMood();
  return ['> ' + hi + ', ' + name + '!',
    '> смен в ' + MONTHS[+ym.slice(5) - 1] + ': ' + m.L.length + (m.L.length ? ' · наличка ' + fmt(m.cashAll) : ''),
    '> касса за месяц: ' + (!m.C.length ? 'нет данных' : m.kassa ? sgn(m.kassa) : '0 · идеально ★'),
    '> настроение: ' + (mood || 'не выбрано'),
    '> прогноз дня: ' + FORTUNES[hash(uid + today()) % FORTUNES.length]].join('\n');
}
function renderTerm(animate) {
  if (!booted && !animate) return;
  target = termText();
  if (!animate || matchMedia('(prefers-reduced-motion:reduce)').matches) { if (!typing) { typed = target.length; $('term').textContent = target; } return; }
  clearInterval(typing); typed = 0;
  typing = setInterval(() => { // печатаем по букве; если данные обновились на ходу — допечатываем уже новые
    typed = Math.min(target.length, typed + 1); $('term').textContent = target.slice(0, typed);
    if (typed >= target.length) { clearInterval(typing); typing = 0; }
  }, 22);
}
function tick() {
  const d = new Date();
  $('clk').textContent = d.toLocaleTimeString('ru-RU');
  $('tdate').textContent = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
}
setInterval(tick, 1000); tick();
setTimeout(() => { booted = true; renderTerm(true); }, 1300); // после заставки загрузки

/* ---------- Пасхалка: 5 быстрых нажатий на аватарку ---------- */
let taps = [];
$('av').onclick = () => {
  const now = Date.now(); taps = taps.filter(t => now - t < 2000); taps.push(now); tap();
  if (taps.length < 5) return;
  taps = []; const vr = $('virus'); vr.classList.remove('hide'); buzz('error'); burst(true);
  clearTimeout(vr._t); vr._t = setTimeout(() => vr.classList.add('hide'), 2800);
};
$('virus').onclick = () => $('virus').classList.add('hide');

$('month').value = today().slice(0, 7);
week(); renderMood(); resetForm(); syncCloud();
