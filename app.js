/* Meal Coach dashboard. Replace data.json and reload. No build step. */

"use strict";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

const METRICS = [
  { key: "kcal", quotaKey: "kcal", label: "熱量", unit: "kcal", kind: "balance" },
  { key: "protein", quotaKey: "protein_g", label: "蛋白", unit: "g", kind: "target" },
  { key: "carbs", quotaKey: "carbs_g", label: "碳水", unit: "g", kind: "balance" },
  { key: "sugar", quotaKey: "sugar_g", label: "糖", unit: "g", kind: "cap" },
  { key: "fiber", quotaKey: "fiber_g", label: "纖維", unit: "g", kind: "target" },
  { key: "sodium", quotaKey: "sodium_mg", label: "鈉", unit: "mg", kind: "cap" },
  { key: "fat", quotaKey: "fat_g", label: "脂肪", unit: "g", kind: "balance" },
];

const NUTRITION_CHART_ORDER = ["kcal", "carbs", "sugar", "fiber", "protein", "sodium", "fat"];
const CHART_COLOR = {
  kcal: "#e0894a",
  carbs: "#d4a24a",
  sugar: "#e16b84",
  fiber: "#7dae62",
  protein: "#4caf70",
  sodium: "#5aa4d4",
  fat: "#c4a36a",
  move: "#e15a4a",
  exercise: "#3c9a45",
  stand: "#148a9a",
  steps: "#c4a36a",
  km: "#7eb0d4",
};
const FITNESS_CHARTS = [
  { key: "move", label: "活動", unit: "kcal", goalKey: "move", format: "int" },
  { key: "exercise", label: "運動", unit: "分鐘", goalKey: "exercise", format: "int" },
  { key: "stand", label: "站立", unit: "小時", goalKey: "stand", format: "int" },
  { key: "steps", label: "步數", unit: "步", goalKey: null, format: "int" },
  { key: "km", label: "公里", unit: "公里", goalKey: null, format: "km" },
];

const RING_META = [
  { key: "move", goalKey: "move", label: "活動", unit: "kcal", color: "#e15a4a" },
  { key: "exercise", goalKey: "exercise", label: "運動", unit: "分鐘", color: "#3c9a45" },
  { key: "stand", goalKey: "stand", label: "站立", unit: "小時", color: "#148a9a" },
];

let snapshot = null;
let selectedDate = "";
let pending = [];
let charts = [];
let revealObserver = null;
let scrollTimer = 0;
let scrollLock = false;

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return Math.round(number).toLocaleString("en-US");
}

function fmtKm(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function pctText(value, quota) {
  const cap = Number(quota);
  if (!cap) return "—";
  const raw = (Number(value) / cap) * 100;
  if (!Number.isFinite(raw)) return "—";
  const rounded = Math.round(raw);
  if ((raw > 100 && rounded === 100) || (raw < 100 && rounded === 100)) {
    return raw.toFixed(1) + "%";
  }
  return rounded + "%";
}

function fillPct(value, quota) {
  const cap = Number(quota);
  if (!cap) return 0;
  const raw = (Number(value) / cap) * 100;
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(100, raw);
}

function metricByKey(key) {
  return METRICS.find((metric) => metric.key === key);
}

function classify(key, value, quota) {
  const metric = metricByKey(key);
  const kind = metric ? metric.kind : "balance";
  const cap = Number(quota);
  const ratio = cap ? Number(value) / cap : 0;
  if (ratio > 1.1) return { tone: "bad", mark: "超", label: "超標", emoji: "🔴" };
  if (ratio >= 0.85) return { tone: "warn", mark: "近", label: "接近", emoji: "🟡" };
  if (kind === "cap") return { tone: "good", mark: "好", label: "未到上限", emoji: "🟢" };
  return { tone: "soft", mark: "低", label: "未夠", emoji: "🟢" };
}

function parts(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!match) return { y: 0, m: 0, d: 0, wd: 0 };
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, wd };
}

function dateLabel(iso) {
  const p = parts(iso);
  return p.m + "月" + p.d + "日";
}

function shortDate(iso) {
  const p = parts(iso);
  return p.m + "/" + p.d;
}

function weekdayChar(iso) {
  return WEEKDAYS[parts(iso).wd] || "";
}

function formatUpdated(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || "");
  if (!match) return iso || "";
  return Number(match[2]) + "月" + Number(match[3]) + "日 " + match[4] + ":" + match[5];
}

