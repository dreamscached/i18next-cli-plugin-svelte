// @ts-check
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tsEslint from "typescript-eslint";

export default defineConfig([
	{ ignores: [".yarn/*", "dist/*"] },
	eslint.configs.recommended,
	...tsEslint.configs.recommended
]);
