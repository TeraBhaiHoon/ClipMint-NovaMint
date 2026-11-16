import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

export function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

// Executes the component's real hooks/loaders without a DOM or another dependency.
// JSX is an inspectable tree; child component rendering is intentionally out of scope.
export function createComponentHarness(path, { mocks = {}, props = {}, freezeAnimationFrames = false } = {}) {
    const slots = [];
    let cursor = 0, dirty = true, tree, now = 0, nextTimer = 0, unmounted = false;
    let currentProps = props;
    const effects = [];
    const timers = new Map();
    const previousGlobals = new Map();
    function patch(key, value) { previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
    function target() {
        const listeners = new Map();
        return {
            addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
            removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
            dispatch(name) { for (const callback of [...(listeners.get(name) || [])]) callback(); },
            listenerCount(name) { return listeners.get(name)?.size || 0; },
        };
    }
    const window = { ...target(), location: { search: "", href: "https://example.test/dashboard", origin: "https://example.test" }, history: { replaceState() {} } };
    const document = { ...target(), visibilityState: "visible", body: { appendChild() {} } };
    const addTimer = (callback, delay = 0, interval = 0) => { const id = ++nextTimer; timers.set(id, { at: now + delay, interval, callback }); return id; };
    patch("window", window);
    patch("document", document);
    patch("localStorage", { getItem() { return null; }, setItem() {} });
    patch("setTimeout", (fn, delay) => addTimer(fn, delay));
    patch("clearTimeout", (id) => timers.delete(id));
    patch("setInterval", (fn, delay) => addTimer(fn, delay, delay));
    patch("clearInterval", (id) => timers.delete(id));
    patch("requestAnimationFrame", (fn) => freezeAnimationFrames ? ++nextTimer : addTimer(fn, 16));
    patch("cancelAnimationFrame", (id) => timers.delete(id));
    const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    const react = {
        useState(initial) {
            const i = cursor++;
            if (!slots[i]) slots[i] = { value: typeof initial === "function" ? initial() : initial };
            return [slots[i].value, (value) => { const next = typeof value === "function" ? value(slots[i].value) : value; if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }];
        },
        useRef(initial) { const i = cursor++; if (!slots[i]) slots[i] = { value: { current: initial } }; return slots[i].value; },
        useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
        useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
        useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) { const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup }; effects.push({ i, fn }); } },
        createContext(value) { return { value, Provider: "Context.Provider" }; },
        useContext(context) { return context.value; },
        use(value) { return value; },
    };
    const jsx = (type, props) => ({ type, props: props || {} });
    const moduleCache = new Map();
    const fakeComponents = new Proxy({}, { get: (_target, name) => String(name) });
    const fallbackRouter = { replace() {}, refresh() {} };
    function load(file) {
        if (moduleCache.has(file.href)) return moduleCache.get(file.href);
        const compiledModule = { exports: {} };
        moduleCache.set(file.href, compiledModule.exports);
        const source = readFileSync(file, "utf8");
        const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
        function require(name) {
            if (Object.hasOwn(mocks, name)) return mocks[name];
            if (name === "react") return react;
            if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
            if (name === "lucide-react" || name.endsWith("/ui")) return fakeComponents;
            if (name === "next/link") return { default: "Link" };
            if (name === "next/navigation") return { useRouter: () => fallbackRouter };
            if (name.startsWith("@/lib/")) return load(new URL(`../../src/lib/${name.slice(6)}.ts`, import.meta.url));
            throw new Error(`Missing component mock for ${name}`);
        }
        new Function("module", "exports", "require", compiled)(compiledModule, compiledModule.exports, require);
        moduleCache.set(file.href, compiledModule.exports);
        return compiledModule.exports;
    }
    const component = load(new URL(`../../${path}`, import.meta.url));
    const render = component.default || component.DashboardProvider;
    function renderNow() {
        if (unmounted) return;
        let passes = 0;
        while (dirty) {
            assert.ok(++passes < 40, "component render must converge");
            dirty = false;
            cursor = 0;
            tree = render(currentProps);
            for (const { i, fn } of effects.splice(0)) { slots[i].cleanup?.(); slots[i].cleanup = fn(); }
        }
    }
    const harness = {
        window, document,
        get tree() { renderNow(); return tree; },
        nodes(predicate) {
            renderNow();
            const found = [];
            function visit(node) { if (!node || typeof node !== "object") return; if (Array.isArray(node)) return node.forEach(visit); if (predicate(node)) found.push(node); visit(node.props?.children); }
            visit(tree);
            return found;
        },
        text() { renderNow(); function text(node) { if (node == null || typeof node === "boolean") return ""; if (typeof node !== "object") return String(node); if (Array.isArray(node)) return node.map(text).join(" "); return text(node.props?.children); } return text(tree); },
        rerender(nextProps = currentProps) { currentProps = nextProps; dirty = true; renderNow(); },
        async flush() { for (let i = 0; i < 35; i++) { await Promise.resolve(); renderNow(); } },
        async advance(ms) {
            const end = now + ms;
            while (true) {
                let chosen;
                for (const entry of timers) if (entry[1].at <= end && (!chosen || entry[1].at < chosen[1].at)) chosen = entry;
                if (!chosen) break;
                const [id, timer] = chosen;
                now = timer.at;
                if (timer.interval) timer.at += timer.interval; else timers.delete(id);
                timer.callback();
                await harness.flush();
            }
            now = end;
            await harness.flush();
        },
        unmount() { if (unmounted) return; unmounted = true; for (const slot of slots) slot?.cleanup?.(); },
        restore() { harness.unmount(); for (const [key, descriptor] of previousGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } },
    };
    renderNow();
    return harness;
}

export function createSupabaseMock({ auth, query, rpc } = {}) {
    const calls = [];
    const channels = [];
    const listeners = new Set();
    function builder(kind, name, args) {
        const call = { kind, name, args, filters: {}, signal: null };
        calls.push(call);
        const value = {
            select() { return value; },
            eq(key, val) { call.filters[key] = val; return value; },
            order() { return value; }, limit() { return value; }, single() { return value; }, maybeSingle() { return value; },
            abortSignal(signal) { call.signal = signal; return value; },
            then(yes, no) { return Promise.resolve().then(() => (kind === "rpc" ? rpc?.(call) : query?.(call)) ?? { data: [], error: null }).then(yes, no); },
        };
        return value;
    }
    const client = {
        auth: {
            getUser() { calls.push({ kind: "auth" }); return auth?.() ?? Promise.resolve({ data: { user: { id: "a", email: "a@example.test" } }, error: null }); },
            onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } }; },
        },
        from(name) { return builder("query", name); },
        rpc(name, args) { return builder("rpc", name, args); },
        channel(name) { const channel = { name, callbacks: [], removed: false, on(_event, _filter, callback) { channel.callbacks.push(callback); return channel; }, subscribe() { return channel; } }; channels.push(channel); return channel; },
        removeChannel(channel) { channel.removed = true; return Promise.resolve("ok"); },
    };
    return { client, calls, channels, emit(event, user) { for (const fn of listeners) fn(event, user ? { user } : null); }, get listenerCount() { return listeners.size; } };
}
