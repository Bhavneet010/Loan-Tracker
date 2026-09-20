// The NPA toolbar button cycles through three states: 'off' hides NPA accounts,
// 'all' lists them alongside everything else, and 'only' narrows the view down
// to NPA accounts alone.
export const NPA_MODES = ['off', 'all', 'only'];

export function normalizeNpaMode(mode) {
  return NPA_MODES.includes(mode) ? mode : 'off';
}

export function nextNpaMode(mode) {
  const i = NPA_MODES.indexOf(normalizeNpaMode(mode));
  return NPA_MODES[(i + 1) % NPA_MODES.length];
}

export function npaModeAllows(mode, isNpa) {
  const current = normalizeNpaMode(mode);
  if (current === 'only') return !!isNpa;
  if (current === 'off') return !isNpa;
  return true;
}
