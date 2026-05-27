import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLinearSignature } from "@/lib/tars/linear";

const SECRET = "test-linear-webhook-secret";

function sign(rawBody: string): string {
  return createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex");
}

describe("verifyLinearSignature", () => {
  it("accepts a valid signature", () => {
    const body = JSON.stringify({ type: "Comment", action: "create" });
    const sig = sign(body);
    expect(
      verifyLinearSignature({
        webhookSecret: SECRET,
        signatureHeader: sig,
        rawBody: body,
      })
    ).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const body = JSON.stringify({ type: "Comment", action: "create" });
    expect(
      verifyLinearSignature({
        webhookSecret: SECRET,
        signatureHeader: "deadbeef",
        rawBody: body,
      })
    ).toBe(false);
  });

  it("rejects when signed with the wrong secret", () => {
    const body = JSON.stringify({ type: "Comment", action: "create" });
    const sig = createHmac("sha256", "wrong-secret")
      .update(body, "utf8")
      .digest("hex");
    expect(
      verifyLinearSignature({
        webhookSecret: SECRET,
        signatureHeader: sig,
        rawBody: body,
      })
    ).toBe(false);
  });

  it("rejects when signature header missing", () => {
    expect(
      verifyLinearSignature({
        webhookSecret: SECRET,
        signatureHeader: null,
        rawBody: "{}",
      })
    ).toBe(false);
  });

  it("rejects on body tampering", () => {
    const original = JSON.stringify({ a: 1 });
    const tampered = JSON.stringify({ a: 2 });
    const sig = sign(original);
    expect(
      verifyLinearSignature({
        webhookSecret: SECRET,
        signatureHeader: sig,
        rawBody: tampered,
      })
    ).toBe(false);
  });
});
