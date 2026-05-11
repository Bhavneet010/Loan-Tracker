import { S } from "./state.js";

export const AVAILABILITY_TYPES = {
  holiday: "On Leave",
  deputation: "Deputation",
};

function parseDate(dateStr) {
  const [y, m, d] = String(dateStr || "").split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

function isoDate(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function normalizeAvailability(item) {
  if (!item || !item.officer || !item.startDate) return null;
  const type = AVAILABILITY_TYPES[item.type] ? item.type : "holiday";
  const startDate = item.startDate;
  const endDate = item.endDate && item.endDate >= startDate ? item.endDate : startDate;
  return {
    id: item.id || `${item.officer}_${type}_${startDate}_${endDate}`.replace(/[^a-z0-9_-]+/gi, "_"),
    officer: item.officer,
    type,
    startDate,
    endDate,
    label: String(item.label || "").trim(),
  };
}

export function availabilityLabel(item) {
  const normalized = normalizeAvailability(item);
  if (!normalized) return "";
  return normalized.label || AVAILABILITY_TYPES[normalized.type] || "Unavailable";
}

export function availabilityShortLabel(item) {
  const normalized = normalizeAvailability(item);
  if (!normalized) return "";
  if (normalized.type === "deputation") return "Dep.";
  return "Leave";
}

export function officerAvailabilityForDate(officer, dateStr) {
  return (S.officerAvailability || [])
    .map(normalizeAvailability)
    .filter(Boolean)
    .find(item =>
      item.officer === officer &&
      item.startDate <= dateStr &&
      item.endDate >= dateStr
    ) || null;
}

export function expandAvailabilityDates(item) {
  const normalized = normalizeAvailability(item);
  if (!normalized) return [];
  const out = [];
  const cursor = parseDate(normalized.startDate);
  const end = parseDate(normalized.endDate);
  while (cursor <= end) {
    out.push(isoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}
