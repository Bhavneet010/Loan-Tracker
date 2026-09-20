// The Status filter's "Amount" option compares each account's limit (in lakh)
// against a figure typed into the filter dropdown, either greater or smaller.
export const AMOUNT_OPS = ['gt', 'lt'];

export function normalizeAmountOp(op) {
  return AMOUNT_OPS.includes(op) ? op : 'gt';
}

// Blank, partial ("12."), or non-numeric input means "no figure yet", so the
// list stays unfiltered while the user is still typing.
export function parseAmountInput(value) {
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!text) return null;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : null;
}

export function amountFilterActive(filter) {
  return filter?.status === 'Amount' && parseAmountInput(filter?.amountValue) !== null;
}

export function matchesAmountFilter(loanAmount, filter) {
  const threshold = parseAmountInput(filter?.amountValue);
  if (threshold === null) return true;
  const amount = parseFloat(loanAmount);
  if (!Number.isFinite(amount)) return false;
  return normalizeAmountOp(filter?.amountOp) === 'lt' ? amount < threshold : amount > threshold;
}

export function amountFilterLabel(filter) {
  return normalizeAmountOp(filter?.amountOp) === 'lt' ? 'below' : 'above';
}
