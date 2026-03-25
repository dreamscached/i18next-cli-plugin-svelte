import { parse } from "svelte/compiler";
import { describe, expect, it } from "vitest";

import I18nextSveltePlugin from "./index.js";

describe("I18nextSveltePlugin", () => {
	it.each([
		{
			name: "example Svelte component",
			source: `
            <script>
            import i18n from "i18next-cli";
            console.log(i18n.t("sample.translation.key"));
            </script>

            <div class="mydiv">Hello world!</div>

            <style>
                .mydiv {
                    color: black;
                }
            </style>
            `,
			expected: `
            import i18n from "i18next-cli";
            console.log(i18n.t("sample.translation.key"));
            `
		},
		{
			name: "one empty <script> tag",
			source: `<script></script>`,
			expected: ``
		},
		{
			name: "empty file",
			source: "",
			expected: ``
		},
		{
			name: "no <script> tag",
			source: `<div>foobar</div><style>div{}</style>`,
			expected: ``
		},
		{
			name: "instance with a module <script> tag",
			source: `
            <script module>export const myval = 42;</script>
            <script>console.log("Hello");</script>
            `,
			expected: `console.log("Hello");
;export const myval = 42;`
		},
		{
			name: "one empty <script module> tag",
			source: `<script module>export const foobar = "bar";</script>`,
			expected: `export const foobar = "bar";`
		},
		{
			name: "multiple statements in <script> with no semicolons",
			source: `<script>console.log("Hello")\nconsole.log("World!")</script>`,
			expected: `console.log("Hello")
console.log("World!")`
		},
		{
			name: "asi-unsafe component with instance and module <script> tags",
			source: `<script>
  const data = [1, 2, 3]
</script>
<script context="module">
  [4, 5, 6].forEach(n => console.log(n))
</script>`,
			expected: `
  const data = [1, 2, 3]

;
  [4, 5, 6].forEach(n => console.log(n))
`
		}
	])("should extract valid js code: $name", ({ source, expected }) => {
		const plugin = new I18nextSveltePlugin();
		const extracted = plugin.onLoad!(source, "test.svelte") as string;
		expect(() => parse(extracted)).not.toThrow();
		expect(extracted).toEqual(expected);
	});

	it.each([
		{
			name: "text tag (i18next.t)",
			source: "<div>{i18next.t('key1')}</div>",
			expected: "(i18next.t('key1'))"
		},
		{
			name: "attribute tag (i18next.t)",
			source: "<button title={i18next.t('key2')}></button>",
			expected: "(i18next.t('key2'))"
		},
		{
			name: "text tag (t)",
			source: "<div>{t('key1')}</div>",
			expected: "(t('key1'))"
		},
		{
			name: "attribute tag (t)",
			source: "<button title={t('key2')}></button>",
			expected: "(t('key2'))"
		},
		{
			name: "non-key tag",
			source: "<div>{variable}</div>",
			expected: "(variable)"
		},
		{
			name: "empty html",
			source: "<script></script>",
			expected: ""
		}
	])("should extract statement from mustache tag: $name", ({ source, expected }) => {
		const plugin = new I18nextSveltePlugin();
		const extracted = plugin.onLoad!(source, "test.svelte");
		expect(extracted).toEqual(expected);
	});

	it.each([
		{
			path: "test.svelte",
			source: "<script>console.log('test')</script>",
			expected: "console.log('test')"
		},
		{
			path: "test.ts",
			source: "<foobar> invalid svelte/ts code",
			expected: undefined
		},
		{
			path: "test.svelte.ts",
			source: "<foobar> invalid svelte/ts code",
			expected: undefined
		},
		{
			path: "svelte.ts",
			source: "<foobar> invalid svelte/ts code",
			expected: undefined
		}
	])("should skip non-svelte files: $path", ({ path, source, expected }) => {
		const plugin = new I18nextSveltePlugin();
		const extracted = plugin.onLoad!(source, path);
		expect(extracted).toEqual(expected);
	});
});
