import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extract } from "i18next-cli";
import type { I18nextToolkitConfig } from "i18next-cli";
import { parse } from "svelte/compiler";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import I18nextSveltePlugin from "./index.js";

function pathEndsWith(p: string | undefined, suffix: string): boolean {
	if (!p) return false;
	return p.replace(/\\/g, "/").endsWith(suffix);
}

describe("I18nextSveltePlugin", () => {
	describe("should extract valid js code", () => {
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
		])("$name", ({ source, expected }) => {
			const plugin = new I18nextSveltePlugin();
			const extracted = plugin.onLoad!(source, "test.svelte") as string;
			expect(() => parse(extracted)).not.toThrow();
			expect(extracted).toEqual(expected);
		});
	});

	describe("should extract statement from mustache tag", () => {
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
		])("$name", ({ source, expected }) => {
			const plugin = new I18nextSveltePlugin();
			const extracted = plugin.onLoad!(source, "test.svelte");
			expect(extracted).toEqual(expected);
		});
	});

	describe("should extract statements from svelte tags", () => {
		it.each([
			{
				name: "from {@html}",
				source: "<div>{@html getHtmlWithTrans(t('key1'))}</div>",
				expected: "(getHtmlWithTrans(t('key1')))"
			},
			{
				name: "from {@render}",
				source: "{@render snippetWithTrans(t('key1'))}",
				expected: "(snippetWithTrans(t('key1')))"
			},
			{
				name: "from {@attach}",
				source: "<div {@attach fnWithTrans(t('key1'))}></div>",
				expected: "(fnWithTrans(t('key1')))"
			},
			{
				name: "from {@const}",
				source: "{@const foobar = t('key1')}",
				expected: "(foobar = t('key1'))"
			},
			{
				name: "from {#if} (no else-if)",
				source: "{#if t('key1')}{/if}",
				expected: "(t('key1'))"
			},
			{
				name: "from {#if} (with else-if)",
				source: "{#if t('key1')}{:else if t('key2')}{/if}",
				expected: "(t('key1'))\n;(t('key2'))"
			},
			{
				name: "from {#each}",
				source: "{#each t('key1')}{/each}",
				expected: "(t('key1'))"
			},
			{
				name: "from {#key}",
				source: "{#key t('key1')}{/key}",
				expected: "(t('key1'))"
			},
			{
				name: "from {#await}",
				source: "{#await t('key1')}{/await}",
				expected: "(t('key1'))"
			},
			{
				name: "from {#snippet}",
				source: "{#snippet foo(arg=t('key1'))}{/snippet}",
				expected: "((arg=t('key1'));)"
			}
		])("$name", ({ source, expected }) => {
			const plugin = new I18nextSveltePlugin();
			const extracted = plugin.onLoad!(source, "test.svelte");
			expect(extracted).toEqual(expected);
		});
	});

	describe("should skip non-svelte files", () => {
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
		])("$path", ({ path, source, expected }) => {
			const plugin = new I18nextSveltePlugin();
			const extracted = plugin.onLoad!(source, path);
			expect(extracted).toEqual(expected);
		});
	});

	describe("should unwrap $derived/$derived.by svelte runes", () => {
		let tempDir: string;

		beforeEach(async () => {
			tempDir = await mkdtemp(join(tmpdir(), "i18next-svelte-test-"));
			await mkdir(join(tempDir, "src"), { recursive: true });
		});

		afterEach(async () => {
			await rm(tempDir, { recursive: true, force: true });
		});

		function makeConfig(
			overrides?: Partial<I18nextToolkitConfig["extract"]>
		): I18nextToolkitConfig {
			return {
				locales: ["en"],
				extract: {
					input: [join(tempDir, "src/**/*.{svelte,svelte.ts}")],
					output: join(tempDir, "locales/{{language}}/{{namespace}}.json"),
					functions: ["t", "i18n.t"],
					transComponents: ["Trans"],
					defaultNS: "translation",
					useTranslationNames: ["useTranslation", "getTranslationContext"],
					...overrides
				},
				plugins: [new I18nextSveltePlugin()]
			};
		}

		it.each([
			{
				name: "resolves namespace from $derived.by(getTranslationContext(...))",
				filename: "src/App.svelte",
				source: `
					<script>
						const { t } = $derived.by(getTranslationContext('my-namespace'));
					</script>
					<div>{t('hello-world', 'Hello World')}</div>
				`,
				expectedNamespace: "/en/my-namespace.json",
				expectedTranslations: {
					"hello-world": "Hello World"
				}
			},
			{
				name: "resolves namespace from $derived(getTranslationContext(...))",
				filename: "src/App.svelte",
				source: `
					<script>
						const { t } = $derived(getTranslationContext('my-namespace'));
					</script>
					<div>{t('hello-world', 'Hello World')}</div>
				`,
				expectedNamespace: "/en/my-namespace.json",
				expectedTranslations: {
					"hello-world": "Hello World"
				}
			},
			{
				name: "extracts multiple keys into the correct namespace",
				filename: "src/App.svelte",
				source: `
					<script>
						const { t } = $derived.by(getTranslationContext('my-namespace'));
					</script>
					<div>
						<h1>{t('title', 'Title')}</h1>
						<p>{t('description', 'Description')}</p>
					</div>
				`,
				expectedNamespace: "/en/my-namespace.json",
				expectedTranslations: {
					title: "Title",
					description: "Description"
				}
			},
			{
				name: "handles destructured alias: const { t: translate } = ...",
				filename: "src/App.svelte",
				source: `
					<script>
						const { t: translate } = $derived.by(getTranslationContext('my-namespace'));
					</script>
					<div>{translate('hello-world', 'Hello World')}</div>
				`,
				expectedNamespace: "/en/my-namespace.json",
				expectedTranslations: {
					"hello-world": "Hello World"
				}
			},
			{
				name: "resolves keyPrefix from custom hook config",
				filename: "src/App.svelte",
				source: `
					<script>
						const { t } = $derived.by(useCustomHook('myPrefix'));
					</script>
					<div>{t('title', 'Title')}</div>
				`,
				configOverrides: {
					useTranslationNames: [
						"useTranslation",
						{ name: "useCustomHook", nsArg: -1, keyPrefixArg: 0 }
					]
				},
				expectedNamespace: "/en/translation.json",
				expectedTranslations: {
					myPrefix: {
						title: "Title"
					}
				}
			},
			{
				name: "does not interfere with non-$derived useTranslation calls",
				filename: "src/App.svelte",
				source: `
					<script>
						const { t } = getTranslationContext('my-namespace');
					</script>
					<div>{t('hello-world', 'Hello World')}</div>
				`,
				expectedNamespace: "/en/my-namespace.json",
				expectedTranslations: {
					"hello-world": "Hello World"
				}
			},
			{
				name: "ignores $derived.by wrapping unknown functions",
				filename: "src/App.svelte",
				source: `
					<script>
						const { t } = $derived.by(someUnrelatedFunction('arg'));
					</script>
					<div>{t('hello-world', 'Hello World')}</div>
				`,
				expectedNamespace: "/en/translation.json",
				expectedTranslations: {
					"hello-world": "Hello World"
				}
			},
			{
				name: "handles $derived.by in .svelte.ts files",
				filename: "src/app.svelte.ts",
				source: `
					const { t } = $derived.by(getTranslationContext('my-namespace'));
					console.log(t('hello-world', 'Hello World'));
				`,
				expectedNamespace: "/en/my-namespace.json",
				expectedTranslations: {
					"hello-world": "Hello World"
				}
			}
			// FIXME: this should work, but it doesn't; this is bad!
			// {
			// 	name: "handles non-destructured assignment: const i18n = ...",
			// 	filename: "src/App.svelte",
			// 	source: `
			// 		<script>
			// 			const i18n = $derived.by(getTranslationContext('my-namespace'));
			// 		</script>
			// 		<div>{i18n.t('hello-world', 'Hello World')}</div>
			// 	`,
			// 	expectedNamespace: "/en/my-namespace.json",
			// 	expectedTranslations: {
			// 		"hello-world": "Hello World"
			// 	}
			// }
		])(
			"$name",
			async ({
				source,
				filename,
				expectedNamespace,
				expectedTranslations,
				configOverrides
			}) => {
				await writeFile(join(tempDir, filename), source);

				const results = await extract(makeConfig(configOverrides));
				const nsFile = results.find((r) => pathEndsWith(r.path, expectedNamespace));

				expect(nsFile).toBeDefined();
				if (expectedTranslations) {
					expect(nsFile!.newTranslations).toEqual(expectedTranslations);
				}
			}
		);
	});

	describe("should extract translation keys from svelte components", () => {
		let tempDir: string;

		function pathEndsWith(p: string | undefined, suffix: string): boolean {
			if (!p) return false;
			return p.replace(/\\/g, "/").endsWith(suffix);
		}

		beforeEach(async () => {
			tempDir = await mkdtemp(join(tmpdir(), "i18next-svelte-key-extract-"));
			await mkdir(join(tempDir, "src"), { recursive: true });
		});

		afterEach(async () => {
			await rm(tempDir, { recursive: true, force: true });
		});

		function makeConfig(): I18nextToolkitConfig {
			return {
				locales: ["en"],
				extract: {
					input: [join(tempDir, "src/**/*.svelte")],
					output: join(tempDir, "locales/{{language}}/{{namespace}}.json"),
					functions: ["t", "i18next.t"],
					defaultNS: "translation",
					useTranslationNames: ["useTranslation", "getTranslationContext"]
				},
				plugins: [new I18nextSveltePlugin()]
			};
		}

		it.each([
			{
				name: "extracts simple keys from script and html",
				source: `
                    <script>
						import { t } from "i18next";
                        const val = t('key_script', 'Default Script');
                    </script>
                    <div>{t('key_html', 'Default HTML')}</div>
                `,
				path: "/en/translation.json",
				expected: {
					key_script: "Default Script",
					key_html: "Default HTML"
				}
			},
			{
				name: "extracts keys from attributes",
				source: `
                    <script>
						import { t } from "i18next";
                    </script>
					<button title={t('key_attr', 'Default Attr')}>
					</button>
				`,
				path: "/en/translation.json",
				expected: {
					key_attr: "Default Attr"
				}
			},
			{
				// https://github.com/dreamscached/i18next-cli-plugin-svelte/issues/10
				name: "handles typescript with interface",
				source: `
					<script lang="ts">
						import { getTranslationContext } from './translation-context';

						interface Props {
							id: string;
						}

						const { t } = $derived.by(getTranslationContext('ui-form'));
						const { id }: Props = $props();
					</script>
					<div {id}>
						{t('hello-world', "Hello World!")}
					</div>
				`,
				path: "/en/ui-form.json",
				expected: {
					"hello-world": "Hello World!"
				}
			}
		])("$name", async ({ source, expected, path }) => {
			await writeFile(join(tempDir, "src/App.svelte"), source);
			const results = await extract(makeConfig());
			const defaultFile = results.find((r) => pathEndsWith(r.path, path));
			expect(defaultFile).toBeDefined();
			expect(defaultFile!.newTranslations).toEqual(expected);
		});
	});
});
