import { describe, expect, test } from "bun:test";
import { formatDecimal, formatPercentage } from "../../src/web/ui/format.ts";

describe("formatDecimal", () => {
  test("groups arbitrary-length integer portions without losing precision", () => {
    expect(formatDecimal("123456789012345678901234567890.012300")).toBe(
      "123\u00a0456\u00a0789\u00a0012\u00a0345\u00a0678\u00a0901\u00a0234\u00a0567\u00a0890,012300",
    );
  });

  test("preserves exact fractional digits for negative decimals", () => {
    expect(formatDecimal("-1000000000000000000000.0001")).toBe(
      "\u22121\u00a0000\u00a0000\u00a0000\u00a0000\u00a0000\u00a0000\u00a0000,0001",
    );
  });
});

describe("formatPercentage", () => {
  test("uses Swedish decimal and percent separators", () => {
    expect(formatPercentage(1 / 3)).toBe("33,33 %");
    expect(formatPercentage(1)).toBe("100 %");
  });
});
