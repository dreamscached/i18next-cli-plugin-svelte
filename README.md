# [i18next-cli](https://github.com/i18next/i18next-cli) Svelte plugin

[![GitHub branch check runs](https://img.shields.io/github/check-runs/dreamscached/i18next-cli-plugin-svelte/master)](https://github.com/dreamscached/i18next-cli-plugin-svelte/actions/workflows/checks.yml)
[![NPM Downloads](https://img.shields.io/npm/dm/i18next-cli-plugin-svelte)](https://www.npmjs.com/package/i18next-cli-plugin-svelte)
[![GitHub License](https://img.shields.io/github/license/dreamscached/i18next-cli-plugin-svelte)](https://github.com/dreamscached/i18next-cli-plugin-svelte/blob/master/LICENSE)

This plugin is a simple TS/JS code extractor for Svelte component files,
enabling `i18next-cli extract` to find the translation keys in `<script>`

## Getting started

Simply import `i18next-cli-plugin-svelte` and add it to `plugins` array.
Here's an example `i18next.config.js` file:

```js
import { defineConfig } from "i18next-cli";
import i18nextSveltePlugin from "i18next-cli-plugin-svelte";

export default defineConfig({
	locales: ["en", "cs"],
	extract: {
		input: "src/**/*.{ts,svelte}",
		output: "src/assets/i18n/{{language}}.json",
		mergeNamespaces: true,
	},
	plugins: [
		i18nextSveltePlugin
	]
});
```
