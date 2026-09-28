import { firebaseConfig } from "./firebase-config.js";
import { renderCover, buildBookPdf, ensureFonts, ordinal, toAr } from "./book.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const LINES_PER_PAGE = 15;      // كل ١٥ سطرًا = صفحة
const LINE_PX = 40;             // ارتفاع السطر في عنصر القياس (#measure)

const $app = document.getElementById("app");
let F = null;        // دوال Firestore
let db = null;
let me = null;       // معرّف اللاعب الحالي
const S = { gid: null, game: null, parts: {}, titles: {}, unsub: [], draftLoaded: false, busy: false };

// ——— أدوات صغيرة ———
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = id => document.getElementById(id);
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3200);
}
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const inviteLink = gid => `${location.origin}${location.pathname}#/g/${gid}`;
const nameOf = uid => (S.game?.players?.[uid]) || "كاتب";
const paras = t => String(t || "").split("\n").map(p => p.trim()).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join("");
const clampInt = (v, a, b, d) => { const n = parseInt(v, 10); return isNaN(n) ? d : Math.min(b, Math.max(a, n)); };

function rememberGame(gid) {
  const list = lsGet("myGames", []).filter(x => x !== gid);
  list.unshift(gid); lsSet("myGames", list.slice(0, 20));
}

// عدد الأسطر الفعلي بعرض سطر ثابت يشبه سطر الكتاب (مستقل عن حجم الشاشة)
function countLines(text) {
  if (!text || !text.trim()) return 0;
  const m = $("measure");
  m.textContent = text.endsWith("\n") ? text + " " : text;
  return Math.max(1, Math.round(m.scrollHeight / LINE_PX));
}

function remaining(g) {
  const end = (g.turnStartedAt || Date.now()) + g.daysPerTurn * 864e5;
  const ms = end - Date.now();
  if (ms <= 0) return { over: true, txt: "انتهت المهلة" };
  const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
  const parts = [];
  if (d) parts.push(`${toAr(d)} يوم`);
  if (h) parts.push(`${toAr(h)} ساعة`);
  if (!d) parts.push(`${toAr(m)} دقيقة`);
  return { over: false, txt: "متبقٍ " + parts.join(" و") };
}

const sortedParts = () => Object.entries(S.parts).map(([uid, p]) => ({ uid, ...p })).sort((a, b) => a.index - b.index);

function chaptersHtml(list) {
  return list.map((p, i) => `
    <article class="chapter">
      <div class="num">الفصل ${ordinal(i)}</div>
      <h3>${esc(p.chapterTitle)}</h3>
      <div class="by">بقلم ${esc(nameOf(p.uid))}</div>
      ${paras(p.text)}
    </article>`).join("");
}

// ——— التشغيل ———
const configured = firebaseConfig && firebaseConfig.apiKey && !/YOUR_/.test(firebaseConfig.apiKey);
if (!configured) renderSetupNotice();
else start().catch(e => {
  console.error(e);
  $app.innerHTML = `<section class="card notice"><h2>تعذّر الاتصال</h2><p>${esc(e.message)}</p>
    <p class="hint">تأكد من إعداد Firebase وتفعيل الدخول المجهول (Anonymous) وإضافة نطاق موقعك في Authorized domains.</p></section>`;
});

async function start() {
  const [appM, authM, fsM] = await Promise.all([
    import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js"),
  ]);
  F = fsM;
  const app = appM.initializeApp(firebaseConfig);
  const auth = authM.getAuth(app);
  db = fsM.getFirestore(app);
  await auth.authStateReady();
  if (!auth.currentUser) await authM.signInAnonymously(auth);
  me = auth.currentUser.uid;
  ensureFonts();
  window.addEventListener("hashchange", route);
  setInterval(tick, 30000);
  route();
}

function renderSetupNotice() {
  $app.innerHTML = `<section class="card notice">
    <h2>خطوة أخيرة قبل اللعب</h2>
    <p>افتح الملف <b>firebase-config.js</b> وضع فيه بيانات مشروعك في Firebase. التفاصيل الكاملة في ملف <b>README.md</b>.</p>
  </section>`;
}

