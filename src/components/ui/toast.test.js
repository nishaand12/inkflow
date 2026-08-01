import {
  clearToasts,
  dismissToast,
  getToasts,
  showErrorToast,
  showToast,
  subscribeToToasts,
} from "./toast";

beforeEach(() => {
  clearToasts();
});

describe("toast store", () => {
  it("adds an error toast and notifies subscribers", () => {
    const seen = [];
    const unsubscribe = subscribeToToasts((items) => seen.push(items.length));

    showErrorToast("Could not save.");

    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0]).toMatchObject({
      message: "Could not save.",
      variant: "error",
    });
    expect(seen[seen.length - 1]).toBe(1);
    unsubscribe();
  });

  it("ignores empty or non-string messages so a blank error never shows a blank toast", () => {
    expect(showErrorToast("")).toBeNull();
    expect(showErrorToast("   ")).toBeNull();
    expect(showErrorToast(undefined)).toBeNull();
    expect(showErrorToast(null)).toBeNull();
    expect(getToasts()).toHaveLength(0);
  });

  it("dismisses by id and leaves other toasts alone", () => {
    const first = showErrorToast("first");
    showErrorToast("second");

    dismissToast(first);

    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0].message).toBe("second");
  });

  it("auto-dismisses after the configured duration", () => {
    jest.useFakeTimers();
    try {
      showToast({ message: "temporary", duration: 1000 });
      expect(getToasts()).toHaveLength(1);

      jest.advanceTimersByTime(1000);
      expect(getToasts()).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("stops notifying after unsubscribe", () => {
    let calls = 0;
    const unsubscribe = subscribeToToasts(() => {
      calls += 1;
    });
    const afterSubscribe = calls;

    unsubscribe();
    showErrorToast("ignored by this listener");

    expect(calls).toBe(afterSubscribe);
  });

  it("supports multiple concurrent toasts", () => {
    showErrorToast("one");
    showErrorToast("two");
    showErrorToast("three");
    expect(getToasts().map((t) => t.message)).toEqual(["one", "two", "three"]);
  });
});
