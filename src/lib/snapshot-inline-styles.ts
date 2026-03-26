/**
 * html2canvas parses `getComputedStyle()` for every node — not just inline
 * styles. Tailwind v4 / the browser can expose `lab()`, `oklch()`, `color-mix()`.
 *
 * We copy **every** longhand from `getComputedStyle` onto inline `style`,
 * sanitizing any value that still contains modern color syntax, so the live
 * tree (and any clone) no longer depends on Tailwind for those pixels.
 */

function hasModernColorFunction(value: string): boolean {
  return /lab\(|oklch\(|color-mix\(|color\s*\(/i.test(value);
}

function resolveColorToRgb(value: string): string {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.left = "-9999px";
  probe.style.color = value;
  document.body.appendChild(probe);
  let resolved = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  if (hasModernColorFunction(resolved)) resolved = "rgb(28, 25, 20)";
  return resolved;
}

function resolveBackgroundToRgb(value: string): string {
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.left = "-9999px";
  probe.style.backgroundColor = value;
  document.body.appendChild(probe);
  let resolved = getComputedStyle(probe).backgroundColor;
  document.body.removeChild(probe);
  if (hasModernColorFunction(resolved)) resolved = "rgb(246, 243, 238)";
  return resolved;
}

/** Replace or drop values html2canvas cannot parse. */
export function sanitizeCssValue(prop: string, val: string): string {
  if (!hasModernColorFunction(val)) return val;

  const p = prop.toLowerCase();

  if (p === "background-image" || p === "background") {
    return "none";
  }
  if (p.startsWith("background-")) {
    if (p === "background-color") return resolveBackgroundToRgb(val);
    return "initial";
  }
  if (p.includes("shadow")) {
    return "0 1px 2px 0 rgba(0,0,0,0.06)";
  }
  if (p === "filter" || p === "backdrop-filter") {
    return "none";
  }
  if (
    p === "color" ||
    p === "caret-color" ||
    p === "outline-color" ||
    p === "text-decoration-color" ||
    p === "column-rule-color" ||
    p.endsWith("-color")
  ) {
    return resolveColorToRgb(val);
  }
  if (p === "text-decoration" || p === "text-emphasis-color") {
    return "none";
  }
  return "initial";
}

export function freezeComputedStylesForSnapshot(root: HTMLElement): () => void {
  const nodes = [root, ...root.querySelectorAll("*")];
  const backups = new Map<HTMLElement, string | null>();

  for (const node of nodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    backups.set(el, el.getAttribute("style"));
  }

  const snapshots = new Map<HTMLElement, Record<string, string>>();
  for (const node of nodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    const cs = getComputedStyle(el);
    const props: Record<string, string> = {};
    for (let i = 0; i < cs.length; i++) {
      const prop = cs[i];
      let val = cs.getPropertyValue(prop);
      if (hasModernColorFunction(val)) {
        val = sanitizeCssValue(prop, val);
      }
      props[prop] = val;
    }
    snapshots.set(el, props);
  }

  for (const node of nodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    el.removeAttribute("style");
    const props = snapshots.get(el)!;
    for (const [prop, val] of Object.entries(props)) {
      if (val === undefined || val === "") continue;
      try {
        el.style.setProperty(prop, val);
      } catch {
        /* invalid combinations on some engines */
      }
    }
  }

  return () => {
    for (const [el, prev] of backups) {
      if (prev === null) el.removeAttribute("style");
      else el.setAttribute("style", prev);
    }
  };
}

/** Kept for compatibility — iframe capture makes this optional. */
export function stripStylesheetsFromClone(clonedDoc: Document): void {
  clonedDoc.querySelectorAll('link[rel="stylesheet"]').forEach((n) => n.remove());
  clonedDoc.querySelectorAll("style").forEach((el) => {
    const text = el.textContent ?? "";
    if (!/@font-face/i.test(text)) el.remove();
  });
}