function route() {
  S.unsub.forEach(f => f()); S.unsub = [];
  S.game = null; S.parts = {}; S.titles = {}; S.draftLoaded = false;
  const m = location.hash.match(/^#\/g\/([A-Za-z0-9]+)/);
  if (!m) { S.gid = null; renderHome(); return; }
  S.gid = m[1];
  $app.innerHTML = `<div class="loading">جارٍ فتح اللعبة…</div>`;
  const gref = F.doc(db, "games", S.gid);
  S.unsub.push(F.onSnapshot(gref, snap => {
    if (!snap.exists()) { $app.innerHTML = `<section class="card center"><h2>لم نجد هذه اللعبة</h2><p class="hint">تأكد من الرابط.</p><a class="btn" href="#/">الرئيسية</a></section>`; return; }
    S.game = { id: snap.id, ...snap.data() };
    if (S.game.playerIds?.includes(me)) rememberGame(S.gid);
    render();
  }, err => toast("خطأ في القراءة: " + err.code)));
  S.unsub.push(F.onSnapshot(F.collection(db, "games", S.gid, "parts"), qs => {
    S.parts = {}; qs.forEach(d => S.parts[d.id] = d.data()); render();
  }));
  S.unsub.push(F.onSnapshot(F.collection(db, "games", S.gid, "titles"), qs => {
    S.titles = {}; qs.forEach(d => S.titles[d.id] = d.data()); render();
  }));
}

// يحفظ ما كتبه المستخدم في الحقول قبل إعادة الرسم ثم يعيده
function keepInputs() {
  const vals = {};
  $app.querySelectorAll("[data-keep]").forEach(el => vals[el.id] = el.value);
  const a = document.activeElement;
  return { vals, focus: a && a.id, s: a && a.selectionStart, e: a && a.selectionEnd, y: window.scrollY };
}
function restoreInputs(k) {
  for (const id in k.vals) { const el = $(id); if (el) el.value = k.vals[id]; }
  if (k.focus) { const el = $(k.focus); if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(k.s, k.e); } catch {} } }
  window.scrollTo(0, k.y);
}

function render() {
  const g = S.game; if (!g) return;
  const k = keepInputs();
  const inGame = g.playerIds.includes(me);
  let html = "";
  if (g.status === "lobby") html = viewLobby(g, inGame);
  else if (g.status === "writing") html = viewWriting(g, inGame);
  else if (g.status === "naming") html = viewNaming(g, inGame);
  else html = viewDone(g);
  $app.innerHTML = html;
  restoreInputs(k);
  bind(g);
  tick();
}

