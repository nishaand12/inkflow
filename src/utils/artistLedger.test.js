import {
  computeBalances,
  entryLabel,
  entryTypeForDirection,
  ledgerAmountForDirection,
} from "./artistLedger";

describe("artistLedger", () => {
  const artists = [{ id: "a1", full_name: "Alex" }];
  const artistById = { a1: artists[0] };

  test("entry labels", () => {
    expect(entryLabel("payout")).toBe("Payout");
    expect(entryLabel("payback")).toBe("Payback");
    expect(entryLabel("tip")).toBe("Tips");
  });

  test("direction maps to ledger type and sign", () => {
    expect(entryTypeForDirection("to_artist")).toBe("payout");
    expect(entryTypeForDirection("to_shop")).toBe("payback");
    expect(ledgerAmountForDirection("to_artist", 40)).toBe(-40);
    expect(ledgerAmountForDirection("to_shop", 40)).toBe(40);
  });

  test("payback settles a negative balance without inflating earned", () => {
    const entries = [
      { artist_id: "a1", entry_type: "settlement_share", amount: 100 },
      { artist_id: "a1", entry_type: "payout", amount: -150 },
      { artist_id: "a1", entry_type: "payback", amount: 50 },
    ];
    const [row] = computeBalances(artists, artistById, entries);
    expect(row.earned).toBe(100);
    expect(row.paid).toBe(150);
    expect(row.payback).toBe(50);
    expect(row.balance).toBe(0);
  });

  test("over-payback increases what the studio owes", () => {
    const entries = [
      { artist_id: "a1", entry_type: "settlement_share", amount: 100 },
      { artist_id: "a1", entry_type: "payout", amount: -120 },
      { artist_id: "a1", entry_type: "payback", amount: 50 },
    ];
    const [row] = computeBalances(artists, artistById, entries);
    expect(row.balance).toBe(30);
    expect(row.payback).toBe(50);
  });
});
