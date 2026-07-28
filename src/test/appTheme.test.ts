import { describe, expect, it } from "vitest";
import { normalizeAppTheme } from "../theme/appTheme";

describe("appTheme", () => {
  it("normalizes unknown values to light", () => {
    expect(normalizeAppTheme(undefined)).toBe("light");
    expect(normalizeAppTheme("sepia")).toBe("light");
    expect(normalizeAppTheme("dark")).toBe("dark");
  });
});
