import js from "@eslint/js";
import ts from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

/**
 * FleetSettle lint rules.
 *
 * Most of what is here is not style. Every `no-restricted-syntax` entry below
 * corresponds to a rule in the root CLAUDE.md whose failure mode is a number
 * that is wrong, plausible, and unnoticed for months. Style is Prettier's job
 * and is switched off at the end of this file.
 *
 * These rules are meant to be *disable-able* — with a reason:
 *
 *   // eslint-disable-next-line no-restricted-syntax -- odometer km, not money
 *
 * That is the design. The point is not to make the pattern impossible, it is to
 * make every occurrence deliberate and visible in review.
 */

// ── Money ────────────────────────────────────────────────────────────────────
// bigint minor units in the database and in domain code, string on the wire,
// never number anywhere. A Number round-trip never fails a test — LKR cents sit
// well inside MAX_SAFE_INTEGER — it only loses a rounding argument years later.
const money = [
  {
    selector: "CallExpression[callee.name='Number']",
    message:
      "Number() on a money value is a silent precision loss. Money is bigint minor units — use the shared codec (IG §4.4).",
  },
  {
    selector: "CallExpression[callee.name=/^(parseInt|parseFloat)$/]",
    message:
      "parseInt/parseFloat produce a number. Money parses to bigint via the shared codec (IG §4.4).",
  },
  {
    selector: "MemberExpression[property.name='toFixed']",
    message:
      "toFixed() is float formatting. Money formats through the codec's format() (UI §5, IG §4.4).",
  },
  {
    selector:
      "CallExpression[callee.object.name='Math'][callee.property.name=/^(round|ceil|floor|trunc|abs)$/]",
    message:
      "Math.* on money rounds the wrong way. Amounts are whole minor units, half-up, with the remainder to the largest fractional shares (CLAUDE.md → Money).",
  },
];

// ── Time ─────────────────────────────────────────────────────────────────────
// "Today" is Asia/Colombo's today, never the device's and never the server's.
const time = [
  {
    selector:
      "CallExpression[callee.property.name=/^(slice|substring|substr|split)$/][callee.object.callee.property.name='toISOString']",
    message:
      "toISOString() is UTC — this is off by one for five and a half hours a day. Use the business-date helper (Intl.DateTimeFormat('en-CA', { timeZone })).",
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message:
      "new Date() reads the device clock. Take the business date from the date helper so the timezone is explicit (IG §4.5).",
  },
  {
    selector: "MemberExpression[property.name=/^get(FullYear|Month|Date|Day|Hours|Minutes)$/]",
    message:
      "Local date parts follow the device timezone. Derive the business date via Intl.DateTimeFormat('en-CA', { timeZone }) (IG §4.5).",
  },
];

// ── Tenancy ──────────────────────────────────────────────────────────────────
// business_id is resolved from the verified JWT sub via business_member.
// Taking it from the request is the whole multi-tenancy bug, in one line.
const tenancy = [
  {
    selector:
      "MemberExpression[object.name=/^(body|input|payload|params|query|req|request|dto)$/][property.name=/^business_?[Ii]d$/]",
    message:
      "business_id is resolved from the verified token via business_member — never from a request body or query param (IG §10.2). Read it from c.get('businessId').",
  },
];

// ── Append-only ──────────────────────────────────────────────────────────────
const appendOnly = [
  {
    selector:
      "CallExpression[callee.property.name='delete'][callee.object.name=/^(db|tx|trx|conn)$/]",
    message:
      "Money records are append-only. A correction voids and replaces with a reference to the original — it never deletes (W-50).",
  },
];

// ── Reports degrade to 'not available', never to zero (W-56) ─────────────────
const notZero = [
  {
    selector: "LogicalExpression[operator=/^(\\?\\?|\\|\\|)$/][right.value=0]",
    message:
      "Defaulting a missing figure to 0 reports a confident wrong number. Missing data degrades to 'not available' (W-56).",
  },
  {
    selector: "LogicalExpression[operator=/^(\\?\\?|\\|\\|)$/][right.bigint='0']",
    message:
      "Defaulting a missing figure to 0n reports a confident wrong number. Missing data degrades to 'not available' (W-56).",
  },
];

