import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBudget,
  todayInSeoul,
  availableSailings,
} from "./recommendation.ts";

test("총시간을 비워두면 임의의 예산을 부여하지 않는다", () => {
  assert.equal(parseBudget(""), undefined);
  assert.equal(parseBudget("  "), undefined);
  assert.equal(parseBudget("120"), 120);
});
test("총시간 0·음수·소수·문자는 요청 전에 거부한다", () => {
  for (const input of ["0", "-1", "1.5", "abc", "Infinity"]) {
    assert.throws(() => parseBudget(input));
  }
});
test("한국 자정 이후에는 UTC 전날을 오늘로 사용하지 않는다", () => {
  assert.equal(todayInSeoul(new Date("2026-11-05T16:00:00Z")), "2026-11-06");
});
test("이미 출발했거나 출발 시각이 지난 회차는 선택 목록에서 제외한다", () => {
  const items = [
    { id: "past", departure: "2026-11-05T13:00:00+09:00" },
    { id: "now", departure: "2026-11-05T14:00:00+09:00" },
    { id: "future", departure: "2026-11-05T15:00:00+09:00" },
  ];
  assert.deepEqual(
    availableSailings(items, new Date("2026-11-05T14:00:00+09:00")).map(
      (x) => x.id,
    ),
    ["future"],
  );
});
