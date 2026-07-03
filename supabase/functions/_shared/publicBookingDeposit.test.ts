import {
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { resolvePublicBookingDeposit } from "./publicBookingDeposit.ts";

Deno.test("resolvePublicBookingDeposit uses appointment type default", () => {
  assertEquals(resolvePublicBookingDeposit({ default_deposit: 75 }), 75);
  assertEquals(resolvePublicBookingDeposit({ default_deposit: "50.5" }), 50.5);
});

Deno.test("resolvePublicBookingDeposit rejects invalid values", () => {
  assertEquals(resolvePublicBookingDeposit({ default_deposit: -10 }), 0);
  assertEquals(resolvePublicBookingDeposit({ default_deposit: null }), 0);
  assertEquals(resolvePublicBookingDeposit({ default_deposit: "abc" }), 0);
});

Deno.test("resolvePublicBookingDeposit rounds to cents", () => {
  assertEquals(resolvePublicBookingDeposit({ default_deposit: 10.005 }), 10.01);
});
