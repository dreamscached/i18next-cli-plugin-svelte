import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extract } from "i18next-cli";
import type { I18nextToolkitConfig } from "i18next-cli";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import I18nextSveltePlugin from "./index.js";

function pathEndsWith(p: string | undefined, suffix: string): boolean {
	if (!p) return false;
	return p.replace(/\\/g, "/").endsWith(suffix);
}

describe("I18nextSveltePlugin", () => {
	describe("onLoad", () => {
		it.each([
			{ path: "test.ts", source: "<foobar> invalid svelte/ts code" },
			{ path: "test.svelte.ts", source: "<foobar> invalid svelte/ts code" },
			{ path: "svelte.ts", source: "<foobar> invalid svelte/ts code" }
		])("returns undefined for non-svelte file $path", ({ path, source }) => {
			const plugin = new I18nextSveltePlugin();
			expect(plugin.onLoad!(source, path)).toBeUndefined();
		});

		it.each([
			{ name: "an example component", source: "<script>console.log('test')</script>" },
			{ name: "an empty file", source: "" },
			{ name: "a file with no <script> tag", source: "<div>foobar</div><style>div{}</style>" },
			{ name: "an empty <script> tag", source: "<script></script>" },
			{ name: "an empty <script module> tag", source: "<script module></script>" },
			{
				name: "instance and module scripts",
				source: `<script module>export const myval = 42;</script><script>console.log("Hello");</script>`
			}
		])("returns a string for $name (.svelte)", ({ source }) => {
			const plugin = new I18nextSveltePlugin();
			expect(typeof plugin.onLoad!(source, "test.svelte")).toBe("string");
		});
	});

	// The plugin only rewrites a component into JS that i18next-cli can parse;
	// the actual contract is *which keys end up extracted*. These tests drive
	// the full extract() pipeline so they stay meaningful regardless of the
	// exact intermediate JS we emit.
	describe("key extraction", () => {
		let tempDir: string;

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
					functions: ["t", "i18next.t", "i18n.t"],
					defaultNS: "translation",
					useTranslationNames: ["useTranslation", "getTranslationContext"]
				},
				plugins: [new I18nextSveltePlugin()]
			};
		}

		it.each([
			{
				name: "from <script>",
				source: `
					<script>
						import { t } from "i18next";
						const val = t('key_script', 'Default Script');
					</script>
				`,
				expected: { key_script: "Default Script" }
			},
			{
				name: "from <script module>",
				source: `<script module>const v = t('key_module', 'Default Module');</script>`,
				expected: { key_module: "Default Module" }
			},
			{
				name: "from both <script> and template",
				source: `
					<script>
						import { t } from "i18next";
						const val = t('key_script', 'Default Script');
					</script>
					<div>{t('key_html', 'Default HTML')}</div>
				`,
				expected: {
					key_script: "Default Script",
					key_html: "Default HTML"
				}
			},
			{
				name: "from an attribute expression",
				source: `
					<script>import { t } from "i18next";</script>
					<button title={t('key_attr', 'Default Attr')}></button>
				`,
				expected: { key_attr: "Default Attr" }
			},
			{
				name: "from a mustache tag (t)",
				source: `<div>{t('key_text', 'Text')}</div>`,
				expected: { key_text: "Text" }
			},
			{
				name: "from a mustache tag (i18next.t)",
				source: `<div>{i18next.t('key_member', 'Member')}</div>`,
				expected: { key_member: "Member" }
			},
			{
				// https://github.com/dreamscached/i18next-cli-plugin-svelte/issues/14
				name: "from {@html}",
				source: `<div>{@html getHtmlWithTrans(t('key_html_tag', 'Html Tag'))}</div>`,
				expected: { key_html_tag: "Html Tag" }
			},
			{
				name: "from {@render}",
				source: `{@render snippetWithTrans(t('key_render', 'Render'))}`,
				expected: { key_render: "Render" }
			},
			{
				name: "from {@attach}",
				source: `<div {@attach fnWithTrans(t('key_attach', 'Attach'))}></div>`,
				expected: { key_attach: "Attach" }
			},
			{
				name: "from {@const}",
				source: `{#if true}{@const c = t('key_const', 'Const')}{c}{/if}`,
				expected: { key_const: "Const" }
			},
			{
				name: "from {#if}",
				source: `{#if t('key_if', 'If')}{/if}`,
				expected: { key_if: "If" }
			},
			{
				name: "from {#if} else-if branch",
				source: `{#if cond}{:else if t('key_elseif', 'ElseIf')}{/if}`,
				expected: { key_elseif: "ElseIf" }
			},
			{
				name: "from {#each}",
				source: `{#each [t('key_each', 'Each')] as item}{item}{/each}`,
				expected: { key_each: "Each" }
			},
			{
				name: "from {#key}",
				source: `{#key t('key_key', 'Key')}{/key}`,
				expected: { key_key: "Key" }
			},
			{
				name: "from {#await}",
				source: `{#await t('key_await', 'Await')}{/await}`,
				expected: { key_await: "Await" }
			},
			{
				name: "from a {#snippet} parameter default",
				source: `{#snippet foo(arg = t('key_snippet_param', 'Snippet Param'))}{/snippet}`,
				expected: { key_snippet_param: "Snippet Param" }
			},
			{
				// https://github.com/dreamscached/i18next-cli-plugin-svelte/issues/14
				name: "from a {#snippet} body",
				source: `{#snippet foo()}{t('key_snippet_body', 'Snippet Body')}{/snippet}`,
				expected: { key_snippet_body: "Snippet Body" }
			},
			{
				// https://github.com/dreamscached/i18next-cli-plugin-svelte/issues/10
				name: "from typescript with an interface",
				source: `
					<script lang="ts">
						import { getTranslationContext } from './translation-context';

						interface Props {
							id: string;
						}

						const { t } = $derived.by(getTranslationContext('translation'));
						const { id }: Props = $props();
					</script>
					<div {id}>{t('key_ts', 'Hello TS')}</div>
				`,
				expected: { key_ts: "Hello TS" }
			}
		])("extracts keys $name", async ({ source, expected }) => {
			await writeFile(join(tempDir, "src/App.svelte"), source);
			const results = await extract(makeConfig());
			const file = results.find((r) => pathEndsWith(r.path, "/en/translation.json"));
			expect(file).toBeDefined();
			expect(file!.newTranslations).toEqual(expected);
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
			},
			{
				name: "handles namespace array (Svelte)",
				filename: "src/App.svelte",
				source: `
					<script>
						const { t } = $derived.by(getTranslationContext(['my-namespace', 'my-fallback-namespace']));
					</script>
					<div>
						{t('hello-world', 'Hello World!')}
					</div>
				`,
				configOverrides: {
					useTranslationNames: ["getTranslationContext"]
				},
				expectedNamespace: "/en/my-namespace.json",
				expectedTranslations: {
					"hello-world": "Hello World!"
				}
			},
			{
				name: "handles namespace array (ts)",
				filename: "src/app.svelte.ts",
				source: `
					const hello = () => {
						const { t } = getTranslationContext(['my-namespace', 'my-fallback-namespace']);
						return { label: t('hello-world', 'Hello World!') };
					};
				`,
				configOverrides: {
					useTranslationNames: ["getTranslationContext"]
				},
				expectedNamespace: "/en/my-namespace.json",
				expectedTranslations: {
					"hello-world": "Hello World!"
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
});
