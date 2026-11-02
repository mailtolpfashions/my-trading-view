// Practice (bar replay) bookkeeping: pure functions only.

/** One practice trade: +qty buys, −qty sells, at a bar's close. */
export type Fill = { qty: number; price: number; time: number };

/** Net position from practice fills (average-cost method), with P&L at `mark`, before charges. */
export function position(fills: Fill[], mark: number) {
  let qty = 0, avg = 0, booked = 0;
  for (const f of fills) {
    if (qty === 0 || Math.sign(f.qty) === Math.sign(qty)) { avg = (avg * Math.abs(qty) + f.price * Math.abs(f.qty)) / (Math.abs(qty) + Math.abs(f.qty)); qty += f.qty; continue; }
    const closing = Math.min(Math.abs(f.qty), Math.abs(qty));
    booked += closing * (f.price - avg) * Math.sign(qty);
    const left = f.qty + qty;
    if (Math.sign(left) !== Math.sign(qty) && left !== 0) avg = f.price; // flipped: the rest opens a new position
    qty = left;
    if (qty === 0) avg = 0;
  }
  return { qty, avg, booked, open: qty * (mark - avg) };
}
