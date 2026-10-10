/** How many retries a test's `retry` option stands for: a number, or `{ count }` (Vitest 5), or nothing. */
export function retryCount(retry: unknown): number {
  if (typeof retry === 'number') return retry
  const count = (retry as { count?: unknown } | null | undefined)?.count
  return typeof count === 'number' ? count : 0
}

/** The refusal for a small or medium test that asks for a retry; undefined when it asks for none. */
export function retryRefusal(retry: unknown): string | undefined {
  const count = retryCount(retry)
  return count > 0
    ? `small and medium tests never retry (this one asks for ${count}): fix the flake, or tag the test "quarantine" until it is fixed`
    : undefined
}
