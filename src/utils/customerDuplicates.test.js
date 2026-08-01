import { findDuplicateCustomers } from "./customerDuplicates";

const EXISTING = [
  { id: "1", name: "Ada", email: "ada@example.com", phone_number: "4165550111" },
  { id: "2", name: "Walk-in", email: null, phone_number: null },
  { id: "3", name: "Bea", email: "", phone_number: "4165550222" },
];

describe("findDuplicateCustomers", () => {
  it("does not throw when existing customers have a null email", () => {
    expect(() =>
      findDuplicateCustomers(EXISTING, { email: "new@example.com", phone_number: "999" })
    ).not.toThrow();
  });

  it("does not throw when the draft has null email and phone", () => {
    expect(() =>
      findDuplicateCustomers(EXISTING, { email: null, phone_number: null })
    ).not.toThrow();
  });

  it("matches on email, case- and whitespace-insensitively", () => {
    const found = findDuplicateCustomers(EXISTING, {
      email: "  ADA@Example.com ",
      phone_number: "",
    });
    expect(found.map((c) => c.id)).toEqual(["1"]);
  });

  it("matches on phone", () => {
    const found = findDuplicateCustomers(EXISTING, {
      email: "",
      phone_number: "4165550222",
    });
    expect(found.map((c) => c.id)).toEqual(["3"]);
  });

  it("never treats two blank fields as a match", () => {
    // The old check compared '' === '' and flagged every email-less customer.
    const found = findDuplicateCustomers(EXISTING, { email: "", phone_number: "" });
    expect(found).toEqual([]);
  });

  it("does not match a blank draft email against a customer with no email", () => {
    const found = findDuplicateCustomers(EXISTING, {
      email: "",
      phone_number: "4165559999",
    });
    expect(found).toEqual([]);
  });

  it("returns every match when email and phone hit different customers", () => {
    const found = findDuplicateCustomers(EXISTING, {
      email: "ada@example.com",
      phone_number: "4165550222",
    });
    expect(found.map((c) => c.id).sort()).toEqual(["1", "3"]);
  });

  it("tolerates a null customer list and null rows", () => {
    expect(findDuplicateCustomers(null, { email: "a@b.c" })).toEqual([]);
    expect(findDuplicateCustomers([null], { email: "a@b.c" })).toEqual([]);
  });
});
