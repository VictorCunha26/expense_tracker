import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import ts from "typescript"
const source = await readFile(new URL("../lib/synch-api.ts", import.meta.url), "utf8")
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const oldBase = process.env.NEXT_PUBLIC_API_URL
process.env.NEXT_PUBLIC_API_URL = "https://api.example.test"
const { synchApi, request, backendConfig } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`)
if (oldBase === undefined) delete process.env.NEXT_PUBLIC_API_URL; else process.env.NEXT_PUBLIC_API_URL = oldBase
test("client credentials, no caching, JSON, empty responses and configured vs connected", async t => {
  const calls = []
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 204 }) })
  assert.equal(backendConfig.configured, true)
  assert.equal(backendConfig.connected, true)
  await synchApi.signOut()
  assert.equal(calls[0].init.credentials, "include")
  assert.equal(calls[0].init.cache, "no-store")
  assert.equal(calls[0].init.method, "POST")
  assert.equal(calls[0].url, "https://api.example.test/v1/auth/logout")
})
test("HTTP and network errors stay explicit; mutations are never automatically retried", async t => {
  let attempts = 0
  t.mock.method(globalThis, "fetch", async () => { attempts++; return new Response(JSON.stringify({ message: "Conflito", code: "STALE_DATA" }), { status: 409, headers: { "X-Request-Id": "trace-1" } }) })
  await assert.rejects(synchApi.signOut(), e => e.status === 409 && e.code === "STALE_DATA" && e.requestId === "trace-1")
  assert.equal(attempts, 1)
  globalThis.fetch.mock.mockImplementation(async () => { throw new TypeError("offline") })
  await assert.rejects(synchApi.bootstrap(), e => e.code === "NETWORK_ERROR")
  await assert.rejects(request("https://other.test/"), e => e.code === "INVALID_PATH")
})
test("malformed success response, multipart and cancellation", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("not-json", { status: 200 }))
  await assert.rejects(synchApi.bootstrap(), e => e.code === "INVALID_RESPONSE")
  globalThis.fetch.mock.mockImplementation(async (_url, init) => {
    assert.ok(init.body instanceof FormData)
    assert.equal(init.headers.has("Content-Type"), false)
    return new Response(JSON.stringify({ receiptUrl: "https://example.test/r.pdf" }))
  })
  assert.deepEqual(await synchApi.uploadReceipt(1, new File(["test"], "nota.pdf")), { receiptUrl: "https://example.test/r.pdf" })
  globalThis.fetch.mock.mockImplementation(async (_url, init) => { assert.ok(init.signal.aborted); throw new DOMException("Aborted", "AbortError") })
  const controller = new AbortController(); controller.abort()
  await assert.rejects(synchApi.bootstrap(controller.signal), e => e.code === "ABORTED")
})
