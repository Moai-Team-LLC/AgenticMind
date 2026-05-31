import type { OxlintConfig } from "oxlint"

type PluginConfig = NonNullable<OxlintConfig["plugins"]>
type RuleConfig = NonNullable<OxlintConfig["rules"]>
type SettingsConfig = NonNullable<OxlintConfig["settings"]>
type OverridesConfig = NonNullable<OxlintConfig["overrides"]>

const basePlugins: PluginConfig = ["typescript", "unicorn", "oxc", "promise", "import", "node"]

const frontendPlugins: PluginConfig = [...basePlugins, "react", "react-perf"]

const categories: NonNullable<OxlintConfig["categories"]> = {
  correctness: "error",
  suspicious: "error",
  perf: "error",
  pedantic: "error",
  style: "error",
  restriction: "error",
}

const baseRules: RuleConfig = {
  "typescript/prefer-readonly-parameter-types": "off",
  "typescript/explicit-function-return-type": "off",
  "typescript/explicit-module-boundary-types": "off",
  "typescript/consistent-type-definitions": ["error", "type"],
  "unicorn/prefer-global-this": "off",
  "func-style": ["error", "expression"],
  "no-magic-numbers": "off",
  "oxc/no-optional-chaining": "off",
  "oxc/no-rest-spread-properties": "off",
  "oxc/no-async-await": "off",
  "unicorn/no-null": "off",
  "sort-imports": "off",
  "no-undefined": "off",
  "max-statements": "off",
  "unicorn/no-process-exit": "off",
  "no-ternary": "off",
  "no-continue": "off",
  "prefer-destructuring": "off",
  "no-console": "off",
  "no-warning-comments": "off",
  "max-params": "off",
  "max-lines-per-function": "off",
  "id-length": "off",
  "no-inline-comments": "off",
  "unicorn/no-array-reduce": "error",
  "no-use-before-define": ["error", { functions: false, variables: false }], // Top-down style: a nested function may reference a module-scope arrow helper declared later. Still catches real same-scope TDZ.
  "no-useless-return": "error",
  "no-duplicate-imports": "off", // Does not work with oxfmt, yikes
  "no-void": "off",
  "typescript/explicit-member-accessibility": "off",
  complexity: ["error", { max: 30 }], // Extract/synth/fetch functions are inherently branchy; 30 keeps a ceiling without risky refactors.
  "max-classes-per-file": "off",
  "new-cap": "error",
  "require-await": "off", // This rule is inferior to the accuracy of the type-aware typescript/require-await rule.
  "no-plusplus": "off", // Idiomatic `i++` in loops; codebase-wide style, not a correctness concern.
  "init-declarations": "off", // `let x` then assign is fine; pure style, not correctness.
  "sort-keys": "off", // Breaks TanStack Query mutation context inference by reordering callbacks.
  "oxc/erasing-op": "error",
  "no-nested-ternary": "off",
  "unicorn/no-nested-ternary": "off",
  "typescript/use-unknown-in-catch-callback-variable": "error",
  "typescript/no-non-null-assertion": "error",
  "typescript/no-confusing-void-expression": "error",
  "oxc/no-map-spread": "off", // Keeping spread: Object.assign alternative causes accidental mutability
  "unicorn/no-await-expression-member": "error",
  "no-empty-function": "error",
  "unicorn/no-useless-collection-argument": "error",
  "unicorn/prefer-ternary": "error",
  "no-negated-condition": "off", // Negated conditions read fine here; pure style.
  "unicorn/no-negated-condition": "off", // Same — duplicate of the eslint rule.
  "typescript/array-type": "error",
  "typescript/unified-signatures": "error",
  "arrow-body-style": ["error", "as-needed", { requireReturnForObjectLiteral: true }],
  "import/prefer-default-export": "off",
  "import/no-namespace": "off", // Breaks Zod's recommended `import * as z from "zod"` style.
  "import/no-named-export": "off",
  "import/no-named-default": "error",
  "promise/prefer-await-to-then": "error",
  "import/group-exports": "off", // Codebase uses inline `export const`; merging exports is churn with no correctness value.
  "promise/prefer-await-to-callbacks": "off", // We like neverthrow match statements.
  "node/no-process-env": "error",
  "import/exports-last": "off", // Same — inline exports are the established idiom; reordering is pure churn.
  "import/max-dependencies": "off", // A lot of dependencies is fine if complexity is fine.
  "import/consistent-type-specifier-style": ["error", "prefer-top-level"],
  "typescript/no-import-type-side-effects": "error",
  "import/no-relative-parent-imports": "error",
  "import/unambiguous": "error",
  "oxc/no-barrel-file": "error",
  "import/first": "error",
  "promise/avoid-new": "off", // Callback-only APIs need promise adapters; this rule encourages behavior-changing rewrites.
  "import/no-nodejs-modules": "off", // Frontend workspaces are full-stack; accidental client Node imports are easy to spot.
  "import/no-default-export": "error",
  "typescript/parameter-properties": "error",
  "unicorn/custom-error-definition": "error",
  "no-await-in-loop": "off", // Sequential awaits are often intentional (ordering / rate-limits); auto-parallelizing risks behavior changes.
  "typescript/only-throw-error": "off", // We throw tagged-union errors immediately caught by ResultAsync.fromPromise mappers (neverthrow idiom); wrapping them in Error would obscure the tag the catch narrows on.
  "typescript/no-unsafe-type-assertion": "off", // Casts at I/O boundaries (raw SQL rows, parsed LLM JSON, neverthrow tagged-error narrowing) are architectural; conforming needs runtime validation everywhere (behavior + perf risk).
  // The no-unsafe-* family is non-deterministic here: oxlint's type-aware engine
  // intermittently fails to resolve the `createEnv` (t3-env) generic and then
  // floods every settings-derived value as `error`-typed (observed 3 vs 1307
  // findings across identical runs). `tsc` is the real type-safety gate and is
  // clean; these rules are unreliable on this codebase, so they're off.
  "typescript/no-unsafe-assignment": "off",
  "typescript/no-unsafe-member-access": "off",
  "typescript/no-unsafe-call": "off",
  "typescript/no-unsafe-argument": "off",
  "typescript/no-unsafe-return": "off",
  "typescript/non-nullable-type-assertion-style": "off", // Conflicts with typescript/no-non-null-assertion (kept), which forbids the `!` it prefers.
  "require-unicode-regexp": "off", // Adding the `u` flag changes escape semantics; not worth a repo-wide sweep.
  "unicorn/consistent-function-scoping": "off", // Local helpers kept next to their only caller aid readability; hoisting for its own sake hurts locality.
  "capitalized-comments": "off", // Capitalizes mid-sentence continuation words in multi-line `//` comments, which hurts readability more than it helps.
  "unicorn/prefer-spread": "off", // Conflicts with no-misused-spread (kept): code-point splitting needs Array.from(str), which this rule would force back to the string spread no-misused-spread forbids.
  "default-case": "off", // Contradicts switch-exhaustiveness-check (kept): exhaustive union switches intentionally omit a default.
  "unicorn/number-literal-case": "off", // oxfmt normalises hex digits to lowercase, which this rule rejects — formatter wins.
  "no-underscore-dangle": "off", // The `__agenticmindDb` global singleton uses a deliberate dunder name.
  "max-lines": "off", // File length is fine when complexity is fine (mirrors max-statements / max-lines-per-function).
}

