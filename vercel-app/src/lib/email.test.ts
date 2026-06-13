import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  emailConfigured,
  escapeHtml,
  wrap,
  trackingUrl,
  confirmationEmail,
  statusEmail,
  delayEmail,
  declineEmail,
  sendEmail,
} from "./email";

describe("escapeHtml", () => {
  it("escapes &, <, >, \" and coerces null/undefined to empty", () => {
    expect(escapeHtml('<a href="x">Tom & Jerry</a>')).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/a&gt;",
    );
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(400)).toBe("400");
  });
});

describe("wrap", () => {
  it("wraps inner HTML in the branded shell with brand colors + footer link", () => {
    const html = wrap("<p>hi</p>");
    expect(html).toContain("<p>hi</p>");
    expect(html).toContain("Bistro Cloud");
    expect(html).toContain("#2C3E50"); // header
    expect(html).toContain("#F9F5F0"); // background
    expect(html).toContain('href="https://bistro-cloud.com"');
  });
});

describe("trackingUrl", () => {
  it("builds the track URL with the token", () => {
    expect(trackingUrl("abc123")).toBe("https://bistro-cloud.com/track?token=abc123");
  });
});

describe("confirmationEmail", () => {
  const base = {
    name: "Sara Ali",
    orderSummary: "2x Grilled Chicken (400 EGP)",
    orderTotal: 400,
    deliverySlot: "14:30",
    paymentMethod: "cod" as const,
    trackingToken: "tok-9",
  };

  it("includes the name, total, 12h slot label and the track URL", () => {
    const { subject, html } = confirmationEmail(base);
    expect(html).toContain("Order confirmed, Sara Ali!");
    expect(html).toContain("Total: 400 EGP");
    expect(html).toContain("2:30 PM"); // 14:30 → 2:30 PM
    expect(html).toContain("https://bistro-cloud.com/track?token=tok-9");
    expect(html).toContain("Track your order");
    expect(subject).toBe("Bistro Cloud — order confirmed for 2:30 PM");
  });

  it("shows a payment line for the method", () => {
    expect(confirmationEmail({ ...base, paymentMethod: "cod" }).html).toContain("Cash on delivery");
    expect(confirmationEmail({ ...base, paymentMethod: "card_on_delivery" }).html).toContain(
      "Card on delivery",
    );
  });

  it("renders the instapay bank block ONLY for instapay with details", () => {
    const withBank = confirmationEmail({
      ...base,
      paymentMethod: "instapay",
      instapayDetails: "Bank: CIB, Acct: 100012345678",
    }).html;
    expect(withBank).toContain("To pay via Instapay");
    expect(withBank).toContain("Bank: CIB, Acct: 100012345678");

    // No details → no bank block even for instapay.
    const noDetails = confirmationEmail({ ...base, paymentMethod: "instapay" }).html;
    expect(noDetails).not.toContain("To pay via Instapay");

    // Non-instapay never shows the bank block.
    const cod = confirmationEmail({ ...base, paymentMethod: "cod", instapayDetails: "x" }).html;
    expect(cod).not.toContain("To pay via Instapay");
  });

  it("escapes HTML in customer-supplied fields", () => {
    const { html } = confirmationEmail({ ...base, name: "<b>x</b>" });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });
});

describe("statusEmail", () => {
  const o = { name: "Sara", deliverySlot: "09:05", trackingToken: "t1" };

  it("renders the preparing copy + slot label + track button", () => {
    const { subject, html } = statusEmail("preparing", o);
    expect(subject).toBe("Your Bistro Cloud order is being prepared");
    expect(html).toContain("The kitchen is on it!");
    expect(html).toContain("9:05 AM");
    expect(html).toContain("track?token=t1");
  });

  it("renders out_for_delivery copy", () => {
    const { subject, html } = statusEmail("out_for_delivery", o);
    expect(subject).toBe("Your Bistro Cloud order is out for delivery");
    expect(html).toContain("On the way!");
  });

  it("renders delivered copy", () => {
    const { subject, html } = statusEmail("delivered", o);
    expect(subject).toBe("Your Bistro Cloud order has been delivered");
    expect(html).toContain("Enjoy your meal!");
  });
});

describe("delayEmail", () => {
  it("includes the new ETA (and the old one) + track button", () => {
    const { subject, html } = delayEmail({
      name: "Sara",
      oldLabel: "2:30 PM",
      newLabel: "3:00 PM",
      trackingToken: "t2",
    });
    expect(subject).toBe("Bistro Cloud — updated delivery time");
    expect(html).toContain("running a little late");
    expect(html).toContain("3:00 PM");
    expect(html).toContain("was 2:30 PM");
    expect(html).toContain("track?token=t2");
  });
});

describe("declineEmail", () => {
  it("lists alternative open slots when provided", () => {
    const { html } = declineEmail({
      name: "Sara",
      deliverySlot: "14:30",
      openSlotLabels: ["3:00 PM", "4:00 PM"],
    });
    expect(html).toContain("still available today");
    expect(html).toContain("3:00 PM, 4:00 PM");
    expect(html).toContain("at <strong>2:30 PM</strong>");
    expect(html).toContain("wa.me/201221288804");
  });

  it("falls back to the 'no times today' copy with no/empty slots", () => {
    const { subject, html } = declineEmail({ name: "Sara", deliverySlot: "14:30" });
    expect(subject).toBe("Bistro Cloud — we couldn't fit your order in today");
    expect(html).toContain("no more delivery times are available today");
  });
});

describe("emailConfigured + sendEmail", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  });

  it("emailConfigured reflects the presence of RESEND_API_KEY", () => {
    expect(emailConfigured()).toBe(false);
    process.env.RESEND_API_KEY = "re_x";
    expect(emailConfigured()).toBe(true);
  });

  it("is a no-op {ok:false,'not configured'} when no key is set (never calls fetch)", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await sendEmail("a@b.com", "s", "<p>h</p>");
    expect(r).toEqual({ ok: false, error: "not configured" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("POSTs to Resend with the correct envelope and returns {ok:true} on 200", async () => {
    process.env.RESEND_API_KEY = "re_secret";
    const spy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await sendEmail("a@b.com", "Subject", "<p>h</p>");
    expect(r).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledOnce();
    const [url, opts] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((opts.headers as Record<string, string>).Authorization).toBe("Bearer re_secret");
    const body = JSON.parse(opts.body as string);
    expect(body.from).toBe("Bistro Cloud <orders@bistro-cloud.com>");
    expect(body.to).toEqual(["a@b.com"]);
    expect(body.reply_to).toBe("bistrocloud3@gmail.com");
    expect(body.subject).toBe("Subject");
  });

  it("returns {ok:false} on a non-2xx response (does not throw)", async () => {
    process.env.RESEND_API_KEY = "re_secret";
    globalThis.fetch = (async () =>
      new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const r = await sendEmail("a@b.com", "s", "<p>h</p>");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("429");
  });

  it("never throws when fetch rejects — returns {ok:false}", async () => {
    process.env.RESEND_API_KEY = "re_secret";
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const r = await sendEmail("a@b.com", "s", "<p>h</p>");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("network down");
  });

  it("returns {ok:false,'no recipient'} when to is empty (key present)", async () => {
    process.env.RESEND_API_KEY = "re_secret";
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await sendEmail("", "s", "<p>h</p>");
    expect(r).toEqual({ ok: false, error: "no recipient" });
    expect(spy).not.toHaveBeenCalled();
  });
});
