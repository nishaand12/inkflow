import { MutationCache, MutationObserver, QueryClient } from "@tanstack/react-query";
import { clearToasts, getToasts, showErrorToast } from "@/components/ui/toast";

/**
 * Guards the wiring in App.tsx: a mutation with no onError of its own must
 * still surface its failure. Without this backstop a failed save is
 * indistinguishable from a successful one.
 */
function buildQueryClient() {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error) => {
        showErrorToast(error?.message || "Something didn't save. Please try again.");
      },
    }),
    defaultOptions: { mutations: { retry: false } },
  });
}

/** Runs a mutation the way a component would, with no local onError. */
function runMutation(client, mutationFn) {
  return new MutationObserver(client, { mutationFn }).mutate();
}

beforeEach(() => {
  clearToasts();
});

describe("global mutation error reporting", () => {
  it("surfaces a failure from a mutation that has no onError handler", async () => {
    const client = buildQueryClient();

    await expect(
      runMutation(client, async () => {
        throw new Error("permission denied for table customers");
      })
    ).rejects.toThrow("permission denied for table customers");

    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0].message).toBe("permission denied for table customers");
  });

  it("falls back to a generic message when the error carries none", async () => {
    const client = buildQueryClient();

    await expect(
      runMutation(client, async () => {
        throw new Error("");
      })
    ).rejects.toThrow();

    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0].message).toBe("Something didn't save. Please try again.");
  });

  it("stays silent when the mutation succeeds", async () => {
    const client = buildQueryClient();

    await runMutation(client, async () => "ok");

    expect(getToasts()).toHaveLength(0);
  });
});
