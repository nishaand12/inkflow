/**
 * Exercises buildFilterQuery's operator handling through the real client by
 * stubbing the supabase query builder. These operators are what keep pages
 * from falling back to full-table reads.
 */

const calls = [];

function makeBuilder() {
  const builder = {};
  const record = (name) => (...args) => {
    calls.push([name, ...args]);
    return builder;
  };
  for (const method of ["select", "eq", "in", "gte", "lte", "gt", "lt", "ilike", "order", "range"]) {
    builder[method] = record(method);
  }
  builder.then = (resolve) => resolve({ data: [], error: null });
  return builder;
}

jest.mock("@/utils/supabase", () => ({
  supabase: { from: (...args) => {
    calls.push(["from", ...args]);
    return makeBuilderRef();
  } },
}));

let makeBuilderRef = makeBuilder;

const { base44 } = require("./base44Client");

beforeEach(() => {
  calls.length = 0;
});

const callNames = () => calls.map((c) => c[0]);
const callFor = (name) => calls.find((c) => c[0] === name);

describe("buildFilterQuery operators", () => {
  it("uses eq for a scalar value", async () => {
    await base44.entities.Customer.filter({ studio_id: "s1" });
    expect(callFor("eq")).toEqual(["eq", "studio_id", "s1"]);
    expect(callNames()).not.toContain("in");
  });

  it("uses in for an array value", async () => {
    await base44.entities.SaleLineItem.filter({ sale_id: ["a", "b"] });
    expect(callFor("in")).toEqual(["in", "sale_id", ["a", "b"]]);
  });

  it("uses range operators for an object value", async () => {
    await base44.entities.Appointment.filter({
      appointment_date: { gte: "2026-07-01", lte: "2026-07-31" },
    });
    expect(callFor("gte")).toEqual(["gte", "appointment_date", "2026-07-01"]);
    expect(callFor("lte")).toEqual(["lte", "appointment_date", "2026-07-31"]);
  });

  it("supports ilike as an operator", async () => {
    await base44.entities.Customer.filter({ name: { ilike: "%ada%" } });
    expect(callFor("ilike")).toEqual(["ilike", "name", "%ada%"]);
  });

  it("rejects an unknown operator rather than silently ignoring it", async () => {
    await expect(
      base44.entities.Customer.filter({ name: { startsWith: "a" } })
    ).rejects.toThrow(/Unsupported filter operator "startsWith"/);
  });

  it("skips null and undefined values instead of filtering on them", async () => {
    await base44.entities.Customer.filter({ studio_id: "s1", email: null, phone: undefined });
    const eqCalls = calls.filter((c) => c[0] === "eq");
    expect(eqCalls).toHaveLength(1);
  });

  it("applies limit as a range window", async () => {
    await base44.entities.Customer.filter({ studio_id: "s1" }, null, { limit: 50, offset: 100 });
    expect(callFor("range")).toEqual(["range", 100, 149]);
  });
});
