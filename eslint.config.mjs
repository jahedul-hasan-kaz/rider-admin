import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // XSS: user text is rendered as text only (docs/spec/07-security.md §5).
      "react/no-danger": "error",
      // The secret-key client bypasses RLS; only the reviewed server modules may use it.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/server/supabase/admin-client",
              message: "Secret-key client is restricted. See docs/spec/07-security.md §3.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/server/actions/admins/**", "src/server/services/**", "src/app/api/webhooks/**", "src/app/api/internal/**"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["src/server/**", "src/app/api/**"],
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts", "src/types/database.gen.ts", "public/vendor/**"]),
]);

export default eslintConfig;
