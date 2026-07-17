import {
  buildPaymentPayload,
  getPaymentBalanceAmount,
  getPaymentTipAmount,
  joinPaymentMethods,
  parsePaymentMethods,
  sumTenderAmounts,
  sumTenderTips,
  tenderRowsFromPayments,
  validateSplitTenders,
} from "./splitTender";

describe("splitTender", () => {
  it("joins and parses payment methods in UI order", () => {
    expect(joinPaymentMethods(["Cash", "Visa"])).toBe("Cash, Visa");
    expect(parsePaymentMethods("Cash, Visa")).toEqual(["Cash", "Visa"]);
  });

  it("validates unique methods and balance sum", () => {
    const rows = [
      { id: "1", method: "Cash", amount: "50", tip: "10" },
      { id: "2", method: "Visa", amount: "50", tip: "" },
    ];
    expect(validateSplitTenders(rows, 100).ok).toBe(true);
    expect(validateSplitTenders(rows, 90).ok).toBe(false);
    expect(
      validateSplitTenders(
        [
          { id: "1", method: "Cash", amount: "50", tip: "" },
          { id: "2", method: "Cash", amount: "50", tip: "" },
        ],
        100
      ).ok
    ).toBe(false);
  });

  it("allows tip-only rows when balance is covered", () => {
    const rows = [
      { id: "1", method: "Visa", amount: "100", tip: "" },
      { id: "2", method: "Cash", amount: "0", tip: "20" },
    ];
    expect(validateSplitTenders(rows, 100).ok).toBe(true);
    expect(sumTenderTips(rows)).toBe(20);
    expect(sumTenderAmounts(rows)).toBe(100);
  });

  it("builds payment payloads with tip in metadata", () => {
    const payload = buildPaymentPayload([
      { id: "1", method: "Cash", amount: "100", tip: "15" },
      { id: "2", method: "Visa", amount: "76", tip: "5" },
    ]);
    expect(payload).toEqual([
      {
        tender_type: "Cash",
        channel: "in_person",
        amount: 115,
        metadata: { tip: 15, balance_amount: 100 },
      },
      {
        tender_type: "Visa",
        channel: "in_person",
        amount: 81,
        metadata: { tip: 5, balance_amount: 76 },
      },
    ]);
  });

  it("reconstructs tender rows from payment ledger rows", () => {
    const rows = tenderRowsFromPayments([
      {
        id: "p1",
        status: "paid",
        tender_type: "Cash",
        amount: 115,
        metadata: { tip: 15, balance_amount: 100 },
      },
      {
        id: "p2",
        status: "voided",
        tender_type: "Visa",
        amount: 81,
        metadata: { tip: 5 },
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(getPaymentBalanceAmount({ amount: 115, metadata: { tip: 15 } })).toBe(100);
    expect(getPaymentTipAmount({ metadata: { tip: 15 } })).toBe(15);
    expect(rows[0].method).toBe("Cash");
    expect(rows[0].amount).toBe("100");
    expect(rows[0].tip).toBe("15");
  });
});
