import { expect, test } from "@playwright/test";

// The run id to inspect is injected by the runner (a real pending-approval run
// produced by the debate loop). See TARS Slice 3 verification.
const RUN_ID = process.env.DEBATE_RUN_ID ?? "";

test.describe("PR-run Debate section", () => {
  test.skip(!RUN_ID, "DEBATE_RUN_ID not set");

  test("renders the Debate section and round is expandable", async ({
    page,
  }) => {
    await page.goto(`/pr-runs/${encodeURIComponent(RUN_ID)}`, {
      waitUntil: "networkidle",
    });

    // The "Debate" section header renders.
    await expect(page.getByRole("heading", { name: "Debate" })).toBeVisible({
      timeout: 30_000,
    });

    // The debate panel + round-1 toggle are present.
    const panel = page.getByTestId("debate-panel");
    await expect(panel).toBeVisible();

    const round1Toggle = page.getByTestId("debate-round-toggle-1");
    await expect(round1Toggle).toBeVisible();
    const round1Body = page.getByTestId("debate-round-body-1");

    // Toggle is clickable/expandable: aria-expanded flips on each click and the
    // round body's presence follows it. We read the starting state (round 1 is
    // collapsed by default when there are later rounds, open when it is last)
    // and assert one full collapse/expand cycle.
    const startExpanded =
      (await round1Toggle.getAttribute("aria-expanded")) === "true";

    if (startExpanded) {
      await expect(round1Body).toBeVisible();
      await round1Toggle.click();
      await expect(round1Toggle).toHaveAttribute("aria-expanded", "false");
      await expect(round1Body).toHaveCount(0);
      await round1Toggle.click();
      await expect(round1Toggle).toHaveAttribute("aria-expanded", "true");
      await expect(round1Body).toBeVisible();
    } else {
      await expect(round1Body).toHaveCount(0);
      await round1Toggle.click();
      await expect(round1Toggle).toHaveAttribute("aria-expanded", "true");
      await expect(round1Body).toBeVisible();
      await round1Toggle.click();
      await expect(round1Toggle).toHaveAttribute("aria-expanded", "false");
      await expect(round1Body).toHaveCount(0);
    }

    // The convergence outcome card is shown.
    await expect(panel.getByText(/Converged — agreed/)).toBeVisible();
  });
});
