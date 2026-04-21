import { S } from "./state.js";
import { getLoanMetrics, sumAmount } from "./derived.js";
import { catCls, esc, fmtAmt, fmtDate, shortCat } from "./utils.js";

let currentCharts = [];
let perfSeg = "month";
let perfTrendMode = "all";
let perfTrendScale = "weekly";
let perfLbPeriod = "month";
let perfLbKind = "fresh";
let chartLoadPromise = null;

const CATS = ["Agriculture", "SME", "Education"];
const TREND_COLORS = {
  fresh: "#6B5FBF",
  renewal: "#10B981",
  officerA: "#6B5FBF",
  officerB: "#F59E0B",
  officerC: "#EC4899",
  officerD: "#0EA5E9",
};

function ensureChartJs() {
  if (window.Chart) return Promise.resolve();
  if (chartLoadPromise) return chartLoadPromise;
  chartLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/chart.js";
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return chartLoadPromise;
}

const amountOf = loan => parseFloat(loan.amount) || 0;

function monthDays(month) {
  const [year, mon] = month.split("-").map(Number);
  const count = new Date(year, mon, 0).getDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

function trendBuckets(month, scale) {
  const days = monthDays(month);
  if (scale === "daily") {
    return {
      label: `${days.length} days`,
      labels: days.map(date => date.slice(8)),
      indexByDate: new Map(days.map((date, index) => [date, index])),
    };
  }

  const ranges = [];
  for (let start = 1; start <= days.length; start += 7) {
    const end = Math.min(start + 6, days.length);
    ranges.push({ start, end, label: start === end ? `${start}` : `${start}-${end}` });
  }
  const indexByDate = new Map();
  days.forEach(date => {
    const day = Number(date.slice(8));
    indexByDate.set(date, Math.floor((day - 1) / 7));
  });
  return {
    label: "weekly",
    labels: ranges.map((range, index) => `W${index + 1} ${range.label}`),
    indexByDate,
  };
}

function groupAmountByBucket(loans, dateKey, buckets) {
  const totals = buckets.labels.map(() => 0);
  loans.forEach(loan => {
    const date = loan[dateKey] || "";
    const index = buckets.indexByDate.get(date);
    if (index !== undefined) totals[index] += amountOf(loan);
  });
  return totals;
}

function buildOfficerTotals(loans) {
  const byOfficer = new Map();
  S.officers.forEach(officer => byOfficer.set(officer, { name: officer, total: 0 }));
  loans.forEach(loan => {
    const name = loan.allocatedTo || "Unassigned";
    if (!byOfficer.has(name)) byOfficer.set(name, { name, total: 0 });
    byOfficer.get(name).total += amountOf(loan);
  });
  return Array.from(byOfficer.values())
    .filter(row => row.total > 0)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

function buildTrendDatasets(metrics, buckets, mode = perfTrendMode) {
  const freshMonth = metrics.sanctionedThisMonth;
  const renewalMonth = metrics.renewalDoneThisMonth;

  if (mode === "all") {
    return {
      labels: buckets.labels,
      datasets: [
        {
          label: "Fresh sanctions",
          data: groupAmountByBucket(freshMonth, "sanctionDate", buckets),
          borderColor: TREND_COLORS.fresh,
          backgroundColor: TREND_COLORS.fresh,
          labelMode: "anchors",
          tension: 0.32,
        },
        {
          label: "Renewals done",
          data: groupAmountByBucket(renewalMonth, "renewedDate", buckets),
          borderColor: TREND_COLORS.renewal,
          backgroundColor: TREND_COLORS.renewal,
          labelMode: "anchors",
          tension: 0.32,
        },
      ],
    };
  }

  const source = mode === "fresh-officers" ? freshMonth : renewalMonth;
  const dateKey = mode === "fresh-officers" ? "sanctionDate" : "renewedDate";
  const palette = [TREND_COLORS.officerA, TREND_COLORS.officerB, TREND_COLORS.officerC, TREND_COLORS.officerD];

  return {
    labels: buckets.labels,
    datasets: buildOfficerTotals(source).slice(0, 3).map((row, index) => ({
      label: row.name,
      data: groupAmountByBucket(source.filter(loan => (loan.allocatedTo || "Unassigned") === row.name), dateKey, buckets),
      borderColor: palette[index % palette.length],
      backgroundColor: palette[index % palette.length],
      labelMode: "end",
      tension: 0.32,
    })),
  };
}

const visibleValueLabelsPlugin = {
  id: "visibleValueLabels",
  afterDatasetsDraw(chart) {
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.font = "700 10px Inter, system-ui, sans-serif";
    ctx.textBaseline = "middle";

    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      const points = meta.data || [];
      const nonZero = dataset.data
        .map((value, index) => ({ value: Number(value) || 0, index }))
        .filter(item => item.value > 0);
      if (!nonZero.length) return;
      const last = nonZero[nonZero.length - 1];
      const first = nonZero[0];
      const high = nonZero.reduce((best, item) => item.value > best.value ? item : best, nonZero[0]);
      const labelIndexes = new Set(
        dataset.labelMode === "end"
          ? [last.index]
          : [first.index, high.index, last.index]
      );

      nonZero.forEach(item => {
        const point = points[item.index];
        if (!point) return;
        if (!labelIndexes.has(item.index)) return;
        const x = Math.min(Math.max(point.x, chartArea.left + 16), chartArea.right - 18);
        const y = Math.max(point.y - 12, chartArea.top + 10);
        const text = item === last ? `${dataset.label} Rs ${fmtAmt(item.value)}L` : `Rs ${fmtAmt(item.value)}L`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.fillStyle = dataset.borderColor;
        ctx.textAlign = item === last ? "right" : "center";
        ctx.strokeText(text, item === last ? Math.min(x + 28, chartArea.right - 2) : x, y);
        ctx.fillText(text, item === last ? Math.min(x + 28, chartArea.right - 2) : x, y);
      });
    });

    ctx.restore();
  },
};

