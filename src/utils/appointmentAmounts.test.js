import {
  getAppointmentAmounts,
  getAppointmentSettlementAmounts,
  getChargePreTaxAmount,
  getPreTaxRatio,
} from "./appointmentAmounts";
import { computeAppointmentShares, resolveRevenueSplitRule } from "./revenueSplits";

describe("getPreTaxRatio", () => {
  it("returns 1 when line totals match pre-tax net (tax-exclusive)", () => {
    expect(getPreTaxRatio(100, 100)).toBe(1);
  });

  it("backs out embedded tax for tax-inclusive lines", () => {
    expect(getPreTaxRatio(26.55, 30)).toBeCloseTo(0.885);
  });

  it("returns 1 when line total sum is zero", () => {
    expect(getPreTaxRatio(0, 0)).toBe(1);
  });
});

describe("getAppointmentAmounts", () => {
  const taxInclusiveAppointment = {
    charge_amount: 26.55,
    tax_amount: 3.45,
    tip_amount: 0,
    discount_amount: 0,
  };

  const taxInclusiveCharges = [
    {
      line_type: "product",
      line_total: 30,
      quantity: 1,
      unit_price: 30,
    },
    {
      line_type: "service",
      line_total: 0,
      quantity: 1,
      unit_price: 0,
    },
  ];

  it("derives pre-tax service/product from charge_amount for tax-inclusive checkout", () => {
    const amounts = getAppointmentAmounts(taxInclusiveAppointment, taxInclusiveCharges);
    expect(amounts.preTaxNet).toBeCloseTo(26.55);
    expect(amounts.productPreTax).toBeCloseTo(26.55);
    expect(amounts.servicePreTax).toBeCloseTo(0);
    expect(amounts.customerTotal).toBeCloseTo(30);
    expect(amounts.totalCollected).toBeCloseTo(30);
  });

  it("keeps tax-exclusive amounts unchanged", () => {
    const appointment = { charge_amount: 200, tax_amount: 26, tip_amount: 0, discount_amount: 0 };
    const charges = [{ line_type: "service", line_total: 200 }];
    const amounts = getAppointmentAmounts(appointment, charges);
    expect(amounts.preTaxNet).toBe(200);
    expect(amounts.servicePreTax).toBe(200);
    expect(amounts.customerTotal).toBeCloseTo(226);
    expect(amounts.preTaxRatio).toBe(1);
  });

  it("falls back to deposit when there are no charge lines", () => {
    const appointment = { charge_amount: 0, tax_amount: 0, deposit_amount: 50, tip_amount: 0 };
    const amounts = getAppointmentAmounts(appointment, []);
    expect(amounts.preTaxNet).toBe(50);
    expect(amounts.customerTotal).toBe(50);
  });
});

describe("getAppointmentSettlementAmounts", () => {
  it("uses customer total for gross and pre-tax for split bases", () => {
    const appointment = { charge_amount: 26.55, tax_amount: 3.45, tip_amount: 5 };
    const charges = [{ line_type: "product", line_total: 30 }];
    const result = getAppointmentSettlementAmounts(appointment, charges);
    expect(result.gross).toBeCloseTo(30);
    expect(result.service).toBeCloseTo(0);
    expect(result.product).toBeCloseTo(26.55);
    expect(result.tip).toBe(5);
    expect(result.preTaxNet).toBeCloseTo(26.55);
  });
});

describe("tax-inclusive checkout does not double-count tax in splits", () => {
  it("shop share equals total collected when artist split is 0%", () => {
    const appointment = { charge_amount: 26.55, tax_amount: 3.45 };
    const charges = [{ line_type: "product", line_total: 30 }];
    const { service, product } = getAppointmentSettlementAmounts(appointment, charges);
    const split = resolveRevenueSplitRule([], {
      appointmentTypeId: "t1",
      artistId: null,
    });
    const { artistShare, shopShare } = computeAppointmentShares(
      split,
      { service, product },
      appointment.tax_amount
    );
    expect(artistShare).toBe(0);
    expect(shopShare).toBeCloseTo(30);
    expect(shopShare).not.toBeCloseTo(33.45);
  });
});

describe("getChargePreTaxAmount", () => {
  it("scales a line total by the pre-tax ratio", () => {
    expect(getChargePreTaxAmount({ line_total: 30 }, getPreTaxRatio(26.55, 30))).toBeCloseTo(26.55);
  });
});
