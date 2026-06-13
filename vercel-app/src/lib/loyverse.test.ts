import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildReceiptBody,
  pushReceipt,
  parseOrderSummary,
  normalizeName,
  loyverseConfigured,
  __resetCacheForTests,
  type LoyverseOrder,
  type VariantMap,
} from "./loyverse";

const PAY = {
  cod: "1252b529-b628-4408-aaa6-1bfb7a0c5d43",
  card: "77c7ac0a-f82b-46c1-a2e7-c39810bb88fd",
  instapay: "a2b2d5bb-10e9-4842-9850-7993c0d2dcde",
};

function order(over: Partial<LoyverseOrder> = {}): LoyverseOrder {
  return {
    items: [{ name: "Grilled Chicken", quantity: 2, price: 200 }],
    name: "Sara Ali",
    phone: "+201001234567",
    address: "12 West Golf, El Gouna",
    deliverySlot: "14:30",
    paymentMethod: "instapay",
    orderTotal: 400,
    trackingToken: "tok-9",
    ...over,
  };
}

// A minimal Response-like object for mocked fetch.
function res(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

beforeEach(() => {
  __resetCacheForTests();
  process.env.LOYVERSE_TOKEN = "test-token";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("normalizeName", () => {
  it("lowercases and strips every non-alphanumeric char", () => {
    expect(normalizeName("Grilled Chicken!")).toBe("grilledchicken");
    expect(normalizeName("Caesar  Salad (Large)")).toBe("caesarsaladlarge");
  });
});

describe("loyverseConfigured", () => {
  it("is true only when the token is set", () => {
    process.env.LOYVERSE_TOKEN = "x";
    expect(loyverseConfigured()).toBe(true);
    delete process.env.LOYVERSE_TOKEN;
    expect(loyverseConfigured()).toBe(false);
  });
});

describe("buildReceiptBody", () => {
  const map: VariantMap = { grilledchicken: "V1" };

  it("maps a catalog item to a variant_id line item", () => {
    const body = buildReceiptBody(order(), map);
    expect(body.line_items).toHaveLength(1);
    expect(body.line_items[0]).toEqual({ variant_id: "V1", quantity: 2, price: 200 });
    expect((body.line_items[0] as { item_name?: string }).item_name).toBeUndefined();
  });

  it("falls back to a custom (item_name) line item for an unmatched item", () => {
    const body = buildReceiptBody(order({ items: [{ name: "Mystery Dish", quantity: 1, price: 75 }] }), map);
    expect(body.line_items[0]).toEqual({ item_name: "Mystery Dish", quantity: 1, price: 75 });
    expect((body.line_items[0] as { variant_id?: string }).variant_id).toBeUndefined();
  });

  it("mixes catalog + custom line items in one receipt", () => {
    const body = buildReceiptBody(
      order({ items: [
        { name: "Grilled Chicken", quantity: 1, price: 200 },
        { name: "Brand New Salad", quantity: 2, price: 50 },
      ] }),
      map,
    );
    expect(body.line_items[0]).toMatchObject({ variant_id: "V1" });
    expect(body.line_items[1]).toMatchObject({ item_name: "Brand New Salad" });
  });

  it("selects the correct payment_type_id per method and uses the order total", () => {
    expect(buildReceiptBody(order({ paymentMethod: "cod" }), map).payments).toEqual([
      { payment_type_id: PAY.cod, money_amount: 400 },
    ]);
    expect(buildReceiptBody(order({ paymentMethod: "card_on_delivery" }), map).payments[0].payment_type_id).toBe(PAY.card);
    expect(buildReceiptBody(order({ paymentMethod: "instapay" }), map).payments[0].payment_type_id).toBe(PAY.instapay);
  });

  it("builds a note with name, phone, address, slot and tracking token", () => {
    const body = buildReceiptBody(order(), map);
    expect(body.note).toContain("Sara Ali");
    expect(body.note).toContain("+201001234567");
    expect(body.note).toContain("12 West Golf, El Gouna");
    expect(body.note).toContain("14:30");
    expect(body.note).toContain("tok-9");
  });

  it("appends a Location: line to the note when location is present", () => {
    const body = buildReceiptBody(order({ location: "https://maps.app.goo.gl/abc" }), {});
    expect(body.note).toContain("Location: https://maps.app.goo.gl/abc");
  });

  it("omits the Location: line from the note when location is absent", () => {
    const body = buildReceiptBody(order(), {});
    expect(body.note).not.toContain("Location:");
  });

  it("sets store, device, source and an ISO receipt_date", () => {
    const body = buildReceiptBody(order(), map);
    expect(body.store_id).toBe("39af263c-0119-49b8-9dc0-4fe99d35acba");
    expect(body.pos_device_id).toBe("d565e82e-52c5-48c6-83f1-b20e437d50bc");
    expect(body.source).toBe("Website");
    expect(() => new Date(body.receipt_date).toISOString()).not.toThrow();
  });
});

describe("parseOrderSummary", () => {
  it("parses the validation summary format into per-unit line items", () => {
    const items = parseOrderSummary("2x Grilled Chicken (400 EGP)\n1x Caesar Salad (90 EGP)");
    expect(items).toEqual([
      { name: "Grilled Chicken", quantity: 2, price: 200 },
      { name: "Caesar Salad", quantity: 1, price: 90 },
    ]);
  });

  it("skips unparseable lines and returns [] when nothing parses", () => {
    expect(parseOrderSummary("garbage line\n")).toEqual([]);
  });
});

describe("pushReceipt", () => {
  it("posts and returns ok + receiptNumber on success (catalog-mapped)", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (String(url).includes("/items")) {
        return res({ items: [{ item_name: "Grilled Chicken", variants: [{ variant_id: "V1" }] }], cursor: null });
      }
      return res({ receipt_number: "1-1001" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await pushReceipt(order());
    expect(r.ok).toBe(true);
    expect(r.receiptNumber).toBe("1-1001");

    const receiptCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/receipts"));
    const posted = JSON.parse((receiptCall![1] as RequestInit).body as string);
    expect(posted.line_items[0]).toMatchObject({ variant_id: "V1", quantity: 2, price: 200 });
  });

  it("returns {ok:false} and does NOT throw on a Loyverse HTTP error", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (String(url).includes("/items")) return res({ items: [], cursor: null });
      return res("rate limited", false, 429);
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await pushReceipt(order());
    expect(r.ok).toBe(false);
    expect(r.error).toContain("429");
  });

  it("falls back to a custom line item when the variant-map fetch fails", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (String(url).includes("/items")) return res("boom", false, 500);
      return res({ receipt_number: "1-1002" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await pushReceipt(order());
    expect(r.ok).toBe(true);

    const receiptCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/receipts"));
    const posted = JSON.parse((receiptCall![1] as RequestInit).body as string);
    // No catalog map -> the item becomes a custom (item_name) line item.
    expect(posted.line_items[0]).toMatchObject({ item_name: "Grilled Chicken" });
    expect(posted.line_items[0].variant_id).toBeUndefined();
  });

  it("is dormant (ok:false, no fetch) when the token is not configured", async () => {
    delete process.env.LOYVERSE_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const r = await pushReceipt(order());
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
