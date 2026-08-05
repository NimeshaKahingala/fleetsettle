import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge's default config only recognises Tailwind's own t-shirt
 * font-size scale (`sm`, `lg`, `2xl`, …) — our custom §5.2 names (`body`,
 * `title`, `hero`, …) don't match it, so `text-body` silently fell through
 * to the *text-color* group (whose value validator is `isAny`) and got
 * dropped as a false conflict with a real colour class like
 * `text-ink-primary`. Same failure for `min-h-tap`/`size-tap` against the
 * spacing scale. Extending both scales here is what stops a component from
 * silently losing its font size or touch target the moment a colour
 * utility sits next to it in the same `cn()` call.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["hero", "title-lg", "title", "body", "body-sm", "label", "caption"],
      spacing: ["tap"],
    },
  },
});

/** Merges conditional class lists and resolves conflicting Tailwind utilities (last one wins). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
