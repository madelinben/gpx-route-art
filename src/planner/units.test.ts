import { expect, test } from "vitest";
import { targetMeters } from "./units";

test("distance mode ignores time and pace", () => {
  expect(targetMeters("distance", 5, 99, 9)).toBe(5000);
});

test("time mode converts minutes at pace to meters", () => {
  expect(targetMeters("time", 0, 30, 6)).toBe(5000);
});
