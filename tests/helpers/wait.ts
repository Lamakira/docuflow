/**
 * Poll until `check` returns a truthy value.
 *
 * Several routes kick off work without awaiting it — transcription, embedding
 * generation — and answer immediately. Tests that assert the outcome have to
 * wait for the same thing a polling client would.
 */
export async function waitFor<T>(
  check: () => Promise<T | undefined | null | false>,
  { timeoutMs = 5000, intervalMs = 25, label = "condition" } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
