import { describe, expect, it } from "vitest";
import { extractScriptIIFE } from "./ast.js";
import { parse, type AST } from "svelte/compiler";
import * as recast from "recast";

describe("extractScriptIIFE", () => {
    it.each([
        {
            source: `
                <script>
                    import { foobar } from "foobar";
                </script>
            `,
            output: `(async () => {
    const {
        foobar
    } = await import("foobar");
})();`
        },
        {
            source: `
                <script>
                    import {} from "foobar";
                </script>
            `,
            output: `(async () => {
    await import("foobar");
})();`
        },
        {
            source: `
                <script>
                    import { foobar as barbaz } from "foobar";
                </script>
            `,
            output: `(async () => {
    const {
        foobar: barbaz
    } = await import("foobar");
})();`
        },
        {
            source: `
                <script>
                    import { foobar as barbaz, bar } from "foobar";
                </script>
            `,
            output: `(async () => {
    const {
        foobar: barbaz,
        bar
    } = await import("foobar");
})();`
        },
        {
            source: `
                <script>
                    import Foobar from "foobar";
                </script>
            `,
            output: `(async () => {
    const {
        default: Foobar
    } = await import("foobar");
})();`
        },
        {
            source: `
                <script>
                    import Foobar, { foobar } from "foobar";
                </script>
            `,
            output: `(async () => {
    const {
        default: Foobar,
        foobar
    } = await import("foobar");
})();`
        },
        {
            source: `
                <script>
                    import "foobar";
                </script>
            `,
            output: `(async () => {
    await import("foobar");
})();`
        },
        {
            source: `
                <script>
                    import * as foobar from "foobar";
                </script>
            `,
            output: `(async () => {
    const foobar = await import("foobar");
})();`
        },
        {
            source: `
                <script>
                    const foobar = await import("foobar");
                </script>
            `,
            output: `(async () => {
    const foobar = await import("foobar");
})();`
        },
        {
            source: `
                <script>
                    if (true) {
                        const foobar = await import("foobar");
                    }
                </script>
            `,
            output: `(async () => {
    if (true) {
        const foobar = await import("foobar");
    }
})();`
        }
    ])("should convert import declarations to const declarations", ({ source, output }) => {
        const ast = parse(source) as AST.Root;
        const iife = extractScriptIIFE(ast.instance!);
        const js = recast.print(iife).code;
        expect(js).toEqual(output);
    });
});
