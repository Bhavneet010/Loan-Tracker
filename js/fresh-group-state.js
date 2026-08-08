export function effectiveFreshGroupCollapsed(stored, defaultCollapsed) {
  return stored === undefined ? Boolean(defaultCollapsed) : Boolean(stored);
}

export function nextFreshGroupCollapsed(stored, defaultCollapsed) {
  return !effectiveFreshGroupCollapsed(stored, defaultCollapsed);
}
