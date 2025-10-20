# i18n-cli Svelte plugin

This plugin is a simple TS/JS code extractor for Svelte component files,
enabling `i18n-cli extract` to find the translation keys.

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
