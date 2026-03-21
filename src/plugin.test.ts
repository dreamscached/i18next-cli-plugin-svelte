import { findKeys, type I18nextToolkitConfig } from "i18next-cli";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import I18nextSveltePlugin from "./index.js";

const tempdir = join(__dirname, "..", "test");
const srcdir = join(tempdir, "src");
const outdir = join(tempdir, "out");

async function writeTestFile(name: string, content: string) {
	const path = join(srcdir, name);
	await mkdir(srcdir, { recursive: true });
	await writeFile(path, content, { encoding: "utf-8" });
}

async function resetTestDir() {
	await rm(tempdir, { force: true, recursive: true });
}

const configBase: I18nextToolkitConfig = {
	locales: ["en"],
	extract: {
		input: join(srcdir, "*.svelte"),
		output: join(outdir, "{{language}}/{{namespace}}.json")
	}
};

describe("I18nextPluginSvelte", () => {
	it("should ignore non-svelte files", async () => {
		const plugin = new I18nextSveltePlugin();
		const res = plugin.onLoad("", "App.js");
		expect(res).toBeUndefined();
	});
});

describe("findKeys", () => {
	afterEach(async () => {
		await resetTestDir();
	});

	describe("key extraction from <script> (no t(...) params)", () => {
		it.each([
			{
				description: "from js <script> with default import",
				content: `
					<script>
						import i18n from "i18next";
						const text1 = i18n.t("hello.script1");
						const text2 = i18n.t("hello.script2");
						const text3 = i18n.t("hello.script3");
					</script>
				`,
				keys: [
					"translation:hello.script1",
					"translation:hello.script2",
					"translation:hello.script3"
				]
			},
			{
				description: "from js <script> with named import",
				content: `
					<script>
						import { t } from "i18next";
						const text1 = t("hello.script1");
						const text2 = t("hello.script2");
						const text3 = t("hello.script3");
					</script>
				`,
				keys: [
					"translation:hello.script1",
					"translation:hello.script2",
					"translation:hello.script3"
				]
			},
			{
				description: "from ts (with types) <script> with default import",
				content: `
					<script lang="ts">
						import i18n from "i18next";
						const text1: string = i18n.t("hello.script1");
						const text2: string = i18n.t("hello.script2");
						const text3: string = i18n.t("hello.script3");
					</script>
				`,
				keys: [
					"translation:hello.script1",
					"translation:hello.script2",
					"translation:hello.script3"
				]
			},
			{
				description: "from ts (with types) <script> with named import",
				content: `
					<script lang="ts">
						import { t } from "i18next";
						const text1: string = t("hello.script1");
						const text2: string = t("hello.script2");
						const text3: string = t("hello.script3");
					</script>
				`,
				keys: [
					"translation:hello.script1",
					"translation:hello.script2",
					"translation:hello.script3"
				]
			},
			{
				description: "from js <script module> with named import",
				content: `
					<script lang="ts">
						import { t } from "i18next";
						const text1: string = t("hello.script1");
						const text2: string = t("hello.script2");
						const text3: string = t("hello.script3");
					</script>
				`,
				keys: [
					"translation:hello.script1",
					"translation:hello.script2",
					"translation:hello.script3"
				]
			},
			{
				description: "from js <script module> with default import",
				content: `
					<script module>
						import i18n from "i18next";
						const text1 = i18n.t("hello.script1");
						const text2 = i18n.t("hello.script2");
						const text3 = i18n.t("hello.script3");
					</script>
				`,
				keys: [
					"translation:hello.script1",
					"translation:hello.script2",
					"translation:hello.script3"
				]
			},
			{
				description: "from ts (with types) <script module> with default import",
				content: `
					<script lang="ts" module>
						import i18n from "i18next";
						const text1: string = i18n.t("hello.script1");
						const text2: string = i18n.t("hello.script2");
						const text3: string = i18n.t("hello.script3");
					</script>
				`,
				keys: [
					"translation:hello.script1",
					"translation:hello.script2",
					"translation:hello.script3"
				]
			},
			{
				description: "from js <script module> with named import",
				content: `
					<script module>
						import { t } from "i18next";
						const text1 = t("hello.script1");
						const text2 = t("hello.script2");
						const text3 = t("hello.script3");
					</script>
				`,
				keys: [
					"translation:hello.script1",
					"translation:hello.script2",
					"translation:hello.script3"
				]
			},
			{
				description: "from ts (with types) <script module> with named import",
				content: `
					<script lang="ts" module>
						import { t } from "i18next";
						const text1: string = t("hello.script1");
						const text2: string = t("hello.script2");
						const text3: string = t("hello.script3");
					</script>
				`,
				keys: [
					"translation:hello.script1",
					"translation:hello.script2",
					"translation:hello.script3"
				]
			},
			{
				description: "from js <script> with default import with custom namespace",
				content: `
					<script>
						import i18n from "i18next";
						const text1 = i18n.t("hello.script1", { ns: "foo" });
						const text2 = i18n.t("hello.script2", { ns: "bar" });
						const text3 = i18n.t("hello.script3", { ns: "baz" });
					</script>
				`,
				keys: ["foo:hello.script1", "bar:hello.script2", "baz:hello.script3"]
			}
		])("$description", async ({ content, keys }) => {
			await writeTestFile("App.svelte", content);
			const res = await findKeys({ ...configBase, plugins: [new I18nextSveltePlugin()] });
			const extractedKeys = [...res.allKeys.keys()];
			expect(extractedKeys).toEqual(expect.arrayContaining(keys));
		});
	});

	describe("key extraction from template tags", () => {
		it.each([
			{
				description: "with default import",
				content: `
					<script>
						import i18n from "i18next";
					</script>
					<div>
						{i18n.t("hello.world1")}
						{i18n.t("hello.world2")}
						{i18n.t("hello.world3")}
					</div>
				`,
				keys: [
					"translation:hello.world1",
					"translation:hello.world2",
					"translation:hello.world3"
				]
			},
			{
				description: "with named import",
				content: `
					<script>
						import { t } from "i18next";
					</script>
					<div>
						{t("hello.world1")}
						{t("hello.world2")}
						{t("hello.world3")}
					</div>
				`,
				keys: [
					"translation:hello.world1",
					"translation:hello.world2",
					"translation:hello.world3"
				]
			}
		])("$description", async ({ content, keys }) => {
			await writeTestFile("App.svelte", content);
			const res = await findKeys({ ...configBase, plugins: [new I18nextSveltePlugin()] });
			const extractedKeys = [...res.allKeys.keys()];
			expect(extractedKeys).toEqual(expect.arrayContaining(keys));
		});
	});

	describe("key extraction from attribute tags", () => {
		it.each([
			{
				description: "with default import",
				content: `
					<script>
						import i18n from "i18next";
					</script>
					<div>
						<img alt={i18n.t("hello.world1")}>
						<img alt={i18n.t("hello.world2")}>
						<img alt={i18n.t("hello.world3")}>
					</div>
				`,
				keys: [
					"translation:hello.world1",
					"translation:hello.world2",
					"translation:hello.world3"
				]
			},
			{
				description: "with named import",
				content: `
					<script>
						import { t } from "i18next";
					</script>
					<div>
						<img alt={t("hello.world1")}>
						<img alt={t("hello.world2")}>
						<img alt={t("hello.world3")}>
					</div>
				`,
				keys: [
					"translation:hello.world1",
					"translation:hello.world2",
					"translation:hello.world3"
				]
			}
		])("$description", async ({ content, keys }) => {
			await writeTestFile("App.svelte", content);
			const res = await findKeys({ ...configBase, plugins: [new I18nextSveltePlugin()] });
			const extractedKeys = [...res.allKeys.keys()];
			expect(extractedKeys).toEqual(expect.arrayContaining(keys));
		});
	});
});