function buildLeaderboardRows(loans, kind) {
  const byOfficer = new Map();
  S.officers.forEach(officer => byOfficer.set(officer, {
    name: officer,
    total: 0,
    count: 0,
    cats: Object.fromEntries(CATS.map(cat => [cat, { count: 0, amount: 0 }])),
    due: 0,
    od: 0,
  }));

  const ensure = name => {
    const key = name || "Unassigned";
    if (!byOfficer.has(key)) byOfficer.set(key, {
      name: key,
      total: 0,
      count: 0,
      cats: Object.fromEntries(CATS.map(cat => [cat, { count: 0, amount: 0 }])),
      due: 0,
      od: 0,
    });
    return byOfficer.get(key);
  };

  loans.forEach(loan => {
    const row = ensure(loan.allocatedTo);
    const amount = amountOf(loan);
    row.total += amount;
    row.count++;
    if (row.cats[loan.category]) {
      row.cats[loan.category].count++;
      row.cats[loan.category].amount += amount;
    }
    if (kind === "renewal" && loan._rs) {
      if (loan._rs.status === "due-soon" && !loan.renewedDate) row.due++;
      if ((loan._rs.status === "pending-renewal" || loan._rs.status === "npa") && !loan.renewedDate) row.od++;
    }
  });

  const ranked = Array.from(byOfficer.values())
    .sort((a, b) => b.total - a.total || b.count - a.count || a.name.localeCompare(b.name));
  const max = ranked.length ? ranked[0].total : 1;
  return ranked.map((row, index) => ({ ...row, rank: index + 1, pct: max > 0 ? Math.round(row.total / max * 100) : 0 }));
}

function buildLeaderboard(loans, kind) {
  const ranked = buildLeaderboardRows(loans, kind);
  const rankClasses = ["gold", "silver", "bronze"];

  return ranked.map((row, index) => {
    const chips = kind === "renewal"
      ? `<span class="perf-lb-cat sme">Done ${row.count} | Rs ${fmtAmt(row.total)}L</span>${row.due ? `<span class="perf-lb-cat due">Due ${row.due}</span>` : ""}${row.od ? `<span class="perf-lb-cat od">OD ${row.od}</span>` : ""}`
      : CATS.map(cat => {
        const data = row.cats[cat];
        if (!data.count) return "";
        return `<span class="perf-lb-cat ${catCls(cat)}">${shortCat(cat)} ${data.count} | Rs ${fmtAmt(data.amount)}L</span>`;
      }).join("");

    return `<div class="perf-lb-item">
      <div class="perf-lb-rank ${rankClasses[index] || ""}">${index + 1}</div>
      <div class="perf-lb-info">
        <div class="perf-lb-name">${esc(row.name)}</div>
        <div class="perf-lb-cats">${chips || '<span class="perf-lb-cat">No activity</span>'}</div>
        <div class="perf-lb-bar-wrap"><div class="perf-lb-bar" style="width:${row.pct}%"></div></div>
      </div>
      <div class="perf-lb-amt">Rs ${fmtAmt(row.total)}L<small>${row.count} ${kind === "renewal" ? "done" : "loans"}</small></div>
    </div>`;
  }).join("");
}

