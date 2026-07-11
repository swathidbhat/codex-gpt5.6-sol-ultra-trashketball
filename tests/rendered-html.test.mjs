import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the finished trashketball experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Trashketball — Quota Mode<\/title>/i);
  assert.match(html, /Trashketball/);
  assert.match(html, /MAKE WASTE/);
  assert.match(html, /CLOCK IN/);
  assert.match(html, /100 points to transfer/);
  assert.match(
    html,
    /https:\/\/trashketball-quota-mode\.swthbht\.chatgpt\.site\/og\.jpg/,
  );
  assert.match(html, /<style>:root/);
  assert.doesNotMatch(html, /rel="stylesheet"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("ships the requested Three.js game systems", async () => {
  const [game, page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/TrashketballGame.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(game, /from "three"/);
  assert.match(game, /buildOffice/);
  assert.match(game, /buildBeach/);
  assert.match(game, /FIXED_STEP = 1 \/ 120/);
  assert.match(game, /scoreBall/);
  assert.match(game, /levelScore >= 100/);
  assert.match(game, /updateTrajectory/);
  assert.match(page, /<TrashketballGame \/>/);
  assert.match(layout, /\/og\.jpg/);
  assert.match(packageJson, /"three"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