function daysSorted() {
  return [...(snapshot.daily || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function daysNewest() {
  return [...daysSorted()].reverse();
}

function fitnessSorted() {
  return [...(snapshot.fitness || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function latestDate() {
  const days = daysSorted();
  return days.length ? days[days.length - 1].date : "";
}

function currentDay() {
  return daysSorted().find((day) => day.date === selectedDate) || daysSorted()[daysSorted().length - 1];
}

function trendDays() {
  return daysSorted().slice(-11);
}

function visibleMetrics(day) {
  return METRICS.filter((metric) => Object.prototype.hasOwnProperty.call(day, metric.key) && snapshot.quotas[metric.quotaKey] != null);
}

function calloutItems(day) {
  const items = [];
  visibleMetrics(day).forEach((metric) => {
    const quota = snapshot.quotas[metric.quotaKey];
    const value = Number(day[metric.key]);
    const status = classify(metric.key, value, quota);
    const show = status.mark === "低" || status.mark === "超" || (status.mark === "近" && metric.kind === "cap");
    if (!show) return;
    items.push({
      metric: metric,
      status: status,
      value: value,
      quota: quota,
      text: metric.label + " " + status.mark + " " + fmtInt(value) + " / " + fmtInt(quota) + " " + metric.unit,
    });
  });
  return items;
}

function coachNote(day) {
  const bits = [];
  if (day.partial) bits.push("進行中");
  calloutItems(day).forEach((item) => bits.push(item.text));
  return bits.join(" ");
}

function heroSub(day) {
  const left = snapshot.quotas.kcal - day.kcal;
  if (left >= 0) return "目標 " + fmtInt(snapshot.quotas.kcal) + " kcal · 仲餘 " + fmtInt(left);
  return "目標 " + fmtInt(snapshot.quotas.kcal) + " kcal · 超咗 " + fmtInt(-left);
}

function completeDays() {
  return daysSorted().filter((day) => !day.partial);
}

function chipStats() {
  const days = completeDays();
  const quotas = snapshot.quotas;
  return {
    n: days.length,
    protein: days.filter((day) => day.protein >= quotas.protein_g).length,
    sodium: days.filter((day) => day.sodium > quotas.sodium_mg).length,
    sugar: days.filter((day) => day.sugar > quotas.sugar_g).length,
    kcal: days.filter((day) => {
      const ratio = day.kcal / quotas.kcal;
      return ratio >= 0.9 && ratio <= 1.1;
    }).length,
  };
}

function dateGaps() {
  const daily = new Set(daysSorted().map((day) => day.date));
  const fitness = new Set(fitnessSorted().map((day) => day.date));
  return {
    noFit: daysSorted().map((day) => day.date).filter((date) => !fitness.has(date)),
    noMeal: fitnessSorted().map((day) => day.date).filter((date) => !daily.has(date)),
  };
}

function fitnessFor(date) {
  return fitnessSorted().find((row) => row.date === date) || null;
}

function shownFitness() {
  const selected = fitnessFor(selectedDate);
  if (selected) return { row: selected, fallback: false };
  const rows = fitnessSorted();
  if (!rows.length) return { row: null, fallback: false };
  return { row: rows[rows.length - 1], fallback: true };
}

function pointSummary(points, spec) {
  const complete = points.filter((point) => !point.partial && Number.isFinite(point.value));
  if (!complete.length) return spec.partialAware ? "未有完整日。" : "未有紀錄。";
  let high = complete[0];
  let low = complete[0];
  complete.forEach((point) => {
    if (point.value > high.value) high = point;
    if (point.value < low.value) low = point;
  });
  const fmt = spec.formatValue;
  let tail = "";
  if (spec.quota != null && spec.kind === "cap") {
    tail = "超上限 " + complete.filter((point) => point.value > spec.quota).length + " 日。";
  } else if (spec.quota != null && (spec.kind === "target" || spec.kind === "goal")) {
    tail = "達標 " + complete.filter((point) => point.value >= spec.quota).length + " 日。";
  } else if (spec.quota != null && spec.kind === "balance") {
    tail = "貼近目標（±10%）" + complete.filter((point) => {
      const ratio = point.value / spec.quota;
      return ratio >= 0.9 && ratio <= 1.1;
    }).length + " 日。";
  }
  const lead = spec.partialAware ? "完整日" : "紀錄";
  return lead + "最高 " + fmt(high.value) + " " + spec.unit + "（" + dateLabel(high.date) + "），最低 " + fmt(low.value) + " " + spec.unit + "（" + dateLabel(low.date) + "）。" + tail;
}

function trendSummary(days, metric) {
  const points = days
    .filter((day) => Number.isFinite(Number(day[metric.key])))
    .map((day) => ({ date: day.date, value: Number(day[metric.key]), partial: !!day.partial }));
  return pointSummary(points, {
    quota: Number(snapshot.quotas[metric.quotaKey]),
    unit: metric.unit,
    kind: metric.kind,
    formatValue: fmtInt,
    partialAware: true,
  });
}

function nutritionChartMetrics() {
  const present = new Set();
  daysSorted().forEach((day) => {
    Object.keys(day).forEach((key) => {
      if (key === "date" || key === "partial") return;
      if (Number.isFinite(Number(day[key]))) present.add(key);
    });
  });
  const ordered = NUTRITION_CHART_ORDER.filter((key) => present.has(key));
  present.forEach((key) => {
    if (!ordered.includes(key)) ordered.push(key);
  });
  return ordered.map((key) => metricByKey(key) || {
    key: key,
    quotaKey: null,
    label: key,
    unit: "",
    kind: "range",
  });
}

function nutritionSpec(metric) {
  const words = { cap: "上限", target: "目標", balance: "配額" };
  const quota = metric.quotaKey != null ? Number(snapshot.quotas[metric.quotaKey]) : null;
  return {
    key: metric.key,
    label: metric.label,
    unit: metric.unit,
    color: CHART_COLOR[metric.key] || "#f6efe6",
    quota: Number.isFinite(quota) && quota > 0 ? quota : null,
    kind: metric.kind,
    lineWord: words[metric.kind] || "配額",
    formatValue: fmtInt,
    partialAware: true,
  };
}

function nutritionPoints(metric) {
  return trendDays()
    .filter((day) => Object.prototype.hasOwnProperty.call(day, metric.key) && Number.isFinite(Number(day[metric.key])))
    .map((day) => ({ date: day.date, value: Number(day[metric.key]), partial: !!day.partial }));
}

function fitnessChartSpecs() {
  return FITNESS_CHARTS
    .filter((item) => fitnessSorted().some((row) => Object.prototype.hasOwnProperty.call(row, item.key) && Number.isFinite(Number(row[item.key]))))
    .map((item) => {
      const rawGoal = item.goalKey != null ? Number(snapshot.fitnessGoals[item.goalKey]) : null;
      const quota = Number.isFinite(rawGoal) && rawGoal > 0 ? rawGoal : null;
      return {
        key: item.key,
        label: item.label,
        unit: item.unit,
        color: CHART_COLOR[item.key] || "#f6efe6",
        quota: quota,
        kind: quota == null ? "range" : "goal",
        lineWord: "目標",
        formatValue: item.format === "km" ? fmtKm : fmtInt,
        partialAware: false,
      };
    });
}

function fitnessPoints(key) {
  return fitnessSorted()
    .filter((row) => Object.prototype.hasOwnProperty.call(row, key) && Number.isFinite(Number(row[key])))
    .map((row) => ({ date: row.date, value: Number(row[key]), partial: false }));
}

function chartModel(points, spec) {
  return {
    dates: points.map((point) => point.date),
    quota: spec.quota,
  };
}

function badgeHtml(status) {
  return (
    '<span class="badge tone-' + status.tone + '">' +
      '<span aria-hidden="true">' + status.emoji + esc(status.mark) + "</span>" +
      '<span class="visually-hidden">' + esc(status.label) + "</span>" +
    "</span>"
  );
}

function metricRows(day) {
  return visibleMetrics(day).map((metric) => {
    const quota = snapshot.quotas[metric.quotaKey];
    const value = Number(day[metric.key]);
    const status = classify(metric.key, value, quota);
    const width = fillPct(value, quota).toFixed(1);
    const over = value > quota ? " is-over" : "";
    const valueText = fmtInt(value) + " / " + fmtInt(quota) + " " + metric.unit;
    const percent = pctText(value, quota);
    const described = metric.label + " " + valueText + "，" + percent + "，" + status.label;
    return (
      '<div class="metric">' +
        '<div class="metric-top">' +
          '<span class="metric-label">' + esc(metric.label) + "</span>" +
          '<span class="metric-value num">' + esc(valueText) + "</span>" +
        "</div>" +
        '<div class="track" role="meter" aria-valuemin="0" aria-valuemax="' + esc(quota) + '" aria-valuenow="' + esc(value) + '" aria-valuetext="' + esc(described) + '">' +
          '<span class="fill tone-' + status.tone + over + '" style="width:' + width + '%"></span>' +
        "</div>" +
        '<div class="metric-foot">' +
          badgeHtml(status) +
          '<span class="pct num tone-' + status.tone + '">' + esc(percent) + "</span>" +
        "</div>" +
      "</div>"
    );
  }).join("");
}

function fatNote() {
  const hasFat = daysSorted().some((day) => Object.prototype.hasOwnProperty.call(day, "fat"));
  if (hasFat || snapshot.quotas.fat_g == null) return "";
  return '<p class="fine">脂肪配額 ' + fmtInt(snapshot.quotas.fat_g) + " g。每日紀錄未有脂肪，所以唔計。</p>";
}

function chevronIcon(direction) {
  const path = direction === "left" ? "M14.5 5.5 8 12l6.5 6.5" : "M9.5 5.5 16 12l-6.5 6.5";
  return '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="' + path + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
}

function daySlide(day) {
  const on = day.date === selectedDate;
  const kcalStatus = classify("kcal", day.kcal, snapshot.quotas.kcal);
  const banner = day.partial ? '<p class="banner">進行中</p>' : "";
  return (
    '<article class="day-slide' + (on ? " is-current" : "") + '" data-slide="' + esc(day.date) + '" aria-hidden="' + (on ? "false" : "true") + '">' +
      banner +
      '<p class="slide-date">' + esc(dateLabel(day.date)) + " · 星期" + esc(weekdayChar(day.date)) + "</p>" +
      '<p class="hero-line">' +
        '<span class="hero-value num tone-' + kcalStatus.tone + '">' + fmtInt(day.kcal) + "</span>" +
        '<span class="hero-unit">kcal</span>' +
        badgeHtml(kcalStatus) +
      "</p>" +
      '<p class="hero-sub num">' + esc(heroSub(day)) + "</p>" +
      metricRows(day) +
    "</article>"
  );
}

function todaySection() {
  const day = currentDay();
  const latest = !day || day.date === latestDate();
  const heading = latest ? "今日" : dateLabel(day.date);
  const sub = latest
    ? dateLabel(day.date) + "（" + weekdayChar(day.date) + "）"
    : "星期" + weekdayChar(day.date);
  const days = daysNewest();
  const index = days.findIndex((item) => item.date === selectedDate);
  const newerDisabled = index <= 0 ? " disabled" : "";
  const olderDisabled = index === -1 || index >= days.length - 1 ? " disabled" : "";
  return (
    '<section class="card today-card reveal is-in" id="today" aria-labelledby="today-heading">' +
      '<div class="day-head">' +
        "<div>" +
          '<h2 id="today-heading">' + esc(heading) + "</h2>" +
          '<p id="today-date" class="date-line">' + esc(sub) + "</p>" +
        "</div>" +
        '<div class="day-nav">' +
          '<button type="button" class="chevron" data-day-step="-1" aria-label="較新一日"' + newerDisabled + ">" + chevronIcon("left") + "</button>" +
          '<button type="button" class="chevron" data-day-step="1" aria-label="較舊一日"' + olderDisabled + ">" + chevronIcon("right") + "</button>" +
        "</div>" +
      "</div>" +
      '<div class="day-track" tabindex="0" aria-label="每日營養，左右滑睇其他日子">' +
        days.map(daySlide).join("") +
      "</div>" +
      '<p class="legend-line" aria-hidden="true">🔴超 · 🟡近 · 🟢低 · 🟢好</p>' +
      '<p class="visually-hidden">超係明顯超標。近係大約八成五至一百一。低係未夠。好係上限之下，唔使再加。</p>' +
    "</section>"
  );
}

function chip(value, total, label, tone) {
  return (
    '<div class="chip">' +
      '<b class="num tone-' + tone + '">' + value + '<span class="of"> / ' + total + "</span></b>" +
      '<span class="chip-label">' + esc(label) + "</span>" +
    "</div>"
  );
}

function chartFigure(points, spec) {
  const id = "chart-" + spec.key;
  pending.push({ id: id, points: points, spec: spec });
  const caption = spec.quota == null
    ? "未設目標線"
    : "虛線 = " + spec.lineWord + " " + spec.formatValue(spec.quota) + (spec.unit ? " " + spec.unit : "");
  return (
    '<figure class="chart reveal" data-chart-id="' + esc(id) + '">' +
      "<figcaption>" +
        "<h3>" + esc(spec.label) + "</h3>" +
        '<p class="chart-quota">' + esc(caption) + "</p>" +
      "</figcaption>" +
      '<div class="chart-canvas"><canvas aria-hidden="true"></canvas></div>' +
      '<p class="summary">' + esc(pointSummary(points, spec)) + "</p>" +
    "</figure>"
  );
}

function chartsCard() {
  const days = trendDays();
  const stats = chipStats();
  const first = days[0];
  const last = days[days.length - 1];
  const range = first ? dateLabel(first.date) + "至" + dateLabel(last.date) : "";
  const chartsHtml = nutritionChartMetrics().map((metric) => chartFigure(nutritionPoints(metric), nutritionSpec(metric))).join("");
  return (
    '<section class="card" id="trends" aria-labelledby="trend-heading">' +
      '<h2 id="trend-heading">近 ' + days.length + " 日營養走勢</h2>" +
      '<p class="section-sub">' + esc(range) + "。空心點係進行中。撳圖可以睇返當日。</p>" +
      '<div class="chips">' +
        chip(stats.protein, stats.n, "蛋白達標", "good") +
        chip(stats.sugar, stats.n, "糖超上限", "bad") +
        chip(stats.sodium, stats.n, "鈉超上限", "bad") +
        chip(stats.kcal, stats.n, "熱量貼近", "good") +
      "</div>" +
      '<p class="fine">小結只計 ' + stats.n + " 個完整日，未計進行中。</p>" +
      '<div class="chart-list">' + chartsHtml + "</div>" +
    "</section>"
  );
}

function fitnessTrends() {
  const rows = fitnessSorted();
  const specs = fitnessChartSpecs();
  if (!rows.length || !specs.length) return "";
  const chartsHtml = specs.map((spec) => chartFigure(fitnessPoints(spec.key), spec)).join("");
  const range = dateLabel(rows[0].date) + "至" + dateLabel(rows[rows.length - 1].date);
  return (
    '<div class="trend-block">' +
      "<h3>活動走勢</h3>" +
      '<p class="section-sub">' + esc(range) + "。只畫有紀錄嘅日子。步數同公里未設目標。</p>" +
      '<div class="chart-list">' + chartsHtml + "</div>" +
    "</div>"
  );
}

function cell(day, metric) {
  if (!Object.prototype.hasOwnProperty.call(day, metric.key)) return '<td class="num">—</td>';
  const quota = snapshot.quotas[metric.quotaKey];
  const value = day[metric.key];
  const status = classify(metric.key, value, quota);
  return (
    '<td class="num tone-' + status.tone + '">' +
      fmtInt(value) +
      '<span class="flag" aria-hidden="true">' + status.emoji + esc(status.mark) + "</span>" +
      '<span class="visually-hidden">，' + esc(status.label) + "</span>" +
    "</td>"
  );
}

function daysTable() {
  const metrics = METRICS.filter((metric) => daysSorted().some((day) => Object.prototype.hasOwnProperty.call(day, metric.key)));
  const head = metrics.map((metric) => (
    '<th scope="col">' + esc(metric.label) + '<span class="unit">' + esc(metric.unit) + "</span></th>"
  )).join("");
  const rows = daysNewest().map((day) => {
    const on = day.date === selectedDate;
    const partial = day.partial ? '<span class="mini">進行中</span>' : "";
    const label = "睇 " + dateLabel(day.date) + (day.partial ? "，進行中" : "");
    return (
      '<tr data-select="' + esc(day.date) + '"' + (on ? ' class="is-on" aria-current="true"' : "") + ">" +
        '<th scope="row"><button type="button" class="row-btn" aria-pressed="' + (on ? "true" : "false") + '" aria-label="' + esc(label) + '">' +
          '<span class="num">' + esc(shortDate(day.date)) + "</span>" + partial +
        "</button></th>" +
        metrics.map((metric) => cell(day, metric)).join("") +
      "</tr>"
    );
  }).join("");

  return (
    '<section class="card reveal" id="days" aria-labelledby="days-heading">' +
      '<h2 id="days-heading">每日數字</h2>' +
      '<p class="legend-line" aria-hidden="true">🔴超 · 🟡近 · 🟢低 · 🟢好</p>' +
      '<p class="scroll-hint">左右滑可以睇晒欄。</p>' +
      '<div class="scroll">' +
        '<table class="sheet days">' +
          "<thead><tr><th scope=\"col\">日期</th>" + head + "</tr></thead>" +
          "<tbody>" + rows + "</tbody>" +
        "</table>" +
      "</div>" +
    "</section>"
  );
}

function ringSvg(value, goal, color) {
  const radius = 40;
  const circ = 2 * Math.PI * radius;
  const ratio = goal ? Number(value) / Number(goal) : 0;
  const shown = Math.max(0, Math.min(ratio, 1));
  const full = shown >= 0.999;
  const dash = (shown * circ).toFixed(2);
  const gap = (circ - shown * circ).toFixed(2);
  const arc = full
    ? '<circle cx="60" cy="60" r="' + radius + '" fill="none" stroke="' + color + '" stroke-width="11"></circle>'
    : '<circle cx="60" cy="60" r="' + radius + '" fill="none" stroke="' + color + '" stroke-width="11" stroke-linecap="round" stroke-dasharray="' + dash + " " + gap + '" transform="rotate(-90 60 60)"></circle>';
  return (
    '<svg class="ring-svg" viewBox="0 0 120 120" aria-hidden="true">' +
      '<circle cx="60" cy="60" r="' + radius + '" fill="none" stroke="#3a322a" stroke-width="11"></circle>' +
      arc +
      '<text x="60" y="66" text-anchor="middle" font-size="16" font-weight="700" fill="#f6efe6" font-family="Georgia, serif">' + esc(pctText(value, goal)) + "</text>" +
    "</svg>"
  );
}

function fitnessLiveHtml() {
  const rows = fitnessSorted();
  if (!rows.length) return "<p>未有活動紀錄。</p>";
  const shown = shownFitness();
  const row = shown.row;
  const goals = snapshot.fitnessGoals;
  const selectedLabel = dateLabel(selectedDate);
  let intro = dateLabel(row.date) + "（" + weekdayChar(row.date) + "）";
  if (shown.fallback) {
    intro = selectedLabel + "未有活動紀錄。下面係最近一次：" + dateLabel(row.date) + "（" + weekdayChar(row.date) + "）。";
  }
  const rings = RING_META.map((meta) => {
    const value = row[meta.key];
    const goal = goals[meta.goalKey];
    const met = Number(value) >= Number(goal);
    return (
      '<figure class="ring">' +
        ringSvg(value, goal, meta.color) +
        "<figcaption>" +
          '<span class="ring-name">' + esc(meta.label) + "</span>" +
          '<span class="ring-score num">' + fmtInt(value) + " / " + fmtInt(goal) + " " + esc(meta.unit) + "</span>" +
          '<span class="visually-hidden">' + esc(pctText(value, goal) + "，" + (met ? "達標" : "未達")) + "</span>" +
        "</figcaption>" +
      "</figure>"
    );
  }).join("");
  const stepsSum = rows.reduce((sum, item) => sum + Number(item.steps), 0);
  const kmSum = rows.reduce((sum, item) => sum + Number(item.km), 0);
  const avgSteps = Math.round(stepsSum / rows.length);
  const avgKm = kmSum / rows.length;
  const gaps = dateGaps();
  const missingFit = gaps.noFit.length
    ? '<p class="fine">膳食有記、活動未有：' + esc(gaps.noFit.map(dateLabel).join("、")) + "。</p>"
    : "";
  const missingMeal = gaps.noMeal.length
    ? '<p class="fine">活動有記、膳食未有：' + esc(gaps.noMeal.map(dateLabel).join("、")) + "。</p>"
    : "";
  return (
    '<p class="section-sub">' + esc(intro) + "</p>" +
    '<div class="rings">' + rings + "</div>" +
    '<div class="step-stats">' +
      "<div><b class=\"num\">" + fmtInt(row.steps) + '</b><span>步</span></div>' +
      "<div><b class=\"num\">" + fmtKm(row.km) + "</b><span>公里</span></div>" +
    "</div>" +
    '<p class="fine">有紀錄 ' + rows.length + " 日，平均 " + fmtInt(avgSteps) + " 步、" + fmtKm(avgKm) + " 公里。目標：活動 " + fmtInt(goals.move) + " kcal、運動 " + fmtInt(goals.exercise) + " 分鐘、站立 " + fmtInt(goals.stand) + " 小時。</p>" +
    missingFit +
    missingMeal
  );
}

function fitnessCard() {
  const rows = fitnessSorted();
  if (!rows.length) {
    return '<section class="card reveal" id="fitness"><h2>活動</h2><p>未有活動紀錄。</p></section>';
  }
  const goals = snapshot.fitnessGoals;
  const shown = shownFitness();
  const headGoals = RING_META.map((meta) => (
    '<th scope="col">' + esc(meta.label) + '<span class="subhead">/ ' + esc(fmtInt(goals[meta.goalKey])) + "</span></th>"
  )).join("");
  const body = [...rows].reverse().map((item) => {
    const on = shown.row && item.date === shown.row.date;
    const ringCells = RING_META.map((meta) => {
      const value = item[meta.key];
      const goal = goals[meta.goalKey];
      const met = Number(value) >= Number(goal);
      const tone = met ? "good" : "soft";
      const word = met ? "達標" : "未達";
      return '<td class="num tone-' + tone + '">' + fmtInt(value) + '<span class="visually-hidden">，' + word + "</span></td>";
    }).join("");
    return (
      '<tr data-select="' + esc(item.date) + '"' + (on ? ' class="is-on"' : "") + ">" +
        '<th scope="row"><button type="button" class="row-btn" aria-pressed="' + (on ? "true" : "false") + '" aria-label="' + esc("睇 " + dateLabel(item.date) + " 活動") + '">' +
          '<span class="num">' + esc(shortDate(item.date)) + "</span>" +
        "</button></th>" +
        ringCells +
        '<td class="num">' + fmtInt(item.steps) + "</td>" +
        '<td class="num">' + fmtKm(item.km) + "</td>" +
      "</tr>"
    );
  }).join("");

  return (
    '<section class="card" id="fitness" aria-labelledby="fit-heading">' +
      '<h2 id="fit-heading">活動</h2>' +
      '<div id="fitness-live" class="reveal">' + fitnessLiveHtml() + "</div>" +
      fitnessTrends() +
      '<p class="scroll-hint">左右滑可以睇晒欄。</p>' +
      '<div class="scroll">' +
        '<table class="sheet fitness">' +
          "<thead><tr><th scope=\"col\">日期</th>" + headGoals + '<th scope="col">步數</th><th scope="col">公里</th></tr></thead>' +
          "<tbody>" + body + "</tbody>" +
        "</table>" +
      "</div>" +
    "</section>"
  );
}

function adviceLists() {
  const block = snapshot.advice || snapshot.comments || {};
  return {
    eating: Array.isArray(block.eating) ? block.eating : [],
    meals: Array.isArray(block.meals) ? block.meals : [],
  };
}

function listHtml(items) {
  if (!items.length) return '<p class="fine">未有文字。</p>';
  return '<ul class="advice-list">' + items.map((item) => "<li>" + esc(item) + "</li>").join("") + "</ul>";
}

function adviceLiveHtml(day) {
  const items = calloutItems(day);
  const head = '<p class="gap-date">' + esc(dateLabel(day.date)) + (day.partial ? " · 進行中" : "") + "</p>";
  if (!items.length) return head + "<p>呢日未見明顯超標，亦未見要追嘅目標。</p>";
  return head + '<ul class="gaps">' + items.map((item) => (
    "<li>" + badgeHtml(item.status) + "<span>" + esc(item.metric.label) + " " + fmtInt(item.value) + " / " + fmtInt(item.quota) + " " + esc(item.metric.unit) + "</span></li>"
  )).join("") + "</ul>";
}

function foodItems(key) {
  const lists = snapshot.foodLists || {};
  const value = lists[key];
  return Array.isArray(value) ? value : [];
}

function foodGroup(title, items) {
  if (!items.length) return "";
  return (
    '<div class="food-col">' +
      '<h3 class="food-title">' + title + "</h3>" +
      listHtml(items) +
    "</div>"
  );
}

function foodSection() {
  const protein = foodItems("protein");
  const fiber = foodItems("fiber");
  const tips = foodItems("tips");
  if (!protein.length && !fiber.length) return "";
  const quotas = snapshot.quotas || {};
  const tipHtml = tips.length
    ? '<ul class="food-tips">' + tips.map((item) => "<li>" + esc(item) + "</li>").join("") + "</ul>"
    : "";
  return (
    '<section class="card reveal" id="foods" aria-labelledby="foods-heading">' +
      '<h2 id="foods-heading">補數</h2>' +
      '<p class="section-sub">蛋白 ' + fmtInt(quotas.protein_g) + " g · 纖維 " + fmtInt(quotas.fiber_g) + " g。屋企同黃埔出面都得。</p>" +
      '<div class="food-grid">' +
        foodGroup("🍗蛋白", protein) +
        foodGroup("🌿纖維", fiber) +
      "</div>" +
      tipHtml +
    "</section>"
  );
}

function adviceSection() {
  const copy = adviceLists();
  const day = currentDay();
  return (
    '<section class="card reveal" id="advice" aria-labelledby="advice-heading">' +
      '<h2 id="advice-heading">建議</h2>' +
      "<h3>飲食</h3>" +
      listHtml(copy.eating) +
      "<h3>餐單</h3>" +
      listHtml(copy.meals) +
      '<h3 id="advice-gap-heading">爭邊樣</h3>' +
      '<div id="advice-live">' + adviceLiveHtml(day) + "</div>" +
      fatNote() +
      '<h3>補邊樣</h3>' +
      '<p class="section-sub">蛋白同纖維最難達標。<a href="#foods">睇晒可以食嘅</a>。</p>' +
      foodPeek() +
    "</section>"
  );
}

function foodPeek() {
  const protein = foodItems("protein").slice(0, 4);
  const fiber = foodItems("fiber").slice(0, 3);
  if (!protein.length && !fiber.length) return "";
  const line = (mark, items) => (
    "<li><span aria-hidden=\"true\">" + mark + "</span> " + esc(items.join("、")) + "</li>"
  );
  return (
    '<ul class="advice-list food-peek">' +
      (protein.length ? line("🍗", protein) : "") +
      (fiber.length ? line("🌿", fiber) : "") +
    "</ul>"
  );
}

function nowBar(day) {
  if (!day || day.date === latestDate()) return "";
  return (
    '<div class="now">' +
      "<p>而家睇緊 <strong>" + esc(dateLabel(day.date)) + "</strong> · " + fmtInt(day.kcal) + " kcal</p>" +
      '<button type="button" data-go-latest>返回今日</button>' +
    "</div>"
  );
}

function pageTitle(day) {
  if (!day) return "膳食教練";
  if (day.date === latestDate()) return "今日 · 膳食教練";
  return dateLabel(day.date) + " · 膳食教練";
}

function view() {
  pending = [];
  const day = currentDay();
  return '<div id="now-slot">' + nowBar(day) + "</div>" + todaySection() + chartsCard() + daysTable() + fitnessCard() + adviceSection() + foodSection();
}

function cssVar(name, fallback) {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function motionOK() {
  return typeof window !== "undefined" && window.matchMedia && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function hexAlpha(hex, alpha) {
  const raw = String(hex).replace("#", "");
  const num = parseInt(raw, 16);
  if (!Number.isFinite(num)) return hex;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
}

function axisLabel(points, point) {
  const index = points.indexOf(point);
  const prev = index > 0 ? points[index - 1].date : "";
  if (!prev || parts(prev).m !== parts(point.date).m) return shortDate(point.date);
  return String(parts(point.date).d);
}

function clearCharts() {
  charts.forEach((entry) => {
    if (entry.chart) entry.chart.destroy();
  });
  charts = [];
  if (revealObserver) revealObserver.disconnect();
  revealObserver = null;
}

function buildChart(figure, item) {
  const canvas = figure.querySelector("canvas");
  if (!canvas || typeof Chart === "undefined") {
    const note = document.createElement("p");
    note.className = "fine";
    note.textContent = "圖表未載入。";
    figure.appendChild(note);
    return;
  }
  const points = item.points;
  const spec = item.spec;
  const card = cssVar("--card", "#241e18");
  const muted = cssVar("--muted", "#d2c3b2");
  const line = cssVar("--line", "#3d342b");
  const ink = cssVar("--ink", "#f6efe6");
  const datasets = [
    {
      data: points.map((point) => point.value),
      borderColor: spec.color,
      backgroundColor: hexAlpha(spec.color, 0.18),
      fill: true,
      tension: 0.25,
      pointRadius: points.map((point) => (point.date === selectedDate ? 7 : point.partial ? 5 : 3.5)),
      pointHoverRadius: points.map((point) => (point.date === selectedDate ? 8 : 5)),
      pointBackgroundColor: points.map((point) => (point.partial || point.date === selectedDate ? card : spec.color)),
      pointBorderColor: spec.color,
      pointBorderWidth: points.map((point) => (point.date === selectedDate ? 3 : 2)),
      borderWidth: 2.5,
    },
  ];
  if (spec.quota != null) {
    datasets.push({
      data: points.map(() => spec.quota),
      borderColor: muted,
      borderDash: [5, 4],
      borderWidth: 1.5,
      pointRadius: 0,
      pointHoverRadius: 0,
      fill: false,
    });
  }
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: points.map((point) => axisLabel(points, point)),
      datasets: datasets,
    },
    options: {
      animation: motionOK() ? { duration: 700, easing: "easeOutQuart" } : false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: card,
          titleColor: ink,
          bodyColor: ink,
          borderColor: line,
          borderWidth: 1,
          filter: (tip) => tip.datasetIndex === 0,
          callbacks: {
            title(tips) {
              const point = points[tips[0].dataIndex];
              return dateLabel(point.date) + (point.partial ? " · 進行中" : "");
            },
            label(tip) {
              return spec.label + " " + spec.formatValue(tip.parsed.y) + (spec.unit ? " " + spec.unit : "");
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: muted, maxRotation: 0, autoSkip: true, font: { size: 11 } },
          grid: { display: false },
          border: { color: line },
        },
        y: {
          beginAtZero: true,
          suggestedMax: spec.quota ? spec.quota * 1.16 : undefined,
          ticks: { color: muted, font: { size: 11 }, maxTicksLimit: 5 },
          grid: { color: "rgba(246, 239, 230, 0.08)" },
          border: { display: false },
        },
      },
      onClick(evt) {
        const hits = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, true);
        const hit = hits.find((entry) => entry.datasetIndex === 0);
        if (!hit) return;
        choose(points[hit.index].date, "chart");
      },
    },
  });
  charts.push({ chart: chart, points: points, spec: spec });
}

function highlightCharts() {
  const card = cssVar("--card", "#241e18");
  charts.forEach((entry) => {
    const set = entry.chart.data.datasets[0];
    set.pointRadius = entry.points.map((point) => (point.date === selectedDate ? 7 : point.partial ? 5 : 3.5));
    set.pointHoverRadius = entry.points.map((point) => (point.date === selectedDate ? 8 : 5));
    set.pointBackgroundColor = entry.points.map((point) => (point.partial || point.date === selectedDate ? card : entry.spec.color));
    set.pointBorderWidth = entry.points.map((point) => (point.date === selectedDate ? 3 : 2));
    entry.chart.update("none");
  });
}

function mountObservers() {
  const nodes = [];
  const seen = new Set();
  document.querySelectorAll(".reveal, .chart[data-chart-id]").forEach((node) => {
    if (seen.has(node)) return;
    seen.add(node);
    nodes.push(node);
  });
  const activate = (node) => {
    node.classList.add("is-in");
    if (node.dataset.chartId && node.dataset.mounted !== "1") {
      node.dataset.mounted = "1";
      const item = pending.find((entry) => entry.id === node.dataset.chartId);
      if (item) buildChart(node, item);
    }
  };
  if (typeof IntersectionObserver === "undefined") {
    nodes.forEach(activate);
    return;
  }
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      activate(entry.target);
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0.2, rootMargin: "0px 0px -4% 0px" });
  nodes.forEach((node) => {
    if (node.classList.contains("is-in") && !node.dataset.chartId) return;
    revealObserver.observe(node);
  });
}

function cssEscape(value) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return String(value).replace(/"/g, "");
}

function nearestSlide() {
  const track = document.querySelector(".day-track");
  if (!track) return null;
  const origin = track.getBoundingClientRect().left;
  let best = null;
  let bestDist = Infinity;
  track.querySelectorAll(".day-slide").forEach((slide) => {
    const dist = Math.abs(slide.getBoundingClientRect().left - origin);
    if (dist < bestDist) {
      bestDist = dist;
      best = slide;
    }
  });
  if (!best || bestDist > 16) return null;
  return best;
}

function positionDayTrack(behavior) {
  const track = document.querySelector(".day-track");
  if (!track) return;
  const slide = track.querySelector('[data-slide="' + cssEscape(selectedDate) + '"]');
  if (!slide) return;
  const left = slide.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft;
  const reduce = behavior === "auto" || !motionOK();
  scrollLock = true;
  track.scrollTo({ left: left, behavior: reduce ? "auto" : "smooth" });
  window.setTimeout(() => {
    scrollLock = false;
  }, reduce ? 180 : 720);
}

function updateChevrons() {
  const days = daysNewest();
  const index = days.findIndex((day) => day.date === selectedDate);
  const newer = document.querySelector("[data-day-step='-1']");
  const older = document.querySelector("[data-day-step='1']");
  if (newer) newer.disabled = index <= 0;
  if (older) older.disabled = index === -1 || index >= days.length - 1;
}

function bindTrack() {
  const track = document.querySelector(".day-track");
  if (!track) return;
  track.addEventListener("scroll", () => {
    if (scrollLock) return;
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      const slide = nearestSlide();
      if (!slide) return;
      const date = slide.getAttribute("data-slide");
      if (date && date !== selectedDate) choose(date, "swipe");
    }, 90);
  }, { passive: true });
  track.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      stepDay(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      stepDay(-1);
    }
  });
}

