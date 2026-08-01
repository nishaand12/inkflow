import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCustomersByIds } from "./useCustomersByIds";

// A plain function, not jest.fn: this project's CRA jest config sets
// resetMocks, which strips implementations from jest.fn() before each test and
// would leave the query function returning undefined.
jest.mock("@/api/base44Client", () => ({
  base44: { entities: { Customer: { filter: () => Promise.resolve([]) } } },
}));

global.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Renders the hook `renders` times and reports every value it returned, plus
 * which passes re-ran an effect that depends on that value.
 */
async function renderHookTimes(renders, hookArgs) {
  const results = [];
  const effectRuns = [];
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Probe({ pass }) {
    const customers = useCustomersByIds(...hookArgs);
    results.push(customers);

    // Mirrors AppointmentDialog: an effect that resets form state and lists
    // the hook's result among its dependencies.
    useEffect(() => {
      effectRuns.push(pass);
    }, [customers]);

    return null;
  }

  const container = document.createElement("div");
  const root = createRoot(container);

  for (let pass = 0; pass < renders; pass++) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe pass={pass} />
        </QueryClientProvider>
      );
    });
  }

  // Let any in-flight fetch settle before unmounting; tearing down mid-flight
  // makes react-query log a cancelled-query warning that has nothing to do
  // with what these tests assert.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  await act(async () => root.unmount());
  client.clear();
  return { results, effectRuns };
}

describe("useCustomersByIds", () => {
  it("returns a referentially stable array when there are no ids", async () => {
    // A new appointment has no customer yet, so the query stays disabled and
    // react-query's data is undefined. This is the case that broke the
    // appointment-type selector: a fresh [] each render re-ran the dialog's
    // reset effect, wiping the selection as the user made it.
    const { results, effectRuns } = await renderHookTimes(4, ["studio-1", []]);

    expect(results).toHaveLength(4);
    for (const value of results) {
      expect(value).toBe(results[0]);
    }
    // The dependent effect runs once, not once per render.
    expect(effectRuns).toEqual([0]);
  });

  it("stays stable when the caller passes a fresh array literal each render", async () => {
    // AppointmentDialog builds `[appointment.customer_id]` inline, so the ids
    // array has a new identity on every render.
    const { results, effectRuns } = await renderHookTimes(4, [
      "studio-1",
      ["cust-1"],
    ]);

    // The reference may change once, when the fetched data replaces the empty
    // placeholder. What it must never do is change on every render — that is
    // what re-ran the dialog's reset effect and cleared the selection.
    const distinctReferences = new Set(results).size;
    expect(distinctReferences).toBeLessThanOrEqual(2);
    expect(effectRuns.length).toBeLessThanOrEqual(2);
  });

  it("is stable when there is no studio id at all", async () => {
    const { results, effectRuns } = await renderHookTimes(3, [undefined, []]);

    for (const value of results) {
      expect(value).toBe(results[0]);
    }
    expect(effectRuns).toEqual([0]);
  });
});
