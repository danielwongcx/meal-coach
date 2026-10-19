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
  kcal: "#c4622d",
  carbs: "#a56b2a",
  sugar: "#c4536a",
  fiber: "#5d8a45",
  protein: "#2f7d4a",
  sodium: "#2b6e97",
  fat: "#8a6a3b",
  move: "#e15a4a",
  exercise: "#3c9a45",
  stand: "#148a9a",
  steps: "#6d5438",
  km: "#3d6f8f",
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

function classify(key, value, quota, partial) {
  const metric = metricByKey(key);
  const kind = metric ? metric.kind : "balance";
  const cap = Number(quota);
  const ratio = cap ? Number(value) / cap : 0;

  if (kind === "cap") {
    if (ratio > 1.1) return { tone: "bad", label: "超標" };
    if (ratio > 1) return { tone: "warn", label: "超少少" };
    if (ratio > 0.9) return { tone: "warn", label: "接近上限" };
    return { tone: "good", label: "未到上限" };
  }

  if (kind === "target") {
    if (ratio >= 1) return { tone: "good", label: "達標" };
    if (ratio >= 0.9) return { tone: "good", label: "就快達標" };
    if (partial) return { tone: "progress", label: "進行中" };
    if (ratio >= 0.7) return { tone: "soft", label: "差少少" };
    return { tone: "soft", label: "未夠" };
  }

  if (partial) {
    if (ratio > 1.1) return { tone: "bad", label: "已超目標" };
    if (ratio > 1) return { tone: "warn", label: "已到目標" };
    return { tone: "progress", label: "進行中" };
  }

  if (ratio >= 0.9 && ratio <= 1.1) return { tone: "good", label: "貼近目標" };
  if (ratio > 1.1 && ratio <= 1.2) return { tone: "warn", label: "高少少" };
  if (ratio > 1.2) return { tone: "bad", label: "超標" };
  if (ratio >= 0.75) return { tone: "soft", label: "低少少" };
  return { tone: "soft", label: "偏低" };
}