function stepDay(delta) {
  const days = daysNewest();
  const index = days.findIndex((day) => day.date === selectedDate);
  const next = days[index + delta];
  if (!next) return;
  choose(next.date, "chevron");
}

function render() {
  const app = document.querySelector("#app");
  const scrollY = window.scrollY;
  clearCharts();
  const html = view();
  app.innerHTML = html;
  document.title = pageTitle(currentDay());
  updateChevrons();
  bindTrack();
  mountObservers();
  window.requestAnimationFrame(() => {
    positionDayTrack("auto");
    window.scrollTo(0, scrollY);
  });
}

function announce(day) {
  const live = document.querySelector("#live");
  if (!live || !day) return;
  const prefix = day.date === latestDate() ? "今日" : dateLabel(day.date);
  live.textContent = prefix + "。" + coachNote(day);
}

function sectionHash(hash) {
  return /^(today|trends|days|fitness|advice|foods)$/.test(hash);
}

function writeHash() {
  const url = new URL(window.location.href);
  const current = decodeURIComponent(url.hash.replace(/^#/, ""));
  if (selectedDate === latestDate()) url.searchParams.delete("day");
  else url.searchParams.set("day", selectedDate);
  if (!sectionHash(current)) url.hash = selectedDate === latestDate() ? "" : selectedDate;
  const search = url.searchParams.toString();
  history.replaceState(null, "", url.pathname + (search ? "?" + search : "") + url.hash);
}

function syncSelection(source, scope) {
  const day = currentDay();
  document.title = pageTitle(day);
  const now = document.querySelector("#now-slot");
  if (now) now.innerHTML = nowBar(day);
  const heading = document.querySelector("#today-heading");
  const dateLine = document.querySelector("#today-date");
  if (heading && dateLine && day) {
    const latest = day.date === latestDate();
    heading.textContent = latest ? "今日" : dateLabel(day.date);
    dateLine.textContent = latest
      ? dateLabel(day.date) + "（" + weekdayChar(day.date) + "）"
      : "星期" + weekdayChar(day.date);
  }
  document.querySelectorAll(".day-slide").forEach((slide) => {
    const on = slide.getAttribute("data-slide") === day.date;
    slide.classList.toggle("is-current", on);
    slide.setAttribute("aria-hidden", on ? "false" : "true");
  });
  if (source !== "swipe") positionDayTrack(source === "hash" ? "auto" : "smooth");
  updateChevrons();
  const advice = document.querySelector("#advice-live");
  if (advice) advice.innerHTML = adviceLiveHtml(day);
  document.querySelectorAll("table.days tbody tr").forEach((row) => {
    const on = row.getAttribute("data-select") === day.date;
    row.classList.toggle("is-on", on);
    if (on) row.setAttribute("aria-current", "true");
    else row.removeAttribute("aria-current");
    const button = row.querySelector("button");
    if (button) button.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const fit = document.querySelector("#fitness-live");
  if (fit) fit.innerHTML = fitnessLiveHtml();
  const shown = shownFitness();
  document.querySelectorAll("table.fitness tbody tr").forEach((row) => {
    const on = !!(shown.row && row.getAttribute("data-select") === shown.row.date);
    row.classList.toggle("is-on", on);
    const button = row.querySelector("button");
    if (button) button.setAttribute("aria-pressed", on ? "true" : "false");
  });
  highlightCharts();
  if (source === "keyboard" && scope) {
    const table = document.querySelector("table." + scope);
    const button = table && table.querySelector('tr[data-select="' + cssEscape(day.date) + '"] button');
    if (button) button.focus();
  }
  announce(day);
}

function choose(date, source, scope) {
  if (!daysSorted().some((day) => day.date === date)) return;
  if (date === selectedDate) return;
  selectedDate = date;
  writeHash();
  if (!document.querySelector(".day-track")) {
    render();
    announce(currentDay());
    return;
  }
  syncSelection(source, scope);
}

function onAppClick(event) {
  const step = event.target.closest("[data-day-step]");
  if (step) {
    stepDay(Number(step.getAttribute("data-day-step")));
    return;
  }
  const latest = event.target.closest("[data-go-latest]");
  if (latest) {
    choose(latestDate(), "button");
    return;
  }
  const row = event.target.closest("tr[data-select]");
  if (row) {
    const table = row.closest("table");
    const scope = table && table.classList.contains("fitness") ? "fitness" : "days";
    choose(row.getAttribute("data-select"), event.detail === 0 ? "keyboard" : "row", scope);
  }
}

function setSheet(open, options) {
  const fab = document.querySelector(".fab");
  const layer = document.querySelector("#nav-layer");
  const sheet = document.querySelector("#nav-sheet");
  if (!fab || !layer || !sheet) return;
  layer.classList.toggle("is-open", open);
  if ("inert" in layer) layer.inert = !open;
  layer.setAttribute("aria-hidden", open ? "false" : "true");
  fab.setAttribute("aria-expanded", open ? "true" : "false");
  fab.setAttribute("aria-label", open ? "關閉目錄" : "開啟目錄");
  sheet.querySelectorAll("a").forEach((link) => {
    if (open) link.removeAttribute("tabindex");
    else link.setAttribute("tabindex", "-1");
  });
  const focus = !options || options.focus !== false;
  if (!focus) return;
  if (open) {
    const link = sheet.querySelector("a");
    if (link) link.focus();
  } else {
    fab.focus();
  }
}

function bindChrome() {
  const fab = document.querySelector(".fab");
  const layer = document.querySelector("#nav-layer");
  if (!fab || !layer || fab.dataset.bound) return;
  fab.dataset.bound = "1";
  fab.addEventListener("click", () => {
    setSheet(fab.getAttribute("aria-expanded") !== "true", { focus: true });
  });
  const backdrop = layer.querySelector(".sheet-backdrop");
  if (backdrop) backdrop.addEventListener("click", () => setSheet(false, { focus: true }));
  const sheet = document.querySelector("#nav-sheet");
  if (sheet) {
    sheet.addEventListener("click", (event) => {
      if (event.target.closest("a")) setSheet(false, { focus: false });
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && layer.classList.contains("is-open")) {
      event.preventDefault();
      setSheet(false, { focus: true });
    }
  });
  setSheet(false, { focus: false });
}

function errorCard(title, bodyHtml) {
  return '<section class="card"><h2>' + esc(title) + "</h2><p>" + bodyHtml + "</p></section>";
}

function assertData(data) {
  if (!data || !Array.isArray(data.daily) || !data.daily.length) throw new Error("data.json 缺少 daily");
  if (!data.quotas) throw new Error("data.json 缺少 quotas");
  if (!Array.isArray(data.fitness)) throw new Error("data.json 缺少 fitness");
  if (!data.fitnessGoals) throw new Error("data.json 缺少 fitnessGoals");
}

function knownDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") && daysSorted().some((day) => day.date === value);
}

function dateFromHash() {
  const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (knownDay(hash)) return hash;
  const day = new URL(window.location.href).searchParams.get("day");
  return knownDay(day) ? day : "";
}

function init() {
  const app = document.querySelector("#app");
  app.addEventListener("click", onAppClick);
  bindChrome();
  window.addEventListener("hashchange", () => {
    if (!snapshot) return;
    const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hash)) return;
    if (!daysSorted().some((day) => day.date === hash)) return;
    choose(hash, "hash");
  });
  if (location.protocol === "file:") {
    app.innerHTML = errorCard(
      "瀏覽器開唔到本地 data.json",
      "你而家係用檔案方式開。請喺專案資料夾行 <code>python3 -m http.server 8080</code>，再開 <a href=\"http://localhost:8080/\">http://localhost:8080/</a>。"
    );
    return;
  }
  fetch("data.json", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    })
    .then((data) => {
      assertData(data);
      snapshot = data;
      selectedDate = dateFromHash() || latestDate();
      const updated = document.querySelector("#updated");
      if (updated && snapshot.updatedAt) updated.textContent = "更新 " + formatUpdated(snapshot.updatedAt);
      render();
      writeHash();
    })
    .catch((error) => {
      console.error(error);
      app.innerHTML = errorCard(
        "讀唔到 data.json",
        "確認 data.json 同 index.html 喺同一層，然後用本地伺服器開頁。<br>指令：<code>python3 -m http.server 8080</code>"
      );
    });
}

