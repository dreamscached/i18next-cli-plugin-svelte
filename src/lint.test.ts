import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runLinter } from "i18next-cli";
import type { I18nextToolkitConfig } from "i18next-cli";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import I18nextSveltePlugin from "./index.js";

// These tests drive the full runLinter() pipeline: the contract is which
// issues i18next-cli reports for a component, not the plugin's internals.
describe("hardcoded string linting", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "i18next-svelte-lint-"));
		await mkdir(join(tempDir, "src"), { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	async function lint(source: string, lintConfig: I18nextToolkitConfig["lint"] = {}) {
		await writeFile(join(tempDir, "src/Component.svelte"), source);
		const config: I18nextToolkitConfig = {
			locales: ["en"],
			extract: {
				input: [join(tempDir, "src/**/*.svelte")],
				output: join(tempDir, "locales/{{language}}/{{namespace}}.json")
			},
			lint: lintConfig,
			plugins: [new I18nextSveltePlugin()]
		};
		const { files } = await runLinter(config);
		return Object.values(files)
			.flat()
			.map(({ text, line, type }) => ({ text, line, type }));
	}

	it("lints a component with TypeScript and runes without parse errors", async () => {
		const issues = await lint(`<script lang="ts">
	interface Props { count: number }
	let { count }: Props = $props();
	const double = $derived(count * 2);
</script>
<p>{double}</p>`);
		expect(issues).toEqual([]);
	});

	it.each([
		{ name: "element text", source: `<p>Hello world</p>`, text: "Hello world" },
		{
			name: "text inside a component",
			source: `<Button>Save changes</Button>`,
			text: "Save changes"
		},
		{
			name: "a string-literal mustache",
			source: `<p>{"Hello world"}</p>`,
			text: "Hello world"
		},
		{
			name: "an accepted attribute",
			source: `<img alt="Company logo" src="a.png" />`,
			text: "Company logo"
		},
		{
			name: "an aria attribute",
			source: `<nav aria-label="Main menu"></nav>`,
			text: "Main menu"
		},
		{
			name: "a literal attribute expression",
			source: `<textarea placeholder={"Your name"}></textarea>`,
			text: "Your name"
		},
		{
			name: "text in {#if}",
			source: `{#if ok}<span>Shown</span>{:else}<span>Hidden</span>{/if}`,
			text: "Shown"
		},
		{
			name: "text in {#each}",
			source: `{#each items as item}<li>Item label</li>{/each}`,
			text: "Item label"
		},
		{
			name: "text in {#snippet}",
			source: `{#snippet row()}<td>Row cell</td>{/snippet}`,
			text: "Row cell"
		},
		{
			name: "text in <svelte:head>",
			source: `<svelte:head><title>Page title</title></svelte:head>`,
			text: "Page title"
		}
	])("reports $name", async ({ source, text }) => {
		const issues = await lint(source);
		expect(issues).toContainEqual({ text, line: 1, type: "hardcoded" });
	});

	it.each([
		{ name: "translated text", source: `<p>{t("greeting")}</p>` },
		{ name: "translated attributes", source: `<img alt={t("logo")} title={$t("logo")} />` },
		{ name: "numbers and single characters", source: `<p>42</p><span>·</span><i>...</i>` },
		{ name: "URLs and paths", source: `<p>https://example.com</p><p>/docs</p>` },
		{
			name: "non-translatable attributes",
			source: `<a href="/about" class="link-primary" id="x"></a>`
		},
		{ name: "<code> content", source: `<code>npm install</code>` },
		{
			name: "<script> and <style>",
			source: `<script>const s = "Not markup";</script><style>p{}</style>`
		},
		{ name: "top-level text with recommended tags", source: `Loose text` }
	])("does not report $name", async ({ source }) => {
		expect(await lint(source)).toEqual([]);
	});

	it("reports line numbers of the .svelte source", async () => {
		const issues = await lint(`<script lang="ts">
	let n: number = 0;
</script>

<h1>
	Title text
</h1>
<p title="Tooltip text">{n}</p>`);
		expect(issues).toEqual([
			{ text: "Title text", line: 6, type: "hardcoded" },
			{ text: "Tooltip text", line: 8, type: "hardcoded" }
		]);
	});

	it("reports each text part around an expression", async () => {
		const issues = await lint(`<p>Count: {n} items</p>`);
		expect(issues.map((i) => i.text)).toEqual(["Count:", "items"]);
	});

	it("honours the ignore directive in an HTML comment", async () => {
		const issues = await lint(`<!-- i18next-instrument-ignore-next-line -->
<p>Ignored text</p>
<p>Reported text</p>`);
		expect(issues.map((i) => i.text)).toEqual(["Reported text"]);
	});

	it("honours lint.ignoredTags", async () => {
		const issues = await lint(`<Kbd>Esc</Kbd><p>Reported text</p>`, { ignoredTags: ["Kbd"] });
		expect(issues.map((i) => i.text)).toEqual(["Reported text"]);
	});

	it("honours lint.acceptedTags", async () => {
		const issues = await lint(`<p>Paragraph</p><span>Span text</span>`, {
			acceptedTags: ["span"]
		});
		expect(issues.map((i) => i.text)).toEqual(["Span text"]);
	});

	it("honours lint.acceptedAttributes", async () => {
		const issues = await lint(`<p data-tip="Tip text" title="Title text"></p>`, {
			acceptedAttributes: ["data-tip"]
		});
		expect(issues.map((i) => i.text)).toEqual(["Tip text"]);
	});

	it("skips elements outside the accepted tags, as for JSX", async () => {
		expect(await lint(`<input placeholder="Your name" />`)).toEqual([]);
	});

	it("leaves non-svelte files to i18next-cli", async () => {
		const plugin = new I18nextSveltePlugin();
		expect(plugin.lintOnLoad("const x = 1;", "file.ts")).toBeUndefined();
	});
});
