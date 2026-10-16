import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Panels that must never render patient or clinical data import nothing
// that does. Enforced in CI, not by convention.
const PATIENT_DATA_MODULES = [
  "@/components/clinical/*",
  "@/components/frontdesk/*",
  "@/components/billing/*",
  "@/features/clinical/*",
  "@/features/patients/*",
  "@/features/billing/*",
  "@/features/pharmacy/*",
  "@/features/queue/*",
  "@/features/scheduling/booking*",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `const { secret, ...safe } = row` is how a field is deliberately left out.
      "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true }],
    },
  },
  {
    files: ["app/(compliance)/**", "app/platform/**", "app/(clinic)/analytics/**", "components/analytics/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: PATIENT_DATA_MODULES,
              message: "The compliance panel, the operations console and analytics never render identifiable patient data.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // v1 reference code, not built
    "legacy/**",
  ]),
]);

export default eslintConfig;
