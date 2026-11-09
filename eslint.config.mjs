import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Project-local agent skills are third-party tooling, not application source.
  globalIgnores([".next/**", ".next-browser/**", "out/**", "build/**", ".agents/**", "next-env.d.ts"]),
]);
