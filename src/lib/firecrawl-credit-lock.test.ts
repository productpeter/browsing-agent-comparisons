import { describe, expect, it, vi } from "vitest";
import { withFirecrawlCreditMeasurement } from "./firecrawl-credit-lock";

describe("withFirecrawlCreditMeasurement", () => {
  it("runs Firecrawl credit windows one at a time (no interleaving)", async () => {
    const order: string[] = [];

    const a = withFirecrawlCreditMeasurement(async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 5));
      order.push("a-end");
      return 1;
    });

    const b = withFirecrawlCreditMeasurement(async () => {
      order.push("b-start");
      order.push("b-end");
      return 2;
    });

    const [ra, rb] = await Promise.all([a, b]);

    expect(ra).toBe(1);
    expect(rb).toBe(2);
    const ai = order.indexOf("a-start");
    const bi = order.indexOf("b-start");
    const ae = order.indexOf("a-end");
    const be = order.indexOf("b-end");
    expect(ai).toBeLessThan(ae);
    expect(ae).toBeLessThan(bi);
    expect(bi).toBeLessThan(be);
  });

  it("releases the lock when the inner function throws", async () => {
    const spy = vi.fn();

    await expect(
      withFirecrawlCreditMeasurement(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    await withFirecrawlCreditMeasurement(async () => {
      spy("ok");
      return undefined;
    });

    expect(spy).toHaveBeenCalledWith("ok");
  });
});
