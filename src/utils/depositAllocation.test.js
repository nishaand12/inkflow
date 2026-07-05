import {
  allocatePaidDepositToBuckets,
  allocatePaidDepositToMethodLabels,
} from "./depositAllocation";

describe("allocatePaidDepositToMethodLabels", () => {
  it("labels Stripe checkout deposits by session id even without metadata", () => {
    const labels = allocatePaidDepositToMethodLabels(50, [
      {
        payment_type: "deposit",
        status: "paid",
        amount: 50,
        stripe_checkout_session_id: "cs_test_123",
        metadata: { appointment_id: "apt-1" },
      },
    ]);
    expect(labels).toEqual({ Stripe: 50 });
  });

  it("labels in-person deposits with their checkout method", () => {
    const labels = allocatePaidDepositToMethodLabels(40, [
      {
        payment_type: "deposit",
        status: "paid",
        amount: 40,
        metadata: { collection_channel: "in_person", method: "Cash" },
      },
    ]);
    expect(labels).toEqual({ Cash: 40 });
  });

  it("defaults legacy paid deposits without payment rows to Stripe", () => {
    expect(allocatePaidDepositToMethodLabels(25, [])).toEqual({ Stripe: 25 });
  });
});

describe("allocatePaidDepositToBuckets", () => {
  it("puts Stripe checkout deposits in the online bucket", () => {
    const buckets = allocatePaidDepositToBuckets(75, [
      {
        payment_type: "deposit",
        status: "paid",
        amount: 75,
        stripe_checkout_session_id: "cs_test_456",
        metadata: { appointment_id: "apt-2" },
      },
    ]);
    expect(buckets).toEqual({ online: 75, cash: 0, terminal: 0 });
  });
});
