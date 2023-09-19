# ts-transform-async-to-mobx-keystone-flow

Converts typescript async functions into generators wrapped with mobx-keystone.flow.
Inspired by [ts-transform-async-to-mobx-flow](https://github.com/AurorNZ/ts-transform-async-to-mobx-flow)

## What it is

In order to run all updates to observables within async functions in `mobx-keystone.action`, `mobx-keystone` provides [`flow`](https://mobx-keystone.js.org/class-models/#flows-async-actions) helper. `flow` can only work with generator functions `function*`.

I find it a little cumbersome to write, and coming from `ts-transform-async-to-mobx-flow` I was already used to the regular, async/await syntax.

This transfomer is created to allow regular syntax to compile into `mobx-keystone`'s `flow` syntx.

### Example

#### Input

```ts
fn = autoFlow(async (input) => {
  return await callApi(input);
})
```

#### Output

```ts
import { _async as _async_1, _await as _await_1 } from 'mobx-keystone';

fn = _async_1(function* (this: THISCLASS, input) {
    return yield* _await_1(callApi(input));
  }).call(this);
} 

```

#### Input

```ts
class Test {
  @autoFlow
  fn = async (input) => {
    return await callApi(input);
  }
}
```

#### Output

```ts
import { modelFlow as modelFlow_1, _async as _async_1, _await as _await_1 } from 'mobx-keystone';

class Test {
  @modelFlow_1
  fn = _async_1(function* (this: THISCLASS, input) {
    return yield* _await_1(callApi(input));
  }).call(this);
}
```

## Also supports `autoModel`

`autoModel` is another helper I added to automatically give identifiers to models, based on their relative paths

#### Input

```ts
@autoModel
class Test {
}
```

#### Output
```ts
import { model as model_1 } from 'mobx-keystone';

@model_1("relative/path/filename")
class Test {
}
```

## How to install

```
npm i ts-transform-async-to-mobx-keystone-flow -D
```

or

```
yarn add ts-transform-async-to-mobx-keystone-flow -D
```

## How to use

You may need to add a reference to this package's typescript definition file in order to declare the global `transformToMobxKeystoneFlow` function:

```ts
/// <reference path="node_modules/ts-transform-async-to-mobx-keystone-flow/transformToMobxKeystoneFlow.d.ts" />
```

It can be added to a `global.d.ts` file to access `transformToMobxKeystoneFlow` in all the project files.

### With [ttypescript](https://github.com/cevek/ttypescript)

`tsconfig.json`

```json
{
  "compilerOptions": {
    "...": "...",
    "plugins": [{ "transform": "ts-transform-async-to-mobx-keystone-flow", "type": "config" }]
  }
}
```

### With [ts-loader](https://github.com/TypeStrong/ts-loader)

```js
// webpack.config.js
const tsTransformAsyncToMobxKeystoneFlow = require('ts-transform-async-to-mobx-keystone-flow').default;

module.exports = {
  // ...
  module: {
    rules: [
      {
        test: /\.(tsx|ts)$/,
        loader: 'ts-loader',
        options: {
          getCustomTransformers: () => ({
            before: [tsTransformAsyncToMobxKeystoneFlow(/** options */)],
          }),
        },
      },
    ],
  },
  // ...
};
```

### With ts-loader and ttypescript

`tsconfig.json`

```json
{
  "compilerOptions": {
    "...": "...",
    "plugins": [{ "transform": "ts-transform-async-to-mobx-keystone-flow", "type": "config" }]
  }
}
```

```js
// webpack.config.js
const tsTransformAsyncToMobxKeystoneFlow = require('ts-transform-async-to-mobx-keystone-flow').default;

module.exports = {
  // ...
  module: {
    rules: [
      {
        test: /\.(tsx|ts)$/,
        loader: 'ts-loader',
        options: {
          compiler: 'ttypescript',
        },
      },
    ],
  },
  // ...
};
```

### Configuration

- mobxKeystonePackage `string`

  default: `'mobx-keystone'`