function mkSummary(loans, title) {
  if (!loans.length) return '<div style="padding:16px;text-align:center;font-size:13px;color:#7B7A9A;">No entries</div>';
  const grouped = {};
  loans.forEach(loan => {
    const officer = loan.allocatedTo || "?";
    const cat = loan.category || "Other";
    if (!grouped[officer]) grouped[officer] = {};
    if (!grouped[officer][cat]) grouped[officer][cat] = { n: 0, a: 0 };
    grouped[officer][cat].n++;
    grouped[officer][cat].a += amountOf(loan);
  });

  const grand = { n: 0, a: 0 };
  const rows = S.officers.map(officer => {
    const officerGroup = grouped[officer] || {};
    const total = { n: 0, a: 0 };
    const chips = CATS.map(cat => {
      const value = officerGroup[cat] || { n: 0, a: 0 };
      total.n += value.n;
      total.a += value.a;
      if (!value.n) return "";
      return `<span class="os-cat ${catCls(cat)}"><span class="os-cnt">${value.n}</span> ${shortCat(cat)} Rs ${fmtAmt(value.a)}L</span>`;
    }).join("");
    grand.n += total.n;
    grand.a += total.a;
    if (!total.n) return `<div class="os-row"><span class="os-name">${esc(officer)}</span><span class="os-cats" style="color:#7B7A9A;font-size:12px;">-</span><span class="os-total">Rs 0L</span></div>`;
    return `<div class="os-row"><span class="os-name">${esc(officer)}</span><span class="os-cats">${chips}</span><span class="os-total">Rs ${fmtAmt(total.a)}L</span></div>`;
  }).join("");

  return `<div class="officer-summary">${rows}<div class="os-grand"><span>${esc(title)}: ${grand.n} loans</span><span>Rs ${fmtAmt(grand.a)} L</span></div></div>`;
}

function emptyMessage() {
  return '<div style="text-align:center;padding:12px;font-size:13px;color:#7B7A9A;">No data yet</div>';
}

function summaryRows(loans) {
  const rows = S.officers.map(officer => ({
    officer,
    total: 0,
    count: 0,
    cats: Object.fromEntries(CATS.map(cat => [cat, { count: 0, amount: 0 }])),
  }));
  const byOfficer = new Map(rows.map(row => [row.officer, row]));
  const ensure = officer => {
    const key = officer || "Unassigned";
    if (!byOfficer.has(key)) {
      const row = { officer: key, total: 0, count: 0, cats: Object.fromEntries(CATS.map(cat => [cat, { count: 0, amount: 0 }])) };
      byOfficer.set(key, row);
      rows.push(row);
    }
    return byOfficer.get(key);
  };

  loans.forEach(loan => {
    const row = ensure(loan.allocatedTo);
    const amount = amountOf(loan);
    row.total += amount;
    row.count++;
    if (row.cats[loan.category]) {
      row.cats[loan.category].count++;
      row.cats[loan.category].amount += amount;
    }
  });

  return rows;
}

function reportCell(value, cls = "") {
  return `<td${cls ? ` class="${cls}"` : ""}>${esc(value)}</td>`;
}

function metricBox(label, value, sub, cls = "") {
  return `<div class="snap-metric ${cls}"><span>${esc(label)}</span><b>${esc(value)}</b><small>${esc(sub)}</small></div>`;
}

function trendTable(metrics, scale, mode) {
  const buckets = trendBuckets(metrics.thisMonth, scale);
  const trend = buildTrendDatasets(metrics, buckets, mode);
  const modeTitle = {
    all: "All Sanctions",
    "fresh-officers": "Fresh Officers",
    "renewal-officers": "Renewal Officers",
  }[mode];
  const head = `<tr><th>Series</th>${trend.labels.map(label => `<th>${esc(label)}</th>`).join("")}<th>Total</th></tr>`;
  const rows = trend.datasets.map(dataset => {
    const total = dataset.data.reduce((sum, value) => sum + (Number(value) || 0), 0);
    return `<tr><th>${esc(dataset.label)}</th>${dataset.data.map(value => reportCell(`Rs ${fmtAmt(value)}L`, "num")).join("")}${reportCell(`Rs ${fmtAmt(total)}L`, "num strong")}</tr>`;
  }).join("");
  return `<section class="snap-section"><h2>${esc(modeTitle)} - ${scale === "weekly" ? "Weekly" : "Daily"} Trend</h2><table>${head}${rows || '<tr><td colspan="2">No trend data</td></tr>'}</table></section>`;
}

