import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const block = html.match(/\/\/ <list-view>([\s\S]*?)\/\/ <\/list-view>/)[1];
const { PAGE_SIZE, japaneseRank, compareByJapaneseLevel, paginate, pageNumbers } =
  new Function(`${block}; return { PAGE_SIZE, japaneseRank, compareByJapaneseLevel, paginate, pageNumbers };`)();

test("page size is 10", () => assert.equal(PAGE_SIZE, 10));

test("N1 ranks first, then N2..N5, unknown last", () => {
  assert.deepEqual(["N5", "N1", "", null, "N3", "n2", "JLPT N4", "Không có"].map(japaneseRank), [5, 1, 99, 99, 3, 2, 4, 99]);
});

test("default order puts N1 on top and keeps the incoming order for ties", () => {
  const rows = [
    { id: "a", japanese_level: "N3" }, { id: "b", japanese_level: null }, { id: "c", japanese_level: "N1" },
    { id: "d", japanese_level: "N2" }, { id: "e", japanese_level: "N1" }, { id: "f", japanese_level: "N3" }
  ];
  assert.deepEqual([...rows].sort(compareByJapaneseLevel).map((row) => row.id), ["c", "e", "d", "a", "f", "b"]);
});

test("paginate gives 10 per page and numbering continues on page 2", () => {
  const items = Array.from({ length: 25 }, (_, index) => index + 1);
  const first = paginate(items, 1), second = paginate(items, 2), third = paginate(items, 3);
  assert.equal(first.items.length, 10); assert.equal(first.offset + 1, 1);
  assert.equal(second.items.length, 10); assert.equal(second.offset + 1, 11);
  assert.equal(third.items.length, 5); assert.equal(third.offset + 1, 21);
  assert.equal(first.pages, 3);
});

test("paginate clamps out-of-range and invalid pages, and handles empty lists", () => {
  const items = Array.from({ length: 25 }, (_, index) => index);
  assert.equal(paginate(items, 99).page, 3);
  assert.equal(paginate(items, 0).page, 1);
  assert.equal(paginate(items, "x").page, 1);
  assert.deepEqual(paginate([], 1), { page: 1, pages: 1, offset: 0, items: [] });
});

test("an exact multiple of 10 has no empty last page", () => {
  assert.equal(paginate(Array.from({ length: 20 }), 1).pages, 2);
});

test("page numbers collapse long ranges with an ellipsis", () => {
  assert.deepEqual(pageNumbers(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageNumbers(1, 20), [1, 2, "…", 20]);
  assert.deepEqual(pageNumbers(10, 20), [1, "…", 9, 10, 11, "…", 20]);
  assert.deepEqual(pageNumbers(20, 20), [1, "…", 19, 20]);
});