// ——— الصفحة الرئيسية ———
function renderHome() {
  const pen = lsGet("penName", "");
  $app.innerHTML = `
  <section class="hero">
    <h1>حكاية واحدة… بأقلام كثيرة</h1>
    <p>يبدأ كاتب القصة، ثم ينتقل القلم عشوائيًا إلى كاتب آخر، حتى يكتب الجميع فصولهم. في النهاية تختارون اسمًا للقصة وتحصلون على رواية جاهزة للطباعة.</p>
  </section>
  <section class="card">
    <h2>ابدأ حكاية جديدة</h2>
    <form id="createForm">
      <label for="cName">اسمك ككاتب (حقيقي أو مستعار)</label>
      <input id="cName" data-keep maxlength="40" required value="${esc(pen)}" placeholder="مثال: أبو يوسف">
      <div class="grid3">
        <label>عدد الكتّاب<input id="cPlayers" type="number" min="2" max="20" value="10" data-keep></label>
        <label>صفحات لكل كاتب<input id="cPages" type="number" min="1" max="20" value="3" data-keep></label>
        <label>أيام لكل دور<input id="cDays" type="number" min="1" max="30" value="3" data-keep></label>
      </div>
      <p class="hint">كل صفحة = ${toAr(LINES_PER_PAGE)} سطرًا. أنت من يكتب الفصل الأول.</p>
      <button class="btn primary block" type="submit">أنشئ اللعبة وادعُ الكتّاب</button>
    </form>
  </section>
  <section class="card">
    <h2>وصلتك دعوة؟</h2>
    <form id="joinForm" class="row">
      <input id="jCode" placeholder="الصق رابط الدعوة أو رمز اللعبة" dir="ltr">
      <button class="btn" type="submit">فتح</button>
    </form>
  </section>
  <section class="card" id="myGamesCard" hidden>
    <h2>حكاياتي</h2>
    <ul class="games" id="myGames"></ul>
  </section>`;

  $("createForm").onsubmit = async e => {
    e.preventDefault();
    const name = $("cName").value.trim();
    if (!name) return toast("اكتب اسمك أولًا");
    const btn = e.submitter; btn.disabled = true;
    try {
      lsSet("penName", name);
      const ref = F.doc(F.collection(db, "games"));
      await F.setDoc(ref, {
        hostUid: me,
        playersCount: clampInt($("cPlayers").value, 2, 20, 10),
        pagesPerPlayer: clampInt($("cPages").value, 1, 20, 3),
        daysPerTurn: clampInt($("cDays").value, 1, 30, 3),
        status: "lobby",
        playerIds: [me],
        players: { [me]: name },
        order: [], skipped: [],
        currentUid: null, turnStartedAt: null, title: null,
        createdAt: Date.now(),
      });
      rememberGame(ref.id);
      location.hash = `#/g/${ref.id}`;
    } catch (err) { console.error(err); toast("تعذّر الإنشاء: " + (err.code || err.message)); btn.disabled = false; }
  };
  $("joinForm").onsubmit = e => {
    e.preventDefault();
    const v = $("jCode").value.trim();
    const m = v.match(/\/g\/([A-Za-z0-9]+)/) || v.match(/^([A-Za-z0-9]{10,})$/);
    if (!m) return toast("الرابط أو الرمز غير صحيح");
    location.hash = `#/g/${m[1]}`;
  };
  loadMyGames();
}

async function loadMyGames() {
  const ids = lsGet("myGames", []);
  if (!ids.length) return;
  const label = { lobby: "بانتظار الكتّاب", writing: "الكتابة جارية", naming: "اختيار الاسم", done: "اكتملت" };
  const rows = await Promise.all(ids.map(async id => {
    try { const s = await F.getDoc(F.doc(db, "games", id)); return s.exists() ? { id, ...s.data() } : null; } catch { return null; }
  }));
  const list = rows.filter(Boolean);
  if (!list.length || !$("myGames")) return;
  $("myGamesCard").hidden = false;
  $("myGames").innerHTML = list.map(g => `<li><a href="#/g/${g.id}">
    <span>${esc(g.title || `حكاية ${esc(g.players?.[g.hostUid] || "")}`)}</span>
    <span class="st ${g.status === "done" ? "ok" : ""}">${label[g.status] || ""}${g.status === "writing" && g.currentUid === me ? " — دورك!" : ""}</span></a></li>`).join("");
}

// ——— غرفة الانتظار ———
function settingsChips(g) {
  return `<div class="chips">
    <span class="chip">👥 ${toAr(g.playersCount)} كتّاب</span>
    <span class="chip">📄 ${toAr(g.pagesPerPlayer)} صفحات لكل كاتب</span>
    <span class="chip">⏳ ${toAr(g.daysPerTurn)} أيام لكل دور</span>
  </div>`;
}

function inviteBox(g) {
  return `<div class="invite">
    <b>ادعُ الكتّاب بهذا الرابط:</b>
    <code id="invLink">${esc(inviteLink(g.id))}</code>
    <div class="actions">
      <button class="btn small" id="copyBtn">نسخ الرابط</button>
      <a class="btn small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent("انضم إليّ في كتابة حكاية مشتركة ✒️\n" + inviteLink(g.id))}">واتساب</a>
      ${navigator.share ? `<button class="btn small" id="shareBtn">مشاركة</button>` : ""}
    </div>
  </div>`;
}

