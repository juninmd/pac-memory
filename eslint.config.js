import js from "@eslint/js"
import tsPlugin from "@typescript-eslint/eslint-plugin"
import tsParser from "@typescript-eslint/parser"
import globals from "globals"

export default [
  js.configs.recommended,
  // TypeScript source files — Node.js environment
  {
    files: ["src/**/*.ts"],
    ignores: ["src/web/public/**"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      globals: { ...globals.node, ...globals.es2022 },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-eval": "error",
      "no-new-func": "error",
      "no-undef": "off", // TypeScript handles this
    },
  },
  // Browser JS files — browser environment
  {
    files: ["src/web/public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser, ...globals.es2022 },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^(API|_)", caughtErrorsIgnorePattern: "^_" }],
      "no-eval": "error",
      "no-new-func": "error",
    },
  },
]
