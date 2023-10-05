import type { Modifier } from "typescript";
import ts from "typescript";

// Seems like isAsyncFunction is not exported from typescript
declare module "typescript" {
  function isAsyncFunction(node: ts.Node): boolean;
}

export interface Options {
  mobxKeystonePackage: string;
  generateModelNameFromFilename?: (filename: string) => string;
}

const autoFlow = "autoFlow";
const modelFlow = "modelFlow";

/**
 * 1. Look for functions marked decorated with @autoFlow or inside an autoFlow(...) call
 * 2. Transform them into generator functions wrapped in an _async call
 * 3. Add import * as mobxKs from "mobx-keystone"; to the top of the file
 * 4. Look for classes marked with @autoModel
 * 5. Transform them into classes marked with @model
 */
export default function createTransformer(
  options?: Partial<Options>
): ts.TransformerFactory<ts.SourceFile> {
  return (context) => (file) => visitSourceFile(file, context, options);
}

function visitSourceFile(
  source: ts.SourceFile,
  context: ts.TransformationContext,
  options?: Partial<Options>
): ts.SourceFile {
  const mobxNamespaceImport = ts.factory.createUniqueName(
    "mobxKs",
    ts.GeneratedIdentifierFlags.Optimistic |
      ts.GeneratedIdentifierFlags.FileLevel
  );

  const _asyncExpression = createMobxKsPropertyAccessExpression(
    mobxNamespaceImport,
    "_async"
  );
  const _awaitExpression = createMobxKsPropertyAccessExpression(
    mobxNamespaceImport,
    "_await"
  );
  const modelFlowExpression = createMobxKsPropertyAccessExpression(
    mobxNamespaceImport,
    modelFlow
  );
  const modelExpression = createMobxKsPropertyAccessExpression(
    mobxNamespaceImport,
    "model"
  );

  let transformed = false;
  let className = "";

  const resSource = addImportMobxStatement(
    source,
    options?.mobxKeystonePackage || "mobx-keystone",
    mobxNamespaceImport
  );

  const functionsToAddDecoratorsTo: string[] = [];

  const visitor: ts.Visitor = (node) => {
    if (ts.isClassDeclaration(node)) {
      className = ts.getNameOfDeclaration(node)?.getText() ?? "";

      const autoModelDecorator = node.modifiers?.find((x) =>
        x.getText().includes("autoModel")
      );

      if (autoModelDecorator) {
        transformed = true;

        // Remove the autoModel decorator and replace it with a model decorator
        // Todo: Might need to ensure that fileName is safe to use as a model name
        const modelName = options?.generateModelNameFromFilename
          ? options?.generateModelNameFromFilename(resSource.fileName)
          : resSource.fileName;

        node = ts.factory.updateClassDeclaration(
          node,
          [
            ...(node.modifiers?.filter((x) => x !== autoModelDecorator) ?? []),
            ts.factory.createDecorator(
              ts.factory.createCallExpression(modelExpression, undefined, [
                ts.factory.createStringLiteral(modelName),
              ])
            ),
          ],
          node.name,
          node.typeParameters,
          node.heritageClauses,
          node.members
        );
      }
    }

    let newNode: ts.Node | undefined;

    if (ts.isPropertyDeclaration(node)) {
      newNode = ts.visitEachChild(
        node,
        (node) => {
          if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text.startsWith(autoFlow)
          ) {
            // Mark to add a decorator for functions wrapped in autoFlow()
            if (ts.isPropertyDeclaration(node.parent)) {
              functionsToAddDecoratorsTo.push(node.parent.name.getText());
            }

            const fn = node.arguments[0];

            // Transform decorator-less property functions that look like this:
            // myFunc = autoFlow(async (...args) => { ... }
            // myFunc = autoFlow(async function (this: MYCLASS, ...args) { ... }
            if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
              transformed = true;
              const newFunctionBlock = createNewFunctionBlock(
                fn,
                _awaitExpression,
                context
              );
              return transformFunction(
                newFunctionBlock,
                _asyncExpression,
                className
              );
            }
          }

          return node;
        },
        context
      );
    }

    // Add a decorator to transformed functions
    if (
      newNode &&
      ts.isPropertyDeclaration(newNode) &&
      functionsToAddDecoratorsTo.includes(newNode.name.getText())
    ) {
      const pd = ts.isPropertyDeclaration(newNode) ? newNode : undefined;

      if (!pd) {
        throw new Error(errorMessage("Could not resolve property declaration"));
      }

      return transformPropertyDeclaration(
        pd,
        newNode.initializer,
        modelFlowExpression
      );
    }

    // Transform decorated methods that look like this:
    // @autoFlow async myFunc(...args) { ... }
    // They are not actually transformed, but changed into properties
    if (
      ts.isMethodDeclaration(node) &&
      hasDecorator(node.modifiers, autoFlow) &&
      node.body
    ) {
      const functionExpression = ts.factory.createFunctionExpression(
        node.modifiers?.map((x) => x as Modifier),
        node.asteriskToken,
        ts.isIdentifier(node.name) ? node.name : undefined,
        node.typeParameters,
        node.parameters,
        node.type,
        node.body
      );

      node = ts.factory.createPropertyDeclaration(
        node.modifiers,
        node.name,
        node.questionToken,
        node.type,
        functionExpression
      );
    }

    // Transform decoratored property functions that look like this:
    // autoFlow myFunc = async function (this: MYCLASS, ...args) { ... }
    // autoFlow myFunc = async (...args) => { ... }
    if (
      ts.isPropertyDeclaration(node) &&
      hasDecorator(node.modifiers, autoFlow) &&
      node.initializer
    ) {
      const fn = node.initializer;

      if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
        transformed = true;
        const newFn = createNewFunctionBlock(fn, _awaitExpression, context);

        return transformPropertyDeclaration(
          node,
          transformFunction(newFn, _asyncExpression, className),
          modelFlowExpression
        );
      }
    }

    return ts.visitEachChild(node, visitor, context);
  };

  const convertToFlowResult = ts.visitEachChild(resSource, visitor, context);

  // transformed is modified by the visitor
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (transformed) {
    return convertToFlowResult;
  }

  return source;
}

