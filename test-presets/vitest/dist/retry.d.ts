/** How many retries a test's `retry` option stands for: a number, or `{ count }` (Vitest 5), or nothing. */
export declare function retryCount(retry: unknown): number;
/** The refusal for a small or medium test that asks for a retry; undefined when it asks for none. */
export declare function retryRefusal(retry: unknown): string | undefined;
