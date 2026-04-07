import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extract } from "i18next-cli";
import type { I18nextToolkitConfig } from "i18next-cli";
import { parse } from "svelte/compiler";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import I18nextSveltePlugin from "./index.js";

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
				expected: `import i18n from "i18next-cli";
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
export const myval = 42;
`
			},
			{
				name: "one empty <script module> tag",
				source: `<script module></script>`,
				expected: ``
			},
			{
				name: "multiple statements in <script> with no semicolons",
				source: `<script>console.log("Hello")\nconsole.log("World!")</script>`,
				expected: `console.log("Hello");
console.log("World!");
`
			},
			{
				name: "asi-unsafe component with instance and module <script> tags",
				source: `
					<script>
						const data = [1, 2, 3]
					</script>
					<script context="module">
						[4, 5, 6].forEach(n => console.log(n))
					</script>
				`,
				expected: `const data = [1, 2, 3];
[4, 5, 6].forEach(n => console.log(n));
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
				source: `<div>{i18next.t('key1')}</div>`,
				expected: `i18next.t('key1');
`
			},
			{
				name: "attribute tag (i18next.t)",
				source: `<button title={i18next.t('key2')}></button>`,
				expected: `i18next.t('key2');
`
			},
			{
				name: "text tag (t)",
				source: `<div>{t('key1')}</div>`,
				expected: `t('key1');
`
			},
			{
				name: "attribute tag (t)",
				source: `<button title={t('key2')}></button>`,
				expected: `t('key2');
`
			},
			{
				name: "non-key tag",
				source: `<div>{variable}</div>`,
				expected: `variable;
`
			},
			{
				name: "empty html",
				source: `<script></script>`,
				expected: ``
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
				source: `<script>console.log('test')</script>`,
				expected: `console.log('test');
`
			},
			{
				path: "test.ts",
				source: `<foobar> invalid svelte/ts code`,
				expected: undefined
			},
			{
				path: "test.svelte.ts",
				source: `<foobar> invalid svelte/ts code`,
				expected: undefined
			},
			{
				path: "svelte.ts",
				source: `<foobar> invalid svelte/ts code`,
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

		function pathEndsWith(p: string | undefined, suffix: string): boolean {
			if (!p) return false;
			return p.replace(/\\/g, "/").endsWith(suffix);
		}

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
					input: [join(tempDir, "src/**/*.svelte")],
					output: join(tempDir, "locales/{{language}}/{{namespace}}.json"),
					functions: ["t"],
					transComponents: ["Trans"],
					defaultNS: "translation",
					useTranslationNames: ["useTranslation", "getTranslationContext"],
					...overrides
				},
				plugins: [new I18nextSveltePlugin()]
			};
		}

		it("resolves namespace from $derived.by(getTranslationContext(...))", async () => {
			await writeFile(
				join(tempDir, "src/App.svelte"),
				`
					<script>
						const { t } = $derived.by(getTranslationContext('my-namespace'));
					</script>

					<div>
						{t('hello-world', 'Hello World')}
					</div>
				`
			);

			const results = await extract(makeConfig());
			const nsFile = results.find((r) => pathEndsWith(r.path, "/en/my-namespace.json"));

			expect(nsFile).toBeDefined();
			expect(nsFile!.newTranslations).toEqual({
				"hello-world": "Hello World"
			});
		});

		it("resolves namespace from $derived(getTranslationContext(...))", async () => {
			await writeFile(
				join(tempDir, "src/App.svelte"),
				`
					<script>
						const { t } = $derived(getTranslationContext('my-namespace'));
					</script>
					<div>
						{t('hello-world', 'Hello World')}
					</div>
				`
			);

			const results = await extract(makeConfig());
			const nsFile = results.find((r) => pathEndsWith(r.path, "/en/my-namespace.json"));

			expect(nsFile).toBeDefined();
			expect(nsFile!.newTranslations).toEqual({
				"hello-world": "Hello World"
			});
		});

		it("extracts multiple keys into the correct namespace", async () => {
			await writeFile(
				join(tempDir, "src/App.svelte"),
				`
					<script>
						const { t } = $derived.by(getTranslationContext('my-namespace'));
					</script>
					<div>
						<h1>{t('title', 'Title')}</h1>
						<p>{t('description', 'Description')}</p>
					</div>
				`
			);

			const results = await extract(makeConfig());
			const nsFile = results.find((r) => pathEndsWith(r.path, "/en/my-namespace.json"));

			expect(nsFile).toBeDefined();
			expect(nsFile!.newTranslations).toEqual({
				title: "Title",
				description: "Description"
			});
		});

		it("handles destructured alias: const { t: translate } = ...", async () => {
			await writeFile(
				join(tempDir, "src/App.svelte"),
				`
					<script>
						const { t: translate } = $derived.by(getTranslationContext('my-namespace'));
					</script>
					<div>
						{translate('hello-world', 'Hello World')}
					</div>
				`
			);

			const results = await extract(makeConfig());
			const nsFile = results.find((r) => pathEndsWith(r.path, "/en/my-namespace.json"));

			expect(nsFile).toBeDefined();
			expect(nsFile!.newTranslations).toEqual({
				"hello-world": "Hello World"
			});
		});

		it("resolves keyPrefix from custom hook config", async () => {
			await writeFile(
				join(tempDir, "src/App.svelte"),
				`
					<script>
						const { t } = $derived.by(useCustomHook('myPrefix'));
					</script>
					<div>
						{t('title', 'Title')}
					</div>
				`
			);

			const config = makeConfig({
				useTranslationNames: [
					"useTranslation",
					{ name: "useCustomHook", nsArg: -1, keyPrefixArg: 0 }
				]
			});

			const results = await extract(config);
			const file = results.find((r) => pathEndsWith(r.path, "/en/translation.json"));

			expect(file).toBeDefined();
			expect(file!.newTranslations).toEqual({
				myPrefix: { title: "Title" }
			});
		});

		it("does not interfere with non-$derived useTranslation calls", async () => {
			await writeFile(
				join(tempDir, "src/App.svelte"),
				`
					<script>
						const { t } = getTranslationContext('my-namespace');
					</script>
					<div>
						{t('hello-world', 'Hello World')}
					</div>
				`
			);

			const results = await extract(makeConfig());
			const nsFile = results.find((r) => pathEndsWith(r.path, "/en/my-namespace.json"));

			expect(nsFile).toBeDefined();
			expect(nsFile!.newTranslations).toEqual({
				"hello-world": "Hello World"
			});
		});

		it("ignores $derived.by wrapping unknown functions", async () => {
			await writeFile(
				join(tempDir, "src/App.svelte"),
				`
					<script>
						const { t } = $derived.by(someUnrelatedFunction('arg'));
					</script>
					<div>
						{t('hello-world', 'Hello World')}
					</div>
				`
			);

			const results = await extract(makeConfig());
			const file = results.find((r) => pathEndsWith(r.path, "/en/translation.json"));

			expect(file).toBeDefined();
			expect(file!.newTranslations).toHaveProperty("hello-world");
		});
	});
});