const createMobxKsPropertyAccessExpression = (
  mobxKsNamespaceImport: ts.Identifier,
  name: string
) =>
  ts.factory.createPropertyAccessExpression(
    mobxKsNamespaceImport,
    ts.factory.createIdentifier(name)
  );

function createNewFunctionBlock(
  fn: ts.ArrowFunction | ts.FunctionExpression,
  _awaitExpression: ts.Expression,
  context: ts.TransformationContext
) {
  const replaceYieldAndCheckNested: ts.Visitor = (node) => {
    if (ts.isAwaitExpression(node)) {
      return ts.factory.createYieldExpression(
        ts.factory.createToken(ts.SyntaxKind.AsteriskToken),
        ts.factory.createCallExpression(_awaitExpression, undefined, [
          node.expression,
        ])
      );
    }

    if (ts.isFunctionLike(node)) {
      // do not visit nested functions
      return node;
    }

    return ts.visitEachChild(node, replaceYieldAndCheckNested, context);
  };

  const newFunctionBody = replaceYieldAndCheckNested(fn.body) as ts.ConciseBody;

  return ts.isArrowFunction(fn)
    ? ts.factory.updateArrowFunction(
        fn,
        fn.modifiers,
        fn.typeParameters,
        fn.parameters,
        fn.type,
        fn.equalsGreaterThanToken,
        newFunctionBody
      )
    : ts.factory.updateFunctionExpression(
        fn,
        fn.modifiers,
        fn.asteriskToken,
        fn.name,
        fn.typeParameters,
        fn.parameters,
        fn.type,
        newFunctionBody as ts.Block
      );
}

/**
 * adds `import * as mobxKs_1 from 'mobx-keystone';`
 * It is possible to try to reuse and existing import statement, but adding one seems simpler for now
 */
