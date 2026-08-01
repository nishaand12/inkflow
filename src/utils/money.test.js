import {
  formatAmount,
  formatMoney,
  isZeroMoney,
  moneySign,
  roundMoney,
  sumMoney,
  toCents,
} from "./money";

describe("negative zero", () => {
  // A settled artist balance drifts to a tiny negative and used to render
  // "$-0.00" while also being labelled "Artist owes studio".
  const DRIFTED = 100 - 100.0000000001;

  it("formats drifted zero as $0.00", () => {
    expect(formatMoney(DRIFTED)).toBe("$0.00");
    expect(formatMoney(-0.0000001)).toBe("$0.00");
    expect(formatMoney(-0)).toBe("$0.00");
  });

  it("never produces a negative zero value", () => {
    expect(Object.is(roundMoney(-0), -0)).toBe(false);
    expect(Object.is(roundMoney(-0.0000001), -0)).toBe(false);
    expect(Object.is(toCents(-0.0000001), -0)).toBe(false);
    expect(Object.is(sumMoney([-0]), -0)).toBe(false);
  });

  it("reports a drifted zero as sign 0, not negative", () => {
    expect(moneySign(DRIFTED)).toBe(0);
    expect(moneySign(-0.0000001)).toBe(0);
    expect(moneySign(-0)).toBe(0);
    expect(isZeroMoney(DRIFTED)).toBe(true);
  });

  it("still reports real negatives as negative", () => {
    expect(moneySign(-0.01)).toBe(-1);
    expect(formatMoney(-0.01)).toBe("$-0.01");
    expect(isZeroMoney(-0.01)).toBe(false);
  });

  it("rounds sub-cent magnitudes to zero", () => {
    // Half a cent or less is zero once rounded to cents.
    expect(moneySign(0.004)).toBe(0);
    expect(moneySign(-0.004)).toBe(0);
    expect(formatMoney(0.004)).toBe("$0.00");
  });
});

describe("rounding", () => {
  it("rounds to whole cents", () => {
    expect(roundMoney(57.5221238938053097)).toBe(57.52);
    expect(roundMoney(7.4778761061946903)).toBe(7.48);
    expect(formatMoney(57.5221238938053097)).toBe("$57.52");
  });

  it("preserves Math.round's existing half-up behaviour", () => {
    // Deliberate: matches what the app already computed.
    expect(toCents(0.005)).toBe(1);
    expect(toCents(-0.005)).toBe(0);
  });

  it("treats non-numeric input as zero", () => {
    expect(roundMoney(null)).toBe(0);
    expect(roundMoney(undefined)).toBe(0);
    expect(roundMoney("")).toBe(0);
    expect(roundMoney(Number.NaN)).toBe(0);
    expect(roundMoney(Infinity)).toBe(0);
  });

  it("parses numeric strings", () => {
    expect(roundMoney("12.345")).toBe(12.35);
    expect(formatAmount("12.345")).toBe("12.35");
  });
});

describe("sumMoney", () => {
  it("does not drift over repeated addition", () => {
    // 0.1 + 0.2 + 0.3 is 0.6000000000000001 with raw floats.
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
  });

  it("sums a realistic split tender to the cent", () => {
    expect(sumMoney([57.5221238938053097, 7.4778761061946903, 9.75])).toBe(74.75);
  });

  it("returns 0 for an empty or nullish list", () => {
    expect(sumMoney([])).toBe(0);
    expect(sumMoney(null)).toBe(0);
  });

  it("cancels exactly to zero", () => {
    expect(sumMoney([100, -100])).toBe(0);
    expect(Object.is(sumMoney([100, -100]), -0)).toBe(false);
  });
});
