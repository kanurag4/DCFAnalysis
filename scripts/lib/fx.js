// scripts/lib/fx.js
// Pure: convert native-currency prices into EUR "shadow" units, used ONLY by
// updatePortfolio() (run-screen.js) to blend GBP/USD and EUR positions into one
// EUR-denominated paper portfolio for the Europe screen. Ranking (margin of
// safety is a %) and on-page display (each row shows its own native currency
// via app.js) never call into this module -- only the portfolio rebalance does.
//
// `rates` is a { [currency]: eurPerUnit } map, e.g. { GBP: 1.169, USD: 0.92 }.
// EUR is the target currency and is always an identity conversion (never needs
// a rate). Yahoo quotes UK-listed prices in PENCE (currency 'GBp'), not pounds,
// so GBp divides by 100 before applying the GBP rate.
//
// Currencies beyond EUR/GBp/GBP genuinely occur in this universe: CPG.L and
// IHG.L are LSE-listed but report in USD (verified 2026-08-03). Passing those
// through unconverted -- the module's original behaviour -- silently pooled USD
// as if it were EUR. They are converted properly now; anything with no rate at
// all is reported back to the caller via `unconvertible` rather than being
// quietly mis-pooled.
const EUR = 'EUR';

// Returns { value, ok }. `ok: false` means no rate was available for this
// currency -- the value is passed through unchanged so callers never crash on
// it, but the caller is expected to surface it (see prepareEurRebalanceInputs's
// `unconvertible`) rather than treat the number as a real EUR figure.
function convert(amount, currency, rates) {
  if (amount == null || !isFinite(amount)) return { value: amount, ok: true };
  if (rates == null) return { value: amount, ok: true }; // FX unavailable this run -- caller no-ops wholesale
  if (currency == null || currency === EUR) return { value: amount, ok: true };
  // 'GBp' is pence: convert to pounds first, then apply the GBP rate.
  const isPence = currency === 'GBp';
  const rate = rates[isPence ? 'GBP' : currency];
  if (rate == null) return { value: amount, ok: false };
  const inMajorUnits = isPence ? amount / 100 : amount;
  return { value: +(inMajorUnits * rate).toFixed(6), ok: true };
}

// Convenience wrapper for callers that only want the number (tests, and the
// row/dividend mappers below, which track `ok` separately).
function toEurPrice(price, currency, rates) {
  return convert(price, currency, rates).value;
}

// Shallow-copies `rows`, replacing snapshotPrice with its EUR equivalent.
// `currencyByTicker` is a { [ticker]: currency } lookup (rows passed into this
// module do not reliably carry their own `.currency` -- see prepareEurRebalanceInputs).
// Returns `rows` unchanged (same array) if `rates` is null -- this run's FX
// fetch failed, so callers fall back to native-currency ratio math rather than
// blocking the batch (same best-effort contract as /timeseries elsewhere in this codebase).
function toEurRows(rows, currencyByTicker, rates, unconvertible) {
  if (rates == null) return rows;
  return rows.map(r => {
    const c = convert(r.snapshotPrice, currencyByTicker[r.ticker], rates);
    if (!c.ok && unconvertible) unconvertible.add(`${r.ticker}:${currencyByTicker[r.ticker]}`);
    return { ...r, snapshotPrice: c.value };
  });
}

// Converts first-seen.json's firstPrice per ticker. Uses the CURRENT run's rate
// (not the true historical rate at first-seen time, which isn't persisted) --
// an accepted approximation that only affects the DISPLAYED entryPrice on a
// newly-sold stock's ledger entry, not the dollarPnl figure (which uses
// oldFx/newFx correctly via the pre-converted oldRows/newRows -- see
// prepareEurRebalanceInputs). Verified against computeRebalance(): `firstSeen`
// is read only for entryDate/entryPrice; dollarPnl derives purely from
// currentValue/divCash/slotValue.
function toEurFirstSeen(firstSeen, currencyByTicker, rates) {
  if (rates == null) return firstSeen;
  const out = {};
  for (const [ticker, entry] of Object.entries(firstSeen)) {
    out[ticker] = entry.firstPrice != null
      ? { ...entry, firstPrice: toEurPrice(entry.firstPrice, currencyByTicker[ticker], rates) }
      : entry;
  }
  return out;
}

