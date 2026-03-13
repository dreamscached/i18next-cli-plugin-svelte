import type { Plugin } from "i18next-cli";
import { type CompileOptions, compile } from "svelte/compiler";

/** Parameters for {@link I18nextSveltePlugin}. */
export interface Options {
	/** Svelte compiler options. */
	compilerOptions?: CompileOptions | undefined;
}

/**
 * Provides Svelte component compilation layer for i18next to
 * later parse and extract translation keys from the generated
 * JS source code.
 */
export class I18nextSveltePlugin implements Plugin {
	/** i18next-cli plugin name. */
	public readonly name = "i18next-cli-plugin-svelte";
	/** Svelte compiler options. */
	private readonly compilerOptions: CompileOptions;

	/**
	 * Creates a new instance of i18next extractor plugin for
	 * Svelte with optional parameters.
	 * @param options optional plugin options
	 */
	constructor(options?: Options) {
		this.compilerOptions = {
			generate: "client",
			...(options?.compilerOptions ?? {})
		};
	}

	/**
	 * For every .svelte input file attempts component compilation
	 * to i18next-parseable JS source code file for further key
	 * extraction.
	 * @param code raw source code to process
	 * @param path path to the source file
	 * @returns generated JS code from .svelte component or
	 *   undefined for non-Svelte files
	 */
	onLoad(code: string, path: string): string | undefined {
		// Passthrough for non-Svelte files
		if (!path.match(/\.svelte$/)) return undefined;
		// Compile Svelte to parseable JS code
		const res = compile(code, this.compilerOptions);
		return res.js.code;
	}
}