function viewLobby(g, inGame) {
  const isHost = g.hostUid === me;
  const full = g.playerIds.length >= g.playersCount;
  const seats = [];
  for (let i = 0; i < g.playersCount; i++) {
    const uid = g.playerIds[i];
    seats.push(uid
      ? `<div class="seat taken">${uid === g.hostUid ? `<span class="tag">صاحب الدعوة</span>` : ""}${esc(nameOf(uid))}${uid === me ? " (أنت)" : ""}</div>`
      : `<div class="seat">مقعد شاغر</div>`);
  }
  let action = "";
  if (!inGame && !full) {
    action = `<section class="card turn">
      <h2>دعاك ${esc(nameOf(g.hostUid))} لكتابة حكاية</h2>
      <p class="hint">سجّل اسمك (حقيقيًا أو مستعارًا). سيظهر على غلاف الرواية.</p>
      <form id="joinGameForm" class="row">
        <input id="jName" data-keep maxlength="40" required value="${esc(lsGet("penName", ""))}" placeholder="اسمك ككاتب">
        <button class="btn primary" type="submit">انضم</button>
      </form></section>`;
  } else if (!inGame && full) {
    action = `<section class="card center"><h2>اكتمل العدد</h2><p class="hint">هذه الحكاية اكتمل كتّابها.</p></section>`;
  }
  let hostCtl = "";
  if (isHost) {
    hostCtl = full
      ? `<button class="btn gold block" id="startBtn">اكتمل العدد — ابدأ بكتابة الفصل الأول</button>`
      : `<p class="hint center">عند اكتمال العدد سيظهر لك زر البدء.</p>
         ${g.playerIds.length >= 2 ? `<button class="btn small" id="startEarlyBtn">ابدأ بالموجودين (${toAr(g.playerIds.length)})</button>` : ""}`;
  }
  return `
    ${action}
    <section class="card">
      <h2>غرفة الانتظار</h2>
      ${settingsChips(g)}
      <p>انضم <b>${toAr(g.playerIds.length)}</b> من <b>${toAr(g.playersCount)}</b></p>
      <div class="progress"><span style="width:${g.playerIds.length / g.playersCount * 100}%"></span></div>
      <div class="seats">${seats.join("")}</div>
      ${inGame ? inviteBox(g) : ""}
      ${hostCtl}
    </section>`;
}

// ——— مرحلة الكتابة ———
function playersList(g) {
  return `<ul class="players">${g.playerIds.map(uid => {
    let st = `<span class="st">⏳ ينتظر دوره</span>`;
    if (S.parts[uid] || g.order.includes(uid)) st = `<span class="st ok">✓ كتب فصله</span>`;
    else if (g.currentUid === uid) st = `<span class="st now">✍️ يكتب الآن</span>`;
    else if ((g.skipped || []).includes(uid)) st = `<span class="st skip">تجاوزه الدور</span>`;
    return `<li><span>${esc(nameOf(uid))}${uid === me ? " (أنت)" : ""}</span>${st}</li>`;
  }).join("")}</ul>`;
}

function viewWriting(g, inGame) {
  const done = g.order.length;
  const total = g.playerIds.length - (g.skipped || []).length;
  const myTurn = g.currentUid === me;
  const isHost = g.hostUid === me;
  const status = `<section class="card">
      <h2>الحكاية تُكتب الآن</h2>
      ${settingsChips(g)}
      <p>اكتمل <b>${toAr(done)}</b> من <b>${toAr(total)}</b> فصول</p>
      <div class="progress"><span style="width:${done / Math.max(1, total) * 100}%"></span></div>
      ${!myTurn ? `<p>القلم الآن بيد <b>${esc(nameOf(g.currentUid))}</b> · <span class="deadline" data-deadline></span></p>` : ""}
      ${isHost && !myTurn ? `<button class="btn danger small" id="skipBtn" hidden>تجاوز ${esc(nameOf(g.currentUid))} (انتهت مهلته)</button>` : ""}
      ${playersList(g)}
    </section>`;

  if (!myTurn) {
    let note = "";
    if (inGame && S.parts[me]) note = `<section class="card center"><h2>شكرًا، فصلك محفوظ ✓</h2><p class="hint">ستصلك الرواية كاملة عندما ينتهي الجميع.</p></section>`;
    else if (inGame) note = `<section class="card center"><p>ستعرف أن دورك قد حان عندما تفتح هذا الرابط. الترتيب عشوائي!</p></section>`;
    return note + status;
  }
  return viewEditor(g) + status;
}

