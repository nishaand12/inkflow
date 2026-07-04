import {
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  PUBLIC_BOOKING_DEPOSIT_CHECKOUT_EXPIRY_SECONDS,
  STAFF_DEPOSIT_CHECKOUT_EXPIRY_SECONDS,
} from "./depositCheckoutExpiry.ts";

Deno.test("staff deposit checkout expires in 12 hours", () => {
  assertEquals(STAFF_DEPOSIT_CHECKOUT_EXPIRY_SECONDS, 12 * 60 * 60);
});

Deno.test("public booking deposit checkout expires in 1 hour", () => {
  assertEquals(PUBLIC_BOOKING_DEPOSIT_CHECKOUT_EXPIRY_SECONDS, 60 * 60);
});
