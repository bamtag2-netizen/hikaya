// توليد كتاب PDF على هيئة رواية: غلاف، صفحة المؤلفين، ثم الفصول.
// الرسم يتم على canvas (يدعم تشكيل الحروف العربية تلقائيًا) ثم يُجمع في PDF بحجم A5.

export const ORD = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر",
  "الحادي عشر", "الثاني عشر", "الثالث عشر", "الرابع عشر", "الخامس عشر", "السادس عشر", "السابع عشر", "الثامن عشر", "التاسع عشر", "العشرون"];
export const toAr = n => String(n).replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]);
export const ordinal = i => ORD[i] || toAr(i + 1);

const W = 1240, H = 1754;            // A5 تقريبًا بدقة ~٢١٠ نقطة/إنش
const PAPER = "#fbf7ee", INK = "#2a2118", MUTED = "#8a7a66", GOLD = "#b8893a";
const BODY = "38px Amiri", LH = 74;
const SIDE = 150, TOP = 210, BOTTOM = 220;
const TW = W - SIDE * 2;              // عرض السطر
const RUQAA = "'Aref Ruqaa'";
const COPYRIGHT = "حقوق الملكية © باسم أبو أنس 2026";
const CREDIT = "صدرت هذه الرواية عبر لعبة «حكاية الأقلام»";
const SITE = (() => {
  try {
    const u = (location.host + location.pathname).replace(/index\.html$/, "").replace(/\/$/, "");
    return u && !/^(localhost|127\.)/.test(u) ? u : "bamtag2-netizen.github.io/hikaya";
  } catch { return "bamtag2-netizen.github.io/hikaya"; }
})();

// سطر الرابط يُرسم من اليسار لليمين
function linkText(x, y, font, color) {
  x.save(); x.direction = "ltr"; x.font = font; x.fillStyle = color; x.textAlign = "center";
  x.fillText(SITE, W / 2, y); x.restore();
}

export async function ensureFonts() {
  const s = "أبجد هوز";
  try {
    await Promise.all([
      document.fonts.load("38px Amiri", s),
      document.fonts.load("bold 60px Amiri", s),
      document.fonts.load(`60px ${RUQAA}`, s),
      document.fonts.load(`bold 120px ${RUQAA}`, s),
    ]);
  } catch (e) { /* نكمل بالخط الاحتياطي */ }
}

function newCanvas(bg = PAPER) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.direction = "rtl";
  x.textBaseline = "alphabetic";
  return { c, x };
}

// يقسم النص إلى أسطر بعرض محدد، مع مسافة بادئة لأول سطر في الفقرة
function wrap(x, text, maxW, indent = 0) {
  const out = [];
  const sp = x.measureText(" ").width;
  for (const para of String(text || "").replace(/\r/g, "").split("\n")) {
    const t = para.trim();
    if (!t) continue;
    const words = t.split(/\s+/);
    let line = [], w = 0, first = true;
    for (const wd of words) {
      const ww = x.measureText(wd).width;
      const lim = maxW - (first ? indent : 0);
      if (line.length && w + sp + ww > lim) {
        out.push({ words: line, last: false, indent: first ? indent : 0 });
        first = false; line = [wd]; w = ww;
      } else {
        w += (line.length ? sp : 0) + ww;
        line.push(wd);
      }
    }
    if (line.length) out.push({ words: line, last: true, indent: first ? indent : 0 });
  }
  return out;
}

// يرسم سطرًا مضبوط الطرفين (justify) من اليمين إلى اليسار
function drawLine(x, L, rightX, y, maxW) {
  const ws = L.words.map(w => x.measureText(w).width);
  const sum = ws.reduce((a, b) => a + b, 0);
  const sp = x.measureText(" ").width;
  const avail = maxW - L.indent;
  let gap = sp;
  if (!L.last && L.words.length > 1) {
    gap = (avail - sum) / (L.words.length - 1);
    if (gap > sp * 4) gap = sp;
  }
  x.textAlign = "right";
  let cx = rightX - L.indent;
  L.words.forEach((w, i) => { x.fillText(w, cx, y); cx -= ws[i] + gap; });
}

function centerText(x, text, y, font, color) {
  x.font = font; x.fillStyle = color; x.textAlign = "center";
  x.fillText(text, W / 2, y);
}

function centerWrapped(x, text, y, font, color, maxW, lh) {
  x.font = font;
  const lines = wrap(x, text, maxW).map(l => l.words.join(" "));
  x.fillStyle = color; x.textAlign = "center";
  lines.forEach((l, i) => x.fillText(l, W / 2, y + i * lh));
  return lines.length;
}

function ornament(x, cy, color, half = 170) {
  const cx = W / 2;
  x.strokeStyle = color; x.fillStyle = color; x.lineWidth = 2;
  x.beginPath(); x.moveTo(cx - half, cy); x.lineTo(cx - 22, cy); x.moveTo(cx + 22, cy); x.lineTo(cx + half, cy); x.stroke();
  x.beginPath(); x.moveTo(cx, cy - 12); x.lineTo(cx + 12, cy); x.lineTo(cx, cy + 12); x.lineTo(cx - 12, cy); x.closePath(); x.fill();
  [-1, 1].forEach(s => { x.beginPath(); x.arc(cx + s * (half + 10), cy, 4, 0, Math.PI * 2); x.fill(); });
}

