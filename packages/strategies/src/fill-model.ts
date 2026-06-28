export interface FillResult {
  filled: boolean;
  /** Execution price. For a resting limit order this is the limit itself. */
  price: number;
}

/**
 * Realistic fill for a RESTING limit BUY at `limit` for `shares`.
 *
 * A resting bid sits at the top of the book, so when the market offers at or
 * below it (best ask in (0, limit]) the trade executes at YOUR limit price —
 * NOT at the cheap observed ask. (You'd only get a 1¢ print if you were the one
 * selling.) Filling at the observed ask is what inflated paper/backtest P&L.
 *
 * Pass `askSize` (when known) to require enough offered size to cover `shares`,
 * so we don't "fill" against dust. When size is unknown (price-only data) the
 * depth check is skipped.
 */
export function restingBuyFill(
  ask: number,
  limit: number,
  shares: number,
  askSize?: number,
): FillResult {
  const crosses = ask > 0 && ask <= limit;
  const deepEnough = askSize === undefined || askSize >= shares;
  return crosses && deepEnough ? { filled: true, price: limit } : { filled: false, price: 0 };
}
