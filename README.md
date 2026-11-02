# [i18next-cli](https://github.com/i18next/i18next-cli) Svelte plugin

[![GitHub branch check runs](https://img.shields.io/github/check-runs/dreamscached/i18next-cli-plugin-svelte/master)](https://github.com/dreamscached/i18next-cli-plugin-svelte/actions/workflows/checks.yml)
[![Coverage](https://raw.githubusercontent.com/dreamscached/i18next-cli-plugin-svelte/refs/heads/docs/.github/badges/coverage.svg)](https://github.com/dreamscached/i18next-cli-plugin-svelte/actions/workflows/coverage-badge.yml)
[![NPM Downloads](https://img.shields.io/npm/dm/i18next-cli-plugin-svelte)](https://www.npmjs.com/package/i18next-cli-plugin-svelte)
[![GitHub License](https://img.shields.io/github/license/dreamscached/i18next-cli-plugin-svelte)](https://github.com/dreamscached/i18next-cli-plugin-svelte/blob/master/LICENSE)

This plugin is a simple TS/JS code extractor for Svelte component files,
enabling `i18next-cli extract` to find the translation keys in `<script>`
and in 'mustache' tags (Svelte templates.)

## Getting started

Simply import `i18next-cli-plugin-svelte` and add it to `plugins` array.
Here's an example `i18next.config.js` file:

```js
import { defineConfig } from "i18next-cli";
import I18nextSveltePlugin from "i18next-cli-plugin-svelte";

export default defineConfig({
	// ...
	plugins: [new I18nextSveltePlugin()]
});
```

## Linting

The plugin also lets `i18next-cli lint` check Svelte components for hardcoded
strings: text in markup, string-literal mustaches (`{"text"}`) and static
values of translatable attributes (`aria-label="Close"`). Translated
expressions such as `{t("key")}` are not reported.

```svelte
<button aria-label="Close dialog">Close</button>  <!-- 2 issues -->
<button aria-label={t("close_dialog")}>{t("close")}</button>  <!-- none -->
```

The same `lint` options apply as for JSX: `acceptedTags`, `acceptedAttributes`,
`ignoredTags` and `ignoredAttributes`. An HTML comment with the ignore
directive suppresses the next line:

```svelte
<!-- i18next-instrument-ignore-next-line -->
<kbd>Esc</kbd>
```

Only markup is linted for now: other lint checks (interpolation parameters,
concatenation) are not run on `<script>` code inside `.svelte` files.
