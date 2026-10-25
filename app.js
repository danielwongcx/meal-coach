/* Meal Coach dashboard. Replace data.json and reload. No build step. */

"use strict";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

const METRICS = [
  { key: "kcal", quotaKey: "kcal", label: "熱量", unit: "kcal", kind: "balance" },
  { key: "protein", quotaKey: "protein_g", label: "蛋白", unit: "g", kind: "target" },
  { key: "carbs", quotaKey: "carbs_g", label: "碳水", unit: "g", kind: "balance" },
  { key: "sugar", quotaKey: "sugar_g", label: "糖", unit: "g", kind: "cap" },
  { key: "added_sugar", quotaKey: "added_sugar_g", label: "添加糖", unit: "g", kind: "cap" },
  { key: "fiber", quotaKey: "fiber_g", label: "纖維", unit: "g", kind: "target" },
  { key: "sodium", quotaKey: "sodium_mg", label: "鈉", unit: "mg", kind: "cap" },
  { key: "water_ml", quotaKey: "water_ml", label: "飲水", unit: "ml", kind: "target" },
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

const VIEWS = ["today", "trends", "fitness", "advice"];
const NUTRITION_PILL_ORDER = ["kcal", "protein", "fat", "carbs", "fiber", "sodium", "sugar"];
const NUTRITION_PILL_LABEL = {
  kcal: "熱量",
  protein: "蛋白質",
  fat: "脂肪",
  carbs: "碳水",
  fiber: "膳食纖維",
  sodium: "鈉",
  sugar: "糖分",
};

let snapshot = null;
let selectedDate = "";
let activeView = "today";
let nutritionKey = "kcal";
let fitnessKey = "move";
let fitnessExpanded = false;
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

function quotaNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
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
  return METRICS.filter((metric) => {
    if (!day || typeof day[metric.key] !== "number" || !Number.isFinite(day[metric.key])) return false;
    return snapshot.quotas[metric.quotaKey] != null;
  });
}

function calloutItems(day) {
  const items = [];
  visibleMetrics(day).forEach((metric) => {
    const quota = quotaNumber(snapshot.quotas[metric.quotaKey]);
    if (quota == null) return;
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
    added: days.filter((day) => {
      const cap = quotaNumber(quotas.added_sugar_g);
      return cap != null && Number.isFinite(day.added_sugar) && day.added_sugar > cap;
    }).length,
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
    quota: quotaNumber(snapshot.quotas[metric.quotaKey]),
    unit: metric.unit,
    kind: metric.kind,
    formatValue: fmtInt,
    partialAware: true,
  });
}