const frontendRuleOverrides: RuleConfig = {
  "react/react-in-jsx-scope": "off",
  "react/jsx-filename-extension": "off",
  "react-perf/jsx-no-new-function-as-prop": "off",
  "react/jsx-max-depth": "off",
  "react-perf/jsx-no-new-array-as-prop": "off",
  "react-perf/jsx-no-new-object-as-prop": "error",
  "react/no-children-prop": "error",
  "react-perf/jsx-no-jsx-as-prop": "off",
  "react/jsx-handler-names": "off",
  "react/only-export-components": [
    "error",
    { allowExportNames: ["metadata", "generateMetadata", "viewport", "generateViewport"] },
  ],
  "react/jsx-props-no-spreading": "off",
  "react/no-multi-comp": "off",
  "react/hook-use-state": "off",
  "react/forbid-component-props": ["error", { forbid: ["style"] }],
}

const schemaFileOverrides: OverridesConfig = [
  {
    files: ["**/schema.ts", "**/schema/**/*.ts"],
    rules: {
      "oxc/no-barrel-file": "off",
    },
  },
  {
    // Entry points + standalone CLIs legitimately read process.env directly
    // (before any settings module is constructed); the settings modules are
    // the boundary for everything downstream.
    files: ["scripts/**/*.ts", "**/src/index.ts"],
    rules: {
      "node/no-process-env": "off",
    },
  },
  {
    // Tests legitimately use `x!` on known fixtures, `(await fn()).prop` in
    // assertions, and async mocks that satisfy async interfaces without
    // awaiting — none of which are defects in test code.
    files: ["**/*.test.ts"],
    rules: {
      "typescript/no-non-null-assertion": "off",
      "unicorn/no-await-expression-member": "off",
      "typescript/require-await": "off",
    },
  },
]

const frontendSettings: SettingsConfig = {
  react: {
    version: "19.2.5",
  },
}

const baseIgnorePatterns = [
  "**/node_modules/**",
  "**/dist/**",
  "**/drizzle/**",
  "**/*.d.ts",
  "**/*.config.{js,ts,mjs,cjs}",
  "**/tsconfig.tsbuildinfo",
]

const rootIgnorePatterns = [
  ...baseIgnorePatterns,
  "apps/web/src/components/ui/**",
  "packages/ui/src/components/**",
]

const webIgnorePatterns = [...baseIgnorePatterns, "src/components/ui/**"]

const uiIgnorePatterns = [...baseIgnorePatterns, "src/components/**"]

type CreateOxlintConfigOptions = {
  plugins?: PluginConfig
  ignorePatterns?: string[]
  rules?: RuleConfig
  settings?: SettingsConfig
  overrides?: OverridesConfig
}

const createOxlintConfig = ({
  plugins = basePlugins,
  ignorePatterns = rootIgnorePatterns,
  rules = {},
  settings,
  overrides = [],
}: CreateOxlintConfigOptions = {}): OxlintConfig => {
  return {
    plugins,
    categories,
    rules: {
      ...baseRules,
      ...rules,
    },
    env: {
      builtin: true,
    },
    ignorePatterns,
    overrides: [...schemaFileOverrides, ...overrides],
    ...(settings === undefined ? {} : { settings }),
  }
}

export {
  baseIgnorePatterns,
  basePlugins,
  baseRules,
  categories,
  createOxlintConfig,
  frontendPlugins,
  frontendRuleOverrides,
  frontendSettings,
  rootIgnorePatterns,
  schemaFileOverrides,
  uiIgnorePatterns,
  webIgnorePatterns,
}