function performerTable(title, rows, kind) {
  const body = rows.map(row => {
    const detail = kind === "renewal"
      ? `Done ${row.count}; Due ${row.due}; OD ${row.od}`
      : CATS.map(cat => {
        const item = row.cats[cat];
        return `${shortCat(cat)} ${item.count} / Rs ${fmtAmt(item.amount)}L`;
      }).join("; ");
    return `<tr>
      ${reportCell(row.rank)}
      ${reportCell(row.name)}
      ${reportCell(detail)}
      ${reportCell(`Rs ${fmtAmt(row.total)}L`, "num strong")}
    </tr>`;
  }).join("");
  return `<section class="snap-section"><h2>${esc(title)}</h2><table><tr><th>Rank</th><th>Officer</th><th>Details</th><th>Total</th></tr>${body || '<tr><td colspan="4">No data</td></tr>'}</table></section>`;
}

function summaryTable(title, loans) {
  const rows = summaryRows(loans);
  const body = rows.map(row => `<tr>
    ${reportCell(row.officer)}
    ${reportCell(row.count, "num")}
    ${CATS.map(cat => {
      const item = row.cats[cat];
      return reportCell(`${item.count} / Rs ${fmtAmt(item.amount)}L`, "num");
    }).join("")}
    ${reportCell(`Rs ${fmtAmt(row.total)}L`, "num strong")}
  </tr>`).join("");
  return `<section class="snap-section"><h2>${esc(title)}</h2><table><tr><th>Officer</th><th>Count</th><th>Agri</th><th>SME</th><th>Edu</th><th>Total</th></tr>${body}</table></section>`;
}

