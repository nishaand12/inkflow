import { resolvePublicBookingDeposit } from "../../supabase/functions/_shared/publicBookingDeposit.js";

describe("resolvePublicBookingDeposit", () => {
  it("uses appointment type default_deposit only", () => {
    expect(resolvePublicBookingDeposit({ default_deposit: 10 })).toBe(10);
    expect(resolvePublicBookingDeposit({ default_deposit: 10.555 })).toBe(10.56);
  });

  it("returns 0 when type has no deposit", () => {
    expect(resolvePublicBookingDeposit({ default_deposit: 0 })).toBe(0);
    expect(resolvePublicBookingDeposit({ default_deposit: null })).toBe(0);
    expect(resolvePublicBookingDeposit({})).toBe(0);
  });
});
