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
    const amount = Number(entry.amount) || 0;
    map[entry.artist_id].balance += amount;
    if (entry.entry_type === "payout") {
      map[entry.artist_id].paid += Math.abs(amount);
    } else if (entry.entry_type === "payback") {
      map[entry.artist_id].payback += Math.abs(amount);
    } else if (entry.entry_type === "settlement_share" || entry.entry_type === "tip") {
      map[entry.artist_id].earned += amount;
    } else if (amount >= 0) {
      map[entry.artist_id].earned += amount;
    } else {
      map[entry.artist_id].paid += Math.abs(amount);
    }
  }
  return Object.values(map);
}

/** Ledger amount for a payment header amount (> 0). */
export function ledgerAmountForDirection(direction, amount) {
  const n = Number(amount) || 0;
  return direction === "to_shop" ? n : -n;
}

export function entryTypeForDirection(direction) {
  return direction === "to_shop" ? "payback" : "payout";
}