function viewEditor(g) {
  const maxLines = g.pagesPerPlayer * LINES_PER_PAGE;
  const prev = sortedParts();
  return `<section class="card turn">
    <div class="turn-head"><h2>دورك الآن ✍️</h2><span class="deadline" data-deadline></span></div>
    <p>المساحة المخصصة لك: <b>${toAr(g.pagesPerPlayer)} صفحات</b> (${toAr(maxLines)} سطرًا). اضغط «حفظ» متى شئت، وعندما تنتهي اضغط «تم» لينتقل القلم إلى كاتب آخر.</p>
    ${prev.length
      ? `<details class="sofar"><summary>اقرأ الحكاية حتى الآن (${toAr(prev.length)} فصول)</summary>${chaptersHtml(prev)}</details>`
      : `<p class="hint">أنت أول من يكتب — ابدأ الحكاية وعرّفنا بالشخصيات والمكان!</p>`}
    <label for="chTitle">عنوان فصلك (الفصل ${ordinal(prev.length)})</label>
    <input id="chTitle" data-keep maxlength="80" placeholder="اكتب عنوان الفصل">
    <label for="chText">نص الفصل</label>
    <div class="paper"><textarea id="chText" data-keep rows="${maxLines}" placeholder="كان يا ما كان…"></textarea></div>
    <div class="meter" id="meter"><div class="progress"><span id="meterBar"></span></div><span id="meterTxt"></span></div>
    <div class="actions">
      <button class="btn" id="saveBtn">حفظ</button>
      <button class="btn primary" id="doneBtn">تم ✓</button>
    </div>
  </section>`;
}

// ——— مرحلة اختيار الاسم ———
function viewNaming(g, inGame) {
  const isHost = g.hostUid === me;
  const mine = S.titles[me] || {};
  const props = Object.entries(S.titles).filter(([, t]) => t.proposal).map(([uid, t]) => ({ uid, text: t.proposal, at: t.at || 0 }));
  const votes = {};
  Object.values(S.titles).forEach(t => { if (t.voteFor) votes[t.voteFor] = (votes[t.voteFor] || 0) + 1; });
  const voters = Object.values(S.titles).filter(t => t.voteFor).length;
  props.sort((a, b) => (votes[b.uid] || 0) - (votes[a.uid] || 0) || a.at - b.at);
  const list = sortedParts();
  return `<section class="card">
    <h2>🎉 اكتملت الحكاية!</h2>
    <p>كتب ${toAr(list.length)} كتّاب ${toAr(list.length)} فصول. حان وقت اختيار اسم القصة: اقترح اسمًا، ثم صوّت للاسم الذي يعجبك.</p>
    <details class="sofar"><summary>اقرأ الحكاية كاملة</summary>${chaptersHtml(list)}</details>
  </section>
  <section class="card turn">
    <h2>ما اسم هذه القصة؟</h2>
    ${inGame ? `<form id="propForm" class="row">
        <input id="propIn" data-keep maxlength="80" placeholder="اقترح اسمًا" value="${esc(mine.proposal || "")}">
        <button class="btn" type="submit">${mine.proposal ? "تعديل" : "اقترح"}</button>
      </form>` : ""}
    <h3>الاقتراحات</h3>
    ${props.length ? `<ul class="proposals">${props.map(p => `
      <li class="${mine.voteFor === p.uid ? "mine-vote" : ""}">
        <span class="t">${esc(p.text)}<span class="who">اقتراح ${esc(nameOf(p.uid))}</span></span>
        <span class="votes">${toAr(votes[p.uid] || 0)} صوت</span>
        ${inGame ? `<button class="btn small ${mine.voteFor === p.uid ? "gold" : ""}" data-vote="${esc(p.uid)}">${mine.voteFor === p.uid ? "صوتك ✓" : "صوّت"}</button>` : ""}
      </li>`).join("")}</ul>` : `<p class="hint">لا توجد اقتراحات بعد.</p>`}
    <p class="hint">صوّت ${toAr(voters)} من ${toAr(g.playerIds.length)} كتّاب.</p>
    ${isHost ? `<button class="btn gold block" id="finalBtn" ${props.length ? "" : "disabled"}>اعتماد الاسم الفائز وإصدار الرواية</button>` : `<p class="hint">صاحب الدعوة يعتمد الاسم الفائز عند انتهاء التصويت.</p>`}
  </section>`;
}