if (typeof document !== "undefined") {
  init();
}

function runSelfCheck() {
  const fs = require("fs");
  const path = require("path");
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "data.json"), "utf8"));
  snapshot = data;
  const expect = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const cases = [
    ["sugar", 16, 30, "good", "好"],
    ["sugar", 32, 30, "warn", "近"],
    ["sugar", 48, 30, "bad", "超"],
    ["sodium", 2006, 2000, "warn", "近"],
    ["sodium", 1900, 2000, "warn", "近"],
    ["sodium", 1642, 2000, "good", "好"],
    ["sodium", 2750, 2000, "bad", "超"],
    ["protein", 23, 135, "soft", "低"],
    ["protein", 89, 135, "soft", "低"],
    ["protein", 121, 135, "warn", "近"],
    ["protein", 115, 135, "warn", "近"],
    ["protein", 136, 135, "warn", "近"],
    ["fiber", 27, 28, "warn", "近"],
    ["fiber", 28, 28, "warn", "近"],
    ["fiber", 17, 28, "soft", "低"],
    ["fiber", 23, 28, "soft", "低"],
    ["kcal", 457, 1950, "soft", "低"],
    ["kcal", 1825, 1950, "warn", "近"],
    ["kcal", 2080, 1950, "warn", "近"],
    ["kcal", 2210, 1950, "bad", "超"],
    ["kcal", 2530, 1950, "bad", "超"],
    ["carbs", 220, 190, "bad", "超"],
    ["carbs", 168, 190, "warn", "近"],
    ["carbs", 228, 190, "bad", "超"],
    ["carbs", 34, 190, "soft", "低"],
  ];
  cases.forEach((item) => {
    const status = classify(item[0], item[1], item[2]);
    expect(status.tone === item[3] && status.mark === item[4], item.join(" ") + " -> " + status.tone + " " + status.mark);
  });
  expect(pctText(2006, 2000) === "100.3%", pctText(2006, 2000));
  expect(pctText(457, 1950) === "23%", pctText(457, 1950));
  expect(pctText(2530, 1950) === "130%", pctText(2530, 1950));
  expect(weekdayChar("2026-10-19") === "一", "weekday");
  expect(weekdayChar("2026-10-17") === "六", "saturday");
  expect(latestDate() === "2026-10-19", latestDate());
  const complete = completeDays();
  expect(complete.length === 10, "complete");
  const stats = chipStats();
  expect(stats.protein === 3 && stats.sodium === 6 && stats.sugar === 9 && stats.kcal === 8, JSON.stringify(stats));
  selectedDate = "2026-10-19";
  const todayNote = coachNote(currentDay());
  expect(todayNote.includes("進行中") && todayNote.includes("蛋白") && todayNote.includes("低"), todayNote);
  expect(!todayNote.includes("糖"), todayNote);
  selectedDate = "2026-10-14";
  const highNote = coachNote(currentDay());
  expect(highNote.includes("超") && highNote.includes("2,750") && highNote.includes("56"), highNote);
  selectedDate = "2026-10-12";
  const midNote = coachNote(currentDay());
  expect(midNote.includes("纖維") && midNote.includes("低") && midNote.includes("鈉") && midNote.includes("近"), midNote);
  const steps = fitnessSorted().reduce((sum, row) => sum + row.steps, 0);
  const km = fitnessSorted().reduce((sum, row) => sum + row.km, 0);
  expect(steps === 79380, String(steps));
  expect(Math.abs(km - 61.48) < 0.001, String(km));
  expect(fitnessSorted()[fitnessSorted().length - 1].date === "2026-10-17", "latest fitness");
  const gaps = dateGaps();
  expect(gaps.noFit.join() === "2026-10-13,2026-10-18,2026-10-19", gaps.noFit.join());
  expect(!daysSorted().some((day) => Object.prototype.hasOwnProperty.call(day, "fat")), "no fat");
  const kcalSummary = trendSummary(trendDays(), metricByKey("kcal"));
  expect(kcalSummary.includes("2,530") && kcalSummary.includes("1,765") && kcalSummary.includes("8 日"), kcalSummary);
  const chartKeys = nutritionChartMetrics().map((metric) => metric.key).join();
  expect(chartKeys === "kcal,carbs,sugar,fiber,protein,sodium", chartKeys);
  const sugarSummary = pointSummary(nutritionPoints(metricByKey("sugar")), nutritionSpec(metricByKey("sugar")));
  expect(sugarSummary.includes("56") && sugarSummary.includes("超上限 9"), sugarSummary);
  const fiberSummary = pointSummary(nutritionPoints(metricByKey("fiber")), nutritionSpec(metricByKey("fiber")));
  expect(fiberSummary.includes("達標 2"), fiberSummary);
  const specs = fitnessChartSpecs();
  expect(specs.map((spec) => spec.key).join() === "move,exercise,stand,steps,km", specs.map((spec) => spec.key).join());
  expect(specs.find((spec) => spec.key === "move").quota === 360, "move goal");
  expect(specs.find((spec) => spec.key === "steps").quota == null, "steps have no goal");
  expect(specs.find((spec) => spec.key === "km").quota == null, "km has no goal");
  const sugarModel = chartModel(nutritionPoints(metricByKey("sugar")), nutritionSpec(metricByKey("sugar")));
  expect(sugarModel.quota === 30 && sugarModel.dates.indexOf("2026-10-19") !== -1, "sugar series keeps the partial day");
  const stepsModel = chartModel(fitnessPoints("steps"), specs.find((spec) => spec.key === "steps"));
  expect(stepsModel.quota == null && stepsModel.dates.length === 8, "fitness dates only");
  expect(stepsModel.dates.indexOf("2026-10-13") === -1 && stepsModel.dates.indexOf("2026-10-19") === -1, "no invented fitness days");
  const moveModel = chartModel(fitnessPoints("move"), specs.find((spec) => spec.key === "move"));
  expect(moveModel.quota === 360, "move goal line");
  expect(Array.isArray(data.advice.eating) && data.advice.eating.length >= 3, "advice eating");
  expect(Array.isArray(data.advice.meals) && data.advice.meals.length >= 3, "advice meals");
  expect(Array.isArray(data.foodLists.protein) && data.foodLists.protein.length >= 8, "protein foods");
  expect(Array.isArray(data.foodLists.fiber) && data.foodLists.fiber.length >= 6, "fiber foods");
  expect(data.foodLists.protein.some((item) => item.includes("豆漿")) && data.foodLists.protein.some((item) => item.includes("黃埔")), "protein examples");
  expect(data.foodLists.fiber.some((item) => item.includes("菜心")) && data.foodLists.fiber.some((item) => item.includes("Ryvita")), "fiber examples");
  expect(Array.isArray(data.foodLists.tips) && data.foodLists.tips.some((item) => item.includes("甜果")), "fiber sugar tip");
  expect(daysNewest()[0].date === "2026-10-19", "newest first");
}

if (typeof process !== "undefined" && process.argv && process.argv.includes("--check")) {
  try {
    runSelfCheck();
    console.log("self-check ok");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
