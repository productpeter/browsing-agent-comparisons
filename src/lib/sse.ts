/**
 * Consume a Tabstack-style SSE response (lines like `data: {...}`).
 */
export async function consumeSseResponse(
  res: Response
): Promise<{ raw: string; events: unknown[] }> {
  if (!res.body) {
    const raw = await res.text();
    return { raw, events: parseDataLines(raw) };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let carry = "";
  const events: unknown[] = [];

  const flushLine = (line: string) => {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]" || payload === "") return;
    try {
      events.push(JSON.parse(payload));
    } catch {
      /* ignore partial JSON */
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    raw += chunk;
    carry += chunk;
    const lines = carry.split("\n");
    carry = lines.pop() ?? "";
    for (const line of lines) flushLine(line);
  }
  if (carry.trim()) {
    for (const line of carry.split("\n")) flushLine(line);
  }

  return { raw, events };
}

function parseDataLines(full: string): unknown[] {
  const events: unknown[] = [];
  for (const line of full.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]" || payload === "") continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      /* ignore */
    }
  }
  return events;
}