// ——— الرواية الجاهزة ———
function bookData(g) {
  const list = sortedParts();
  return {
    title: g.title || "حكاية بلا اسم",
    authors: list.map(p => nameOf(p.uid)),
    chapters: list.map(p => ({ title: p.chapterTitle, author: nameOf(p.uid), text: p.text })),
  };
}

function viewDone(g) {
  const b = bookData(g);
  return `<section class="card book">
    <p class="hint">رواية مشتركة</p>
    <h1>${esc(b.title)}</h1>
    <p>بأقلام: ${b.authors.map(esc).join("، ")}</p>
    <img class="cover-preview" id="coverImg" alt="غلاف الرواية">
    <button class="btn gold block" id="pdfBtn">تحميل الرواية PDF</button>
    <p class="hint" id="pdfMsg"></p>
  </section>
  <section class="card">
    <h2>اقرأ الرواية</h2>
    ${chaptersHtml(sortedParts())}
  </section>`;
}

// ——— ربط الأزرار ———
function bind(g) {
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };

  on("copyBtn", async () => { try { await navigator.clipboard.writeText(inviteLink(g.id)); toast("تم نسخ الرابط"); } catch { toast("انسخ الرابط يدويًا"); } });
  on("shareBtn", () => navigator.share({ title: "حكاية الأقلام", text: "انضم إليّ في كتابة حكاية مشتركة ✒️", url: inviteLink(g.id) }).catch(() => {}));

  const jf = $("joinGameForm");
  if (jf) jf.onsubmit = async e => { e.preventDefault(); await joinGame($("jName").value.trim()); };

  on("startBtn", () => startWriting(false));
  on("startEarlyBtn", () => { if (confirm("هل تريد البدء بالكتّاب الموجودين فقط؟ لن يتمكن أحد من الانضمام بعد ذلك.")) startWriting(true); });
  on("skipBtn", skipCurrent);

  if ($("chText")) setupEditor(g);

  const pf = $("propForm");
  if (pf) pf.onsubmit = async e => {
    e.preventDefault();
    const v = $("propIn").value.trim();
    if (!v) return toast("اكتب اقتراحك");
    try { await F.setDoc(F.doc(db, "games", g.id, "titles", me), { proposal: v, at: Date.now() }, { merge: true }); toast("تم حفظ اقتراحك"); }
    catch (err) { toast("تعذّر الحفظ: " + err.code); }
  };
  $app.querySelectorAll("[data-vote]").forEach(b => b.onclick = async () => {
    try { await F.setDoc(F.doc(db, "games", g.id, "titles", me), { voteFor: b.dataset.vote }, { merge: true }); }
    catch (err) { toast("تعذّر التصويت: " + err.code); }
  });
  on("finalBtn", finalizeTitle);

  if ($("coverImg")) {
    const b = bookData(g);
    ensureFonts().then(() => { const img = $("coverImg"); if (img) img.src = renderCover(b).toDataURL("image/jpeg", 0.85); });
  }
  on("pdfBtn", downloadPdf);
}

function tick() {
  const g = S.game;
  if (!g || g.status !== "writing") return;
  const r = remaining(g);
  document.querySelectorAll("[data-deadline]").forEach(el => { el.textContent = r.txt; el.classList.toggle("over", r.over); });
  const sb = $("skipBtn"); if (sb) sb.hidden = !r.over;
}