export default ts.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "**/coverage/**",
      "**/worker-configuration.d.ts",
      "**/routeTree.gen.ts",
      "docs/**",
    ],
  },

  js.configs.recommended,
  ...ts.configs.recommended,

  // ── Everything TypeScript ──────────────────────────────────────────────────
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "no-restricted-syntax": ["error", ...money, ...time, ...tenancy, ...appendOnly],

      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-implicit-coercion": ["error", { boolean: false }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // A cast is documentation the compiler trusts and never checks — which is
      // how a money column ships the wrong shape (IG §11).
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "as", objectLiteralTypeAssertions: "never" },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },

  // ── Type-aware rules ───────────────────────────────────────────────────────
  // Applied to workspace source only, so config and scripts need no tsconfig.
  {
    files: ["{api,web,packages}/**/*.{ts,tsx}"],
    extends: [ts.configs.recommendedTypeChecked],
    rules: {
      // Every money write is one transaction. A dropped promise is a partial
      // write, which leaves a day confirmed but unpaid.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",

      // `${amount}` on a bigint is fine; on an object it prints [object Object]
      // into a statement someone is about to argue about.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: false, allowBoolean: false, allowNullish: false },
      ],
    },
  },

  // ── The Worker ─────────────────────────────────────────────────────────────
  {
    files: ["api/src/**/*.ts"],
    languageOptions: { globals: globals.worker },
    rules: {
      // Structured logging only (IG §3.4) — and no request bodies in production
      // logs, which console.log makes far too easy (IG §10.6).
      "no-console": "error",
      // Workers have no process.env; bindings arrive on the env object.
      "no-restricted-globals": [
        "error",
        {
          name: "process",
          message: "Workers have no process.env — read bindings from the env object (TS §8).",
        },
        {
          name: "Buffer",
          message: "Node globals are not available in the Worker runtime. Use Web APIs.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...money,
        ...time,
        ...tenancy,
        ...appendOnly,
        {
          // The period-open trigger is the truth. Two implementations of one
          // rule will diverge, and the one that loses is the database.
          selector:
            "CallExpression[callee.property.name=/^(isPeriodOpen|checkPeriodOpen|assertPeriodOpen|ensurePeriodOpen)$/]",
          message:
            "Do not pre-check the period in application code. assert_period_open() is the truth — catch the violation and map it to PERIOD_CLOSED (IG §4.2).",
        },
      ],
    },
  },

  // ── Layering (IG §3.1). The direction of these arrows is the architecture. ──
  {
    files: ["api/src/queries/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "hono",
              message: "queries/ take (db, …) and know nothing about HTTP (IG §3.1).",
            },
          ],
          patterns: [
            {
              group: [
                "**/handlers/**",
                "**/routes/**",
                "**/route-defs/**",
                "**/auth/**",
                "**/middleware/**",
              ],
              message: "queries/ is the bottom layer — nothing above it may be imported (IG §3.1).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["api/src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "hono",
              message:
                "domain/ orchestrates queries in a transaction and knows nothing about HTTP (IG §3.1).",
            },
          ],
          patterns: [
            {
              group: ["**/handlers/**", "**/routes/**", "**/route-defs/**"],
              message: "domain/ sits below the HTTP layer (IG §3.1).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["api/src/handlers/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "drizzle-orm",
              message:
                "Handlers do not build SQL. A multi-statement write belongs in domain/ so it is one transaction (IG §3.1, §4.2).",
            },
            {
              name: "@neondatabase/serverless",
              message:
                "Handlers receive a db from middleware; they do not open connections (IG §4.1).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "hono",
              message: "shared/ is imported by both sides — it must stay runtime-neutral (IG §2).",
            },
            {
              name: "react",
              message: "shared/ is imported by both sides — it must stay runtime-neutral (IG §2).",
            },
            {
              name: "@neondatabase/serverless",
              message: "shared/ is imported by both sides — it must stay runtime-neutral (IG §2).",
            },
          ],
        },
      ],
    },
  },

  // ── Schemas: the wire shape of money ───────────────────────────────────────
  {
    files: ["**/schemas/**/*.ts", "packages/shared/src/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...money,
        ...time,
        {
          selector: "CallExpression[callee.object.name='z'][callee.property.name='number']",
          message:
            "Money crosses the wire as a string, never a number (IG §4.4). If this field really is a count, disable this line with the reason.",
        },
      ],
    },
  },

  // ── Reports ────────────────────────────────────────────────────────────────
  {
    files: ["api/src/{queries,domain}/**/*.ts", "web/src/**/report*/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...money, ...time, ...tenancy, ...appendOnly, ...notZero],
    },
  },

  // ── The client ─────────────────────────────────────────────────────────────
  {
    files: ["web/src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    rules: {
      "no-restricted-syntax": [
        "error",
        ...money,
        ...time,
        {
          selector: "Literal[value=/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/]",
          message:
            "No raw hex. Colour comes from --color-* tokens; the prefix is required by Tailwind v4's @theme namespace (UI §5.1).",
        },
        {
          selector:
            "TemplateElement[value.raw=/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/]",
          message: "No raw hex. Colour comes from --color-* tokens (UI §5.1).",
        },
        {
          selector: "Literal[value=/\\b100vh\\b/]",
          message:
            "100vh is the wrong viewport unit on mobile — the URL bar is not accounted for. Use 100svh (UI §5).",
        },
        {
          selector: "TemplateElement[value.raw=/\\b100vh\\b/]",
          message: "100vh is the wrong viewport unit on mobile. Use 100svh (UI §5).",
        },
      ],
    },
  },

  // ── Tests ──────────────────────────────────────────────────────────────────
  {
    files: ["**/tests/**/*.ts", "**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",
      "@typescript-eslint/no-restricted-imports": "off",
    },
  },

  // ── Tooling ────────────────────────────────────────────────────────────────
  {
    files: ["**/scripts/**/*.{js,mjs,ts}", "*.config.{js,mjs,ts}", ".claude/hooks/**/*.mjs"],
    languageOptions: { globals: globals.node },
    rules: {
      "no-console": "off",
      "no-restricted-syntax": "off",
      "no-restricted-globals": "off",
    },
  },

  prettier,
);