function rosette(x, cx, cy, r, color) {
  x.save(); x.translate(cx, cy); x.strokeStyle = color; x.lineWidth = 2.5;
  for (let i = 0; i < 8; i++) {
    x.rotate(Math.PI / 4);
    x.beginPath(); x.ellipse(0, -r / 2, r / 5, r / 2, 0, 0, Math.PI * 2); x.stroke();
  }
  x.beginPath(); x.arc(0, 0, r / 6, 0, Math.PI * 2); x.fillStyle = color; x.fill();
  x.beginPath(); x.arc(0, 0, r * 1.05, 0, Math.PI * 2); x.stroke();
  x.restore();
}

// ——— الغلاف ———
export function renderCover({ title, authors }) {
  const { c, x } = newCanvas("#16222e");
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#23384c"); g.addColorStop(1, "#0d151d");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W / 2, H * 0.4, 50, W / 2, H * 0.4, 800);
  glow.addColorStop(0, "rgba(214,173,99,.16)"); glow.addColorStop(1, "rgba(214,173,99,0)");
  x.fillStyle = glow; x.fillRect(0, 0, W, H);

  const gold = "#d6ad63", light = "#f3e3b8";
  x.strokeStyle = gold; x.lineWidth = 6; x.strokeRect(60, 60, W - 120, H - 120);
  x.lineWidth = 2; x.strokeRect(86, 86, W - 172, H - 172);
  [[86, 86], [W - 86, 86], [86, H - 86], [W - 86, H - 86]].forEach(([a, b]) => rosette(x, a, b, 34, gold));

  centerText(x, "رواية", 290, "40px Amiri", gold);
  rosette(x, W / 2, 440, 70, gold);

  // عنوان بخط الرقعة، يصغر تلقائيًا حتى يتسع في ٣ أسطر
  let size = 140, lines;
  for (; size >= 70; size -= 6) {
    x.font = `bold ${size}px ${RUQAA}`;
    lines = wrap(x, title, W - 320);
    if (lines.length <= 3) break;
  }
  const lh = size * 1.35;
  const blockH = lines.length * lh;
  let ty = 760 - blockH / 2 + lh * 0.75;
  x.fillStyle = light; x.textAlign = "center";
  x.shadowColor = "rgba(0,0,0,.35)"; x.shadowBlur = 12;
  lines.forEach((l, i) => x.fillText(l.words.join(" "), W / 2, ty + i * lh));
  x.shadowBlur = 0;
  ornament(x, ty + blockH - lh * 0.4 + 40, gold, 220);

  // أسماء المؤلفين أسفل الغلاف
  x.font = "36px Amiri";
  const names = wrap(x, authors.join("  ◆  "), W - 360).map(l => l.words.join(" "));
  const nlh = 60;
  let ny = H - 200 - (names.length - 1) * nlh;
  centerText(x, "بأقلام", ny - 80, "34px Amiri", gold);
  x.font = "36px Amiri"; x.fillStyle = "#e9e1cf"; x.textAlign = "center";
  names.forEach((l, i) => x.fillText(l, W / 2, ny + i * nlh));
  return c;
}

// ——— صفحة العنوان والمؤلفين ———
function renderTitlePage({ title, authors }) {
  const { c, x } = newCanvas();
  x.strokeStyle = "#d9ccb2"; x.lineWidth = 2; x.strokeRect(70, 70, W - 140, H - 140);
  const n = centerWrapped(x, title, 360, `bold 84px ${RUQAA}`, INK, W - 360, 116);
  let y = 360 + (n - 1) * 116 + 80;
  ornament(x, y, GOLD);
  y += 120;
  centerText(x, "تأليف", y, "38px Amiri", MUTED);
  y += 90;
  const two = authors.length > 10;
  const rows = two ? Math.ceil(authors.length / 2) : authors.length;
  // نضغط المسافة بين الأسماء إذا اقتربت من أسطر الحقوق في الأسفل
  const lh = Math.max(44, Math.min(two ? 64 : 70, (H - 420 - y) / Math.max(1, rows - 1)));
  x.font = "bold 40px Amiri"; x.fillStyle = INK; x.textAlign = "center";
  authors.forEach((a, i) => {
    if (two) {
      const col = i % 2, row = Math.floor(i / 2);
      x.fillText(a, col === 0 ? W * 0.68 : W * 0.32, y + row * lh);
    } else {
      x.fillText(a, W / 2, y + i * lh);
    }
  });
  centerText(x, `الطبعة الأولى — ${toAr(new Date().getFullYear())}`, H - 300, "30px Amiri", MUTED);
  x.strokeStyle = "#e0d5bf"; x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(W / 2 - 200, H - 260); x.lineTo(W / 2 + 200, H - 260); x.stroke();
  centerText(x, CREDIT, H - 210, "28px Amiri", MUTED);
  centerText(x, COPYRIGHT, H - 165, "28px Amiri", MUTED);
  linkText(x, H - 122, "24px Amiri", GOLD);
  return c;
}

