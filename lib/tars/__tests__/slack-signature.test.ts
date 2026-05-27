import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySlackSignature } from "@/lib/tars/slack";

const SECRET = "test-signing-secret";

function sign(rawBody: string, ts: string): string {
  return `v0=${createHmac("sha256", SECRET)
    .update(`v0:${ts}:${rawBody}`)
    .digest("hex")}`;
}

describe("verifySlackSignature", () => {
  const fixedNow = () => 1_700_000_000_000;

  it("accepts a valid signature within the freshness window", () => {
    const ts = String(Math.floor(fixedNow() / 1000));
    const rawBody = JSON.stringify({ type: "event_callback" });
    const sig = sign(rawBody, ts);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        signatureHeader: sig,
        timestampHeader: ts,
        rawBody,
        now: fixedNow,
      }),
    ).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const ts = String(Math.floor(fixedNow() / 1000));
    const rawBody = JSON.stringify({ type: "event_callback" });
    const sig = "v0=deadbeef";
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        signatureHeader: sig,
        timestampHeader: ts,
        rawBody,
        now: fixedNow,
      }),
    ).toBe(false);
  });

  it("rejects when signed with the wrong secret", () => {
    const ts = String(Math.floor(fixedNow() / 1000));
    const rawBody = JSON.stringify({ type: "event_callback" });
    const sig = `v0=${createHmac("sha256", "wrong-secret")
      .update(`v0:${ts}:${rawBody}`)
      .digest("hex")}`;
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        signatureHeader: sig,
        timestampHeader: ts,
        rawBody,
        now: fixedNow,
      }),
    ).toBe(false);
  });

  it("rejects a stale timestamp (> 5 minutes)", () => {
    const oldTs = String(Math.floor(fixedNow() / 1000) - 600);
    const rawBody = JSON.stringify({ type: "event_callback" });
    const sig = sign(rawBody, oldTs);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        signatureHeader: sig,
        timestampHeader: oldTs,
        rawBody,
        now: fixedNow,
      }),
    ).toBe(false);
  });

  it("rejects when headers are missing", () => {
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        signatureHeader: null,
        timestampHeader: "1700000000",
        rawBody: "{}",
        now: fixedNow,
      }),
    ).toBe(false);

    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        signatureHeader: "v0=abc",
        timestampHeader: null,
        rawBody: "{}",
        now: fixedNow,
      }),
    ).toBe(false);
  });

  it("rejects body tampering — signature no longer matches", () => {
    const ts = String(Math.floor(fixedNow() / 1000));
    const original = JSON.stringify({ type: "event_callback", evil: false });
    const tampered = JSON.stringify({ type: "event_callback", evil: true });
    const sig = sign(original, ts);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        signatureHeader: sig,
        timestampHeader: ts,
        rawBody: tampered,
        now: fixedNow,
      }),
    ).toBe(false);
  });
});