function nutritionChartMetrics() {
  const present = new Set();
  daysSorted().forEach((day) => {
    NUTRITION_CHART_ORDER.forEach((key) => {
      if (typeof day[key] === "number" && Number.isFinite(day[key])) present.add(key);
    });
  });
  return NUTRITION_CHART_ORDER.filter((key) => present.has(key)).map((key) => metricByKey(key) || {
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
    const quota = quotaNumber(snapshot.quotas[metric.quotaKey]);
    const value = Number(day[metric.key]);
    if (quota == null) {
      const note = typeof snapshot.quotas[metric.quotaKey] === "string"
        ? snapshot.quotas[metric.quotaKey]
        : "未設數字上限";
      return (
        '<div class="metric">' +
          '<div class="metric-top">' +
            '<span class="metric-label">' + esc(metric.label) + "</span>" +
            '<span class="metric-value num">' + esc(fmtInt(value) + " " + metric.unit) + "</span>" +
          "</div>" +
          '<p class="metric-note fine">' + esc(note) + "</p>" +
        "</div>"
      );
    }
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
          '<span class="fill tone-' + status.tone + over + '" style="--fill:' + width + '%"></span>' +
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

function macroHtml(day, key) {
  const metric = metricByKey(key);
  if (!metric || !day || typeof day[key] !== "number" || !Number.isFinite(day[key])) return "";
  const quota = quotaNumber(snapshot.quotas[metric.quotaKey]);
  if (quota == null) return "";
  const value = Number(day[key]);
  const status = classify(key, value, quota);
  const width = fillPct(value, quota).toFixed(1);
  const over = value > quota ? " is-over" : "";
  const percent = pctText(value, quota);
  const valueText = fmtInt(value) + " / " + fmtInt(quota) + " " + metric.unit;
  const described = metric.label + " " + valueText + "，" + percent + "，" + status.label;
  return (
    '<div class="macro">' +
      '<span class="macro-label">' + esc(metric.label) + "</span>" +
      '<span class="macro-value num">' + esc(fmtInt(value)) + '<span class="macro-unit">' + esc(metric.unit) + "</span></span>" +
      '<div class="track track-compact" role="meter" aria-valuemin="0" aria-valuemax="' + esc(quota) + '" aria-valuenow="' + esc(value) + '" aria-valuetext="' + esc(described) + '">' +
        '<span class="fill tone-' + status.tone + over + '" style="--fill:' + width + '%"></span>' +
      "</div>" +
    "</div>"
  );
}

function miniHtml(day, key, label) {
  const metric = metricByKey(key);
  if (!metric || !day || typeof day[key] !== "number" || !Number.isFinite(day[key])) return "";
  const quota = quotaNumber(snapshot.quotas[metric.quotaKey]);
  const value = Number(day[key]);
  const shown = label || metric.label;
  if (quota == null) {
    const note = typeof snapshot.quotas[metric.quotaKey] === "string" ? snapshot.quotas[metric.quotaKey] : "";
    const short = note.indexOf("不設上限") !== -1 ? "天然" : (note || "未設上限");
    return (
      '<div class="mini-metric">' +
        '<div class="mini-top"><span>' + esc(shown) + '</span><span class="badge">' + esc(short) + "</span></div>" +
        '<p class="mini-value num">' + esc(fmtInt(value) + " " + metric.unit) + "</p>" +
        (note ? '<p class="visually-hidden">' + esc(note) + "</p>" : "") +
      "</div>"
    );
  }
  const status = classify(key, value, quota);
  return (
    '<div class="mini-metric">' +
      '<div class="mini-top"><span>' + esc(shown) + "</span>" + badgeHtml(status) + "</div>" +
      '<p class="mini-value num">' + esc(fmtInt(value)) + '<span class="mini-unit"> / ' + esc(fmtInt(quota) + " " + metric.unit) + "</span></p>" +
    "</div>"
  );
}

function daySlide(day) {
  const on = day.date === selectedDate;
  const kcalStatus = classify("kcal", day.kcal, snapshot.quotas.kcal);
  const banner = day.partial ? '<p class="banner">進行中</p>' : "";
  const macros = ["protein", "carbs", "fat"].map((key) => macroHtml(day, key)).filter(Boolean);
  const minis = [
    miniHtml(day, "fiber", "纖維"),
    miniHtml(day, "sugar", "糖"),
    miniHtml(day, "sodium", "鈉"),
    miniHtml(day, "added_sugar", "添加糖"),
  ].filter(Boolean);
  return (
    '<article class="day-slide' + (on ? " is-current" : "") + '" data-slide="' + esc(day.date) + '" aria-hidden="' + (on ? "false" : "true") + '">' +
      banner +
      '<div class="hero-card">' +
        '<p class="hero-line">' +
          '<span class="hero-value num tone-' + kcalStatus.tone + '">' + fmtInt(day.kcal) + "</span>" +
          '<span class="hero-unit">kcal</span>' +
          badgeHtml(kcalStatus) +
        "</p>" +
        '<p class="hero-sub num">' + esc(heroSub(day)) + "</p>" +
      "</div>" +
      (macros.length ? '<div class="macro-row cols-' + macros.length + '">' + macros.join("") + "</div>" : "") +
      (minis.length ? '<div class="mini-grid">' + minis.join("") + "</div>" : "") +
    "</article>"
  );
}

const MEAL_FIELDS = [
  { key: "kcal", label: "", unit: "kcal" },
  { key: "carbs", label: "碳水", unit: "g" },
  { key: "sugar", label: "糖", unit: "g" },
  { key: "added_sugar", label: "添加糖", unit: "g" },
  { key: "fiber", label: "纖維", unit: "g" },
  { key: "protein", label: "蛋白", unit: "g" },
  { key: "fat", label: "脂肪", unit: "g" },
  { key: "sodium", label: "鈉", unit: "mg" },
];

function dayMeals(day) {
  if (!day || !Array.isArray(day.meals)) return [];
  return day.meals.filter((entry) => entry && entry.name);
}

function fmtAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const rounded = Math.round(number * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function mealMacroText(entry) {
  return MEAL_FIELDS.map((field) => {
    if (!entry || !Object.prototype.hasOwnProperty.call(entry, field.key)) return "";
    const text = fmtAmount(entry[field.key]);
    if (!text) return "";
    return (field.label ? field.label + " " : "") + text + " " + field.unit;
  }).filter(Boolean).join(" · ");
}

function mealMetaText(entry) {
  return [entry.time, entry.place].filter(Boolean).join(" · ");
}

const MED_LABELS = {
  xeloda_am: "Xeloda 早",
  xeloda_pm: "Xeloda 晚",
  lyrica_25mg: "Lyrica 25 mg",
  vitamin_b6_50mg: "維他命 B6 50 mg",
  ursofalk_heptral: "Ursofalk／Heptral",
  neuropathy_level_1_to_10: "麻痺",
  forehead_rash: "額頭",
  sleep_quality: "睡眠",
};

function trackHtml(day) {
  if (!day) return "";
  const items = [];
  const meds = day.meds_and_symptoms;
  if (meds && typeof meds === "object") {
    Object.keys(meds).forEach((key) => {
      const value = meds[key];
      if (value == null || value === "") return;
      const label = MED_LABELS[key] || key;
      const text = key === "neuropathy_level_1_to_10" ? value + " / 10" : String(value);
      items.push(label + " " + text);
    });
  }
  const bowel = day.bowel;
  if (bowel && bowel.count != null && Number.isFinite(Number(bowel.count))) {
    const rawType = bowel.type == null ? "" : String(bowel.type);
    const type = rawType && rawType.indexOf("/") === -1 ? rawType : "";
    items.push("大便 " + bowel.count + " 次" + (type ? " · " + type : ""));
  }
  if (!items.length) return "";
  return (
    '<div class="track-block">' +
      '<h3 class="food-title">今日追蹤</h3>' +
      '<ul class="food-tips">' + items.map((item) => "<li>" + esc(item) + "</li>").join("") + "</ul>" +
    "</div>"
  );
}

function aiNoteHtml(note) {
  const text = String(note || "");
  if (!text) return "";
  if (text.length <= 28) return '<p class="meal-note">' + esc(text) + "</p>";
  return (
    '<div class="ai-note">' +
      '<details>' +
        '<summary>查看 AI 分析</summary>' +
        '<p class="ai-full">' + esc(text) + "</p>" +
      "</details>" +
      '<p class="ai-preview">' + esc(text) + "</p>" +
    "</div>"
  );
}

function mealCardHtml(entry) {
  const meal = entry.meal ? '<span class="meal-tag">' + esc(entry.meal) + "</span>" : "";
  const time = entry.time ? '<span class="meal-time num">' + esc(entry.time) + "</span>" : "";
  const kcalText = Object.prototype.hasOwnProperty.call(entry, "kcal") ? fmtAmount(entry.kcal) : "";
  const kcal = kcalText ? '<span class="meal-kcal num">' + esc(kcalText + " kcal") + "</span>" : "";
  const macros = MEAL_FIELDS.filter((field) => field.key !== "kcal").map((field) => {
    if (!Object.prototype.hasOwnProperty.call(entry, field.key)) return "";
    const text = fmtAmount(entry[field.key]);
    if (!text) return "";
    return (field.label ? field.label + " " : "") + text + " " + field.unit;
  }).filter(Boolean).join(" · ");
  const macroHtml = macros ? '<p class="meal-macros num">' + esc(macros) + "</p>" : "";
  return (
    '<li class="meal-card">' +
      '<div class="meal-head">' +
        meal +
        time +
        kcal +
        '<p class="meal-name">' + esc(entry.name) + "</p>" +
      "</div>" +
      macroHtml +
      aiNoteHtml(entry.note) +
    "</li>"
  );
}

function mealLogHtml(day) {
  const meals = dayMeals(day);
  const count = meals.length ? '<span class="meal-count num">' + meals.length + " 項</span>" : "";
  let body = '<p class="fine">未有逐項紀錄。</p>';
  if (meals.length) {
    const anyMacro = meals.some((entry) => MEAL_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(entry, field.key) && fmtAmount(entry[field.key])));
    const note = anyMacro ? "" : '<p class="fine">逐項營養未分開記，上面係當日總數。</p>';
    body = note + '<ul class="meal-list">' + meals.map(mealCardHtml).join("") + "</ul>";
  }
  return (
    '<div class="meal-log">' +
      '<div class="meal-log-head"><h3>餐次</h3>' + count + "</div>" +
      body +
      trackHtml(day) +
    "</div>"
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
      '<div class="today-body">' +
        '<div class="day-track" tabindex="0" aria-label="每日營養，左右滑睇其他日子">' +
          days.map(daySlide).join("") +
        "</div>" +
        '<div class="meals-col"><div id="meal-slot">' + mealLogHtml(day) + "</div></div>" +
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

function chartFigure(points, spec, stableId) {
  const id = stableId || ("chart-" + spec.key);
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

function nutritionSwitchMetrics() {
  const present = new Map(nutritionChartMetrics().map((metric) => [metric.key, metric]));
  return NUTRITION_PILL_ORDER.filter((key) => present.has(key)).map((key) => present.get(key));
}

function activeNutritionMetric() {
  const metrics = nutritionSwitchMetrics();
  const metric = metrics.find((item) => item.key === nutritionKey) || metrics[0];
  if (metric) nutritionKey = metric.key;
  return metric || null;
}

function chartSwitch(group, items, activeKey, points, spec) {
  const labelFor = group === "nutrition"
    ? (item) => NUTRITION_PILL_LABEL[item.key] || item.label
    : (item) => item.label;
  const pills = items.map((item) => {
    const on = item.key === activeKey;
    return (
      '<button type="button" class="filter-pill' + (on ? " is-on" : "") + '" role="tab" data-chart-group="' + group + '" data-chart-key="' + esc(item.key) + '" aria-selected="' + (on ? "true" : "false") + '" tabindex="' + (on ? "0" : "-1") + '">' +
        esc(labelFor(item)) +
      "</button>"
    );
  }).join("");
  return (
    '<div class="chart-switch" data-chart-group="' + group + '">' +
      '<div class="filter-pills" role="tablist" aria-label="' + (group === "nutrition" ? "營養指標" : "活動指標") + '">' + pills + "</div>" +
      chartFigure(points, spec, "chart-" + group) +
    "</div>"
  );
}

function chartsCard() {
  const days = trendDays();
  const stats = chipStats();
  const first = days[0];
  const last = days[days.length - 1];
  const range = first ? dateLabel(first.date) + "至" + dateLabel(last.date) : "";
  const metric = activeNutritionMetric();
  const chartsHtml = metric
    ? chartSwitch("nutrition", nutritionSwitchMetrics(), metric.key, nutritionPoints(metric), nutritionSpec(metric))
    : '<p class="fine">未有走勢。</p>';
  return (
    '<section class="card" id="trends" aria-labelledby="trend-heading">' +
      '<div class="section-head">' +
        '<h2 id="trend-heading">近 ' + days.length + " 日營養走勢</h2>" +
        '<button type="button" class="text-btn" data-open-days>每日數字</button>' +
      "</div>" +
      '<p class="section-sub">' + esc(range) + "。空心點係進行中。撳圖可以睇返當日。</p>" +
      '<div class="chips">' +
        chip(stats.protein, stats.n, "蛋白達標", "good") +
        chip(stats.added, stats.n, "添加糖超上限", "bad") +
        chip(stats.sodium, stats.n, "鈉超上限", "bad") +
        chip(stats.kcal, stats.n, "熱量貼近", "good") +
      "</div>" +
      '<p class="fine">小結只計 ' + stats.n + " 個完整日，未計進行中。</p>" +
      chartsHtml +
    "</section>"
  );
}

function activeFitnessSpec() {
  const specs = fitnessChartSpecs();
  const spec = specs.find((item) => item.key === fitnessKey) || specs[0];
  if (spec) fitnessKey = spec.key;
  return spec || null;
}

function fitnessTrends() {
  const rows = fitnessSorted();
  const specs = fitnessChartSpecs();
  const spec = activeFitnessSpec();
  if (!rows.length || !spec) return "";
  const range = dateLabel(rows[0].date) + "至" + dateLabel(rows[rows.length - 1].date);
  return (
    '<div class="trend-block">' +
      "<h3>活動走勢</h3>" +
      '<p class="section-sub">' + esc(range) + "。只畫有紀錄嘅日子。步數同公里未設目標。</p>" +
      chartSwitch("fitness", specs, spec.key, fitnessPoints(spec.key), spec) +
    "</div>"
  );
}

function cell(day, metric) {
  if (typeof day[metric.key] !== "number" || !Number.isFinite(day[metric.key])) return '<td class="num">—</td>';
  const quota = quotaNumber(snapshot.quotas[metric.quotaKey]);
  const value = day[metric.key];
  if (quota == null) return '<td class="num">' + fmtInt(value) + "</td>";
  const status = classify(metric.key, value, quota);
  return (
    '<td class="num tone-' + status.tone + '">' +
      fmtInt(value) +
      '<span class="flag" aria-hidden="true">' + status.emoji + esc(status.mark) + "</span>" +
      '<span class="visually-hidden">，' + esc(status.label) + "</span>" +
    "</td>"
  );
}

function daysTableBody() {
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
    '<div class="scroll">' +
      '<table class="sheet days">' +
        "<thead><tr><th scope=\"col\">日期</th>" + head + "</tr></thead>" +
        "<tbody>" + rows + "</tbody>" +
      "</table>" +
    "</div>"
  );
}

function daysModal() {
  return (
    '<div class="day-modal" id="days-modal" hidden>' +
      '<button type="button" class="day-modal-backdrop" data-close-days aria-label="關閉每日數字"></button>' +
      '<div class="day-modal-panel" role="dialog" aria-modal="true" aria-labelledby="days-heading">' +
        '<div class="day-modal-head">' +
          '<h2 id="days-heading">每日數字</h2>' +
          '<button type="button" class="day-modal-close" data-close-days aria-label="關閉">×</button>' +
        "</div>" +
        '<p class="legend-line" aria-hidden="true">🔴超 · 🟡近 · 🟢低 · 🟢好</p>' +
        '<p class="scroll-hint">左右滑可以睇晒欄。撳日期可以睇返當日。</p>' +
        daysTableBody() +
      "</div>" +
    "</div>"
  );
}

function ringRatio(value, goal) {
  const cap = Number(goal);
  const raw = cap ? Number(value) / cap : 0;
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

function ringFrame(ratio, eased) {
  const current = Math.max(0, Number(ratio) || 0) * Math.min(1, Math.max(0, Number(eased) || 0));
  return {
    current: current,
    base: Math.min(1, current),
    over: Math.min(1, Math.max(0, current - 1)),
  };
}

function lightenHex(hex, amount) {
  const raw = String(hex).replace("#", "");
  const num = parseInt(raw, 16);
  if (!Number.isFinite(num) || raw.length < 6) return hex;
  const mix = (channel) => Math.round(channel + (255 - channel) * amount);
  const parts = [mix((num >> 16) & 255), mix((num >> 8) & 255), mix(num & 255)];
  return "#" + parts.map((part) => part.toString(16).padStart(2, "0")).join("");
}

function ringSvg(value, goal, color) {
  const radius = 40;
  const circ = (2 * Math.PI * radius).toFixed(2);
  const ratio = ringRatio(value, goal);
  const label = pctText(value, goal);
  const base = (Math.min(1, ratio) * Number(circ)).toFixed(2);
  const extra = (Math.min(1, Math.max(0, ratio - 1)) * Number(circ)).toFixed(2);
  const over = ratio > 1
    ? '<circle class="ring-over" cx="60" cy="60" r="' + radius + '" stroke="' + lightenHex(color, 0.42) + '" stroke-width="11" data-circ="' + circ + '" style="--ring-final:' + extra + " " + circ + '" transform="rotate(-90 60 60)"></circle>'
    : "";
  return (
    '<svg class="ring-svg" viewBox="0 0 120 120" aria-hidden="true">' +
      '<circle class="ring-track" cx="60" cy="60" r="' + radius + '" stroke-width="11"></circle>' +
      '<circle class="ring-arc" cx="60" cy="60" r="' + radius + '" stroke="' + color + '" stroke-width="11" data-circ="' + circ + '" style="--ring-final:' + base + " " + circ + '" transform="rotate(-90 60 60)"></circle>' +
      over +
      '<text class="ring-label" x="60" y="66" text-anchor="middle" font-size="16" font-weight="700" font-family="Georgia, serif" data-label="' + esc(label) + '">' + esc(label) + "</text>" +
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
      '<figure class="ring" data-ratio="' + ringRatio(value, goal).toFixed(4) + '">' +
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

function fitnessBody(rows) {
  const goals = snapshot.fitnessGoals;
  const shown = shownFitness();
  const ordered = [...rows].reverse();
  const visible = fitnessExpanded ? ordered : ordered.slice(0, 5);
  return visible.map((item) => {
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
}

function fitnessMoreButton(total) {
  if (total <= 5) return "";
  const label = fitnessExpanded ? "只顯示最近 5" : "顯示全部 (" + total + ")";
  return '<button type="button" class="text-btn fitness-more" data-fitness-more aria-expanded="' + (fitnessExpanded ? "true" : "false") + '">' + label + "</button>";
}

function fitnessCard() {
  const rows = fitnessSorted();
  if (!rows.length) {
    return '<section class="card reveal" id="fitness"><h2>運動</h2><p>未有活動紀錄。</p></section>';
  }
  const goals = snapshot.fitnessGoals;
  const headGoals = RING_META.map((meta) => (
    '<th scope="col">' + esc(meta.label) + '<span class="subhead">/ ' + esc(fmtInt(goals[meta.goalKey])) + "</span></th>"
  )).join("");

  return (
    '<section class="card" id="fitness" aria-labelledby="fit-heading">' +
      '<h2 id="fit-heading">運動</h2>' +
      '<div class="exercise-split">' +
        '<div id="fitness-live" class="reveal exercise-live">' + fitnessLiveHtml() + "</div>" +
        fitnessTrends() +
        '<div class="exercise-log">' +
          '<div class="table-head"><h3>活動紀錄</h3>' + fitnessMoreButton(rows.length) + "</div>" +
          '<p class="scroll-hint">左右滑可以睇晒欄。</p>' +
          '<div class="scroll">' +
            '<table class="sheet fitness">' +
              "<thead><tr><th scope=\"col\">日期</th>" + headGoals + '<th scope="col">步數</th><th scope="col">公里</th></tr></thead>' +
              "<tbody>" + fitnessBody(rows) + "</tbody>" +
            "</table>" +
          "</div>" +
        "</div>" +
      "</div>" +
    "</section>"
  );
}

function adviceLists() {
  const block = snapshot.advice || snapshot.comments || {};
  return {
    eating: Array.isArray(block.eating) ? block.eating : [],
    meds: Array.isArray(block.meds_safety) ? block.meds_safety : [],
  };
}

function listHtml(items) {
  if (!items.length) return '<p class="fine">未有文字。</p>';
  return '<ul class="advice-list">' + items.map((item) => "<li>" + esc(item) + "</li>").join("") + "</ul>";
}

function iconSvg(path) {
  return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="' + path + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
}

const CARD_ICONS = {
  alert: "M12 9v4M12 17h.01M10.3 4.8 2.8 18a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.8a2 2 0 0 0-3.4 0Z",
  fork: "M8 3v7M6 3v8a2 2 0 0 0 2 2v8M10 3v7M17 3v8c0 1.2-.8 2-2 2v8M15 3c0 3 2 4 2 7",
  shield: "M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z",
  leaf: "M5 19c8 0 14-8 14-14-6 0-14 6-14 14Z",
  plate: "M4 11h16M7 11a5 5 0 0 1 10 0M12 16v4",
};

function priorityTag(level) {
  const label = level === "high" ? "高" : level === "mid" ? "中" : "低";
  return '<span class="priority priority-' + level + '">' + label + "</span>";
}

function checkItems(items) {
  if (!items.length) return '<p class="fine">未有文字。</p>';
  return (
    '<ul class="check-list">' +
      items.map((item) => '<li><span class="check-mark" aria-hidden="true"></span><span>' + item + "</span></li>").join("") +
    "</ul>"
  );
}

function checkCard(options) {
  const body = options.html != null ? options.html : checkItems(options.items || []);
  return (
    '<article class="check-card"' + (options.id ? ' id="' + esc(options.id) + '"' : "") + ">" +
      '<div class="check-card-top">' +
        '<span class="check-icon" aria-hidden="true">' + options.icon + "</span>" +
        "<h3>" + esc(options.title) + "</h3>" +
        priorityTag(options.priority || "low") +
      "</div>" +
      body +
    "</article>"
  );
}

function adviceLiveHtml(day) {
  const items = calloutItems(day);
  const high = items.some((item) => item.status.mark === "超");
  const priority = !items.length ? "low" : high ? "high" : "mid";
  const head = '<p class="gap-date">' + esc(dateLabel(day.date)) + (day.partial ? " · 進行中" : "") + "</p>";
  const html = !items.length
    ? head + "<p>呢日未見明顯超標，亦未見要追嘅目標。</p>"
    : head + '<ul class="check-list">' + items.map((item) => (
      '<li><span class="check-mark" aria-hidden="true"></span><span>' +
        badgeHtml(item.status) + " " + esc(item.metric.label) + " " + fmtInt(item.value) + " / " + fmtInt(item.quota) + " " + esc(item.metric.unit) +
      "</span></li>"
    )).join("") + "</ul>";
  return checkCard({
    title: "今日要注意",
    icon: iconSvg(CARD_ICONS.alert),
    priority: priority,
    html: html,
  });
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
  const caution = foodItems("caution");
  const tips = foodItems("tips");
  if (!protein.length && !fiber.length && !caution.length) return "";
  const quotas = snapshot.quotas || {};
  const tipHtml = tips.length
    ? '<ul class="food-tips">' + tips.map((item) => "<li>" + esc(item) + "</li>").join("") + "</ul>"
    : "";
  const added = quotaNumber(quotas.added_sugar_g);
  const water = quotaNumber(quotas.water_ml);
  const sub = "蛋白 " + fmtInt(quotas.protein_g) + " g · 纖維 " + fmtInt(quotas.fiber_g) + " g" +
    (added == null ? "" : " · 添加糖上限 " + fmtInt(added) + " g") +
    (water == null ? "" : " · 飲水 " + fmtInt(water) + " ml") +
    "。總糖係天然果糖，不設上限。";
  return (
    '<section class="card reveal" id="foods" aria-labelledby="foods-heading">' +
      '<h2 id="foods-heading">補數</h2>' +
      '<p class="section-sub">' + esc(sub) + "</p>" +
      '<div class="food-grid">' +
        foodGroup("🍗蛋白", protein) +
        foodGroup("🌿纖維", fiber) +
        foodGroup("少食／慎選", caution) +
      "</div>" +
      tipHtml +
    "</section>"
  );
}

function adviceSection() {
  const copy = adviceLists();
  const day = currentDay();
  const caution = foodItems("caution");
  const protein = foodItems("protein");
  const fiber = foodItems("fiber");
  const tips = foodItems("tips");
  const cards = [
    '<div id="advice-live">' + adviceLiveHtml(day) + "</div>",
    checkCard({ title: "飲食", icon: iconSvg(CARD_ICONS.fork), priority: "low", items: copy.eating.map(esc) }),
    checkCard({ title: "用藥", icon: iconSvg(CARD_ICONS.shield), priority: "high", items: copy.meds.map(esc) }),
    caution.length ? checkCard({ title: "少食／慎選", icon: iconSvg(CARD_ICONS.alert), priority: "mid", items: caution.map(esc) }) : "",
    protein.length ? checkCard({ id: "foods", title: "補蛋白", icon: iconSvg(CARD_ICONS.plate), priority: "mid", items: protein.map(esc) }) : "",
    fiber.length ? checkCard({ title: "補纖維", icon: iconSvg(CARD_ICONS.leaf), priority: "mid", items: fiber.map(esc) }) : "",
  ].filter(Boolean).join("");
  const tipHtml = tips.length
    ? '<ul class="food-tips">' + tips.map((item) => "<li>" + esc(item) + "</li>").join("") + "</ul>"
    : "";
  return (
    '<section class="card reveal" id="advice" aria-labelledby="advice-heading">' +
      '<h2 id="advice-heading">建議</h2>' +
      '<p class="section-sub">先睇今日缺口，再睇可以點食。</p>' +
      '<div class="check-grid">' + cards + "</div>" +
      tipHtml +
      fatNote() +
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

function viewPanel(name, html) {
  const hidden = activeView === name ? "" : " hidden";
  return '<div class="view-panel" id="view-' + name + '" role="tabpanel" aria-labelledby="tab-' + name + '"' + hidden + ">" + html + "</div>";
}

function view() {
  pending = [];
  const day = currentDay();
  return (
    '<div id="now-slot">' + nowBar(day) + "</div>" +
    viewPanel("today", todaySection()) +
    viewPanel("trends", chartsCard()) +
    viewPanel("fitness", fitnessCard()) +
    viewPanel("advice", adviceSection()) +
    daysModal()
  );
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
  if (ringRaf) cancelAnimationFrame(ringRaf);
  ringRaf = 0;
  charts.forEach((entry) => {
    if (entry.raf) cancelAnimationFrame(entry.raf);
    if (entry.chart) entry.chart.destroy();
  });
  charts = [];
  if (revealObserver) revealObserver.disconnect();
  revealObserver = null;
}

const CHART_EASE = "easeInQuad";
const REVEAL_MS = 1100;

function revealEase(t) {
  const clamped = Math.min(1, Math.max(0, Number(t) || 0));
  const effects = typeof Chart !== "undefined" && Chart.helpers && Chart.helpers.easingEffects;
  const ease = effects && effects[CHART_EASE];
  return ease ? ease(clamped) : clamped * clamped;
}

function revealSlot(index, count) {
  const n = Math.max(Number(count) || 1, 1);
  const start = REVEAL_MS * Math.sqrt(Math.max(0, index) / n);
  const end = REVEAL_MS * Math.sqrt(Math.min(index + 1, n) / n);
  return { delay: start, duration: Math.max(end - start, 48) };
}

function chartAnimations(type, count) {
  const slot = (ctx) => revealSlot(ctx && ctx.index ? ctx.index : 0, count);
  if (type === "bar") {
    return {
      y: { duration: 0 },
      base: { duration: 0 },
      height: { duration: 0 },
      x: {
        type: "number",
        easing: CHART_EASE,
        duration: (ctx) => slot(ctx).duration,
        from(ctx) {
          if (!ctx || ctx.type !== "data") return undefined;
          const el = ctx.chart.getDatasetMeta(ctx.datasetIndex).data[ctx.index];
          const props = el.getProps(["x", "width"], true);
          return props.x - props.width / 2;
        },
        delay(ctx) {
          if (!ctx || ctx.type !== "data" || ctx.xStarted) return 0;
          ctx.xStarted = true;
          return slot(ctx).delay;
        },
      },
      width: {
        type: "number",
        easing: CHART_EASE,
        duration: (ctx) => Math.max(slot(ctx).duration, 160),
        from: 0,
        delay(ctx) {
          if (!ctx || ctx.type !== "data" || ctx.wStarted) return 0;
          ctx.wStarted = true;
          return slot(ctx).delay;
        },
      },
    };
  }
  const previousY = (ctx) => {
    if (!ctx || ctx.type !== "data" || ctx.index === 0) {
      return ctx.chart.scales.y.getPixelForValue(ctx.raw);
    }
    const prev = ctx.chart.getDatasetMeta(ctx.datasetIndex).data[ctx.index - 1];
    return prev.getProps(["y"], true).y;
  };
  return {
    x: {
      type: "number",
      easing: CHART_EASE,
      duration: (ctx) => slot(ctx).duration,
      from: NaN,
      delay(ctx) {
        if (!ctx || ctx.type !== "data" || ctx.xStarted) return 0;
        ctx.xStarted = true;
        return slot(ctx).delay;
      },
    },
    y: {
      type: "number",
      easing: CHART_EASE,
      duration: (ctx) => slot(ctx).duration,
      from: previousY,
      delay(ctx) {
        if (!ctx || ctx.type !== "data" || ctx.yStarted) return 0;
        ctx.yStarted = true;
        return slot(ctx).delay;
      },
    },
  };
}

const ltrRevealPlugin = {
  id: "ltrReveal",
  beforeDatasetsDraw(chart) {
    chart.$ltrClip = false;
    if (chart.$ltr == null) chart.$ltr = motionOK() ? 0 : 1;
    if (chart.$ltr >= 1) return;
    const area = chart.chartArea;
    if (!area) return;
    const ctx = chart.ctx;
    chart.$ltrClip = true;
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.left, area.top - 20, Math.max(0, (area.right - area.left) * chart.$ltr), area.bottom - area.top + 40);
    ctx.clip();
  },
  afterDatasetsDraw(chart) {
    if (!chart.$ltrClip) return;
    chart.ctx.restore();
    chart.$ltrClip = false;
  },
};

function registerLtrPlugin() {
  if (typeof Chart === "undefined" || registerLtrPlugin.done) return;
  Chart.register(ltrRevealPlugin);
  registerLtrPlugin.done = true;
}

function playChart(entry) {
  if (!entry || !entry.chart) return;
  if (entry.raf) cancelAnimationFrame(entry.raf);
  entry.raf = 0;
  const chart = entry.chart;
  if (!motionOK()) {
    chart.$ltr = 1;
    chart.draw();
    return;
  }
  const started = performance.now();
  chart.$ltr = 0;
  chart.draw();
  const frame = (now) => {
    const t = Math.min(1, (now - started) / REVEAL_MS);
    chart.$ltr = revealEase(t);
    chart.draw();
    if (t < 1) entry.raf = requestAnimationFrame(frame);
    else {
      chart.$ltr = 1;
      entry.raf = 0;
      chart.draw();
    }
  };
  entry.raf = requestAnimationFrame(frame);
}

function parkChart(entry) {
  if (!entry || !entry.chart) return;
  if (entry.raf) cancelAnimationFrame(entry.raf);
  entry.raf = 0;
  if (!motionOK()) return;
  entry.chart.$ltr = 0;
  entry.chart.draw();
}

function playTodayBars(section) {
  if (!section) return;
  const slides = section.querySelectorAll(".day-slide");
  if (!motionOK()) {
    section.classList.add("bars-play");
    section.querySelectorAll(".fill").forEach((el) => {
      el.style.transition = "none";
      el.style.width = el.style.getPropertyValue("--fill") || "0%";
    });
    return;
  }
  section.classList.remove("bars-play");
  slides.forEach((slide) => {
    slide.querySelectorAll(".fill").forEach((el) => {
      el.style.transition = "none";
      el.style.width = "0%";
    });
  });
  section.getBoundingClientRect();
  slides.forEach((slide) => {
    const bars = slide.querySelectorAll(".fill");
    const count = bars.length || 1;
    bars.forEach((el, index) => {
      const slot = revealSlot(index, count);
      el.style.transition = "width " + Math.max(slot.duration, 180) + "ms cubic-bezier(0.55, 0.085, 0.68, 0.53) " + slot.delay + "ms";
      el.style.width = el.style.getPropertyValue("--fill") || "0%";
    });
  });
  section.classList.add("bars-play");
}

function resetTodayBars(section) {
  if (!section || !motionOK()) return;
  section.classList.remove("bars-play");
  section.querySelectorAll(".fill").forEach((el) => {
    el.style.transition = "none";
    el.style.width = "0%";
  });
}

let ringRaf = 0;

function paintRing(el, portion) {
  if (!el) return;
  const circ = Number(el.dataset.circ) || 1;
  const drawn = Math.max(0, portion) * circ;
  el.style.strokeDasharray = drawn.toFixed(2) + " " + circ.toFixed(2);
  el.style.strokeLinecap = portion >= 0.999 ? "butt" : "round";
}

function applyRingFrame(eased) {
  document.querySelectorAll("#fitness .ring").forEach((ring) => {
    const frame = ringFrame(Number(ring.dataset.ratio) || 0, eased);
    paintRing(ring.querySelector(".ring-arc"), frame.base);
    paintRing(ring.querySelector(".ring-over"), frame.over);
    const label = ring.querySelector(".ring-label");
    if (!label) return;
    if (eased >= 1 && label.dataset.label) label.textContent = label.dataset.label;
    else label.textContent = Math.round(frame.current * 100) + "%";
  });
}

function playRings() {
  if (ringRaf) cancelAnimationFrame(ringRaf);
  ringRaf = 0;
  if (!document.querySelector("#fitness .ring")) return;
  if (!motionOK()) {
    applyRingFrame(1);
    return;
  }
  const started = performance.now();
  applyRingFrame(0);
  const frame = (now) => {
    const t = Math.min(1, (now - started) / REVEAL_MS);
    applyRingFrame(revealEase(t));
    if (t < 1) ringRaf = requestAnimationFrame(frame);
    else {
      applyRingFrame(1);
      ringRaf = 0;
    }
  };
  ringRaf = requestAnimationFrame(frame);
}

function resetRings() {
  if (ringRaf) cancelAnimationFrame(ringRaf);
  ringRaf = 0;
  if (!motionOK()) return;
  applyRingFrame(0);
}

function themeName() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function themeColors() {
  return {
    card: cssVar("--card", "#241e18"),
    muted: cssVar("--muted", "#d2c3b2"),
    line: cssVar("--line", "#3d342b"),
    ink: cssVar("--ink", "#f6efe6"),
    grid: cssVar("--grid", "rgba(246, 239, 230, 0.12)"),
  };
}

function chartSeriesColor(key) {
  return cssVar("--chart-" + key, CHART_COLOR[key] || "#f6efe6");
}

function areaFill(color) {
  return function (context) {
    const chart = context && context.chart;
    const area = chart && chart.chartArea;
    const light = themeName() === "light";
    const top = light ? 0.36 : 0.48;
    const mid = light ? 0.1 : 0.14;
    if (!area || !chart.ctx) return hexAlpha(color, top);
    const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    gradient.addColorStop(0, hexAlpha(color, top));
    gradient.addColorStop(0.62, hexAlpha(color, mid));
    gradient.addColorStop(1, hexAlpha(color, 0));
    return gradient;
  };
}

function paintChart(entry) {
  const colors = themeColors();
  const color = chartSeriesColor(entry.spec.key);
  const card = colors.card;
  const set = entry.chart.data.datasets[0];
  set.borderColor = color;
  set.backgroundColor = areaFill(color);
  set.pointBorderColor = color;
  set.pointRadius = entry.points.map((point) => (point.date === selectedDate ? 7 : point.partial ? 5 : 3.5));
  set.pointHoverRadius = entry.points.map((point) => (point.date === selectedDate ? 8 : 5));
  set.pointBackgroundColor = entry.points.map((point) => (point.partial || point.date === selectedDate ? card : color));
  set.pointBorderWidth = entry.points.map((point) => (point.date === selectedDate ? 3 : 2));
  if (entry.chart.data.datasets[1]) entry.chart.data.datasets[1].borderColor = colors.muted;
  const scales = entry.chart.options.scales;
  scales.x.ticks.color = colors.muted;
  scales.x.border.color = colors.line;
  scales.y.ticks.color = colors.muted;
  scales.y.grid.color = colors.grid;
  const tip = entry.chart.options.plugins.tooltip;
  tip.backgroundColor = colors.card;
  tip.titleColor = colors.ink;
  tip.bodyColor = colors.ink;
  tip.borderColor = colors.line;
}

function applyChartTheme() {
  charts.forEach((entry) => {
    paintChart(entry);
    entry.chart.update("none");
  });
}

function syncThemeButton() {
  const button = document.querySelector("#theme-toggle");
  if (!button) return;
  const dark = themeName() === "dark";
  button.setAttribute("aria-pressed", dark ? "true" : "false");
  button.setAttribute("aria-label", dark ? "轉做淺色" : "轉做深色");
}

function applyTheme(theme, persist) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  document.documentElement.style.colorScheme = next;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", next === "light" ? "#F7F4EF" : "#16130f");
  if (persist) {
    try {
      localStorage.setItem("meal-coach-theme", next);
    } catch (error) {
      /* private mode can block storage */
    }
  }
  syncThemeButton();
  applyChartTheme();
}

function bindTheme() {
  const button = document.querySelector("#theme-toggle");
  if (!button || button.dataset.bound) return;
  button.dataset.bound = "1";
  syncThemeButton();
  button.addEventListener("click", () => {
    applyTheme(themeName() === "dark" ? "light" : "dark", true);
  });
  if (!window.matchMedia) return;
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const onScheme = () => {
    let saved = "";
    try {
      saved = localStorage.getItem("meal-coach-theme") || "";
    } catch (error) {
      saved = "dark";
    }
    if (saved === "light" || saved === "dark") return;
    applyTheme(media.matches ? "light" : "dark", false);
  };
  if (media.addEventListener) media.addEventListener("change", onScheme);
  else if (media.addListener) media.addListener(onScheme);
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
  const colors = themeColors();
  const series = chartSeriesColor(spec.key);
  const datasets = [
    {
      data: points.map((point) => point.value),
      borderColor: series,
      backgroundColor: areaFill(series),
      fill: true,
      tension: 0.25,
      pointRadius: points.map((point) => (point.date === selectedDate ? 7 : point.partial ? 5 : 3.5)),
      pointHoverRadius: points.map((point) => (point.date === selectedDate ? 8 : 5)),
      pointBackgroundColor: points.map((point) => (point.partial || point.date === selectedDate ? colors.card : series)),
      pointBorderColor: series,
      pointBorderWidth: points.map((point) => (point.date === selectedDate ? 3 : 2)),
      borderWidth: 2.5,
    },
  ];
  if (spec.quota != null) {
    datasets.push({
      data: points.map(() => spec.quota),
      borderColor: colors.muted,
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
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.card,
          titleColor: colors.ink,
          bodyColor: colors.ink,
          borderColor: colors.line,
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
          ticks: { color: colors.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { size: 11 } },
          grid: { display: false },
          border: { color: colors.line },
        },
        y: {
          beginAtZero: true,
          suggestedMax: spec.quota ? spec.quota * 1.16 : undefined,
          ticks: { color: colors.muted, font: { size: 11 }, maxTicksLimit: 5 },
          grid: { color: colors.grid },
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
  chart.$ltr = motionOK() ? 0 : 1;
  charts.push({ chart: chart, points: points, spec: spec, node: figure, raf: 0 });
}

function highlightCharts() {
  charts.forEach((entry) => {
    paintChart(entry);
    entry.chart.update("none");
  });
}

function mountChart(node) {
  if (!node.dataset.chartId || node.dataset.mounted === "1") {
    return charts.find((entry) => entry.node === node);
  }
  node.dataset.mounted = "1";
  const item = pending.find((entry) => entry.id === node.dataset.chartId);
  if (item) buildChart(node, item);
  return charts.find((entry) => entry.node === node);
}

function mountObservers() {
  registerLtrPlugin();
  const nodes = [];
  const seen = new Set();
  document.querySelectorAll(".reveal, .chart[data-chart-id], #today, #fitness").forEach((node) => {
    if (seen.has(node)) return;
    seen.add(node);
    nodes.push(node);
  });
  const show = (node) => {
    node.classList.add("is-in");
    if (node.dataset.chartId && node.dataset.playing !== "1") {
      node.dataset.playing = "1";
      playChart(mountChart(node));
    }
    if (node.id === "today" && node.dataset.bars !== "1") {
      node.dataset.bars = "1";
      playTodayBars(node);
    }
    if (node.id === "fitness" && node.dataset.rings !== "1") {
      node.dataset.rings = "1";
      playRings();
    }
  };
  const hide = (node) => {
    if (node.dataset.chartId) {
      node.dataset.playing = "";
      parkChart(charts.find((entry) => entry.node === node));
    }
    if (node.id === "today") {
      node.dataset.bars = "";
      resetTodayBars(node);
    }
    if (node.id === "fitness") {
      node.dataset.rings = "";
      resetRings();
    }
  };
  if (typeof IntersectionObserver === "undefined") {
    nodes.forEach(show);
    return;
  }
  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const visible = entry.isIntersecting && entry.intersectionRatio > 0;
      if (visible) show(entry.target);
      else if (entry.intersectionRatio === 0) hide(entry.target);
    });
  }, { threshold: [0, 0.15], rootMargin: "0px 0px -4% 0px" });
  nodes.forEach((node) => revealObserver.observe(node));
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

function syncTabs() {
  document.querySelectorAll(".view-tab").forEach((tab) => {
    const on = tab.getAttribute("data-view") === activeView;
    tab.setAttribute("aria-selected", on ? "true" : "false");
    tab.tabIndex = on ? 0 : -1;
  });
}

function render() {
  const app = document.querySelector("#app");
  const scrollY = window.scrollY;
  clearCharts();
  const html = view();
  app.innerHTML = html;
  document.title = pageTitle(currentDay());
  syncTabs();
  updateChevrons();
  bindTrack();
  mountObservers();
  window.requestAnimationFrame(() => {
    positionDayTrack("auto");
    revealActiveView();
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
  return /^(today|trends|fitness|advice|foods|days)$/.test(hash);
}

function viewFromHash(hash) {
  if (hash === "foods") return "advice";
  if (hash === "days") return "trends";
  return VIEWS.indexOf(hash) === -1 ? "" : hash;
}

let daysOpener = null;

function daysModalEl() {
  return document.querySelector("#days-modal");
}

let daysMotion = 0;

function openDaysModal(opener) {
  const modal = daysModalEl();
  if (!modal) return;
  daysMotion += 1;
  daysOpener = opener && opener.focus ? opener : document.querySelector("[data-open-days]");
  if (!modal.hidden && modal.classList.contains("is-in")) {
    const close = modal.querySelector(".day-modal-close");
    if (close) close.focus();
    return;
  }
  modal.hidden = false;
  document.body.classList.add("modal-open");
  if (motionOK()) {
    modal.classList.remove("is-in");
    void modal.offsetWidth;
  }
  modal.classList.add("is-in");
  const close = modal.querySelector(".day-modal-close");
  if (close) close.focus();
}

function finishDaysClose() {
  const modal = daysModalEl();
  if (!modal || modal.hidden) return;
  modal.classList.remove("is-in");
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  const opener = daysOpener;
  daysOpener = null;
  if (opener && document.contains(opener)) opener.focus();
}

function closeDaysModal() {
  const modal = daysModalEl();
  if (!modal || modal.hidden) return;
  if (!motionOK()) {
    daysMotion += 1;
    finishDaysClose();
    return;
  }
  const token = ++daysMotion;
  modal.classList.remove("is-in");
  const panel = modal.querySelector(".day-modal-panel");
  let settled = false;
  const settle = () => {
    if (settled || token !== daysMotion) return;
    settled = true;
    finishDaysClose();
  };
  if (panel) {
    panel.addEventListener("transitionend", (event) => {
      if (event.target !== panel) return;
      settle();
    });
  }
  window.setTimeout(settle, 520);
}

function toggleMealLog(summary, event) {
  const details = summary.parentElement;
  if (!details || !motionOK()) return;
  event.preventDefault();
  const panel = details.querySelector(".meal-panel");
  if (!panel) return;
  const token = String(Number(details.dataset.motion || 0) + 1);
  details.dataset.motion = token;
  if (details.classList.contains("is-open")) {
    details.classList.remove("is-open");
    let settled = false;
    const settle = () => {
      if (settled || details.dataset.motion !== token) return;
      settled = true;
      details.open = false;
    };
    panel.addEventListener("transitionend", (endEvent) => {
      if (endEvent.target !== panel) return;
      settle();
    });
    window.setTimeout(settle, 520);
    return;
  }
  details.open = true;
  void panel.offsetHeight;
  details.classList.add("is-open");
}

function daysFocusable() {
  const modal = daysModalEl();
  if (!modal) return [];
  return [...modal.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((el) => !el.disabled && el.getAttribute("aria-hidden") !== "true");
}

function trapDaysModal(event) {
  const modal = daysModalEl();
  if (!modal || modal.hidden) return false;
  if (event.key === "Escape") {
    event.preventDefault();
    closeDaysModal();
    return true;
  }
  if (event.key !== "Tab") return false;
  const list = daysFocusable();
  if (!list.length) return false;
  const first = list[0];
  const last = list[list.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
  return false;
}

function writeHash() {
  const url = new URL(window.location.href);
  if (selectedDate === latestDate()) url.searchParams.delete("day");
  else url.searchParams.set("day", selectedDate);
  if (activeView !== "today") url.hash = activeView;
  else url.hash = selectedDate === latestDate() ? "" : selectedDate;
  const search = url.searchParams.toString();
  history.replaceState(null, "", url.pathname + (search ? "?" + search : "") + url.hash);
}

function chartItem(group, key) {
  if (group === "fitness") {
    const spec = fitnessChartSpecs().find((item) => item.key === key);
    if (!spec) return null;
    return { id: "chart-fitness", points: fitnessPoints(key), spec: spec };
  }
  const metric = nutritionChartMetrics().find((item) => item.key === key);
  if (!metric) return null;
  return { id: "chart-nutrition", points: nutritionPoints(metric), spec: nutritionSpec(metric) };
}

function activateChartPill(button) {
  const group = button.getAttribute("data-chart-group");
  const key = button.getAttribute("data-chart-key");
  if (group === "nutrition") nutritionKey = key;
  else if (group === "fitness") fitnessKey = key;
  else return;
  const host = button.closest(".chart-switch");
  const figure = host && host.querySelector(".chart");
  const item = chartItem(group, key);
  if (!host || !figure || !item) return;
  host.querySelectorAll(".filter-pill").forEach((pill) => {
    const on = pill === button;
    pill.classList.toggle("is-on", on);
    pill.setAttribute("aria-selected", on ? "true" : "false");
    pill.tabIndex = on ? 0 : -1;
  });
  const caption = item.spec.quota == null
    ? "未設目標線"
    : "虛線 = " + item.spec.lineWord + " " + item.spec.formatValue(item.spec.quota) + (item.spec.unit ? " " + item.spec.unit : "");
  const heading = figure.querySelector("h3");
  const quota = figure.querySelector(".chart-quota");
  const summary = figure.querySelector(".summary");
  if (heading) heading.textContent = item.spec.label;
  if (quota) quota.textContent = caption;
  if (summary) summary.textContent = pointSummary(item.points, item.spec);
  const existing = charts.find((entry) => entry.node === figure);
  if (existing) {
    if (existing.raf) cancelAnimationFrame(existing.raf);
    if (existing.chart) existing.chart.destroy();
    charts = charts.filter((entry) => entry !== existing);
  }
  const index = pending.findIndex((entry) => entry.id === item.id);
  if (index >= 0) pending[index] = item;
  else pending.push(item);
  figure.dataset.chartId = item.id;
  figure.dataset.mounted = "";
  figure.dataset.playing = "1";
  const entry = mountChart(figure);
  if (entry && entry.chart) entry.chart.resize();
  playChart(entry);
}

function revealActiveView() {
  const panel = document.querySelector("#view-" + activeView);
  if (!panel) return;
  panel.querySelectorAll(".chart[data-chart-id]").forEach((node) => {
    node.dataset.playing = "1";
    const entry = mountChart(node);
    if (entry && entry.chart) entry.chart.resize();
    playChart(entry);
  });
  if (activeView === "today") {
    const today = document.querySelector("#today");
    if (today) {
      today.dataset.bars = "1";
      today.classList.add("is-in");
      playTodayBars(today);
    }
    positionDayTrack("auto");
  }
  if (activeView === "fitness") {
    const fitness = document.querySelector("#fitness");
    if (fitness) {
      fitness.dataset.rings = "1";
      playRings();
    }
  }
}

function showView(name, options) {
  const next = viewFromHash(name) || (VIEWS.indexOf(name) === -1 ? "today" : name);
  activeView = next;
  if (!snapshot) {
    syncTabs();
    return;
  }
  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.hidden = panel.id !== "view-" + next;
  });
  syncTabs();
  if (!options || options.hash !== false) writeHash();
  if (!options || options.keepScroll !== true) window.scrollTo(0, 0);
  window.requestAnimationFrame(() => {
    revealActiveView();
    if (name === "foods") {
      const foods = document.querySelector("#foods");
      if (foods && foods.scrollIntoView) foods.scrollIntoView({ block: "start" });
    }
  });
  if (options && options.focusTab) {
    const tab = document.querySelector('#tab-' + next);
    if (tab) tab.focus();
  }
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
  const meals = document.querySelector("#meal-slot");
  if (meals) meals.innerHTML = mealLogHtml(day);
  document.querySelectorAll("table.days tbody tr").forEach((row) => {
    const on = row.getAttribute("data-select") === day.date;
    row.classList.toggle("is-on", on);
    if (on) row.setAttribute("aria-current", "true");
    else row.removeAttribute("aria-current");
    const button = row.querySelector("button");
    if (button) button.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const fit = document.querySelector("#fitness-live");
  if (fit) {
    fit.innerHTML = fitnessLiveHtml();
    const section = document.querySelector("#fitness");
    if (section && section.dataset.rings === "1") playRings();
  }
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

function movePill(pill, event) {
  if (!pill) return false;
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return false;
  const pills = [...pill.parentElement.querySelectorAll(".filter-pill")];
  if (!pills.length) return false;
  let index = pills.indexOf(pill);
  if (event.key === "ArrowRight") index = (index + 1) % pills.length;
  else if (event.key === "ArrowLeft") index = (index - 1 + pills.length) % pills.length;
  else if (event.key === "Home") index = 0;
  else index = pills.length - 1;
  event.preventDefault();
  pills[index].focus();
  activateChartPill(pills[index]);
  return true;
}

function onAppClick(event) {
  const pill = event.target.closest(".filter-pill");
  if (pill) {
    activateChartPill(pill);
    return;
  }
  const more = event.target.closest("[data-fitness-more]");
  if (more) {
    fitnessExpanded = !fitnessExpanded;
    const body = document.querySelector("table.fitness tbody");
    const rows = fitnessSorted();
    if (body) body.innerHTML = fitnessBody(rows);
    more.textContent = fitnessExpanded ? "只顯示最近 5" : "顯示全部 (" + rows.length + ")";
    more.setAttribute("aria-expanded", fitnessExpanded ? "true" : "false");
    return;
  }
  const summary = event.target.closest(".meal-log > summary");
  if (summary) {
    toggleMealLog(summary, event);
    return;
  }
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
  if (event.target.closest("[data-open-days]")) {
    openDaysModal(event.target.closest("[data-open-days]"));
    return;
  }
  if (event.target.closest("[data-close-days]")) {
    closeDaysModal();
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
  const tabs = document.querySelector("#view-tabs");
  if (!tabs || tabs.dataset.bound) return;
  tabs.dataset.bound = "1";
  tabs.addEventListener("click", (event) => {
    const tab = event.target.closest(".view-tab");
    if (!tab) return;
    showView(tab.getAttribute("data-view"));
  });
  tabs.addEventListener("keydown", (event) => {
    const current = event.target.closest(".view-tab");
    if (!current) return;
    const list = [...tabs.querySelectorAll(".view-tab")];
    const index = list.indexOf(current);
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % list.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + list.length) % list.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = list.length - 1;
    else return;
    event.preventDefault();
    list[next].focus();
    showView(list[next].getAttribute("data-view"), { focusTab: false });
  });
  document.addEventListener("keydown", (event) => {
    if (trapDaysModal(event)) return;
    if (movePill(event.target.closest && event.target.closest(".filter-pill"), event)) return;
  });
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
  app.addEventListener("toggle", (event) => {
    const details = event.target;
    if (!details.classList || !details.classList.contains("meal-log") || motionOK()) return;
    details.classList.toggle("is-open", details.open);
  }, true);
  bindChrome();
  bindTheme();
  window.addEventListener("hashchange", () => {
    if (!snapshot) return;
    const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
    const viewName = viewFromHash(hash);
    if (viewName) {
      showView(hash, { hash: false });
      if (hash === "days") openDaysModal(document.querySelector("[data-open-days]"));
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hash)) return;
    if (!daysSorted().some((day) => day.date === hash)) return;
    if (activeView !== "today") showView("today", { hash: false });
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
      const openHash = decodeURIComponent(location.hash.replace(/^#/, ""));
      const initialView = viewFromHash(openHash);
      if (initialView) activeView = initialView;
      const updated = document.querySelector("#updated");
      if (updated && snapshot.updatedAt) updated.textContent = "更新 " + formatUpdated(snapshot.updatedAt);
      const openDays = openHash === "days";
      render();
      writeHash();
      if (openDays) openDaysModal(document.querySelector("[data-open-days]"));
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
  expect(weekdayChar("2026-10-20") === "二", "tuesday");
  expect(weekdayChar("2026-10-17") === "六", "saturday");
  expect(latestDate() === "2026-10-20", latestDate());
  const complete = completeDays();
  expect(complete.length === 11, "complete " + complete.length);
  const stats = chipStats();
  expect(stats.protein === 3 && stats.sodium === 6 && stats.added === 0 && stats.kcal === 9, JSON.stringify(stats));
  selectedDate = "2026-10-20";
  const todayNote = coachNote(currentDay());
  expect(todayNote.includes("進行中") && todayNote.includes("蛋白") && todayNote.includes("低") && !todayNote.includes("糖"), todayNote);
  selectedDate = "2026-10-14";
  const highNote = coachNote(currentDay());
  expect(highNote.includes("超") && highNote.includes("2,750") && !highNote.includes("糖"), highNote);
  selectedDate = "2026-10-12";
  const midNote = coachNote(currentDay());
  expect(midNote.includes("纖維") && midNote.includes("低") && midNote.includes("鈉") && midNote.includes("近"), midNote);
  const steps = fitnessSorted().reduce((sum, row) => sum + row.steps, 0);
  const km = fitnessSorted().reduce((sum, row) => sum + row.km, 0);
  expect(steps === 86233, String(steps));
  expect(Math.abs(km - 66.85) < 0.001, String(km));
  expect(fitnessSorted()[fitnessSorted().length - 1].date === "2026-10-19", "latest fitness");
  const gaps = dateGaps();
  expect(gaps.noFit.join() === "2026-10-13,2026-10-18,2026-10-20", gaps.noFit.join());
  expect(daysSorted().filter((day) => typeof day.fat === "number").map((day) => day.date).join() === "2026-10-20", "fat only where logged");
  const kcalSummary = trendSummary(trendDays(), metricByKey("kcal"));
  expect(kcalSummary.includes("2,530") && kcalSummary.includes("1,765") && kcalSummary.includes("8 日"), kcalSummary);
  const chartKeys = nutritionChartMetrics().map((metric) => metric.key).join();
  expect(chartKeys === "kcal,carbs,sugar,fiber,protein,sodium,fat", chartKeys);
  const sugarSummary = pointSummary(nutritionPoints(metricByKey("sugar")), nutritionSpec(metricByKey("sugar")));
  expect(sugarSummary.includes("56") && !sugarSummary.includes("超上限"), sugarSummary);
  const fiberSummary = pointSummary(nutritionPoints(metricByKey("fiber")), nutritionSpec(metricByKey("fiber")));
  expect(fiberSummary.includes("達標 2"), fiberSummary);
  const specs = fitnessChartSpecs();
  expect(specs.map((spec) => spec.key).join() === "move,exercise,stand,steps,km", specs.map((spec) => spec.key).join());
  expect(specs.find((spec) => spec.key === "move").quota === 360, "move goal");
  expect(specs.find((spec) => spec.key === "steps").quota == null, "steps have no goal");
  expect(specs.find((spec) => spec.key === "km").quota == null, "km has no goal");
  const sugarModel = chartModel(nutritionPoints(metricByKey("sugar")), nutritionSpec(metricByKey("sugar")));
  expect(sugarModel.quota == null && sugarModel.dates.indexOf("2026-10-20") !== -1, "sugar has no numeric cap and keeps the partial day");
  const stepsModel = chartModel(fitnessPoints("steps"), specs.find((spec) => spec.key === "steps"));
  expect(stepsModel.quota == null && stepsModel.dates.length === 9, "fitness dates only");
  expect(stepsModel.dates.indexOf("2026-10-13") === -1 && stepsModel.dates.indexOf("2026-10-20") === -1 && stepsModel.dates.indexOf("2026-10-19") !== -1, "no invented fitness days");
  const moveModel = chartModel(fitnessPoints("move"), specs.find((spec) => spec.key === "move"));
  expect(moveModel.quota === 360, "move goal line");
  expect(Array.isArray(data.advice.eating) && data.advice.eating.some((item) => item.includes("溫水")), "advice eating");
  expect(Array.isArray(data.advice.meds_safety) && data.advice.meds_safety.some((item) => item.includes("西柚")), "meds safety");
  expect(data.quotas.sugar_g === "不設上限 (只限天然果糖)" && data.quotas.added_sugar_g === 25 && data.quotas.water_ml === 2500, "quota shape");
  expect(Array.isArray(data.foodLists.protein) && data.foodLists.protein.some((item) => item.includes("全熟")) && data.foodLists.protein.some((item) => item.includes("海參")), "protein examples");
  expect(Array.isArray(data.foodLists.fiber) && data.foodLists.fiber.some((item) => item.includes("天然果糖")), "fiber examples");
  expect(Array.isArray(data.foodLists.caution) && data.foodLists.caution.some((item) => item.includes("綠豆沙")), "caution foods");
  expect(daysNewest()[0].date === "2026-10-20", "newest first");
  const logged = daysSorted().find((day) => day.date === "2026-10-19");
  expect(logged.kcal === 1911.5 && logged.partial === false && logged.meals.length === 7, "oct 19 totals stay");
  const morning = daysSorted().find((day) => day.date === "2026-10-20");
  expect(morning.partial === true && morning.kcal === 610 && morning.fat === 18 && morning.added_sugar === 0 && morning.water_ml == null, "oct 20 breakfast only");
  expect(morning.meds_and_symptoms.xeloda_am === "08:30" && morning.bowel.count == null, "oct 20 tracking");
  expect(!daysSorted().some((day) => day.date < "2026-10-20" && (day.meds_and_symptoms || day.bowel || day.water_ml != null)), "no invented history");
  const mealCounts = {
    "2026-10-09": 5,
    "2026-10-10": 4,
    "2026-10-11": 5,
    "2026-10-12": 3,
    "2026-10-13": 4,
    "2026-10-14": 4,
    "2026-10-15": 5,
    "2026-10-16": 4,
    "2026-10-17": 5,
    "2026-10-18": 7,
    "2026-10-19": 7,
    "2026-10-20": 1,
  };
  daysSorted().forEach((day) => {
    expect(Array.isArray(day.meals) && day.meals.length === mealCounts[day.date], day.date + " meal count " + (day.meals && day.meals.length));
    ["kcal", "carbs", "sugar", "fiber", "protein", "sodium"].forEach((key) => {
      const sum = day.meals.reduce((total, item) => total + Number(item[key] || 0), 0);
      expect(Math.abs(sum - day[key]) < 0.05, day.date + " " + key + " sum " + sum);
    });
  });
  expect(logged.meals.some((item) => item.meal === "早餐" && item.name.includes("蘋果") && item.name.includes("炒蛋") && item.name.includes("豆漿")), "oct 19 breakfast");
  expect(logged.meals.some((item) => item.name.includes("Ryvita") && item.kcal === 36.5), "oct 19 ryvita");
  expect(logged.meals.some((item) => item.name.includes("生菜")), "oct 19 lettuce");
  expect(logged.meals.some((item) => item.name.includes("蕃薯") && item.kcal === 180), "oct 19 sweet potato");
  expect(logged.meals.some((item) => item.meal === "午餐" && item.name.includes("餃子") && item.name.includes("醋")), "oct 19 dumplings");
  expect(logged.meals.some((item) => item.name.includes("海參")), "oct 19 sea cucumber");
  expect(morning.meals[0].name.includes("黑麥") && morning.meals[0].name.includes("炒蛋") && morning.meals[0].kcal === 610, "oct 20 food");
  expect(mealMacroText({ name: "例", kcal: 1081.5, sodium: 749, carbs: 12 }) === "1081.5 kcal · 碳水 12 g · 鈉 749 mg", mealMacroText({ name: "例", kcal: 1081.5, sodium: 749, carbs: 12 }));
  const todayLog = mealLogHtml(morning);
  expect(todayLog.includes("meal-card") && todayLog.includes("610 kcal") && todayLog.includes("脂肪 18 g") && todayLog.includes("添加糖 0 g") && todayLog.includes("查看 AI 分析") && todayLog.includes("Xeloda 早 08:30") && !todayLog.includes("肚瀉") && !todayLog.includes("大便"), "today log");
  const loggedView = mealLogHtml(logged);
  expect(loggedView.includes("meal-card") && loggedView.includes("海參") && !loggedView.includes("is-open"), "oct 19 log stays closed");
  const olderDay = daysSorted().find((day) => day.date === "2026-10-18");
  const olderLog = mealLogHtml(olderDay);
  expect(olderLog.includes("meal-card") && olderLog.includes("綠豆沙") && olderLog.includes("零食") && olderLog.includes("~21:35"), "older log stays closed");
  const taggedLog = mealLogHtml({ date: "1999-01-01", meals: [{ name: "蛋", meal: "早餐", kcal: 80, protein: 6 }] });
  expect(taggedLog.includes("早餐") && taggedLog.includes("80 kcal") && taggedLog.includes("蛋白 6 g") && taggedLog.includes("meal-card"), taggedLog);
  const lineAnim = chartAnimations("line", 11);
  expect(Number.isNaN(lineAnim.x.from), "line starts hidden and draws across");
  expect(typeof lineAnim.y.from === "function", "line y follows the previous point");
  expect(lineAnim.x.easing === "easeInQuad" && lineAnim.y.easing === "easeInQuad", "line eases in");
  expect(Math.abs(revealEase(0.5) - 0.25) < 0.001, "easeInQuad is slow at the start");
  const early = { type: "data", index: 1 };
  const later = { type: "data", index: 4 };
  expect(lineAnim.x.delay(later) > lineAnim.x.delay(early), "later points wait so the stroke moves left to right");
  const earlySlot = revealSlot(1, 11);
  const laterSlot = revealSlot(8, 11);
  expect(laterSlot.duration < earlySlot.duration, "the stroke speeds up");
  const barAnim = chartAnimations("bar", 8);
  expect(barAnim.height.duration === 0 && barAnim.y.duration === 0 && barAnim.base.duration === 0, "bars do not grow upward");
  expect(barAnim.width.from === 0, "bars grow in width");
  expect(barAnim.width.easing === "easeInQuad", "bars ease in");
  expect(barAnim.width.delay({ type: "data", index: 3 }) > barAnim.width.delay({ type: "data", index: 0 }), "bars progress left to right");
  const full = ringFrame(480 / 360, 1);
  const partial = ringFrame(7 / 12, 1);
  const earlyRing = ringFrame(480 / 360, 0.25);
  expect(full.base === 1 && full.over > 0.3 && full.over < 0.4, "move ring continues past a full circle");
  expect(partial.over === 0 && partial.base > 0.5 && partial.base < 0.7, "stand ring stays under a full circle");
  expect(earlyRing.base < full.base && earlyRing.over === 0, "rings start filling before the extra lap");
  expect(typeof areaFill("#e0894a") === "function", "line area is a gradient fill");
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
