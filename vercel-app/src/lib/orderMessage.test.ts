import { describe, it, expect } from "vitest";
import { buildOrderMessage, keyboardForStatus, actionToStatus, slotLabel } from "./orderMessage";

const order = {
  name: "Sara Ali",
  phone: "+201001234567",
  email: "sara@example.com",
  address: "12 West Golf",
  orderSummary: "2x Grilled Chicken (400 EGP)",
  orderTotal: 400,
  itemCount: 2,
  deliverySlot: "14:30",
  paymentMethod: "card_on_delivery" as const,
  trackingToken: "abc-123",
  status: "confirmed" as const,
};

describe("buildOrderMessage", () => {
  it("includes name, slot label, total, payment, and items", () => {
    const t = buildOrderMessage(order);
    expect(t).toContain("Sara Ali");
    expect(t).toContain("2:30 PM");
    expect(t).toContain("400 EGP");
    expect(t).toContain("Card on delivery");
    expect(t).toContain("Grilled Chicken");
    expect(t).toContain("+201001234567");
  });

  it("includes the note line when note is present", () => {
    const t = buildOrderMessage({ ...order, note: "No nuts please" });
    expect(t).toContain("📝 No nuts please");
  });

  it("omits the note line when note is absent", () => {
    const t = buildOrderMessage(order);
    expect(t).not.toContain("📝");
  });
});

describe("keyboardForStatus", () => {
  it("offers Approve/Decline for pending_approval, carrying the token", () => {
    const k = keyboardForStatus("pending_approval", "abc-123");
    const flat = k.inline_keyboard.flat();
    expect(flat.some((b) => b.callback_data === "approve:abc-123")).toBe(true);
    expect(flat.some((b) => b.callback_data === "decline:abc-123")).toBe(true);
  });

  it("offers Preparing + Cancel for confirmed", () => {
    const k = keyboardForStatus("confirmed", "abc-123");
    const flat = k.inline_keyboard.flat();
    expect(flat.some((b) => b.callback_data === "preparing:abc-123")).toBe(true);
    expect(flat.some((b) => b.callback_data === "cancel:abc-123")).toBe(true);
  });

  it("offers Delivered for out_for_delivery and no buttons for terminal states", () => {
    expect(keyboardForStatus("out_for_delivery", "t").inline_keyboard.flat().some((b) => b.callback_data === "delivered:t")).toBe(true);
    expect(keyboardForStatus("delivered", "t").inline_keyboard.flat().length).toBe(0);
  });
});

describe("actionToStatus", () => {
  it("maps each button action to a status", () => {
    expect(actionToStatus("approve")).toBe("confirmed");
    expect(actionToStatus("decline")).toBe("declined");
    expect(actionToStatus("preparing")).toBe("preparing");
    expect(actionToStatus("otd")).toBe("out_for_delivery");
    expect(actionToStatus("delivered")).toBe("delivered");
    expect(actionToStatus("cancel")).toBe("cancelled");
    expect(actionToStatus("bogus")).toBeNull();
  });
});

describe("slotLabel", () => {
  it("formats 24h to 12h", () => {
    expect(slotLabel("14:30")).toBe("2:30 PM");
    expect(slotLabel("20:00")).toBe("8:00 PM");
  });
});
