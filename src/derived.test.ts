import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extract } from "i18next-cli";
import type { I18nextToolkitConfig } from "i18next-cli";

import I18nextSveltePlugin from "./index.js";

function pathEndsWith(p: string | undefined, suffix: string): boolean {
	if (!p) return false;
	return p.replace(/\\/g, "/").endsWith(suffix);
}

let tempDir: string;

describe("$derived.by / $derived rune unwrapping", () => {
	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "i18next-svelte-test-"));
		await mkdir(join(tempDir, "src"), { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	function makeConfig(
		overrides?: Partial<I18nextToolkitConfig["extract"]>,
	): I18nextToolkitConfig {
		return {
			locales: ["en"],
			extract: {
				input: [join(tempDir, "src/**/*.svelte")],
				output: join(tempDir, "locales/{{language}}/{{namespace}}.json"),
				functions: ["t"],
				transComponents: ["Trans"],
				defaultNS: "translation",
				useTranslationNames: [
					"useTranslation",
					"getTranslationContext",
				],
				...overrides,
			},
			plugins: [new I18nextSveltePlugin()],
		};
	}

	it("resolves namespace from $derived.by(getTranslationContext(...))", async () => {
		await writeFile(
			join(tempDir, "src/App.svelte"),
			`<script>
  const { t } = $derived.by(getTranslationContext('my-namespace'));
</script>

<div>{t('hello-world', 'Hello World')}</div>`,
		);

		const results = await extract(makeConfig());
		const nsFile = results.find((r) =>
			pathEndsWith(r.path, "/en/my-namespace.json"),
		);

		expect(nsFile).toBeDefined();
		expect(nsFile!.newTranslations).toEqual({
			"hello-world": "Hello World",
		});
	});

	it("resolves namespace from $derived(getTranslationContext(...))", async () => {
		await writeFile(
			join(tempDir, "src/App.svelte"),
			`<script>
  const { t } = $derived(getTranslationContext('my-namespace'));
</script>

<div>{t('hello-world', 'Hello World')}</div>`,
		);

		const results = await extract(makeConfig());
		const nsFile = results.find((r) =>
			pathEndsWith(r.path, "/en/my-namespace.json"),
		);

		expect(nsFile).toBeDefined();
		expect(nsFile!.newTranslations).toEqual({
			"hello-world": "Hello World",
		});
	});

	it("extracts multiple keys into the correct namespace", async () => {
		await writeFile(
			join(tempDir, "src/App.svelte"),
			`<script>
  const { t } = $derived.by(getTranslationContext('my-namespace'));
</script>

<div>
  <h1>{t('title', 'Title')}</h1>
  <p>{t('description', 'Description')}</p>
</div>`,
		);

		const results = await extract(makeConfig());
		const nsFile = results.find((r) =>
			pathEndsWith(r.path, "/en/my-namespace.json"),
		);

		expect(nsFile).toBeDefined();
		expect(nsFile!.newTranslations).toEqual({
			title: "Title",
			description: "Description",
		});
	});

	it("handles destructured alias: const { t: translate } = ...", async () => {
		await writeFile(
			join(tempDir, "src/App.svelte"),
			`<script>
  const { t: translate } = $derived.by(getTranslationContext('my-namespace'));
</script>

<div>{translate('hello-world', 'Hello World')}</div>`,
		);

		const results = await extract(makeConfig());
		const nsFile = results.find((r) =>
			pathEndsWith(r.path, "/en/my-namespace.json"),
		);

		expect(nsFile).toBeDefined();
		expect(nsFile!.newTranslations).toEqual({
			"hello-world": "Hello World",
		});
	});

	it("resolves keyPrefix from custom hook config", async () => {
		await writeFile(
			join(tempDir, "src/App.svelte"),
			`<script>
  const { t } = $derived.by(useCustomHook('myPrefix'));
</script>

<div>{t('title', 'Title')}</div>`,
		);

		const config = makeConfig({
			useTranslationNames: [
				"useTranslation",
				{ name: "useCustomHook", nsArg: -1, keyPrefixArg: 0 },
			],
		});

		const results = await extract(config);
		const file = results.find((r) =>
			pathEndsWith(r.path, "/en/translation.json"),
		);

		expect(file).toBeDefined();
		expect(file!.newTranslations).toEqual({
			myPrefix: { title: "Title" },
		});
	});

	it("does not interfere with non-$derived useTranslation calls", async () => {
		await writeFile(
			join(tempDir, "src/App.svelte"),
			`<script>
  const { t } = getTranslationContext('my-namespace');
</script>

<div>{t('hello-world', 'Hello World')}</div>`,
		);

		const results = await extract(makeConfig());
		const nsFile = results.find((r) =>
			pathEndsWith(r.path, "/en/my-namespace.json"),
		);

		expect(nsFile).toBeDefined();
		expect(nsFile!.newTranslations).toEqual({
			"hello-world": "Hello World",
		});
	});

	it("ignores $derived.by wrapping unknown functions", async () => {
		await writeFile(
			join(tempDir, "src/App.svelte"),
			`<script>
  const { t } = $derived.by(someUnrelatedFunction('arg'));
</script>

<div>{t('hello-world', 'Hello World')}</div>`,
		);

		const results = await extract(makeConfig());
		const file = results.find((r) =>
			pathEndsWith(r.path, "/en/translation.json"),
		);

		expect(file).toBeDefined();
		expect(file!.newTranslations).toHaveProperty("hello-world");
	});
});
