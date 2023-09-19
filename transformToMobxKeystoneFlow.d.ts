/** 
 * Marks `async` functions to transform into a generator function wrapped with `mobx-keystone._async` 
 * by [ts-transform-async-to-mobx-keystone-flow](https://github.com/Tsury/ts-transform-async-to-mobx-keystone-flow) 
 * @example
```
// in:
fn = autoFlow(async (input) => {
  return await callApi(input);
})

// out:
import { _async as _async_1, _await as _await_1 } from 'mobx-keystone';

fn = _async_1(function* (this: THISCLASS, input) {
    return yield* _await_1(callApi(input));
  }).call(this);
} 
```
 */
declare function autoFlow<T extends (...args: any[]) => Promise<any>>(asyncFunction: T): T;

/** 
 * Marks an `async` property function to transform into a generator function wrapped with `mobx-keystone._async` 
 * by [ts-transform-async-to-mobx-keystone-flow](https://github.com/Tsury/ts-transform-async-to-mobx-keystone-flow) 
 * @example
```
// in:
class Test {
  @autoFlow
  fn = async (input) => {
    return await callApi(input);
  }
}

// out:
import { modelFlow as modelFlow_1, _async as _async_1, _await as _await_1 } from 'mobx-keystone';

class Test {
  @modelFlow_1
  fn = _async_1(function* (this: THISCLASS, input) {
    return yield* _await_1(callApi(input));
  }).call(this);
} 
}
```
 */
declare function autoFlow(target: Object, propertyKey: string | symbol): void;

/** 
 * Marks an model class to add a @model decorator to it with the relative path as the value 
 * by [ts-transform-async-to-mobx-keystone-flow](https://github.com/Tsury/ts-transform-async-to-mobx-keystone-flow) 
 * @example
```
// in:
@autoModel
class Test {
}

// out:
import { model as model_1 } from 'mobx-keystone';

@model_1("relative/path/filename")
class Test {
}
```
 */
declare const autoModel: ClassDecorator;