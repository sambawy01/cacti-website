import { describe, it, expect } from "vitest";
import { validateOrderPayload } from "./validation";

const valid = {
  items: [{ name: "Grilled Chicken", quantity: 2, price: 200 }],
  name: "Sara Ali",
  phone: "+201001234567",
  email: "sara@example.com",
  address: "12 West Golf, El Gouna",
  deliverySlot: "14:30",
  expectedStatus: "open",
  paymentMethod: "cod",
  note: "",
};

describe("validateOrderPayload", () => {
  it("accepts a valid payload and normalizes it", () => {
    const r = validateOrderPayload(valid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email).toBe("sara@example.com");
      expect(r.value.itemCount).toBe(2);
      expect(r.value.orderTotal).toBe(400);
      expect(r.value.orderSummary).toContain("2x Grilled Chicken");
      expect(r.value.paymentMethod).toBe("cod");
    }
  });

  it("REQUIRES email (the key Phase 1 rule)", () => {
    expect(validateOrderPayload({ ...valid, email: "" }).ok).toBe(false);
    expect(validateOrderPayload({ ...valid, email: "not-an-email" }).ok).toBe(false);
    const { email, ...noEmail } = valid;
    expect(validateOrderPayload(noEmail).ok).toBe(false);
  });

  it("rejects missing/short name, bad phone, short address", () => {
    expect(validateOrderPayload({ ...valid, name: "" }).ok).toBe(false);
    expect(validateOrderPayload({ ...valid, name: "A" }).ok).toBe(false);
    expect(validateOrderPayload({ ...valid, phone: "abc" }).ok).toBe(false);
    expect(validateOrderPayload({ ...valid, address: "x" }).ok).toBe(false);
  });

  it("rejects an empty cart and an over-large cart", () => {
    expect(validateOrderPayload({ ...valid, items: [] }).ok).toBe(false);
    const many = Array.from({ length: 51 }, () => ({ name: "x", quantity: 1, price: 1 }));
    expect(validateOrderPayload({ ...valid, items: many }).ok).toBe(false);
  });

  it("only allows the three Phase-1 payment methods", () => {
    expect(validateOrderPayload({ ...valid, paymentMethod: "cod" }).ok).toBe(true);
    expect(validateOrderPayload({ ...valid, paymentMethod: "card_on_delivery" }).ok).toBe(true);
    expect(validateOrderPayload({ ...valid, paymentMethod: "instapay" }).ok).toBe(true);
    expect(validateOrderPayload({ ...valid, paymentMethod: "bitcoin" }).ok).toBe(false);
    expect(validateOrderPayload({ ...valid, paymentMethod: "card_online" }).ok).toBe(false);
  });

  it("validates deliverySlot format and expectedStatus", () => {
    expect(validateOrderPayload({ ...valid, deliverySlot: "2pm" }).ok).toBe(false);
    expect(validateOrderPayload({ ...valid, expectedStatus: "maybe" }).ok).toBe(false);
  });

  it("clamps item quantities and rejects non-positive", () => {
    expect(validateOrderPayload({ ...valid, items: [{ name: "x", quantity: 0, price: 5 }] }).ok).toBe(false);
    const r = validateOrderPayload({ ...valid, items: [{ name: "x", quantity: 1000, price: 5 }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.itemCount).toBeLessThanOrEqual(200);
  });

  it("strips newlines/control chars from name, address, and item names (Telegram spoofing guard)", () => {
    const r = validateOrderPayload({
      ...valid,
      name: "Ahmed\n💳 PAID IN FULL",
      address: "12 West Golf\n\nTotal: 0 EGP",
      items: [{ name: "Chicken\nFREE", quantity: 1, price: 100 }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe("Ahmed 💳 PAID IN FULL");
      expect(r.value.name).not.toContain("\n");
      expect(r.value.address).not.toContain("\n");
      expect(r.value.orderSummary).not.toContain("\n  "); // item names are single-line
      expect(r.value.orderSummary).toContain("Chicken FREE");
    }
  });

  it("rejects a name that is only control characters (collapses to empty)", () => {
    expect(validateOrderPayload({ ...valid, name: "\n\t\r" }).ok).toBe(false);
  });
});