// ——— العمليات ———
async function joinGame(name) {
  if (!name) return toast("اكتب اسمك أولًا");
  lsSet("penName", name);
  try {
    await F.runTransaction(db, async tx => {
      const ref = F.doc(db, "games", S.gid);
      const s = await tx.get(ref); const g = s.data();
      if (g.status !== "lobby") throw new Error("بدأت الكتابة بالفعل");
      if (g.playerIds.includes(me)) return;
      if (g.playerIds.length >= g.playersCount) throw new Error("اكتمل العدد");
      if (Object.values(g.players).some(n => n.trim() === name)) throw new Error("هذا الاسم مستخدم، اختر اسمًا آخر");
      tx.update(ref, { playerIds: [...g.playerIds, me], [`players.${me}`]: name });
    });
    rememberGame(S.gid);
    toast("أهلًا بك في الحكاية!");
  } catch (err) { toast(err.message || "تعذّر الانضمام"); }
}

async function startWriting(early) {
  const g = S.game;
  const upd = { status: "writing", currentUid: g.hostUid, turnStartedAt: Date.now(), order: [] };
  if (early) upd.playersCount = g.playerIds.length;
  try { await F.updateDoc(F.doc(db, "games", g.id), upd); toast("بدأت الحكاية! دورك في كتابة الفصل الأول"); }
  catch (err) { toast("تعذّر البدء: " + err.code); }
}

function pickNext(g, order, skipped) {
  const left = g.playerIds.filter(u => !order.includes(u) && !skipped.includes(u));
  return left.length ? left[Math.floor(Math.random() * left.length)] : null;
}

async function skipCurrent() {
  const cur = S.game.currentUid;
  if (!confirm(`تجاوز ${nameOf(cur)}؟ سينتقل القلم إلى كاتب آخر عشوائيًا ولن يكتب فصله.`)) return;
  try {
    await F.runTransaction(db, async tx => {
      const ref = F.doc(db, "games", S.gid);
      const g = (await tx.get(ref)).data();
      if (g.currentUid !== cur || g.status !== "writing") return;
      const skipped = [...(g.skipped || []), cur];
      const next = pickNext(g, g.order, skipped);
      tx.update(ref, next
        ? { skipped, currentUid: next, turnStartedAt: Date.now() }
        : { skipped, currentUid: null, status: g.order.length ? "naming" : "lobby" });
    });
  } catch (err) { toast("تعذّر التجاوز: " + (err.code || err.message)); }
}

