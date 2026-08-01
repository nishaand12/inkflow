import { toCents } from "./money";

export function entryLabel(type) {
  if (type === "settlement_share") return "Service fees";
  if (type === "tip") return "Tips";
  if (type === "payout") return "Payout";
  if (type === "payback") return "Payback";
  return "Adjustment";
}

/**
 * Running artist ledger balances.
 * Sign convention: positive balance = studio owes artist.
 * Payouts (shop → artist) are negative ledger amounts.
 * Paybacks (artist → shop) are positive ledger amounts.
 */
export function computeBalances(artists, artistById, entries) {
  const map = {};
  for (const artist of artists) {
    map[artist.id] = {
      artist_id: artist.id,
      artist_name: artist.full_name || "Unknown",
      balance: 0,
      earned: 0,
      paid: 0,
      payback: 0,
    };
  }
  for (const entry of entries) {
    if (!map[entry.artist_id]) {
      map[entry.artist_id] = {
        artist_id: entry.artist_id,
        artist_name: artistById[entry.artist_id]?.full_name || "Unknown",
        balance: 0,
        earned: 0,
        paid: 0,
        payback: 0,
      };
    }
    // Accumulate in whole cents: summing raw floats drifts, which is what made
    // a settled balance render as "$-0.00 — Artist owes studio".
    const cents = toCents(entry.amount);
    map[entry.artist_id].balance += cents;
    if (entry.entry_type === "payout") {
      map[entry.artist_id].paid += Math.abs(cents);
    } else if (entry.entry_type === "payback") {
      map[entry.artist_id].payback += Math.abs(cents);
    } else if (entry.entry_type === "settlement_share" || entry.entry_type === "tip") {
      map[entry.artist_id].earned += cents;
    } else if (cents >= 0) {
      map[entry.artist_id].earned += cents;
    } else {
      map[entry.artist_id].paid += Math.abs(cents);
    }
  }
  return Object.values(map).map((row) => ({
    ...row,
    balance: centsToMoney(row.balance),
    earned: centsToMoney(row.earned),
    paid: centsToMoney(row.paid),
    payback: centsToMoney(row.payback),
  }));
}

/** Cent totals back to a currency value, never -0. */
function centsToMoney(cents) {
  return cents === 0 ? 0 : cents / 100;
}

/** Ledger amount for a payment header amount (> 0). */
export function ledgerAmountForDirection(direction, amount) {
  const n = Number(amount) || 0;
  return direction === "to_shop" ? n : -n;
}

export function entryTypeForDirection(direction) {
  return direction === "to_shop" ? "payback" : "payout";
}
