import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const dist = new URL("../dist/", import.meta.url);
const pagesBase = "/codex-gpt5.6-sol-ultra-trashketball/";

test("builds a self-contained GitHub Pages game", async () => {
  const html = await readFile(new URL("index.html", dist), "utf8");
  assert.match(html, /<title>Trashketball — Quota Mode<\/title>/);
  assert.match(html, /id="root"/);
  assert.match(html, /MAKE WASTE|Trashketball/);
  assert.match(html, new RegExp(`${pagesBase}assets/index-[^"']+\\.js`));
  assert.match(html, new RegExp(`${pagesBase}assets/index-[^"']+\\.css`));
  assert.doesNotMatch(html, /chatgpt\.site|vinext|_next|wrangler/i);
  await access(new URL("og.jpg", dist));
  await access(new URL(".nojekyll", dist));
});

test("emits every referenced hashed asset", async () => {
  const html = await readFile(new URL("index.html", dist), "utf8");
  const referenced = [...html.matchAll(/\/assets\/([^"']+)/g)].map(
    (match) => match[1],
  );
  const emitted = new Set(await readdir(new URL("assets/", dist)));
  assert.ok(referenced.length >= 2);
  for (const asset of referenced) assert.ok(emitted.has(asset), asset);
});

test("retains both levels and fixed-step scoring physics", async () => {
  const game = await readFile(new URL("app/TrashketballGame.tsx", root), "utf8");
  assert.match(game, /buildOffice/);
  assert.match(game, /buildBeach/);
  assert.match(game, /FIXED_STEP = 1 \/ 120/);
  assert.match(game, /levelScore >= 100/);
  assert.match(game, /scoreBall/);
  assert.match(game, /updateTrajectory/);
});
