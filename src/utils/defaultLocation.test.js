import {
  PREFERRED_DEFAULT_LOCATION_NAME,
  resolvePreferredDefaultLocationId,
  sortLocationsByCreatedAt,
} from "./defaultLocation";

describe("sortLocationsByCreatedAt", () => {
  it("sorts by created_at ascending", () => {
    const sorted = sortLocationsByCreatedAt([
      { id: "b", created_at: "2026-02-01T00:00:00Z" },
      { id: "a", created_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(sorted.map((l) => l.id)).toEqual(["a", "b"]);
  });
});

describe("resolvePreferredDefaultLocationId", () => {
  it("returns empty string when there are no active locations", () => {
    expect(resolvePreferredDefaultLocationId([])).toBe("");
    expect(
      resolvePreferredDefaultLocationId([{ id: "x", name: "Closed", is_active: false }])
    ).toBe("");
  });

  it("prefers New Tribe Studio when it is active", () => {
    const id = resolvePreferredDefaultLocationId([
      {
        id: "other",
        name: "Other Shop",
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "nts",
        name: PREFERRED_DEFAULT_LOCATION_NAME,
        is_active: true,
        created_at: "2026-03-01T00:00:00Z",
      },
    ]);
    expect(id).toBe("nts");
  });

  it("matches preferred name case-insensitively", () => {
    const id = resolvePreferredDefaultLocationId([
      {
        id: "nts",
        name: "new tribe studio",
        is_active: true,
        created_at: "2026-03-01T00:00:00Z",
      },
    ]);
    expect(id).toBe("nts");
  });

  it("ignores inactive New Tribe Studio and falls back to earliest active", () => {
    const id = resolvePreferredDefaultLocationId([
      {
        id: "nts",
        name: PREFERRED_DEFAULT_LOCATION_NAME,
        is_active: false,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "b",
        name: "Second",
        is_active: true,
        created_at: "2026-02-01T00:00:00Z",
      },
      {
        id: "a",
        name: "First",
        is_active: true,
        created_at: "2026-01-15T00:00:00Z",
      },
    ]);
    expect(id).toBe("a");
  });
});
