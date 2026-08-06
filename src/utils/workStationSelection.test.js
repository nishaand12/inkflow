import {
  pickPreferredWorkStationId,
  sortStationsForDefault,
} from "./workStationSelection";

describe("sortStationsForDefault", () => {
  it("sorts by created_at then name", () => {
    const sorted = sortStationsForDefault([
      { id: "b", name: "B", created_at: "2026-02-01T00:00:00Z" },
      { id: "a2", name: "Z", created_at: "2026-01-01T00:00:00Z" },
      { id: "a1", name: "A", created_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["a1", "a2", "b"]);
  });
});

describe("pickPreferredWorkStationId", () => {
  const stations = [
    { id: "ws-old", name: "Old", created_at: "2026-01-01T00:00:00Z" },
    { id: "ws-pref", name: "Preferred", created_at: "2026-03-01T00:00:00Z" },
    { id: "ws-new", name: "New", created_at: "2026-02-01T00:00:00Z" },
  ];

  it("returns empty string when no stations are available", () => {
    expect(pickPreferredWorkStationId([], "ws-pref")).toBe("");
  });

  it("selects the artist's preferred station when it is free", () => {
    expect(pickPreferredWorkStationId(stations, "ws-pref")).toBe("ws-pref");
  });

  it("falls back to the first station by default ordering when preferred is booked", () => {
    const withoutPreferred = stations.filter((s) => s.id !== "ws-pref");
    expect(pickPreferredWorkStationId(withoutPreferred, "ws-pref")).toBe("ws-old");
  });

  it("falls back to first station when no preferred is configured", () => {
    expect(pickPreferredWorkStationId(stations, null)).toBe("ws-old");
    expect(pickPreferredWorkStationId(stations, "")).toBe("ws-old");
  });
});