function markFor(tone) {
  if (tone === "bad") return "超";
  if (tone === "warn") return "近";
  if (tone === "soft") return "低";
  return "";
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

function coachNote(day) {
  const quotas = snapshot.quotas;
  const bits = [];
  if (day.partial) {
    bits.push("呢日仲未完，以下係截至而家，唔當全日結算。");
  } else {
    const kcalStatus = classify("kcal", day.kcal, quotas.kcal, false);
    if (kcalStatus.tone === "good") bits.push("熱量貼近目標。");
    else if (kcalStatus.tone === "bad") bits.push("熱量超標，去到 " + pctText(day.kcal, quotas.kcal) + "。");
    else if (kcalStatus.tone === "warn") bits.push("熱量高少少。");
    else bits.push("熱量偏低。");

    const proteinGap = quotas.protein_g - day.protein;
    if (day.protein >= quotas.protein_g) bits.push("蛋白達標。");
    else if (day.protein >= quotas.protein_g * 0.9) bits.push("蛋白就快達標。");
    else bits.push("蛋白未夠，差 " + fmtInt(proteinGap) + " g。");
  }

  if (day.sugar > quotas.sugar_g * 1.1) bits.push("糖超標（" + fmtInt(day.sugar) + " g）。");
  else if (day.sugar > quotas.sugar_g) bits.push("糖超少少（" + fmtInt(day.sugar) + " / " + fmtInt(quotas.sugar_g) + " g）。");
  else if (day.partial) bits.push("糖 " + fmtInt(day.sugar) + " / " + fmtInt(quotas.sugar_g) + " g，未貼上限。");
  else if (day.sugar > quotas.sugar_g * 0.9) bits.push("糖接近上限。");

  if (day.sodium > quotas.sodium_mg * 1.1) bits.push("鈉超標（" + fmtInt(day.sodium) + " mg）。");
  else if (day.sodium > quotas.sodium_mg) bits.push("鈉超少少（" + fmtInt(day.sodium) + " / " + fmtInt(quotas.sodium_mg) + " mg）。");
  else if (!day.partial && day.sodium > quotas.sodium_mg * 0.9) bits.push("鈉接近上限。");

  if (!day.partial && day.fiber < quotas.fiber_g * 0.9) {
    bits.push("纖維差 " + fmtInt(quotas.fiber_g - day.fiber) + " g。");
  }
  return bits.join("");
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
    label: metric.label,
    unit: metric.unit,
    color: CHART_COLOR[metric.key] || "#241c14",
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
        color: CHART_COLOR[item.key] || "#241c14",
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

function metricRows(day) {
  return visibleMetrics(day).map((metric) => {
    const quota = snapshot.quotas[metric.quotaKey];
    const value = Number(day[metric.key]);
    const status = classify(metric.key, value, quota, !!day.partial);
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
          '<span class="status tone-' + status.tone + '">' + esc(status.label) + "</span>" +
          '<span class="pct num tone-' + status.tone + '">' + esc(percent) + "</span>" +
        "</div>" +
      "</div>"
    );
  }).join("");
}

function legendHtml() {
  return (
    '<ul class="legend">' +
      '<li><i class="swatch good" aria-hidden="true"></i>貼近、達標、未到上限</li>' +
      '<li><i class="swatch warn" aria-hidden="true"></i>接近上限或超少少</li>' +
      '<li><i class="swatch bad" aria-hidden="true"></i>明顯超標</li>' +
      '<li><i class="swatch soft" aria-hidden="true"></i>蛋白或纖維未夠</li>' +
      '<li><i class="swatch progress" aria-hidden="true"></i>當日進行中</li>' +
    "</ul>"
  );
}

function fatNote() {
  const hasFat = daysSorted().some((day) => Object.prototype.hasOwnProperty.call(day, "fat"));
  if (hasFat || snapshot.quotas.fat_g == null) return "";
  return '<p class="fine">脂肪配額係 ' + fmtInt(snapshot.quotas.fat_g) + " g。呢份每日紀錄未有脂肪，所以唔列出。</p>";
}

function dayCard(day) {
  const latest = day.date === latestDate();
  const p = parts(day.date);
  const heading = latest ? "今日" : p.m + "月" + p.d + "日";
  const sub = latest
    ? p.m + "月" + p.d + "日（" + weekdayChar(day.date) + "）"
    : "星期" + weekdayChar(day.date) + (day.partial ? " · 進行中" : " · 完整日");
  const kcalStatus = classify("kcal", day.kcal, snapshot.quotas.kcal, !!day.partial);
  const banner = day.partial
    ? '<p class="banner">進行中 · ' + esc(dateLabel(day.date)) + " 未完成，唔好當全日結算。</p>"
    : "";
  const back = latest ? "" : '<button type="button" class="text-btn" data-go-latest>返回今日</button>';
  return (
    '<section class="card day-card" id="day-card" aria-labelledby="day-heading">' +
      banner +
      '<div class="day-head">' +
        "<div>" +
          '<h2 id="day-heading">' + esc(heading) + "</h2>" +
          '<p class="date-line">' + esc(sub) + "</p>" +
        "</div>" +
        back +
      "</div>" +
      '<p class="hero-line">' +
        '<span class="hero-value num tone-' + kcalStatus.tone + '">' + fmtInt(day.kcal) + "</span>" +
        '<span class="hero-unit">kcal</span>' +
      "</p>" +
      '<p class="hero-sub num">' + esc(heroSub(day)) + "</p>" +
      '<p class="note">' + esc(coachNote(day)) + "</p>" +
      metricRows(day) +
      legendHtml() +
      fatNote() +
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

function chartSvg(points, spec) {
  if (!points.length) return '<p class="fine">未有數字。</p>';
  const color = spec.color || "#241c14";
  const quota = spec.quota;
  const width = 360;
  const height = 168;
  const pad = { l: quota == null ? 16 : 52, r: 8, t: 14, b: 26 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const values = points.map((point) => point.value);
  let maxY = Math.max(quota || 0, ...values, 0) * 1.16;
  if (!Number.isFinite(maxY) || maxY <= 0) maxY = 1;
  const slot = innerW / Math.max(points.length, 1);
  const xOf = (index) => pad.l + slot * index + slot / 2;
  const yOf = (value) => pad.t + innerH - (value / maxY) * innerH;
  const line = values.map((value, index) => (index === 0 ? "M" : "L") + xOf(index).toFixed(1) + " " + yOf(value).toFixed(1)).join(" ");
  const area = line + " L" + xOf(points.length - 1).toFixed(1) + " " + yOf(0).toFixed(1) + " L" + xOf(0).toFixed(1) + " " + yOf(0).toFixed(1) + " Z";
  let quotaMark = "";
  if (quota != null) {
    const qy = yOf(quota);
    quotaMark =
      '<line x1="' + pad.l + '" x2="' + (width - pad.r) + '" y1="' + qy.toFixed(1) + '" y2="' + qy.toFixed(1) + '" stroke="#8d7b66" stroke-width="1.25" stroke-dasharray="4 4"></line>' +
      '<text x="' + (pad.l - 6) + '" y="' + (qy + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="#5e5346">' + esc(spec.formatValue(quota)) + "</text>";
  }
  let slots = "";
  let hits = "";
  let dots = "";
  let labels = "";
  points.forEach((point, index) => {
    const x = xOf(index);
    const selected = point.date === selectedDate;
    if (selected) {
      slots += '<rect x="' + (pad.l + slot * index).toFixed(1) + '" y="' + pad.t + '" width="' + slot.toFixed(1) + '" height="' + innerH.toFixed(1) + '" fill="#f3e6d2"></rect>';
    }
    const radius = selected ? 6 : 3.6;
    if (point.partial || selected) {
      dots += '<circle cx="' + x.toFixed(1) + '" cy="' + yOf(point.value).toFixed(1) + '" r="' + radius + '" fill="#fffaf3" stroke="' + color + '" stroke-width="2.4"></circle>';
    } else {
      dots += '<circle cx="' + x.toFixed(1) + '" cy="' + yOf(point.value).toFixed(1) + '" r="' + radius + '" fill="' + color + '"></circle>';
    }
    const prev = index > 0 ? points[index - 1].date : "";
    const label = !prev || parts(prev).m !== parts(point.date).m ? shortDate(point.date) : String(parts(point.date).d);
    labels += '<text x="' + x.toFixed(1) + '" y="' + (height - 8) + '" text-anchor="middle" font-size="10" fill="#5e5346">' + esc(label) + "</text>";
    const title = dateLabel(point.date) + " · " + spec.formatValue(point.value) + (spec.unit ? " " + spec.unit : "") + (point.partial ? " · 進行中" : "");
    hits += '<rect class="hit" data-chart-date="' + esc(point.date) + '" x="' + (pad.l + slot * index).toFixed(1) + '" y="' + pad.t + '" width="' + slot.toFixed(1) + '" height="' + (innerH + 20).toFixed(1) + '" fill="transparent" tabindex="-1"><title>' + esc(title) + "</title></rect>";
  });

  return (
    '<svg viewBox="0 0 ' + width + " " + height + '" aria-hidden="true" focusable="false">' +
      slots +
      '<line x1="' + pad.l + '" x2="' + (width - pad.r) + '" y1="' + yOf(0).toFixed(1) + '" y2="' + yOf(0).toFixed(1) + '" stroke="#eadfce" stroke-width="1"></line>' +
      quotaMark +
      '<path d="' + area + '" fill="' + color + '" fill-opacity="0.14"></path>' +
      '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></path>' +
      dots +
      labels +
      hits +
    "</svg>"
  );
}

function chartFigure(points, spec) {
  const caption = spec.quota == null
    ? "未設目標線"
    : "虛線 = " + spec.lineWord + " " + spec.formatValue(spec.quota) + (spec.unit ? " " + spec.unit : "");
  return (
    '<figure class="chart">' +
      "<figcaption>" +
        "<h3>" + esc(spec.label) + "</h3>" +
        '<p class="chart-quota">' + esc(caption) + "</p>" +
      "</figcaption>" +
      chartSvg(points, spec) +
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
  const charts = nutritionChartMetrics().map((metric) => chartFigure(nutritionPoints(metric), nutritionSpec(metric))).join("");

  return (
    '<section class="card" aria-labelledby="trend-heading">' +
      '<h2 id="trend-heading">近 ' + days.length + " 日營養走勢</h2>" +
      '<p class="section-sub">' + esc(range) + "。每項對住上限、目標或者配額。空心點係進行中。撳圖可以睇返當日。</p>" +
      '<div class="chips">' +
        chip(stats.protein, stats.n, "蛋白達標", "good") +
        chip(stats.sugar, stats.n, "糖超上限", "bad") +
        chip(stats.sodium, stats.n, "鈉超上限", "bad") +
        chip(stats.kcal, stats.n, "熱量貼近", "good") +
      "</div>" +
      '<p class="fine">小結只計 ' + stats.n + " 個完整日，未計進行中。</p>" +
      '<div class="chart-list">' + charts + "</div>" +
    "</section>"
  );
}

function fitnessTrends() {
  const rows = fitnessSorted();
  const specs = fitnessChartSpecs();
  if (!rows.length || !specs.length) return "";
  const charts = specs.map((spec) => chartFigure(fitnessPoints(spec.key), spec)).join("");
  const range = dateLabel(rows[0].date) + "至" + dateLabel(rows[rows.length - 1].date);
  return (
    '<div class="trend-block">' +
      "<h3>活動走勢</h3>" +
      '<p class="section-sub">' + esc(range) + "，只畫有紀錄嘅日子。活動、運動、站立有目標線；步數同公里未設目標。</p>" +
      '<div class="chart-list">' + charts + "</div>" +
    "</div>"
  );
}

function cell(day, metric) {
  if (!Object.prototype.hasOwnProperty.call(day, metric.key)) return '<td class="num">—</td>';
  const quota = snapshot.quotas[metric.quotaKey];
  const value = day[metric.key];
  const status = classify(metric.key, value, quota, !!day.partial);
  const mark = markFor(status.tone);
  const markHtml = mark ? '<span class="flag" aria-hidden="true">' + mark + "</span>" : "";
  return (
    '<td class="num tone-' + status.tone + '" title="' + esc(status.label + " " + pctText(value, quota)) + '">' +
      fmtInt(value) + markHtml +
      '<span class="visually-hidden">，' + esc(status.label) + "</span>" +
    "</td>"
  );
}

function daysTable() {
  const metrics = METRICS.filter((metric) => daysSorted().some((day) => Object.prototype.hasOwnProperty.call(day, metric.key)));
  const head = metrics.map((metric) => (
    '<th scope="col">' + esc(metric.label) + '<span class="unit">' + esc(metric.unit) + "</span></th>"
  )).join("");
  const rows = [...daysSorted()].reverse().map((day) => {
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
    '<section class="card" aria-labelledby="days-heading">' +
      '<h2 id="days-heading">每日數字</h2>' +
      '<p class="section-sub">最新喺上面。超 = 明顯超標，近 = 接近或者略超，低 = 目標未夠。</p>' +
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
      '<circle cx="60" cy="60" r="' + radius + '" fill="none" stroke="#efe4d4" stroke-width="11"></circle>' +
      arc +
      '<text x="60" y="66" text-anchor="middle" font-size="16" font-weight="700" fill="#241c14" font-family="Georgia, serif">' + esc(pctText(value, goal)) + "</text>" +
    "</svg>"
  );
}

function fitnessCard() {
  const rows = fitnessSorted();
  if (!rows.length) {
    return '<section class="card" id="fitness-card"><h2>活動</h2><p>未有活動紀錄。</p></section>';
  }
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

  const headGoals = RING_META.map((meta) => (
    '<th scope="col">' + esc(meta.label) + '<span class="subhead">/ ' + esc(fmtInt(goals[meta.goalKey])) + "</span></th>"
  )).join("");
  const body = [...rows].reverse().map((item) => {
    const on = item.date === row.date;
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
    '<section class="card" id="fitness-card" aria-labelledby="fit-heading">' +
      '<h2 id="fit-heading">活動</h2>' +
      '<p class="section-sub">' + esc(intro) + "</p>" +
      '<div class="rings">' + rings + "</div>" +
      '<div class="step-stats">' +
        "<div><b class=\"num\">" + fmtInt(row.steps) + '</b><span>步</span></div>' +
        "<div><b class=\"num\">" + fmtKm(row.km) + "</b><span>公里</span></div>" +
      "</div>" +
      '<p class="fine">有紀錄 ' + rows.length + " 日，平均 " + fmtInt(avgSteps) + " 步、" + fmtKm(avgKm) + " 公里。目標：活動 " + fmtInt(goals.move) + " kcal、運動 " + fmtInt(goals.exercise) + " 分鐘、站立 " + fmtInt(goals.stand) + " 小時。</p>" +
      missingFit +
      missingMeal +
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
  const day = currentDay();
  return nowBar(day) + dayCard(day) + chartsCard() + daysTable() + fitnessCard();
}

function render(options) {
  const settings = options || {};
  const app = document.querySelector("#app");
  const scrollY = window.scrollY;
  app.innerHTML = view();
  document.title = pageTitle(currentDay());
  if (settings.restoreDate) {
    const scope = settings.restoreScope === "fitness" ? "fitness" : "days";
    const safeDate = window.CSS && CSS.escape ? CSS.escape(settings.restoreDate) : settings.restoreDate;
    const button = app.querySelector("table." + scope + ' tr[data-select="' + safeDate + '"] button');
    if (button) button.focus();
    return;
  }
  window.scrollTo(0, scrollY);
}

function announce(day) {
  const live = document.querySelector("#live");
  if (!live || !day) return;
  const prefix = day.date === latestDate() ? "今日" : dateLabel(day.date);
  live.textContent = prefix + "。" + coachNote(day);
}

function choose(date, source, scope) {
  if (!daysSorted().some((day) => day.date === date)) return;
  if (date === selectedDate) return;
  selectedDate = date;
  const url = new URL(window.location.href);
  url.hash = date === latestDate() ? "" : date;
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  render({
    restoreDate: source === "keyboard" ? date : null,
    restoreScope: scope || "days",
  });
  announce(currentDay());
}

function onAppClick(event) {
  const latest = event.target.closest("[data-go-latest]");
  if (latest) {
    choose(latestDate(), "button");
    return;
  }
  const chart = event.target.closest("[data-chart-date]");
  if (chart) {
    choose(chart.getAttribute("data-chart-date"), "chart");
    return;
  }
  const row = event.target.closest("tr[data-select]");
  if (row) {
    const table = row.closest("table");
    const scope = table && table.classList.contains("fitness") ? "fitness" : "days";
    choose(row.getAttribute("data-select"), event.detail === 0 ? "keyboard" : "row", scope);
  }
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

function applyHash() {
  const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
  const days = daysSorted();
  const date = days.some((day) => day.date === hash) ? hash : latestDate();
  if (!date || date === selectedDate) return false;
  selectedDate = date;
  return true;
}

function init() {
  const app = document.querySelector("#app");
  app.addEventListener("click", onAppClick);
  window.addEventListener("hashchange", () => {
    if (!snapshot) return;
    if (applyHash()) {
      render();
      announce(currentDay());
    }
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
      if (!applyHash()) selectedDate = latestDate();
      const updated = document.querySelector("#updated");
      if (updated && snapshot.updatedAt) updated.textContent = "更新 " + formatUpdated(snapshot.updatedAt);
      render();
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
    ["sugar", 16, 30, true, "good", "未到上限"],
    ["sugar", 32, 30, false, "warn", "超少少"],
    ["sugar", 48, 30, false, "bad", "超標"],
    ["sodium", 2006, 2000, false, "warn", "超少少"],
    ["sodium", 1900, 2000, false, "warn", "接近上限"],
    ["sodium", 1642, 2000, false, "good", "未到上限"],
    ["sodium", 2750, 2000, false, "bad", "超標"],
    ["protein", 23, 135, true, "progress", "進行中"],
    ["protein", 89, 135, false, "soft", "未夠"],
    ["protein", 121, 135, false, "soft", "差少少"],
    ["protein", 115, 135, false, "soft", "差少少"],
    ["protein", 136, 135, false, "good", "達標"],
    ["fiber", 27, 28, false, "good", "就快達標"],
    ["fiber", 28, 28, false, "good", "達標"],
    ["fiber", 17, 28, false, "soft", "未夠"],
    ["fiber", 23, 28, false, "soft", "差少少"],
    ["kcal", 457, 1950, true, "progress", "進行中"],
    ["kcal", 1825, 1950, false, "good", "貼近目標"],
    ["kcal", 2080, 1950, false, "good", "貼近目標"],
    ["kcal", 2210, 1950, false, "warn", "高少少"],
    ["kcal", 2530, 1950, false, "bad", "超標"],
    ["carbs", 220, 190, false, "warn", "高少少"],
    ["carbs", 168, 190, false, "soft", "低少少"],
    ["carbs", 228, 190, false, "warn", "高少少"],
    ["carbs", 34, 190, true, "progress", "進行中"],
  ];
  cases.forEach((item) => {
    const status = classify(item[0], item[1], item[2], item[3]);
    expect(status.tone === item[4] && status.label === item[5], item.join(" ") + " -> " + status.tone + " " + status.label);
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
  expect(todayNote.includes("未完") && todayNote.includes("16"), todayNote);
  selectedDate = "2026-10-14";
  const highNote = coachNote(currentDay());
  expect(highNote.includes("130%") && highNote.includes("蛋白達標") && highNote.includes("2,750"), highNote);
  selectedDate = "2026-10-12";
  const midNote = coachNote(currentDay());
  expect(midNote.includes("差 14 g") && midNote.includes("接近上限") && midNote.includes("差 11 g"), midNote);
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
  const sugarSvg = chartSvg(nutritionPoints(metricByKey("sugar")), nutritionSpec(metricByKey("sugar")));
  expect(sugarSvg.includes(">30</text>") && sugarSvg.includes("stroke-dasharray"), "sugar cap line");
  expect(sugarSvg.includes("2026-10-19"), "partial day stays on the sugar chart");
  const stepsSvg = chartSvg(fitnessPoints("steps"), specs.find((spec) => spec.key === "steps"));
  expect(!stepsSvg.includes("stroke-dasharray"), "steps chart has no goal line");
  expect((stepsSvg.match(/data-chart-date/g) || []).length === 8, "fitness dates only");
  expect(!stepsSvg.includes("2026-10-13") && !stepsSvg.includes("2026-10-19"), "no invented fitness days");
  const moveSvg = chartSvg(fitnessPoints("move"), specs.find((spec) => spec.key === "move"));
  expect(moveSvg.includes(">360</text>"), "move goal line");
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
