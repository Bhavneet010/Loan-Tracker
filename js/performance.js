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

function buildTrendDatasets(metrics, buckets) {
  const freshMonth = metrics.sanctionedThisMonth;
  const renewalMonth = metrics.renewalDoneThisMonth;

  if (perfTrendMode === "all") {
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

  const source = perfTrendMode === "fresh-officers" ? freshMonth : renewalMonth;
  const dateKey = perfTrendMode === "fresh-officers" ? "sanctionDate" : "renewedDate";
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

function buildLeaderboard(loans, kind) {
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
  const rankClasses = ["gold", "silver", "bronze"];

  return ranked.map((row, index) => {
    const pct = max > 0 ? Math.round(row.total / max * 100) : 0;
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
        <div class="perf-lb-bar-wrap"><div class="perf-lb-bar" style="width:${pct}%"></div></div>
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
