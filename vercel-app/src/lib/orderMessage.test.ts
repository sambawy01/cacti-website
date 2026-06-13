import { describe, it, expect } from "vitest";
import { buildOrderMessage, keyboardForStatus, actionToStatus, slotLabel, delayKeyboard, delayActionMinutes } from "./orderMessage";

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

  it("includes a 📍 location line (after the address) when location is present", () => {
    const t = buildOrderMessage({ ...order, location: "https://maps.app.goo.gl/abc" });
    expect(t).toContain("📍 https://maps.app.goo.gl/abc");
    const lines = t.split("\n");
    const addrIdx = lines.indexOf(`📍 ${order.address}`);
    const locIdx = lines.indexOf("📍 https://maps.app.goo.gl/abc");
    expect(addrIdx).toBeGreaterThanOrEqual(0);
    expect(locIdx).toBe(addrIdx + 1);
  });

  it("omits the location line when location is absent", () => {
    const t = buildOrderMessage(order);
    // Only the address renders with 📍 — exactly one occurrence.
    expect(t.split("📍").length - 1).toBe(1);
  });
});

describe("keyboardForStatus", () => {
  it("offers Approve/Decline for pending_approval, carrying the token", () => {
    const k = keyboardForStatus("pending_approval", "abc-123");
    const flat = k.inline_keyboard.flat();
    expect(flat.some((b) => b.callback_data === "approve:abc-123")).toBe(true);
    expect(flat.some((b) => b.callback_data === "decline:abc-123")).toBe(true);
  });

  it("offers Preparing + Cancel + Running late for confirmed", () => {
    const k = keyboardForStatus("confirmed", "abc-123");
    const flat = k.inline_keyboard.flat();
    expect(flat.some((b) => b.callback_data === "preparing:abc-123")).toBe(true);
    expect(flat.some((b) => b.callback_data === "cancel:abc-123")).toBe(true);
    expect(flat.some((b) => b.callback_data === "delay:abc-123")).toBe(true);
    expect(flat.some((b) => b.text === "⏰ Running late")).toBe(true);
  });

  it("offers Out for delivery + Cancel + Running late for preparing", () => {
    const k = keyboardForStatus("preparing", "abc-123");
    const flat = k.inline_keyboard.flat();
    expect(flat.some((b) => b.callback_data === "otd:abc-123")).toBe(true);
    expect(flat.some((b) => b.callback_data === "cancel:abc-123")).toBe(true);
    expect(flat.some((b) => b.callback_data === "delay:abc-123")).toBe(true);
  });

  it("does NOT show the Running late button on pending_approval, out_for_delivery, or terminal states", () => {
    expect(keyboardForStatus("pending_approval", "t").inline_keyboard.flat().some((b) => b.callback_data === "delay:t")).toBe(false);
    expect(keyboardForStatus("out_for_delivery", "t").inline_keyboard.flat().some((b) => b.callback_data === "delay:t")).toBe(false);
    expect(keyboardForStatus("delivered", "t").inline_keyboard.flat().some((b) => b.callback_data === "delay:t")).toBe(false);
  });

  it("offers Delivered for out_for_delivery and no buttons for terminal states", () => {
    expect(keyboardForStatus("out_for_delivery", "t").inline_keyboard.flat().some((b) => b.callback_data === "delivered:t")).toBe(true);
    expect(keyboardForStatus("delivered", "t").inline_keyboard.flat().length).toBe(0);
  });
});

describe("delayKeyboard", () => {
  it("offers +15 / +30 / +60 and Back, all carrying the token", () => {
    const k = delayKeyboard("abc-123");
    const flat = k.inline_keyboard.flat();
    expect(flat.some((b) => b.callback_data === "delay15:abc-123")).toBe(true);
    expect(flat.some((b) => b.callback_data === "delay30:abc-123")).toBe(true);
    expect(flat.some((b) => b.callback_data === "delay60:abc-123")).toBe(true);
    expect(flat.some((b) => b.callback_data === "delayback:abc-123")).toBe(true);
    // Three +N buttons on the first row, Back on the second.
    expect(k.inline_keyboard[0]).toHaveLength(3);
    expect(k.inline_keyboard[1]).toHaveLength(1);
  });
});

describe("delayActionMinutes", () => {
  it("maps delay15/30/60 to minutes and returns null for everything else", () => {
    expect(delayActionMinutes("delay15")).toBe(15);
    expect(delayActionMinutes("delay30")).toBe(30);
    expect(delayActionMinutes("delay60")).toBe(60);
    expect(delayActionMinutes("delay")).toBeNull();
    expect(delayActionMinutes("delayback")).toBeNull();
    expect(delayActionMinutes("approve")).toBeNull();
    expect(delayActionMinutes("bogus")).toBeNull();
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

  it("returns null for all delay actions (they are not status changes)", () => {
    expect(actionToStatus("delay")).toBeNull();
    expect(actionToStatus("delay15")).toBeNull();
    expect(actionToStatus("delay30")).toBeNull();
    expect(actionToStatus("delay60")).toBeNull();
    expect(actionToStatus("delayback")).toBeNull();
  });
});

describe("slotLabel", () => {
  it("formats 24h to 12h", () => {
    expect(slotLabel("14:30")).toBe("2:30 PM");
    expect(slotLabel("20:00")).toBe("8:00 PM");
  });
});