// ——— الغلاف الخلفي ———
function renderBackCover({ title, authors }) {
  const { c, x } = newCanvas("#16222e");
  const g = x.createLinearGradient(W, 0, 0, H);
  g.addColorStop(0, "#23384c"); g.addColorStop(1, "#0d151d");
  x.fillStyle = g; x.fillRect(0, 0, W, H);

  const gold = "#d6ad63", light = "#f3e3b8", soft = "#cfc6b4";
  x.strokeStyle = gold; x.lineWidth = 6; x.strokeRect(60, 60, W - 120, H - 120);
  x.lineWidth = 2; x.strokeRect(86, 86, W - 172, H - 172);
  [[86, 86], [W - 86, 86], [86, H - 86], [W - 86, H - 86]].forEach(([a, b]) => rosette(x, a, b, 34, gold));

  rosette(x, W / 2, 420, 60, gold);
  const n = centerWrapped(x, title, 620, `bold 72px ${RUQAA}`, light, W - 360, 100);
  let y = 620 + (n - 1) * 100 + 80;
  ornament(x, y, gold, 180);
  y += 110;
  const blurb = `رواية كُتبت بأقلام ${toAr(authors.length)} كتّاب، تناوبوا على فصولها واحدًا تلو الآخر دون أن يعرف أحدهم إلى أين ستمضي الحكاية.`;
  centerWrapped(x, blurb, y, "36px Amiri", soft, W - 380, 64);

  x.strokeStyle = "rgba(214,173,99,.5)"; x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(W / 2 - 280, H - 330); x.lineTo(W / 2 + 280, H - 330); x.stroke();
  centerText(x, "حكاية الأقلام", H - 265, `46px ${RUQAA}`, gold);
  centerText(x, CREDIT, H - 210, "30px Amiri", soft);
  centerText(x, COPYRIGHT, H - 162, "30px Amiri", soft);
  linkText(x, H - 118, "26px Amiri", gold);
  return c;
}

// ——— الكتاب كاملًا ———
export async function buildBookPdf({ title, authors, chapters }, onProgress = () => {}) {
  await ensureFonts();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "mm", format: "a5", orientation: "portrait", compress: true });
  let first = true;
  const add = async c => {
    if (!first) pdf.addPage("a5", "portrait");
    first = false;
    pdf.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, 148, 210, undefined, "FAST");
    await new Promise(r => setTimeout(r, 0));
  };

  onProgress("الغلاف…");
  await add(renderCover({ title, authors }));
  await add(renderTitlePage({ title, authors }));

  let pageNo = 0;
  let cur = null, y = 0;
  const finish = async () => {
    if (!cur) return;
    centerText(cur.x, toAr(pageNo), H - 110, "30px Amiri", MUTED);
    await add(cur.c);
    cur = null;
  };
  const open = (chapterStart) => {
    pageNo++;
    cur = newCanvas();
    if (!chapterStart) {
      centerText(cur.x, title, 120, "26px Amiri", MUTED);
      cur.x.strokeStyle = "#e0d5bf"; cur.x.lineWidth = 1.5;
      cur.x.beginPath(); cur.x.moveTo(SIDE, 146); cur.x.lineTo(W - SIDE, 146); cur.x.stroke();
    }
    y = TOP + 40;
  };

  const measure = newCanvas().x;
  measure.font = BODY;

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    onProgress(`الفصل ${ordinal(i)}…`);
    await finish();
    open(true);
    const x = cur.x;
    y = 380;
    centerText(x, `الفصل ${ordinal(i)}`, y, `58px ${RUQAA}`, GOLD);
    y += 115;
    const n = centerWrapped(x, ch.title || "", y, "bold 60px Amiri", INK, TW, 84);
    y += (n - 1) * 84 + 70;
    centerText(x, `بقلم: ${ch.author}`, y, "34px Amiri", MUTED);
    y += 70;
    ornament(x, y, GOLD, 140);
    y += 120;

    for (const L of wrap(measure, ch.text, TW, 54)) {
      if (y > H - BOTTOM) { await finish(); open(false); }
      cur.x.font = BODY; cur.x.fillStyle = INK;
      drawLine(cur.x, L, W - SIDE, y, TW);
      y += LH;
    }
  }
  // خاتمة
  if (!cur) open(false);
  if (y + 60 > H - BOTTOM) { await finish(); open(false); y = TOP + 200; }
  y += 40;
  centerText(cur.x, "— تمّت —", y, `52px ${RUQAA}`, GOLD);
  await finish();
  onProgress("الغلاف الخلفي…");
  await add(renderBackCover({ title, authors }));
  onProgress("");
  return pdf;
}
