import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Pages under src/app run on the server unless they say "use client". A page
 * there that hands a function to a client component as its children (as in
 * `<FormField>{(a) => <Input {...a} />}</FormField>`) builds and type-checks,
 * then fails each time the page is opened ("Functions cannot be passed
 * directly to Client Components"): the site shows «حدث خطأ ما». Server pages
 * write `<Input {...controlProps("name")} />` instead.
 */
const APP = fileURLToPath(new URL("../../src/app", import.meta.url));

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

/** Where a server file passes a function as a JSX element's children: "file:line <Element>". */
function functionChildren(name: string, text: string): string[] {
  if (/^\s*["']use client["']/.test(text)) return [];
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      for (const child of node.children) {
        const e = ts.isJsxExpression(child) ? child.expression : undefined;
        if (e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e))) {
          const line = source.getLineAndCharacterOfPosition(child.getStart(source)).line + 1;
          found.push(`${name}:${line} <${node.openingElement.tagName.getText(source)}>`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("server pages", () => {
  it("never pass a function as children (it fails when the page is opened)", () => {
    const found = tsxFiles(APP).flatMap((file) => functionChildren(relative(APP, file), readFileSync(file, "utf8")));
    expect(found).toEqual([]);
  });

  it("the check finds such a function, and leaves client components alone", () => {
    const page = 'export default function P() {\n  return <FormField name="x">{(a) => <input {...a} />}</FormField>;\n}\n';
    expect(functionChildren("page.tsx", page)).toEqual(["page.tsx:2 <FormField>"]);
    expect(functionChildren("form.tsx", `"use client";\n${page}`)).toEqual([]);
  });
});
