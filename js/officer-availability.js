import { S } from "./state.js";

export const AVAILABILITY_TYPES = {
  holiday: "On Leave",
  deputation: "Deputation",
};

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
