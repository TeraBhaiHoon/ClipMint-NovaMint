export class LoadTimeoutError extends Error {
    constructor() {
        super("The request took too long. Please try again.");
        this.name = "LoadTimeoutError";
    }
}

export function createLoadScope(timeoutMs = 15_000) {
    let disposed = false;
    let controller: AbortController | null = null;
    let pending: Promise<unknown> | null = null;

    return {
        get active() { return !disposed; },
        get busy() { return pending !== null; },
        async run<T>(work: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
            if (disposed) throw new DOMException("Load cancelled", "AbortError");
            if (pending) throw new DOMException("Load already in progress", "AbortError");
            const request = new AbortController();
            controller = request;
            let timer: ReturnType<typeof setTimeout> | undefined;
            let onAbort: () => void = () => {};
            const cancellation = new Promise<never>((_, reject) => {
                onAbort = () => reject(request.signal.reason || new DOMException("Load cancelled", "AbortError"));
                request.signal.addEventListener("abort", onAbort, { once: true });
                timer = setTimeout(() => request.abort(new LoadTimeoutError()), timeoutMs);
            });
            // Race the whole operation, not only fetch: auth preparation or JSON parsing can also stall.
            const operation = Promise.resolve().then(() => {
                if (request.signal.aborted) throw request.signal.reason;
                return work(request.signal);
            });
            const result = Promise.race([operation, cancellation]);
            pending = result;
            try {
                return await result;
            } finally {
                clearTimeout(timer);
                request.signal.removeEventListener("abort", onAbort);
                if (pending === result) pending = null;
                if (controller === request) controller = null;
            }
        },
        dispose() {
            disposed = true;
            controller?.abort(new DOMException("Load cancelled", "AbortError"));
        },
    };
}

export type LoadScope = ReturnType<typeof createLoadScope>;
