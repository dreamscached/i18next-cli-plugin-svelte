import { describe, expect, it } from "vitest";

import i18nextSveltePlugin from "./index.js";
import { parse } from "svelte/compiler";

describe("i18nextSveltePlugin", () => {
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
            name: "ASI-unsafe component with instance and module <script> tags",
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
	])("should extract valid ES code: $name", async ({ source, expected }) => {
		const extracted = i18nextSveltePlugin.onLoad(source, "test.svelte");
        expect(() => parse(extracted)).not.toThrow();
		expect(extracted).toEqual(expected);
	});
});
