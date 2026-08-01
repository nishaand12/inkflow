import { containsPattern, escapeLikeTerm } from "@/utils/likePattern";

describe("escapeLikeTerm", () => {
  it("leaves ordinary terms untouched", () => {
    expect(escapeLikeTerm("Katie Moore")).toBe("Katie Moore");
  });

  it("escapes % so it cannot act as a wildcard", () => {
    // Unescaped, "100%" would match far more than the user typed.
    expect(escapeLikeTerm("100%")).toBe("100\\%");
  });

  it("escapes _ so it cannot match any single character", () => {
    expect(escapeLikeTerm("a_b")).toBe("a\\_b");
  });

  it("escapes backslashes before they can escape something else", () => {
    expect(escapeLikeTerm("a\\b")).toBe("a\\\\b");
  });

  it("handles nullish input without throwing", () => {
    expect(escapeLikeTerm(null)).toBe("");
    expect(escapeLikeTerm(undefined)).toBe("");
  });
});

describe("containsPattern", () => {
  it("wraps the escaped term in wildcards", () => {
    expect(containsPattern("ada")).toBe("%ada%");
  });

  it("keeps user wildcards inert", () => {
    expect(containsPattern("50%")).toBe("%50\\%%");
  });
});
