import {
  allocateServiceTax,
  computeAppointmentShares,
  resolveRevenueSplitRule,
} from "./revenueSplits";

describe("allocateServiceTax", () => {
  it("allocates all tax to service when there are no products", () => {
    expect(allocateServiceTax({ service: 200, product: 0 }, 26)).toBeCloseTo(26);
  });

  it("allocates tax proportionally when products are present", () => {
    expect(allocateServiceTax({ service: 200, product: 50 }, 32.5)).toBeCloseTo(26);
  });
});

describe("computeAppointmentShares", () => {
  const percentSplit = resolveRevenueSplitRule(
    [{ split_mode: "percent", split_value: 60, is_active: true, artist_id: "a1" }],
    { appointmentTypeId: "t1", artistId: "a1" }
  );

  it("applies percent split to service plus service tax", () => {
    const { artistShare, shopShare } = computeAppointmentShares(
      percentSplit,
      { service: 200, product: 0 },
      26
    );
    expect(artistShare).toBeCloseTo(135.6);
    expect(shopShare).toBeCloseTo(90.4);
  });

  it("uses exact per-line service tax when provided instead of prorating", () => {
    // Tax-exempt service + taxed product: proration would leak product tax
    // into the artist base; the exact serviceTax keeps product tax 100% shop.
    const { artistShare, shopShare } = computeAppointmentShares(
      percentSplit,
      { service: 100, product: 100, serviceTax: 0 },
      13
    );
    expect(artistShare).toBeCloseTo(60);
    expect(shopShare).toBeCloseTo(153);
  });

  it("splits exact service tax and leaves product tax with the shop", () => {
    // service $100 @13% tax, product $50 tax-exempt -> serviceTax 13, total tax 13
    const { artistShare, shopShare } = computeAppointmentShares(
      percentSplit,
      { service: 100, product: 50, serviceTax: 13 },
      13
    );
    expect(artistShare).toBeCloseTo(67.8); // 60% of 113
    expect(shopShare).toBeCloseTo(95.2); // 163 collected - 67.80
  });

  it("artist and shop shares always partition the gross collected", () => {
    const { artistShare, shopShare } = computeAppointmentShares(
      percentSplit,
      { service: 120, product: 80, serviceTax: 15.6 },
      26
    );
    expect(artistShare + shopShare).toBeCloseTo(120 + 80 + 26);
  });

  it("falls back to proration when serviceTax is not supplied", () => {
    const { artistShare } = computeAppointmentShares(
      percentSplit,
      { service: 200, product: 50 },
      32.5
    );
    expect(artistShare).toBeCloseTo(0.6 * (200 + 26));
  });

  it("keeps fixed-amount payout unchanged and assigns remainder (incl. tax) to shop", () => {
    const fixedSplit = resolveRevenueSplitRule(
      [
        {
          split_mode: "fixed_amount",
          split_value: 100,
          is_active: true,
          artist_id: "a1",
        },
      ],
      { appointmentTypeId: "t1", artistId: "a1" }
    );
    const { artistShare, shopShare } = computeAppointmentShares(
      fixedSplit,
      { service: 200, product: 0 },
      26
    );
    expect(artistShare).toBe(100);
    expect(shopShare).toBeCloseTo(126);
  });
});
