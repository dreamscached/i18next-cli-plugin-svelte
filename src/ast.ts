/* eslint-disable @typescript-eslint/no-explicit-any */
import type * as estree from "estree";
import { walk } from "estree-walker";
import { type AST } from "svelte/compiler";

export function extractScriptIIFE(script: AST.Script): estree.ExpressionStatement {
	// We can't have top-level 'import ...' declaration in IIFE, so we
	// need to convert them to 'const {} = await import' first.
	walk(script as any, {
		enter(node) {
			switch (node.type) {
				case "ImportDeclaration":
					this.replace(transformImport(node));
					break;
				case "MetaProperty":
					this.replace(transformImportMeta(node));
					break;
				case "ExportNamedDeclaration":
				case "ExportDefaultDeclaration":
					this.replace(transformExport(node));
					break;
			}
		}
	});

	return toIIFE(script.content.body as unknown as estree.Statement[]);
}

export function extractTemplateExpr(html: AST.Fragment): estree.ExpressionStatement[] {
	const statements: estree.ExpressionStatement[] = [];

	walk(html as any, {
		// @ts-expect-error we're walking Svelte AST here
		enter(node: AST.BaseNode) {
			switch (node.type) {
				case "MustacheTag":
				case "RawMustacheTag":
				case "HtmlTag":
				case "RenderTag":
				case "AttachTag":
				case "ConstTag":
				case "IfBlock":
				case "EachBlock":
				case "KeyBlock":
				case "AwaitBlock":
					statements.push({
						type: "ExpressionStatement",
						expression: (node as any).expression
					});
					break;
				// TODO: snippet
			}
		}
	});

	return statements;
}

function transformImport(
	node: estree.ImportDeclaration
): estree.VariableDeclaration | estree.ExpressionStatement {
	// 'await' expression common for any imports
	const awaitExpression: estree.AwaitExpression = {
		type: "AwaitExpression",
		argument: {
			type: "CallExpression",
			callee: { type: "Import" as any },
			arguments: [node.source],
			optional: false
		}
	};

	// Handle side-effect only imports: import "foobar";
	if (node.specifiers.length === 0) {
		return {
			type: "ExpressionStatement",
			expression: awaitExpression
		};
	}

	// Handle namespace import: import * as Foobar
	const namespaceSpecifier = node.specifiers.find((s) => s.type === "ImportNamespaceSpecifier");
	let id: estree.Identifier | estree.ObjectPattern;

	if (namespaceSpecifier) {
		id = namespaceSpecifier.local;
	} else {
		// Handle named and default imports
		const properties = node.specifiers
			.map((specifier) => {
				switch (specifier.type) {
					case "ImportSpecifier":
						return {
							type: "Property" as const,
							key: specifier.imported,
							value: specifier.local,
							kind: "init" as const,
							shorthand:
								specifier.imported.type === "Identifier" &&
								specifier.imported.name === specifier.local.name,
							method: false,
							computed: false
						};
					case "ImportDefaultSpecifier":
						return {
							type: "Property" as const,
							key: { type: "Identifier" as const, name: "default" },
							value: specifier.local,
							kind: "init" as const,
							shorthand: false,
							method: false,
							computed: false
						};
					case "ImportNamespaceSpecifier":
					default:
						return null;
				}
			})
			.filter((val) => val !== null);

		id = {
			type: "ObjectPattern",
			properties: properties
		};
	}

	return {
		type: "VariableDeclaration",
		kind: "const",
		declarations: [
			{
				type: "VariableDeclarator",
				id: id,
				init: awaitExpression
			}
		]
	};
}

function toIIFE(nodes: estree.Statement[]): estree.ExpressionStatement {
	return {
		type: "ExpressionStatement",
		expression: {
			type: "CallExpression",
			arguments: [],
			optional: false,
			callee: {
				type: "ArrowFunctionExpression",
				params: [],
				expression: false,
				async: true,
				body: {
					type: "BlockStatement",
					body: nodes
				}
			}
		}
	};
}

function transformExport(
	exportNode: estree.ExportNamedDeclaration | estree.ExportDefaultDeclaration
): estree.Statement {
	// Named exports: export const x = 1; export function f() {}
	if (exportNode.type === "ExportNamedDeclaration") {
		if (exportNode.declaration) {
			// Simply return the declaration (const/let/var/function/class)
			// The 'export' keyword is effectively stripped here.
			return exportNode.declaration;
		}

		// Handle: export { x }; (references only, no logic to extract)
		return { type: "EmptyStatement" };
	}

	// Default Exports: export default ...
	const decl = exportNode.declaration;

	// Handle Function/Class Declarations (which might be anonymous)
	if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
		if (decl.id) {
			return decl as estree.Statement;
		}

		// If anonymous, we convert to an expression to satisfy 'Statement' type
		return {
			type: "ExpressionStatement",
			expression: {
				...decl,
				type: decl.type === "FunctionDeclaration" ? "FunctionExpression" : "ClassExpression"
			} as estree.FunctionExpression | estree.ClassExpression
		};
	}

	// Expressions: export default t('key'); or export default { a: t('b') };
	// Wrap in an ExpressionStatement to keep it as a valid Statement in the IIFE body
	return {
		type: "ExpressionStatement",
		expression: decl as estree.Expression
	};
}

function transformImportMeta(node: estree.Node): estree.Node {
	if (node.type === "MetaProperty" && node.meta.name === "import") {
		// Replace with a dummy identifier or object
		return {
			type: "ObjectExpression",
			properties: []
		};
	}
	return node;
}
