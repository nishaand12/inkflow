import { saleServiceProductNet } from "./saleLines";

describe("saleServiceProductNet", () => {
  it("buckets net and tax by line type using each line's own rate", () => {
    const lines = [
      { line_type: "service", quantity: 1, unit_price: 100, tax_rate: 0.13 },
      { line_type: "product", quantity: 2, unit_price: 25, tax_rate: 0.13 },
      { line_type: "product", quantity: 1, unit_price: 40, tax_rate: 0 }, // gift card
    ];
    const { service, product, serviceTax, productTax } = saleServiceProductNet(lines);
    expect(service).toBeCloseTo(100);
    expect(product).toBeCloseTo(90);
    expect(serviceTax).toBeCloseTo(13);
    expect(productTax).toBeCloseTo(6.5);
  });

  it("keeps tax buckets exact for tax-inclusive pricing", () => {
    const lines = [
      { line_type: "service", quantity: 1, unit_price: 113, tax_rate: 0.13, tax_inclusive: true },
    ];
    const { service, serviceTax } = saleServiceProductNet(lines);
    expect(service).toBeCloseTo(100);
    expect(serviceTax).toBeCloseTo(13);
  });

  it("nets line discounts before tax and split buckets", () => {
    const lines = [
      { line_type: "service", quantity: 1, unit_price: 100, discount_amount: 20, tax_rate: 0.13 },
    ];
    const { service, serviceTax } = saleServiceProductNet(lines);
    expect(service).toBeCloseTo(80);
    expect(serviceTax).toBeCloseTo(10.4);
  });

  it("clamps negative buckets at zero", () => {
    const lines = [
      { line_type: "service", quantity: 1, unit_price: 50, tax_rate: 0.13, revenue_sign: "negative" },
    ];
    const { service, serviceTax } = saleServiceProductNet(lines);
    expect(service).toBe(0);
    expect(serviceTax).toBe(0);
  });
});
