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
