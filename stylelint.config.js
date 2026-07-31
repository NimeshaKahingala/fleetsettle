/**
 * CSS rules. Two of these are load-bearing rather than stylistic:
 * `color-no-hex` (UI §5.1 — colour comes from tokens) and the 100vh ban
 * (UI §5 — the mobile URL bar is not accounted for by 100vh).
 */
export default {
  extends: ["stylelint-config-standard"],
  rules: {
    // Tailwind v4 owns these.
    "at-rule-no-unknown": [
      true,
      {
        ignoreAtRules: [
          "theme",
          "source",
          "utility",
          "variant",
          "custom-variant",
          "plugin",
          "apply",
          "reference",
          "config",
          "tailwind",
          "layer",
        ],
      },
    ],
    "at-rule-no-deprecated": null,

    // No raw hex. The palette-constants file is the single exception, below.
    "color-no-hex": true,

    // 100vh ignores the mobile browser chrome; 100dvh does not account for the
    // keyboard, which is an overlay by spec. The shell uses 100svh (UI §5).
    "declaration-property-value-disallowed-list": {
      "/^(height|min-height|max-height|inset|top|bottom)$/": ["/\\b100vh\\b/"],
    },

    // Kebab-case custom properties, plus Tailwind v4's own double-hyphen
    // companion suffix for a theme step's paired properties — e.g.
    // --text-hero--line-height alongside --text-hero (tailwindcss.com/docs/font-size).
    // The --color-* prefix requirement inside @theme is checked by
    // scripts/check-forbidden.mjs, which can see the block.
    "custom-property-pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*(--[a-z][a-z0-9]*(-[a-z0-9]+)*)?$",

    "declaration-no-important": true,
    "selector-class-pattern": null,
  },
  overrides: [
    {
      // "The only place a hex appears" (UI §12.3). UI §12.2's structure table
      // puts this in design/, not styles/ — this override was pointed at the
      // wrong path before the workspace existed to prove it.
      files: ["web/src/design/tokens.css"],
      rules: {
        "color-no-hex": null,
        // Tailwind v4 resolves this exact bare-string form specially; rewriting
        // it as `url("tailwindcss")` is a real `@import` of a literal file
        // named "tailwindcss", not the framework (tailwindcss.com/docs/installation).
        "import-notation": null,
      },
    },
  ],
};