function addImportMobxStatement(
  source: ts.SourceFile,
  mobxPackage: string,
  mobxNamespaceImport: ts.Identifier
) {
  const importFlowStatement = ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(
      false,
      undefined,
      ts.factory.createNamespaceImport(mobxNamespaceImport)
    ),
    ts.factory.createStringLiteral(mobxPackage)
  );

  return ts.factory.updateSourceFile(
    source,
    [importFlowStatement, ...source.statements],
    source.isDeclarationFile,
    source.referencedFiles,
    source.typeReferenceDirectives,
    source.hasNoDefaultLib,
    source.libReferenceDirectives
  );
}

/**
 * A helper to update function and strip the async keyword from modifiers
 */
function transformFunction(
  fn: ts.FunctionExpression | ts.ArrowFunction,
  asyncIdentifier: ts.Expression,
  className: string
) {
  if (!isAsyncFunction(fn)) {
    throw new Error(
      errorMessage(
        `Could not resolve expression as async function: ${fn.getFullText()}`
      )
    );
  }

  const hasThisParam = fn.parameters.find((x) => x.name.getText() === "this");
  const additionalParams = hasThisParam
    ? []
    : [
        ts.factory.createParameterDeclaration(
          undefined,
          undefined,
          "this",
          undefined,
          ts.factory.createTypeReferenceNode(className)
        ),
      ];

  return ts.factory.createCallExpression(asyncIdentifier, undefined, [
    ts.factory.createFunctionExpression(
      undefined,
      ts.factory.createToken(ts.SyntaxKind.AsteriskToken),
      undefined,
      undefined,
      additionalParams.concat(fn.parameters),
      undefined,
      fn.body as ts.Block
    ),
  ]);
}

/**
 * A helper to update property declaration and strip the async keyword from modifiers
 */
function transformPropertyDeclaration(
  node: ts.PropertyDeclaration,
  newFunctionBlock: ts.CallExpression | ts.Expression | undefined,
  modelFlowExpression: ts.Expression
): ts.PropertyDeclaration {
  const newModifiers = ensureDecorators(
    Array.from(node.modifiers ?? []),
    modelFlowExpression
  );

  return ts.factory.updatePropertyDeclaration(
    node,
    newModifiers,
    node.name,
    node.questionToken,
    node.type,
    newFunctionBlock
  );
}

const isSpecificDecorator = (decorator: ts.ModifierLike, name: string) =>
  ts.isDecorator(decorator) &&
  ts.isIdentifier(decorator.expression) &&
  decorator.expression.text === name;

const hasDecorator = (
  decorators: ts.NodeArray<ts.ModifierLike> | undefined,
  name: string
) => !!decorators?.filter((x) => isSpecificDecorator(x, name)).length;

/**
 * A helper to ensure that the modelFlow decorator is present and that autoFlow and async are removed
 */
function ensureDecorators(
  modifiers: ts.ModifierLike[] | undefined,
  modelFlowExpression: ts.Expression
): ts.ModifierLike[] | undefined {
  const res =
    modifiers?.reduce<ts.ModifierLike[]>((acc, x) => {
      // skip async modifier
      if (x.kind === ts.SyntaxKind.AsyncKeyword) {
        return acc;
      }

      // skip @autoFlow decorator
      if (isSpecificDecorator(x, autoFlow)) {
        return acc;
      }

      return [...acc, x];
    }, []) ?? [];

  // Add the modelFlow decorator if it is not already there
  if (!hasDecorator(ts.factory.createNodeArray(res), modelFlow)) {
    // Ensure that the modelFlow decorator is the first one
    // TODO: Check conflicts with additional decorators
    res.unshift(ts.factory.createDecorator(modelFlowExpression));
  }

  return res;
}

const isAsyncFunction = (node: ts.Node): boolean => {
  // TODO: Improve the typescript namespace extension workaround to support
  // optional/undefined isAsyncFunction
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!ts.isAsyncFunction) {
    throw new Error(errorMessage("Could not resolve isAsyncFunction"));
  }

  return ts.isAsyncFunction(node);
};

const errorMessage = (message: string): string =>
  `[ts-transform-async-to-mobx-keystone-flow]: ${message}`;
