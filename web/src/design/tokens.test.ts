import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// UI §12.3: "The two dark blocks are byte-identical by design ... never let
// one be edited without the other; a lint rule comparing them is cheaper
// than the bug." This is that lint rule — the media-query block covers the
// OS setting, the [data-theme="dark"] block covers the in-app toggle, and a
// manual edit to only one is exactly the failure mode where the toggle and
// the OS setting drift apart.
//
// Read via fs, not `import ... from "./tokens.css?raw"` or a `new URL(...,
// import.meta.url)` — jsdom's global URL implementation mishandles a `file:`
// base during relative resolution, and Vitest stubs plain CSS imports empty
// under jsdom by default. import.meta.dirname is a real Node path, untouched
// by either.
const css = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");

// Declarations, not raw text — a formatter is free to indent the two blocks
// differently (one sits inside @media, the other doesn't), and that is not
// the drift this test exists to catch.
function declarations(pattern: RegExp): string[] {
  const match = pattern.exec(css);
  if (!match?.[1]) throw new Error(`tokens.css: pattern not found: ${String(pattern)}`);
  return [...match[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((declaration) => {
    const name = declaration[1];
    const value = declaration[2];
    if (!name || !value) throw new Error(`Unparseable declaration: ${declaration[0]}`);
    return `${name}: ${value.trim()}`.replace(/\s+/g, " ");
  });
}

describe("tokens.css dark-mode parity", () => {
  test("the media-query block and the [data-theme] block declare identical values", () => {
    const mediaQueryBlock = declarations(
      /:root:where\(:not\(\[data-theme="light"\]\)\)\s*\{([\s\S]*?)\}\s*\}/,
    );
    const dataThemeBlock = declarations(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);

    expect(mediaQueryBlock.length).toBeGreaterThan(0);
    expect(mediaQueryBlock).toEqual(dataThemeBlock);
  });
});

// GAP-49: `AppShell` was the only thing painting `bg-page`, and three screens
// render outside it — both `AuthGate` states and `NotBuiltYetScreen`. In dark
// mode that put `--color-ink-primary` on the browser's default white canvas
// and made the sign-in screen illegible. jsdom does not render, so no
// component test can catch a missing background; this asserts the structural
// fix is still in the file, which is the part a future edit could quietly
// remove. Whether it *looks* right stays a real-browser check, both schemes.
describe("tokens.css base layer", () => {
  const base = /@layer base\s*\{([\s\S]*?)\n\}/.exec(css)?.[1];

  test("the root element paints the page colour, so no screen has to", () => {
    expect(base).toBeDefined();
    expect(base).toMatch(/html\s*\{[^}]*background-color:\s*var\(--color-page\)/);
    expect(base).toMatch(/html\s*\{[^}]*color:\s*var\(--color-ink-primary\)/);
  });

  // The lookbehind is load-bearing: `prefers-color-scheme: dark` ends with the
  // same characters as the declaration being counted, so without it the media
  // query counts itself and the assertion passes for the wrong reason.
  test("color-scheme follows the theme, so UA surfaces match it too", () => {
    expect(base).toMatch(/(?<!prefers-)color-scheme:\s*light/);
    // Both switches, same as block 3: the OS setting and the in-app toggle.
    expect(base?.match(/(?<!prefers-)color-scheme:\s*dark/g)).toHaveLength(2);
  });
});
