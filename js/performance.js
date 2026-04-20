import { S } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { fmtAmt, fmtDate, esc } from "./utils.js";

let currentCharts = [];
let perfSeg = 'month';
let perfChart = 'cats';
let perfLbPeriod = 'month';
let chartLoadPromise = null;

function ensureChartJs() {
  if (window.Chart) return Promise.resolve();
  if (chartLoadPromise) return chartLoadPromise;
  chartLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return chartLoadPromise;
}

export async function renderDaily(c) {
  const metrics = getLoanMetrics();
  const td = metrics.day;
  const todayL = metrics.sanctionedToday;
  const monthL = metrics.sanctionedThisMonth;
  const pendingL = metrics.pending;
  const tAmt = sumAmount(todayL);
  const mAmt = sumAmount(monthL);
  const pAmt = sumAmount(pendingL);
  const cats = ['Agriculture', 'SME', 'Education'];
  const catColors = ['rgba(16,185,129,0.75)', 'rgba(107,95,191,0.75)', 'rgba(245,158,11,0.75)'];

  function buildLeaderboard(loans) {
    const od = {};
    S.officers.forEach(o => od[o] = { total: 0, agri: 0, sme: 0, edu: 0 });
    loans.forEach(l => {
      const a = parseFloat(l.amount) || 0, o = l.allocatedTo;
      if (od[o] !== undefined) {
        od[o].total += a;
        if (l.category === 'Agriculture') od[o].agri += a;
        else if (l.category === 'SME') od[o].sme += a;
        else if (l.category === 'Education') od[o].edu += a;
      }
    });
    const sr = Object.entries(od).sort((a, b) => b[1].total - a[1].total);
    const mx = sr.length ? sr[0][1].total : 1;
    const rk = ['gold', 'silver', 'bronze'];
    return sr.map(([nm, d], i) => {
      const p = mx > 0 ? Math.round(d.total / mx * 100) : 0;
      return `<div class="perf-lb-item">
        <div class="perf-lb-rank ${rk[i] || ''}">${i + 1}</div>
        <div class="perf-lb-info">
          <div class="perf-lb-name">${esc(nm)}</div>
          <div class="perf-lb-cats">
            ${d.agri ? `<span class="perf-lb-cat agri">Agri ₹${fmtAmt(d.agri)}L</span>` : ''}
            ${d.sme ? `<span class="perf-lb-cat sme">SME ₹${fmtAmt(d.sme)}L</span>` : ''}
            ${d.edu ? `<span class="perf-lb-cat edu">Edu ₹${fmtAmt(d.edu)}L</span>` : ''}
          </div>
          <div class="perf-lb-bar-wrap"><div class="perf-lb-bar" style="width:${p}%"></div></div>
        </div>
        <div class="perf-lb-amt">₹${fmtAmt(d.total)}L</div>
      </div>`;
    }).join('');
  }

  const lbHtml = buildLeaderboard(perfLbPeriod === 'today' ? todayL : monthL);

  function mkSummary(loans) {
    if (!loans.length) return '<div style="padding:16px;text-align:center;font-size:13px;color:#7B7A9A;">No entries</div>';
    const grp = {};
    loans.forEach(l => {
      const o = l.allocatedTo || '?', ct = l.category || 'Other';
      if (!grp[o]) grp[o] = {};
      if (!grp[o][ct]) grp[o][ct] = { n: 0, a: 0 };
      grp[o][ct].n++; grp[o][ct].a += parseFloat(l.amount) || 0;
    });
    const grand = { n: 0, a: 0 };
    const rows = S.officers.map(off => {
      const g = grp[off] || {}; let rt = { n: 0, a: 0 };
      const ch = cats.map(cat => {
        const v = g[cat] || { n: 0, a: 0 }; rt.n += v.n; rt.a += v.a;
        if (!v.n) return '';
        const cl = cat === 'Agriculture' ? 'agri' : cat === 'SME' ? 'sme' : 'edu';
        const sh = cat === 'Agriculture' ? 'Agri' : cat === 'Education' ? 'Edu' : cat;
        return `<span class="os-cat ${cl}"><span class="os-cnt">${v.n}</span> ${sh} ₹${fmtAmt(v.a)}L</span>`;
      }).join('');
      grand.n += rt.n; grand.a += rt.a;
      if (!rt.n) return `<div class="os-row"><span class="os-name">${esc(off)}</span><span class="os-cats" style="color:#7B7A9A;font-size:12px;">—</span><span class="os-total">₹0L</span></div>`;
      return `<div class="os-row"><span class="os-name">${esc(off)}</span><span class="os-cats">${ch}</span><span class="os-total">₹${fmtAmt(rt.a)}L</span></div>`;
    }).join('');
    return `<div class="officer-summary">${rows}<div class="os-grand"><span>Total: ${grand.n} loans</span><span>₹${fmtAmt(grand.a)} L</span></div></div>`;
  }

  const segData = { today: { title: `📅 Today — ${fmtDate(td)}`, amt: tAmt, loans: todayL }, month: { title: '📅 This Month', amt: mAmt, loans: monthL }, pending: { title: '⌛ Pending', amt: pAmt, loans: pendingL } };
  const seg = segData[perfSeg];
  const isMob = window.innerWidth <= 500;
  const cht = isMob ? `<div style="text-align:center;margin-bottom:10px;"><div class="mini-toggle"><button class="mini-toggle-btn ${perfChart === 'cats' ? 'active' : ''}" onclick="setPerfChart('cats')">Categories</button><button class="mini-toggle-btn ${perfChart === 'officers' ? 'active' : ''}" onclick="setPerfChart('officers')">Officers</button></div></div>` : '';

  c.innerHTML = `
    <div class="perf-kpi-row">
      <div class="perf-kpi today"><div class="perf-kpi-label">Today</div><div class="perf-kpi-value">₹${fmtAmt(tAmt)}L</div><div class="perf-kpi-sub">${todayL.length} loan${todayL.length !== 1 ? 's' : ''}</div></div>
      <div class="perf-kpi month"><div class="perf-kpi-label">This Month</div><div class="perf-kpi-value">₹${fmtAmt(mAmt)}L</div><div class="perf-kpi-sub">${monthL.length} sanctioned</div></div>
      <div class="perf-kpi pipeline"><div class="perf-kpi-label">Pending</div><div class="perf-kpi-value">₹${fmtAmt(pAmt)}L</div><div class="perf-kpi-sub">${pendingL.length} in pipeline</div></div>
    </div>
    ${cht}
    <div class="perf-chart-grid">
      <div class="report-card ${isMob && perfChart !== 'cats' ? 'mob-hide' : ''}">
        <div class="report-head"><span class="report-head-title">📊 Category Breakdown</span></div>
        <div class="chart-container"><canvas id="catChart"></canvas></div>
      </div>
      <div class="report-card ${isMob && perfChart !== 'officers' ? 'mob-hide' : ''}">
        <div class="report-head"><span class="report-head-title">🏆 Officers</span></div>
        <div class="chart-container"><canvas id="offChart"></canvas></div>
      </div>
    </div>
    <div class="perf-lb">
      <div class="perf-lb-header">
        <div class="perf-lb-title">🥇 Top Performers</div>
        <div class="mini-toggle">
          <button class="mini-toggle-btn ${perfLbPeriod === 'month' ? 'active' : ''}" onclick="setPerfLbPeriod('month')">Month</button>
          <button class="mini-toggle-btn ${perfLbPeriod === 'today' ? 'active' : ''}" onclick="setPerfLbPeriod('today')">Today</button>
        </div>
      </div>
      ${lbHtml || '<div style="text-align:center;padding:12px;font-size:13px;color:#7B7A9A;">No data yet</div>'}
    </div>
    <div class="perf-seg">
      <button class="perf-seg-btn ${perfSeg === 'today' ? 'active' : ''}" onclick="setPerfSeg('today')">Today</button>
      <button class="perf-seg-btn ${perfSeg === 'month' ? 'active' : ''}" onclick="setPerfSeg('month')">This Month</button>
      <button class="perf-seg-btn ${perfSeg === 'pending' ? 'active' : ''}" onclick="setPerfSeg('pending')">Pending</button>
    </div>
    <div class="report-card">
      <div class="report-head"><span class="report-head-title">${seg.title}</span><span class="report-head-amt">₹${fmtAmt(seg.amt)} L</span></div>
      ${mkSummary(seg.loans)}
    </div>
    ${S.isAdmin ? '<div style="text-align:center;margin-top:16px;"><button class="btn btn-cancel-full" onclick="handleSettings()" style="padding:12px 28px;font-size:14px;max-width:200px;">⚙️ Admin Settings</button></div>' : ''}`;

  currentCharts.forEach(ch => ch.destroy());
  currentCharts = [];
  let catAmts = [0, 0, 0], catCnts = [0, 0, 0], offAmts = {};
  S.officers.forEach(o => offAmts[o] = 0);
  monthL.forEach(l => {
    const a = parseFloat(l.amount) || 0, ci = cats.indexOf(l.category);
    if (ci !== -1) { catAmts[ci] += a; catCnts[ci]++; }
    if (offAmts[l.allocatedTo] !== undefined) offAmts[l.allocatedTo] += a;
  });

  try {
    await ensureChartJs();
  } catch (err) {
    console.warn('[Performance] Chart.js failed to load:', err);
  }

  if (window.Chart) {
    const ce = document.getElementById('catChart');
    if (ce) currentCharts.push(new Chart(ce.getContext('2d'), { type: 'bar', data: { labels: cats.map((c, i) => c + ' (' + catCnts[i] + ')'), datasets: [{ data: catAmts, backgroundColor: catColors, borderRadius: 5, barThickness: 24 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: { beginAtZero: true, ticks: { font: { size: 10 }, callback: v => '₹' + v + 'L' } }, y: { ticks: { font: { size: 11, weight: 'bold' } } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ₹' + fmtAmt(ctx.raw) + ' Lakhs' } } } } }));
    const oe = document.getElementById('offChart');
    if (oe) currentCharts.push(new Chart(oe.getContext('2d'), { type: 'bar', data: { labels: Object.keys(offAmts), datasets: [{ label: '₹ Lakhs', data: Object.values(offAmts), backgroundColor: 'rgba(107,95,191,0.7)', borderRadius: 5 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } }, plugins: { legend: { display: false } } } }));
  }
}

window.setPerfSeg = function (v) { perfSeg = v; const o = document.getElementById('perfOverlayContent'); if (o && document.getElementById('perfOverlay').style.display !== 'none') renderDaily(o); };
window.setPerfChart = function (v) { perfChart = v; const o = document.getElementById('perfOverlayContent'); if (o && document.getElementById('perfOverlay').style.display !== 'none') renderDaily(o); };
window.setPerfLbPeriod = function (v) { perfLbPeriod = v; const o = document.getElementById('perfOverlayContent'); if (o && document.getElementById('perfOverlay').style.display !== 'none') renderDaily(o); };