function setupEditor(g) {
  const maxLines = g.pagesPerPlayer * LINES_PER_PAGE;
  const ta = $("chText"), ti = $("chTitle");
  const localKey = `draft_${g.id}`;
  let lastValid = ta.value;

  const update = () => {
    const n = countLines(ta.value);
    const page = Math.max(1, Math.ceil(n / LINES_PER_PAGE));
    $("meterBar").style.width = Math.min(100, n / maxLines * 100) + "%";
    $("meterTxt").textContent = `السطر ${toAr(n)} من ${toAr(maxLines)} · الصفحة ${toAr(Math.min(page, g.pagesPerPlayer))} من ${toAr(g.pagesPerPlayer)}`;
    $("meter").classList.toggle("full", n >= maxLines);
  };

  // تعبئة المسودة المحفوظة مرة واحدة
  if (!S.draftLoaded) {
    S.draftLoaded = true;
    const local = lsGet(localKey, null);
    if (local && !ta.value && !ti.value) { ta.value = local.text || ""; ti.value = local.chapterTitle || ""; lastValid = ta.value; }
    F.getDoc(F.doc(db, "games", g.id, "drafts", me)).then(s => {
      if (!s.exists()) return;
      const d = s.data();
      const t = $("chText"), h = $("chTitle");
      if (t && !t.value) { t.value = d.text || ""; lastValid = t.value; }
      if (h && !h.value) h.value = d.chapterTitle || "";
      update();
    }).catch(() => {});
  }

  let saveT;
  ta.oninput = () => {
    if (countLines(ta.value) > maxLines) {
      const pos = Math.max(0, ta.selectionStart - (ta.value.length - lastValid.length));
      ta.value = lastValid;
      try { ta.setSelectionRange(pos, pos); } catch {}
      toast("وصلت إلى نهاية المساحة المخصصة لك");
    } else lastValid = ta.value;
    update();
    clearTimeout(saveT);
    saveT = setTimeout(() => lsSet(localKey, { text: ta.value, chapterTitle: ti.value }), 600);
  };
  ti.oninput = () => lsSet(localKey, { text: ta.value, chapterTitle: ti.value });
  update();

  $("saveBtn").onclick = async () => {
    try {
      await F.setDoc(F.doc(db, "games", g.id, "drafts", me), { text: ta.value, chapterTitle: ti.value.trim(), savedAt: Date.now() });
      toast("تم الحفظ ✓");
    } catch (err) { toast("تعذّر الحفظ: " + err.code); }
  };

  $("doneBtn").onclick = async () => {
    const text = ta.value.trim(), title = ti.value.trim();
    if (!title) { ti.focus(); return toast("اكتب عنوانًا لفصلك"); }
    if (!text) { ta.focus(); return toast("اكتب نص الفصل أولًا"); }
    if (!confirm("هل انتهيت من فصلك؟ بعد التسليم لا يمكن التعديل، وسينتقل القلم إلى كاتب آخر عشوائيًا.")) return;
    const btn = $("doneBtn"); btn.disabled = true;
    try {
      await F.runTransaction(db, async tx => {
        const ref = F.doc(db, "games", g.id);
        const cur = (await tx.get(ref)).data();
        if (cur.status !== "writing" || cur.currentUid !== me) throw new Error("لم يعد هذا دورك");
        const order = [...cur.order, me];
        const next = pickNext(cur, order, cur.skipped || []);
        tx.set(F.doc(db, "games", g.id, "parts", me), { chapterTitle: title, text, index: order.length, submittedAt: Date.now() });
        tx.update(ref, next
          ? { order, currentUid: next, turnStartedAt: Date.now() }
          : { order, currentUid: null, status: "naming" });
      });
      try { localStorage.removeItem(localKey); } catch {}
      F.deleteDoc(F.doc(db, "games", g.id, "drafts", me)).catch(() => {});
      toast("أحسنت! انتقل القلم إلى الكاتب التالي");
    } catch (err) { btn.disabled = false; toast(err.message || "تعذّر التسليم"); }
  };
}

async function finalizeTitle() {
  const votes = {};
  Object.values(S.titles).forEach(t => { if (t.voteFor) votes[t.voteFor] = (votes[t.voteFor] || 0) + 1; });
  const props = Object.entries(S.titles).filter(([, t]) => t.proposal)
    .map(([uid, t]) => ({ uid, text: t.proposal, at: t.at || 0, v: votes[uid] || 0 }))
    .sort((a, b) => b.v - a.v || a.at - b.at);
  if (!props.length) return;
  const win = props[0];
  if (!confirm(`اعتماد «${win.text}» اسمًا للرواية (${win.v} صوت)؟`)) return;
  try { await F.updateDoc(F.doc(db, "games", S.gid), { status: "done", title: win.text }); }
  catch (err) { toast("تعذّر الاعتماد: " + err.code); }
}

async function downloadPdf() {
  if (!window.jspdf) return toast("لم تُحمّل مكتبة PDF، تحقق من الاتصال");
  const btn = $("pdfBtn"), msg = $("pdfMsg");
  btn.disabled = true;
  try {
    const b = bookData(S.game);
    const pdf = await buildBookPdf(b, t => { if (msg) msg.textContent = t ? "جارٍ تجهيز " + t : ""; });
    pdf.save(`${b.title.replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "رواية"}.pdf`);
    if (msg) msg.textContent = "تم تجهيز الرواية ✓";
  } catch (err) { console.error(err); toast("تعذّر إنشاء الملف"); }
  btn.disabled = false;
}