// Converts per-share dividend amounts, which Yahoo reports in the security's
// own quote currency (PENCE for GBp names, same as price).
//
// This MUST be converted at the SAME rate as oldRows' prices (oldFx), because
// computeRebalance() derives `shares = slotValue / oldPrice` and then
// `divCash = shares * dividend`. Converting the dividend at oldFx makes that
// rate cancel out algebraically -- divCash collapses to
// `slotValue * (dividend_native / oldPrice_native)`, i.e. the true dividend
// yield applied to the slot, identical to what the un-converted (single-
// currency) path produces for every other market. Converting at newFx instead
// would leave a spurious FX term on the dividend.
//
// Skipping this conversion entirely (the pre-2026-08-03 behaviour) left a
// pence-denominated dividend multiplied by a EUR-basis share count: a ~85x
// overstatement on every GBp holding, which is ~half this universe.
function toEurDividends(dividendsByTicker, currencyByTicker, rates, unconvertible) {
  if (rates == null) return dividendsByTicker;
  const out = {};
  for (const [ticker, amount] of Object.entries(dividendsByTicker)) {
    const c = convert(amount, currencyByTicker[ticker], rates);
    if (!c.ok && unconvertible) unconvertible.add(`${ticker}:${currencyByTicker[ticker]}`);
    out[ticker] = c.value;
  }
  return out;
}

// Orchestrates the conversions above for one full-fetch run's rebalance call.
// oldRows AND dividends are priced at oldRates (the rates persisted in last
// run's rankings.json); newRows/allEvaluated/firstSeen at newRates (this run's
// fetch). Using DIFFERENT rates for old vs new prices is the whole point -- it
// is what lets a GBP position's contribution to the EUR pool reflect real
// currency drift between rebalances, not just the stock's own native-currency
// return. (Dividends deliberately use oldRates so the rate cancels -- see
// toEurDividends.)
//
// No-ops (returns every input unchanged) when either rate set is unavailable,
// so a failed FX fetch degrades to native-currency ratio math instead of
// blocking the batch.
//
// Returns `unconvertible`: a sorted array of "TICKER:CURRENCY" strings for
// holdings whose currency had no rate. The caller should log these -- they are
// being pooled at face value, which is only correct for EUR.
function prepareEurRebalanceInputs({
  oldRows, newRows, allEvaluated, firstSeen, dividendsByTicker = {}, oldRates, newRates,
}) {
  if (oldRates == null || newRates == null) {
    return { oldRows, newRows, allEvaluated, firstSeen, dividendsByTicker, unconvertible: [] };
  }
  const currencyByTicker = {};
  for (const r of oldRows) if (r.ticker && r.currency) currencyByTicker[r.ticker] = r.currency;
  for (const r of allEvaluated) if (r.ticker && r.currency) currencyByTicker[r.ticker] = r.currency;
  const unconvertible = new Set();
  return {
    oldRows: toEurRows(oldRows, currencyByTicker, oldRates, unconvertible),
    newRows: toEurRows(newRows, currencyByTicker, newRates, unconvertible),
    allEvaluated: toEurRows(allEvaluated, currencyByTicker, newRates, unconvertible),
    firstSeen: toEurFirstSeen(firstSeen, currencyByTicker, newRates),
    dividendsByTicker: toEurDividends(dividendsByTicker, currencyByTicker, oldRates, unconvertible),
    unconvertible: [...unconvertible].sort(),
  };
}

module.exports = { toEurPrice, toEurRows, toEurFirstSeen, toEurDividends, prepareEurRebalanceInputs };
