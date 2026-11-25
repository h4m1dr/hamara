// Mini App page (Phase 2): Wepod-like day-grouped card list, bank chips,
// corner filter panel, category colors, charts, manual entry, settings.
// Served at /app; data comes from the initData-authenticated API.

export const APP_HTML = `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>hamara</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root{--bg:#f5f6f8;--card:#fff;--text:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:#2563eb;--red:#dc2626;--green:#16a34a}
  body.dark{--bg:#0f1115;--card:#1a1d24;--text:#f3f4f6;--muted:#9ca3af;--line:#2a2e38}
  *{box-sizing:border-box}
  body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);margin:0;padding:12px;padding-bottom:84px}
  .summary{display:flex;gap:8px;margin-bottom:10px}
  .sum{flex:1;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:10px;text-align:center}
  .sum b{font-size:15px}
  .chips{display:flex;gap:8px;overflow-x:auto;padding:2px 0 10px;scrollbar-width:none}
  .chip{border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:999px;padding:6px 14px;white-space:nowrap;cursor:pointer;font-size:13px}
  .chip.on{background:var(--accent);color:#fff;border-color:var(--accent)}
  .toolbar{display:flex;gap:8px;align-items:center;margin-bottom:6px}
  .toolbar .sp{flex:1}
  button,select,input{background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:13px}
  button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
  .panel{display:none;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;margin-bottom:10px}
  .panel.open{display:block}
  .panel label{display:block;font-size:12px;color:var(--muted);margin:8px 0 4px}
  .panel select,.panel input{width:100%}
  .day{font-size:12px;color:var(--muted);margin:16px 4px 6px;font-weight:700}
  .card{background:var(--card);border:1px solid var(--line);border-right:5px solid var(--line);border-radius:14px;padding:10px 12px;margin:6px 0;cursor:pointer}
  .row{display:flex;justify-content:space-between;align-items:center;gap:8px}
  .amt{font-weight:800;font-size:15px;white-space:nowrap}
  .neg{color:var(--red)}.pos{color:var(--green)}
  .muted{color:var(--muted);font-size:12px}
  .tag{font-size:11px;border-radius:999px;padding:2px 9px;color:#fff;white-space:nowrap}
  .note{font-size:13px;margin-top:4px}
  .empty{text-align:center;color:var(--muted);padding:36px 16px;line-height:2}
  .sheet{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10}
  .sheet.open{display:block}
  .sheetbox{position:absolute;bottom:0;right:0;left:0;background:var(--card);border-radius:18px 18px 0 0;padding:16px;max-height:82vh;overflow:auto}
  .sheetbox label{display:block;font-size:12px;color:var(--muted);margin:10px 0 4px}
  .sheetbox select,.sheetbox input{width:100%}
  .fab{position:fixed;bottom:18px;left:18px;width:54px;height:54px;border-radius:50%;background:var(--accent);color:#fff;font-size:26px;border:none;cursor:pointer;z-index:9}
  .catrow{display:flex;align-items:center;gap:8px;margin:6px 0}
  .dot{width:14px;height:14px;border-radius:50%;flex:none}
  canvas{max-width:100%;display:block;margin:6px auto}
  .legend{font-size:12px;line-height:1.9}
</style></head><body>

<div class="summary">
  <div class="sum"><div class="muted">درآمد این ماه</div><b class="pos" id="sumIn">۰</b></div>
  <div class="sum"><div class="muted">هزینه این ماه</div><b class="neg" id="sumOut">۰</b></div>
</div>

<div class="chips" id="chips"></div>

<div class="toolbar">
  <button id="filterBtn">فیلتر</button>
  <span class="sp"></span>
  <button id="themeBtn">تم</button>
  <button id="csvBtn">خروجی CSV</button>
</div>

<div class="panel" id="filterPanel">
  <label>دسته</label><select id="fCat"></select>
  <label>نوع انتقال</label><select id="fKind"></select>
</div>

<canvas id="donut" width="300" height="300"></canvas>
<div class="legend" id="legend"></div>
<canvas id="bars" width="360" height="190"></canvas>

<div id="list"></div>

<button class="fab" id="addBtn">+</button>

<div class="sheet" id="editSheet"><div class="sheetbox">
  <div class="row"><b>تراکنش</b><button onclick="closeSheets()">بستن</button></div>
  <div id="editInfo" class="muted" style="margin-top:6px"></div>
  <label>دسته</label><select id="eCat"></select>
  <label>یادداشت (روی کارت دیده می‌شود)</label><input id="eNote" placeholder="مثلاً: ناهار با زینب">
  <div class="row" style="margin-top:14px">
    <button class="primary" onclick="saveEdit()">ذخیره</button>
    <button onclick="delTx()" style="color:var(--red)">حذف تراکنش</button>
  </div>
</div></div>

<div class="sheet" id="addSheet"><div class="sheetbox">
  <div class="row"><b>تراکنش دستی</b><button onclick="closeSheets()">بستن</button></div>
  <label>بانک</label><select id="aBank"></select>
  <label>مبلغ (تومان)</label><input id="aAmount" type="number" inputmode="numeric">
  <label>جهت</label><select id="aDir"><option value="out">برداشت / هزینه</option><option value="in">واریز / درآمد</option></select>
  <label>دسته</label><select id="aCat"></select>
  <label>یادداشت</label><input id="aNote">
  <div style="margin-top:14px"><button class="primary" onclick="saveAdd()">ثبت</button></div>
</div></div>

<div class="sheet" id="catSheet"><div class="sheetbox">
  <div class="row"><b>دسته‌ها</b><button onclick="closeSheets()">بستن</button></div>
  <div id="catList"></div>
  <label>دسته جدید</label><input id="cName" placeholder="مثلاً: غذا">
  <label>رنگ</label><input id="cColor" type="color" value="#dc2626">
  <div style="margin-top:12px"><button class="primary" onclick="addCat()">اضافه کن</button></div>
</div></div>

<div class="toolbar" style="margin-top:18px">
  <button onclick="openSheet('catSheet')">مدیریت دسته‌ها</button>
  <button id="setBtn">خروجی تنظیمات</button>
</div>

<script>
const tg = window.Telegram.WebApp; tg.ready(); tg.expand();
const H = {'x-telegram-init-data': tg.initData || ''};
const $ = (id) => document.getElementById(id);
let bank = '', cats = [], banks = [], editId = null;
const toman = (r) => Math.abs(Math.round(r/10)).toLocaleString('fa-IR');
const jDay = new Intl.DateTimeFormat('fa-IR', {weekday:'long', day:'numeric', month:'long', timeZone:'Asia/Tehran'});
const jTime = new Intl.DateTimeFormat('fa-IR', {hour:'2-digit', minute:'2-digit', timeZone:'Asia/Tehran'});
async function api(path, opts) { const r = await fetch(path, {headers:{...H,'content-type':'application/json'}, ...opts}); return r.json(); }
function openSheet(id){ closeSheets(); $(id).classList.add('open'); }
function closeSheets(){ document.querySelectorAll('.sheet').forEach(s=>s.classList.remove('open')); }
document.querySelectorAll('.sheet').forEach(s=>s.addEventListener('click',e=>{ if(e.target===s) closeSheets(); }));

async function load() {
  const [b, c, s] = await Promise.all([api('/api/banks'), api('/api/categories'), api('/api/settings')]);
  banks = b.items || []; cats = c.items || [];
  if ((s.items||[]).find(x=>x.key==='theme')?.value === 'dark') document.body.classList.add('dark');
  $('chips').innerHTML = '<button class="chip on" data-b="">همه</button>' + banks.map(x=>'<button class="chip" data-b="'+x.id+'">'+x.name+'</button>').join('');
  document.querySelectorAll('.chip').forEach(el=>el.onclick=()=>{bank=el.dataset.b;document.querySelectorAll('.chip').forEach(e=>e.classList.toggle('on',e===el));loadTx();});
  const catOpts = '<option value="">همه دسته‌ها</option><option value="none">بدون دسته</option>' + cats.map(x=>'<option value="'+x.id+'">'+x.name+'</option>').join('');
  $('fCat').innerHTML = catOpts;
  $('eCat').innerHTML = '<option value="">بدون دسته</option>' + cats.map(x=>'<option value="'+x.id+'">'+x.name+'</option>').join('');
  $('aCat').innerHTML = $('eCat').innerHTML;
  $('aBank').innerHTML = banks.map(x=>'<option value="'+x.id+'">'+x.name+'</option>').join('');
  $('catList').innerHTML = cats.map(x=>'<div class="catrow"><span class="dot" style="background:'+x.color+'"></span><span>'+x.name+'</span><span style="flex:1"></span><button onclick="delCat('+x.id+')">حذف</button></div>').join('') || '<p class="muted">هنوز دسته‌ای نیست. مثلاً «غذا» با رنگ قرمز بساز.</p>';
  const all = await api('/api/transactions?limit=500');
  const kinds = [...new Set((all.items||[]).map(x=>x.kind).filter(Boolean))];
  $('fKind').innerHTML = '<option value="">همه نوع‌ها</option>' + kinds.map(k=>'<option>'+k+'</option>').join('');
  loadTx(); loadStats();
}

async function loadTx() {
  const q = new URLSearchParams({bank, category:$('fCat').value, kind:$('fKind').value});
  const d = await api('/api/transactions?' + q);
  const items = d.items || [];
  if (!items.length) { $('list').innerHTML = '<div class="empty">هنوز تراکنشی نیست.<br>پیامک بانک رو به بات بفرست، فایل CSV صورتحساب رو بفرست، یا با دکمه + دستی ثبت کن.</div>'; return; }
  let html = '', lastDay = '';
  for (const t of items) {
    const dt = new Date(t.occurred_at);
    const day = jDay.format(dt);
    if (day !== lastDay) { html += '<div class="day">' + day + '</div>'; lastDay = day; }
    const color = t.category_color || '#e5e7eb';
    html += '<div class="card" style="border-right-color:'+color+'" onclick="openEdit('+t.id+')">'
      + '<div class="row"><span>'+(t.bank_name||'')+(t.is_internal?' · انتقال داخلی':'')+'</span>'
      + '<span class="amt '+(t.amount_rial<0?'neg':'pos')+'">'+(t.amount_rial<0?'−':'+')+toman(t.amount_rial)+' تومان</span></div>'
      + '<div class="row"><span class="muted">'+jTime.format(dt)+(t.kind?' · '+t.kind:'')+(t.balance_rial!=null?' · مانده '+toman(t.balance_rial):'')+'</span>'
      + (t.category_name?'<span class="tag" style="background:'+color+'">'+t.category_name+'</span>':'') + '</div>'
      + (t.note?'<div class="note">'+t.note+'</div>':'') + '</div>';
  }
  $('list').innerHTML = html;
}

async function openEdit(id) {
  const d = await api('/api/transactions?limit=500');
  const t = (d.items||[]).find(x=>x.id===id); if (!t) return;
  editId = id;
  $('editInfo').textContent = (t.bank_name||'') + ' · ' + toman(t.amount_rial) + ' تومان · ' + jDay.format(new Date(t.occurred_at));
  $('eCat').value = t.category_id || '';
  $('eNote').value = t.note || '';
  openSheet('editSheet');
}
async function saveEdit() {
  await api('/api/transactions/'+editId, {method:'PATCH', body: JSON.stringify({category_id: $('eCat').value?Number($('eCat').value):null, note: $('eNote').value || null})});
  closeSheets(); loadTx(); loadStats();
}
async function delTx() {
  if (!confirm('این تراکنش حذف بشه؟')) return;
  await api('/api/transactions/'+editId, {method:'DELETE'});
  closeSheets(); loadTx(); loadStats();
}
async function saveAdd() {
  const amt = Number($('aAmount').value);
  if (!amt || !$('aBank').value) { alert('بانک و مبلغ رو وارد کن. اول یه پیامک بفرست تا بانک ساخته بشه.'); return; }
  await api('/api/transactions', {method:'POST', body: JSON.stringify({bank_id:Number($('aBank').value), amount_toman:amt, direction:$('aDir').value, category_id:$('aCat').value?Number($('aCat').value):null, note:$('aNote').value||null})});
  closeSheets(); loadTx(); loadStats();
}
async function addCat() {
  if (!$('cName').value) return;
  await api('/api/categories', {method:'POST', body: JSON.stringify({name:$('cName').value, color:$('cColor').value})});
  load();
}
async function delCat(id) { if (!confirm('دسته حذف بشه؟ تراکنش‌هاش بی‌دسته می‌شن.')) return; await api('/api/categories/'+id, {method:'DELETE'}); load(); }

async function loadStats() {
  const s = await api('/api/stats');
  const m = (s.monthly||[]).slice(-1)[0];
  $('sumIn').textContent = m ? toman(m.income) : '۰';
  $('sumOut').textContent = m ? toman(m.expense) : '۰';
  drawDonut(s.donut||[], s.internal_total||0); drawBars(s.monthly||[]);
}
function drawDonut(rows, internal) {
  const cv = $('donut'), ctx = cv.getContext('2d'); ctx.clearRect(0,0,300,300);
  const data = rows.map(r=>({v:r.total,c:r.color,n:r.name}));
  if (internal>0) data.push({v:internal,c:'#94a3b8',n:'انتقال داخلی'});
  const total = data.reduce((a,d)=>a+d.v,0);
  $('legend').innerHTML = data.map(d=>'<span class="dot" style="background:'+d.c+';display:inline-block"></span> '+d.n+': '+toman(d.v)+' تومان').join('<br>');
  if (!total) { ctx.fillStyle=getComputedStyle(document.body).color; ctx.font='13px sans-serif'; ctx.fillText('هنوز هزینه‌ای ثبت نشده', 85, 150); return; }
  let a = -Math.PI/2;
  for (const d of data) { const sw = d.v/total*Math.PI*2; ctx.beginPath(); ctx.moveTo(150,150); ctx.arc(150,150,135,a,a+sw); ctx.fillStyle=d.c; ctx.fill(); a+=sw; }
  ctx.globalCompositeOperation='destination-out'; ctx.beginPath(); ctx.arc(150,150,78,0,Math.PI*2); ctx.fill(); ctx.globalCompositeOperation='source-over';
}
function drawBars(rows) {
  const cv = $('bars'), ctx = cv.getContext('2d'); ctx.clearRect(0,0,360,190);
  if (!rows.length) return;
  const max = Math.max(...rows.flatMap(r=>[r.income,r.expense])) || 1;
  const w = 360/rows.length;
  rows.forEach((r,i)=>{ const x=i*w+4;
    ctx.fillStyle='#16a34a'; ctx.fillRect(x,165-(r.income/max*145),w/2-4,r.income/max*145);
    ctx.fillStyle='#dc2626'; ctx.fillRect(x+w/2,165-(r.expense/max*145),w/2-4,r.expense/max*145);
    ctx.fillStyle=getComputedStyle(document.body).color; ctx.font='9px sans-serif'; ctx.fillText(r.month,x,182); });
}
$('filterBtn').onclick = () => $('filterPanel').classList.toggle('open');
$('fCat').onchange = loadTx; $('fKind').onchange = loadTx;
$('addBtn').onclick = () => openSheet('addSheet');
$('themeBtn').onclick = async () => { const dark = document.body.classList.toggle('dark'); await api('/api/settings',{method:'POST',body:JSON.stringify({theme:dark?'dark':'light'})}); };
async function download(path, name) { const r = await fetch(path,{headers:H}); const b = await r.blob(); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=name; a.click(); }
$('csvBtn').onclick = () => download('/api/export.csv','hamara-transactions.csv');
$('setBtn').onclick = () => download('/api/settings/export','hamara-settings.json');
load();
</script></body></html>
`;
