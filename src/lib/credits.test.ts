import { describe, expect, it } from "vitest";
import {
  NO_CREDITS,
  creditsLines,
  dollars,
  expiryShort,
  showsCreditsCard,
  teamLeft,
  type CreditsState,
} from "@/lib/credits";

const NOW = Date.UTC(2026, 10, 13, 12);
const READ: CreditsState = {
  keyPresent: true,
  console: "connected",
  tranches: [
    {
      kind: "team",
      remaining: 45_698,
      granted: 50_000,
      expiresAt: Date.UTC(2026, 11, 10),
    },
    {
      kind: "promo",
      remaining: 99_413,
      granted: 100_000,
      expiresAt: Date.UTC(2027, 3, 8),
    },
  ],
  total: 145_111,
  fetchedAt: NOW,
  exhausted: false,
};

describe("the API credits as the page shows them", () => {
  it("says the Team credit, the amounts and the expiries", () => {
    expect(teamLeft(READ)).toBe(45_698);
    expect(teamLeft({ ...READ, tranches: [] })).toBeNull();
    expect(dollars(45_698)).toBe("457 $");
    expect(dollars(145_111).replace(/\s/g, " ")).toBe("1 451 $");
    expect(expiryShort(Date.UTC(2026, 11, 10, 12), NOW)).toBe("10/12");
    expect(expiryShort(Date.UTC(2027, 3, 8, 12), NOW)).toBe("08/04/27");
    expect(creditsLines(READ, NOW)[0]).toBe(
      "Team : 457 $ sur 500 $, expire le 10/12",
    );
  });

  it("shows the card once the key or the Console is there", () => {
    expect(showsCreditsCard(NO_CREDITS)).toBe(false);
    expect(showsCreditsCard({ ...NO_CREDITS, keyPresent: true })).toBe(true);
    expect(showsCreditsCard({ ...NO_CREDITS, console: "disconnected" })).toBe(
      true,
    );
  });
});
