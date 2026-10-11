// The development server only serves files inside webui/ and survives malformed requests.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { root } from "./helpers.mjs";
import { resolveStatic, serve } from "../../tools/lib/browser.mjs";

test("static paths resolve inside webui/ only", () => {
  const sibling = path.join(root, "webui-sibling-test");
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, "secret.txt"), "not served");
  try {
    assert.equal(resolveStatic("/"), path.join(root, "webui", "index.htm"));
    assert.equal(resolveStatic("/js/app.js"), path.join(root, "webui", "js", "app.js"));
    assert.equal(resolveStatic("/..%5cwebui-sibling-test%5csecret.txt"), null, "a sibling folder that shares the prefix is refused");
    assert.equal(resolveStatic("/..%2fpackage.json"), null);
    assert.equal(resolveStatic("/%E0%A4%A"), null, "a malformed escape is refused, not thrown");
    assert.equal(resolveStatic("/js"), null, "folders are not served");
    assert.equal(resolveStatic("/index.htm%00.png"), null);
  } finally {
    fs.rmSync(sibling, { recursive: true, force: true });
  }
});

test("the server answers malformed and unsupported requests and keeps running", async () => {
  const s = await serve(0);
  try {
    const base = "http://127.0.0.1:" + s.port;
    assert.equal((await fetch(base + "/%E0%A4%A")).status, 404);
    assert.equal((await fetch(base + "/index.htm", { method: "POST" })).status, 405);
    const ok = await fetch(base + "/index.htm");
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
    assert.equal(ok.headers.get("access-control-allow-origin"), null);
  } finally {
    await s.close();
  }
});