function buildSnapshotHtml() {
  const metrics = getLoanMetrics();
  const renewalToday = metrics.renewalDoneThisMonth.filter(loan => loan.renewedDate === metrics.day);
  const freshTodayAmt = sumAmount(metrics.sanctionedToday);
  const freshMonthAmt = sumAmount(metrics.sanctionedThisMonth);
  const pendingAmt = sumAmount(metrics.pending);
  const renewalTodayAmt = sumAmount(renewalToday);
  const renewalMonthAmt = sumAmount(metrics.renewalDoneThisMonth);
  const renewalOverdueAmt = sumAmount(metrics.renewalOverdue);
  const generatedAt = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

  const freshMonthRows = buildLeaderboardRows(metrics.sanctionedThisMonth, "fresh");
  const freshTodayRows = buildLeaderboardRows(metrics.sanctionedToday, "fresh");
  const renewalMonthRows = buildLeaderboardRows(metrics.renewalDoneThisMonth, "renewal");
  const renewalTodayRows = buildLeaderboardRows(renewalToday, "renewal");

  const css = `
    *{box-sizing:border-box} body{margin:0;background:#F5F3FC;color:#25213D;font-family:Inter,Arial,sans-serif}
    .snap{max-width:1100px;margin:0 auto;padding:28px} .snap-head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:18px}
    h1{font-size:28px;margin:0 0 6px} h2{font-size:16px;margin:0 0 10px}.muted{color:#756F91;font-size:12px;font-weight:700}
    .print-btn{border:0;border-radius:10px;background:#6B5FBF;color:white;padding:10px 14px;font-weight:800;cursor:pointer}
    .snap-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}.snap-card,.snap-section{background:white;border:1px solid #E7E0F8;border-radius:10px;padding:14px;margin-bottom:14px;box-shadow:0 2px 8px rgba(62,47,125,.05)}
    .snap-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.snap-metric{border-radius:9px;background:#F8F6FF;border-top:4px solid #6B5FBF;padding:10px}.snap-metric.green{border-color:#10B981}.snap-metric.amber{border-color:#F59E0B}.snap-metric.red{border-color:#EF4444}
    .snap-metric span{display:block;color:#756F91;font-size:10px;font-weight:900;text-transform:uppercase}.snap-metric b{display:block;font-size:20px;margin-top:4px}.snap-metric small{display:block;color:#756F91;font-size:11px;margin-top:4px}
    table{width:100%;border-collapse:collapse;font-size:11px} th,td{border-bottom:1px solid #ECE7FA;padding:7px;text-align:left;vertical-align:top} th{background:#F8F6FF;color:#51498A;font-size:10px;text-transform:uppercase}.num{text-align:right;white-space:nowrap}.strong{font-weight:900;color:#25213D}
    .two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.page-break{break-before:page}
    @media(max-width:760px){.snap{padding:16px}.snap-grid,.two{grid-template-columns:1fr}.snap-head{display:block}.print-btn{margin-top:10px}.snap-metrics{grid-template-columns:1fr}}
    @media print{body{background:white}.snap{max-width:none;padding:0}.print-btn{display:none}.snap-card,.snap-section{box-shadow:none;break-inside:avoid} th{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  `;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Performance Snapshot</title><style>${css}</style></head>
  <body><main class="snap">
    <header class="snap-head"><div><h1>Performance Snapshot</h1><div class="muted">Generated ${esc(generatedAt)} | User ${esc(S.user || "Admin")} | Month ${esc(metrics.thisMonth)}</div></div><button class="print-btn" onclick="window.print()">Save as PDF / Print</button></header>
    <div class="snap-grid">
      <section class="snap-card"><h2>Fresh Loans</h2><div class="snap-metrics">
        ${metricBox("Today", `Rs ${fmtAmt(freshTodayAmt)}L`, `${metrics.sanctionedToday.length} loans`)}
        ${metricBox("This Month", `Rs ${fmtAmt(freshMonthAmt)}L`, `${metrics.sanctionedThisMonth.length} sanctioned`, "green")}
        ${metricBox("Pending", `Rs ${fmtAmt(pendingAmt)}L`, `${metrics.pending.length} in pipeline`, "amber")}
      </div></section>
      <section class="snap-card"><h2>Renewals</h2><div class="snap-metrics">
        ${metricBox("Today Done", `Rs ${fmtAmt(renewalTodayAmt)}L`, `${renewalToday.length} renewals`)}
        ${metricBox("This Month", `Rs ${fmtAmt(renewalMonthAmt)}L`, `${metrics.renewalDoneThisMonth.length} done`, "green")}
        ${metricBox("Overdue", `Rs ${fmtAmt(renewalOverdueAmt)}L`, `${metrics.renewalOverdue.length} accounts`, "red")}
      </div></section>
    </div>
    ${["weekly", "daily"].map(scale => ["all", "fresh-officers", "renewal-officers"].map(mode => trendTable(metrics, scale, mode)).join("")).join("")}
    <div class="two page-break">
      ${performerTable("Fresh Top Performers - This Month", freshMonthRows, "fresh")}
      ${performerTable("Fresh Top Performers - Today", freshTodayRows, "fresh")}
      ${performerTable("Renewal Top Performers - This Month", renewalMonthRows, "renewal")}
      ${performerTable("Renewal Top Performers - Today", renewalTodayRows, "renewal")}
    </div>
    ${summaryTable("Fresh Summary - Today", metrics.sanctionedToday)}
    ${summaryTable("Fresh Summary - This Month", metrics.sanctionedThisMonth)}
    ${summaryTable("Fresh Summary - Pending", metrics.pending)}
  </main><script>setTimeout(()=>window.print(),400)</script></body></html>`;
}

export async function renderDaily(c) {
  const metrics = getLoanMetrics();
  const todayL = metrics.sanctionedToday;
  const monthL = metrics.sanctionedThisMonth;
  const pendingL = metrics.pending;
  const renewalToday = metrics.renewalDoneThisMonth.filter(loan => loan.renewedDate === metrics.day);
  const renewalMonth = metrics.renewalDoneThisMonth;
  const buckets = trendBuckets(metrics.thisMonth, perfTrendScale);

  const tAmt = sumAmount(todayL);
  const mAmt = sumAmount(monthL);
  const pAmt = sumAmount(pendingL);
  const rTodayAmt = sumAmount(renewalToday);
  const rMonthAmt = sumAmount(renewalMonth);
  const rOverdueAmt = sumAmount(metrics.renewalOverdue);

  const lbLoans = perfLbKind === "renewal"
    ? (perfLbPeriod === "today" ? renewalToday : renewalMonth)
    : (perfLbPeriod === "today" ? todayL : monthL);
  const lbHtml = buildLeaderboard(lbLoans, perfLbKind);

  const segData = {
    today: { title: `Today - ${fmtDate(metrics.day)}`, amt: tAmt, loans: todayL, label: "Today" },
    month: { title: "This Month", amt: mAmt, loans: monthL, label: "This Month" },
    pending: { title: "Pending", amt: pAmt, loans: pendingL, label: "Pending" },
  };
  const seg = segData[perfSeg];

  c.innerHTML = `
    <div class="perf-section-title"><span>Fresh Loans</span><small>current performance strip</small></div>
    <div class="perf-kpi-row">
      <div class="perf-kpi today"><div class="perf-kpi-label">Today</div><div class="perf-kpi-value">Rs ${fmtAmt(tAmt)}L</div><div class="perf-kpi-sub">${todayL.length} loan${todayL.length !== 1 ? "s" : ""}</div></div>
      <div class="perf-kpi month"><div class="perf-kpi-label">This Month</div><div class="perf-kpi-value">Rs ${fmtAmt(mAmt)}L</div><div class="perf-kpi-sub">${monthL.length} sanctioned</div></div>
      <div class="perf-kpi pipeline"><div class="perf-kpi-label">Pending</div><div class="perf-kpi-value">Rs ${fmtAmt(pAmt)}L</div><div class="perf-kpi-sub">${pendingL.length} in pipeline</div></div>
    </div>

    <div class="perf-section-title"><span>Renewals</span><small>new renewal strip</small></div>
    <div class="perf-kpi-row">
      <div class="perf-kpi today"><div class="perf-kpi-label">Today Done</div><div class="perf-kpi-value">Rs ${fmtAmt(rTodayAmt)}L</div><div class="perf-kpi-sub">${renewalToday.length} renewal${renewalToday.length !== 1 ? "s" : ""}</div></div>
      <div class="perf-kpi month"><div class="perf-kpi-label">This Month</div><div class="perf-kpi-value">Rs ${fmtAmt(rMonthAmt)}L</div><div class="perf-kpi-sub">${renewalMonth.length} done</div></div>
      <div class="perf-kpi overdue"><div class="perf-kpi-label">Overdue</div><div class="perf-kpi-value">Rs ${fmtAmt(rOverdueAmt)}L</div><div class="perf-kpi-sub">${metrics.renewalOverdue.length} accounts</div></div>
    </div>

    <div class="report-card">
      <div class="report-head"><span class="report-head-title">Daily Trend</span><span class="report-head-amt">${buckets.label}</span></div>
      <div class="perf-trend-summary">
        <div><span>Fresh</span><b>Rs ${fmtAmt(mAmt)}L</b></div>
        <div><span>Renewals</span><b>Rs ${fmtAmt(rMonthAmt)}L</b></div>
        <div><span>Combined</span><b>Rs ${fmtAmt(mAmt + rMonthAmt)}L</b></div>
      </div>
      <div class="perf-scale-toggle">
        <button class="mini-toggle-btn ${perfTrendScale === "weekly" ? "active" : ""}" onclick="setPerfTrendScale('weekly')">Weekly</button>
        <button class="mini-toggle-btn ${perfTrendScale === "daily" ? "active" : ""}" onclick="setPerfTrendScale('daily')">Daily</button>
      </div>
      <div class="perf-chart-mode">
        <button class="mini-toggle-btn ${perfTrendMode === "all" ? "active" : ""}" onclick="setPerfTrendMode('all')">All Sanctions</button>
        <button class="mini-toggle-btn ${perfTrendMode === "fresh-officers" ? "active" : ""}" onclick="setPerfTrendMode('fresh-officers')">Fresh Officers</button>
        <button class="mini-toggle-btn ${perfTrendMode === "renewal-officers" ? "active" : ""}" onclick="setPerfTrendMode('renewal-officers')">Renewal Officers</button>
      </div>
      <div class="chart-container trend"><canvas id="dailyTrendChart"></canvas></div>
    </div>

    <div class="perf-lb">
      <div class="perf-lb-header">
        <div class="perf-lb-title">Top Performers</div>
        <div class="mini-toggle">
          <button class="mini-toggle-btn ${perfLbKind === "fresh" ? "active" : ""}" onclick="setPerfLbKind('fresh')">Fresh</button>
          <button class="mini-toggle-btn ${perfLbKind === "renewal" ? "active" : ""}" onclick="setPerfLbKind('renewal')">Renewals</button>
        </div>
      </div>
      <div style="text-align:right;margin:-4px 0 8px;">
        <div class="mini-toggle">
          <button class="mini-toggle-btn ${perfLbPeriod === "month" ? "active" : ""}" onclick="setPerfLbPeriod('month')">Month</button>
          <button class="mini-toggle-btn ${perfLbPeriod === "today" ? "active" : ""}" onclick="setPerfLbPeriod('today')">Today</button>
        </div>
      </div>
      ${lbHtml || emptyMessage()}
    </div>

    <div class="perf-seg">
      <button class="perf-seg-btn ${perfSeg === "today" ? "active" : ""}" onclick="setPerfSeg('today')">Today</button>
      <button class="perf-seg-btn ${perfSeg === "month" ? "active" : ""}" onclick="setPerfSeg('month')">This Month</button>
      <button class="perf-seg-btn ${perfSeg === "pending" ? "active" : ""}" onclick="setPerfSeg('pending')">Pending</button>
    </div>
    <div class="report-card">
      <div class="report-head"><span class="report-head-title">${seg.title}</span><span class="report-head-amt">Rs ${fmtAmt(seg.amt)} L</span></div>
      ${mkSummary(seg.loans, seg.label)}
    </div>
    ${S.isAdmin ? '<div style="text-align:center;margin-top:16px;"><button class="btn btn-cancel-full" onclick="handleSettings()" style="padding:12px 28px;font-size:14px;max-width:200px;">Admin Settings</button></div>' : ""}`;

  currentCharts.forEach(chart => chart.destroy());
  currentCharts = [];

  try {
    await ensureChartJs();
  } catch (err) {
    console.warn("[Performance] Chart.js failed to load:", err);
  }

  if (window.Chart) {
    const canvas = document.getElementById("dailyTrendChart");
    const trend = buildTrendDatasets(metrics, buckets);
    if (canvas) {
      currentCharts.push(new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
          labels: trend.labels,
          datasets: trend.datasets.map(dataset => ({
            ...dataset,
            borderWidth: 3,
            pointRadius: 3,
            pointHoverRadius: 5,
            fill: false,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 24, right: 24, bottom: 0, left: 0 } },
          scales: {
            y: {
              beginAtZero: true,
              ticks: { font: { size: 10 }, callback: value => `Rs ${value}L` },
              grid: { color: "rgba(107,95,191,0.08)" },
            },
            x: {
              ticks: { font: { size: 10 }, maxTicksLimit: 7 },
              grid: { display: false },
            },
          },
          plugins: {
            legend: {
              display: true,
              labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, font: { size: 10, weight: "bold" } },
            },
            tooltip: {
              callbacks: {
                label: ctx => `${ctx.dataset.label}: Rs ${fmtAmt(ctx.raw)} Lakhs`,
              },
            },
          },
        },
        plugins: [visibleValueLabelsPlugin],
      }));
    }
  }
}

window.setPerfSeg = function (value) {
  perfSeg = value;
  const target = document.getElementById("perfOverlayContent");
  if (target && document.getElementById("perfOverlay").style.display !== "none") renderDaily(target);
};

window.setPerfTrendMode = function (value) {
  perfTrendMode = value;
  const target = document.getElementById("perfOverlayContent");
  if (target && document.getElementById("perfOverlay").style.display !== "none") renderDaily(target);
};

window.setPerfTrendScale = function (value) {
  perfTrendScale = value;
  const target = document.getElementById("perfOverlayContent");
  if (target && document.getElementById("perfOverlay").style.display !== "none") renderDaily(target);
};

window.setPerfLbPeriod = function (value) {
  perfLbPeriod = value;
  const target = document.getElementById("perfOverlayContent");
  if (target && document.getElementById("perfOverlay").style.display !== "none") renderDaily(target);
};

window.setPerfLbKind = function (value) {
  perfLbKind = value;
  const target = document.getElementById("perfOverlayContent");
  if (target && document.getElementById("perfOverlay").style.display !== "none") renderDaily(target);
};

window.exportPerformanceSnapshot = function () {
  const html = buildSnapshotHtml();
  const report = window.open("", "_blank");
  if (report) {
    report.document.open();
    report.document.write(html);
    report.document.close();
    return;
  }

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `performance-snapshot-${todayFileName()}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

function todayFileName() {
  return new Date().toISOString().slice(0, 10);
}
