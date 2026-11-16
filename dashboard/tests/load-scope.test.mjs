import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Match the existing dashboard suite: transpile with the project's TypeScript
// dependency instead of requiring native TypeScript support in the Node runtime.
const source = readFileSync(new URL("../src/lib/load-scope.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const compiledModule = { exports: {} };
new Function("module", "exports", compiled)(compiledModule, compiledModule.exports);
const { createLoadScope, LoadTimeoutError } = compiledModule.exports;

// Functional helper coverage only. React effect ownership, rendered error states,
// and route/account changes need separate integration tests.
const TIMEOUT_MS = 1_000;

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function timedScope(t) {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const scope = createLoadScope(TIMEOUT_MS);
    t.after(() => scope.dispose());
    return scope;
}

function isTimeout(error) {
    assert.ok(error instanceof LoadTimeoutError);
    assert.equal(error.name, "LoadTimeoutError");
    return true;
}

function isAbort(error) {
    assert.ok(error instanceof DOMException);
    assert.equal(error.name, "AbortError");
    return true;
}

test("disposing before the work microtask prevents transport from starting", async (t) => {
    const scope = timedScope(t);
    let calls = 0;
    const result = scope.run(async () => { calls++; return "unexpected"; });
    scope.dispose();
    await assert.rejects(result, isAbort);
    assert.equal(calls, 0);
    assert.equal(scope.busy, false);
});

test("normal result preserves its value and clears busy state and timeout", async (t) => {
    const scope = timedScope(t);
    const expected = { title: "Ready", clips: [1, 2] };
    let signal;
    const result = scope.run(async (requestSignal) => {
        signal = requestSignal;
        return expected;
    });

    assert.equal(scope.active, true);
    assert.equal(scope.busy, true);
    assert.strictEqual(await result, expected);
    assert.equal(scope.busy, false);
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(TIMEOUT_MS * 2);
    assert.equal(signal.aborted, false, "a settled request must not be aborted later");
    assert.equal(scope.active, true);
});

test("synchronously thrown work error is preserved and retry is available", async (t) => {
    const scope = timedScope(t);
    const failure = new Error("Preparation failed");
    let signal;
    await assert.rejects(scope.run((requestSignal) => {
        signal = requestSignal;
        throw failure;
    }), (error) => error === failure);

    assert.equal(scope.busy, false);
    assert.equal(scope.active, true);
    t.mock.timers.tick(TIMEOUT_MS * 2);
    assert.equal(signal.aborted, false);
    assert.equal(await scope.run(async () => "retried"), "retried");
});

test("asynchronously rejected work error is preserved and releases the scope", async (t) => {
    const scope = timedScope(t);
    const failure = new Error("Query failed");
    await assert.rejects(scope.run(async () => { throw failure; }), (error) => error === failure);
    assert.equal(scope.busy, false);
    assert.equal(scope.active, true);
    assert.equal(await scope.run(async () => 7), 7);
});

test("never-settling work times out, aborts its signal, and permits retry", async (t) => {
    const scope = timedScope(t);
    const started = deferred();
    const stalled = deferred();
    let signal;
    const request = scope.run((requestSignal) => {
        signal = requestSignal;
        started.resolve();
        return stalled.promise;
    });
    const rejection = assert.rejects(request, isTimeout);
    await started.promise;

    t.mock.timers.tick(TIMEOUT_MS - 1);
    assert.equal(signal.aborted, false);
    assert.equal(scope.busy, true);
    t.mock.timers.tick(1);
    await rejection;

    assert.equal(signal.aborted, true);
    assert.ok(signal.reason instanceof LoadTimeoutError);
    assert.equal(scope.busy, false);
    assert.equal(scope.active, true);
    assert.equal(await scope.run(async () => "retry succeeded"), "retry succeeded");
    assert.equal(scope.busy, false);
});

test("the timeout includes preparation stalled before transport is called", async (t) => {
    const scope = timedScope(t);
    const preparing = deferred();
    const preparation = deferred();
    const transport = t.mock.fn(async () => "transport result");
    let signal;
    const request = scope.run(async (requestSignal) => {
        signal = requestSignal;
        preparing.resolve();
        await preparation.promise;
        return transport(requestSignal);
    });
    const rejection = assert.rejects(request, isTimeout);
    await preparing.promise;

    assert.equal(transport.mock.callCount(), 0);
    t.mock.timers.tick(TIMEOUT_MS);
    await rejection;
    assert.equal(transport.mock.callCount(), 0);
    assert.equal(signal.aborted, true);
    assert.equal(scope.busy, false);
    assert.equal(await scope.run(async () => "preparation retry"), "preparation retry");
    // The unresolved callback deliberately ignores abort: the race must still
    // settle. This does not assert that ignored underlying work is forcibly stopped.
});

test("the timeout includes transport that never returns a response", async (t) => {
    const scope = timedScope(t);
    const transportStarted = deferred();
    const response = deferred();
    let signal;
    const transport = t.mock.fn((requestSignal) => {
        signal = requestSignal;
        transportStarted.resolve();
        return response.promise;
    });
    const request = scope.run(async (requestSignal) => await transport(requestSignal));
    const rejection = assert.rejects(request, isTimeout);
    await transportStarted.promise;

    t.mock.timers.tick(TIMEOUT_MS);
    await rejection;
    assert.equal(transport.mock.callCount(), 1);
    assert.equal(signal.aborted, true);
    assert.equal(scope.busy, false);
    assert.equal(await scope.run(async () => "transport retry"), "transport retry");
});

test("receiving a response does not end the timeout while body parsing stalls", async (t) => {
    const scope = timedScope(t);
    const parsingStarted = deferred();
    const parsedBody = deferred();
    const json = t.mock.fn(() => {
        parsingStarted.resolve();
        return parsedBody.promise;
    });
    const transport = t.mock.fn(async () => ({ ok: true, json }));
    let signal;
    const request = scope.run(async (requestSignal) => {
        signal = requestSignal;
        const response = await transport(requestSignal);
        return await response.json();
    });
    const rejection = assert.rejects(request, isTimeout);
    await parsingStarted.promise;

    assert.equal(transport.mock.callCount(), 1);
    assert.equal(json.mock.callCount(), 1);
    assert.equal(scope.busy, true);
    t.mock.timers.tick(TIMEOUT_MS);
    await rejection;
    assert.equal(signal.aborted, true);
    assert.equal(scope.busy, false);
    assert.deepEqual(await scope.run(async () => ({ parsed: true })), { parsed: true });
});

test("dispose cancels in-flight work and refuses later work without invoking it", async (t) => {
    const scope = timedScope(t);
    const started = deferred();
    const stalled = deferred();
    let signal;
    const request = scope.run((requestSignal) => {
        signal = requestSignal;
        started.resolve();
        return stalled.promise;
    });
    const rejection = assert.rejects(request, isAbort);
    await started.promise;

    scope.dispose();
    assert.equal(scope.active, false);
    assert.equal(signal.aborted, true);
    assert.equal(signal.reason.name, "AbortError");
    await rejection;
    assert.equal(scope.busy, false);
    const laterWork = t.mock.fn(async () => "must not run");
    await assert.rejects(scope.run(laterWork), isAbort);
    assert.equal(laterWork.mock.callCount(), 0);
    scope.dispose();
    t.mock.timers.tick(TIMEOUT_MS * 2);
    assert.equal(signal.reason.name, "AbortError", "cancel must not turn into timeout");
});

test("busy scope refuses duplicate work without cancelling the first request", async (t) => {
    const scope = timedScope(t);
    const started = deferred();
    const firstResult = deferred();
    let signal;
    const firstWork = t.mock.fn((requestSignal) => {
        signal = requestSignal;
        started.resolve();
        return firstResult.promise;
    });
    const first = scope.run(firstWork);
    const duplicateWork = t.mock.fn(async () => "duplicate");
    await assert.rejects(scope.run(duplicateWork), (error) => {
        isAbort(error);
        assert.match(error.message, /already in progress/);
        return true;
    });
    await started.promise;

    assert.equal(firstWork.mock.callCount(), 1);
    assert.equal(duplicateWork.mock.callCount(), 0);
    assert.equal(signal.aborted, false);
    assert.equal(scope.busy, true);
    firstResult.resolve("first result");
    assert.equal(await first, "first result");
    assert.equal(scope.busy, false);
    assert.equal(await scope.run(async () => "next result"), "next result");
});

test("late timed-out A cannot release or block retry B in the same scope", async (t) => {
    const scope = timedScope(t);
    const aStarted = deferred();
    const aResult = deferred();
    const a = scope.run(() => {
        aStarted.resolve();
        return aResult.promise;
    });
    const aRejection = assert.rejects(a, isTimeout);
    await aStarted.promise;
    t.mock.timers.tick(TIMEOUT_MS);
    await aRejection;

    const bStarted = deferred();
    const bResult = deferred();
    let bSignal;
    const b = scope.run((signal) => {
        bSignal = signal;
        bStarted.resolve();
        return bResult.promise;
    });
    await bStarted.promise;
    aResult.resolve("late A");
    await aResult.promise;
    await Promise.resolve();

    assert.equal(scope.busy, true, "late A must not clear B's busy state");
    assert.equal(bSignal.aborted, false);
    const duplicate = t.mock.fn(async () => "duplicate B");
    await assert.rejects(scope.run(duplicate), isAbort);
    assert.equal(duplicate.mock.callCount(), 0);
    bResult.resolve("B result");
    assert.equal(await b, "B result");
    assert.equal(scope.busy, false);
    t.mock.timers.tick(TIMEOUT_MS * 2);
    assert.equal(bSignal.aborted, false);
});

test("disposed scope A cannot occupy replacement scope B, even when A finishes late", async (t) => {
    const aScope = timedScope(t);
    const aStarted = deferred();
    const aResult = deferred();
    const a = aScope.run(() => {
        aStarted.resolve();
        return aResult.promise;
    });
    const aRejection = assert.rejects(a, isAbort);
    await aStarted.promise;
    aScope.dispose();

    const bScope = createLoadScope(TIMEOUT_MS);
    t.after(() => bScope.dispose());
    const bStarted = deferred();
    const bResult = deferred();
    let bSignal;
    const b = bScope.run((signal) => {
        bSignal = signal;
        bStarted.resolve();
        return bResult.promise;
    });
    await aRejection;
    await bStarted.promise;
    aResult.resolve("stale route A");
    await aResult.promise;
    await Promise.resolve();

    assert.equal(aScope.active, false);
    assert.equal(aScope.busy, false);
    assert.equal(bScope.active, true);
    assert.equal(bScope.busy, true);
    assert.equal(bSignal.aborted, false);
    bResult.resolve("current route B");
    assert.equal(await b, "current route B");
    assert.equal(bScope.busy, false);
});
