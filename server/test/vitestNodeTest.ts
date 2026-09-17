/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  afterAll as after,
  afterEach,
  beforeAll as before,
  beforeEach,
  describe,
  onTestFinished,
  vi,
  test as vitestTest,
} from 'vitest';

type MockImplementation = (...args: any[]) => any;

type NodeMockFunction = MockImplementation & {
  mock: {
    calls: { arguments: unknown[] }[];
    callCount: () => number;
    resetCalls: () => void;
    mockImplementation: (
      implementation: MockImplementation
    ) => NodeMockFunction;
    mockImplementationOnce: (
      implementation: MockImplementation
    ) => NodeMockFunction;
    restore: () => void;
  };
};

export type TestContext = {
  after: (callback: () => unknown) => void;
  before: (callback: () => unknown) => void;
  skip: (reason?: string) => never;
  mock: typeof mock;
};

const trackedSpies = new Set<ReturnType<typeof vi.spyOn>>();

const toNodeMock = (spy: any): NodeMockFunction => {
  const nodeMock = ((...args: any[]) => spy(...args)) as NodeMockFunction;

  nodeMock.mock = {
    get calls() {
      return spy.mock.calls.map((args: unknown[]) => ({ arguments: args }));
    },
    callCount: () => spy.mock.calls.length,
    resetCalls: () => spy.mockClear(),
    mockImplementation: (implementation: MockImplementation) => {
      spy.mockImplementation(implementation);
      return nodeMock;
    },
    mockImplementationOnce: (implementation: MockImplementation) => {
      spy.mockImplementationOnce(implementation);
      return nodeMock;
    },
    restore: () => spy.mockRestore(),
  };

  trackedSpies.add(spy);
  return nodeMock;
};

export const mock = {
  fn: (implementation?: MockImplementation): NodeMockFunction =>
    toNodeMock(vi.fn(implementation)),
  method: (
    object: object,
    methodName: string,
    implementation?: MockImplementation
  ): NodeMockFunction => {
    const spy = vi.spyOn(object as Record<string, any>, methodName);
    if (implementation) {
      spy.mockImplementation(implementation);
    }
    return toNodeMock(spy);
  },
  restoreAll: () => {
    for (const spy of trackedSpies) {
      spy.mockRestore();
    }
    trackedSpies.clear();
    vi.restoreAllMocks();
  },
};

const withNodeContext = (callback: (...args: any[]) => any) => {
  if (!callback) {
    return callback;
  }

  return async (context: any) => {
    const nodeContext: TestContext = {
      after: (cleanup) => onTestFinished(cleanup),
      before: (setup) => setup(),
      skip: (reason) => context.skip(reason),
      mock,
    };
    return callback(nodeContext);
  };
};

const nodeTest = (
  name: string,
  optionsOrCallback: any,
  maybeCallback?: any
) => {
  const hasOptions = typeof optionsOrCallback !== 'function';
  const options = hasOptions ? optionsOrCallback : undefined;
  const callback = hasOptions ? maybeCallback : optionsOrCallback;
  return vitestTest(name, options, withNodeContext(callback) as any);
};

const nodeTestSkip = (
  name: string,
  optionsOrCallback: any,
  maybeCallback?: any
) => {
  const hasOptions = typeof optionsOrCallback !== 'function';
  const options = hasOptions ? optionsOrCallback : undefined;
  const callback = hasOptions ? maybeCallback : optionsOrCallback;
  return vitestTest.skip(name, options, withNodeContext(callback) as any);
};

const nodeTestOnly = (
  name: string,
  optionsOrCallback: any,
  maybeCallback?: any
) => {
  const hasOptions = typeof optionsOrCallback !== 'function';
  const options = hasOptions ? optionsOrCallback : undefined;
  const callback = hasOptions ? maybeCallback : optionsOrCallback;
  return vitestTest.only(name, options, withNodeContext(callback) as any);
};

const nodeTestTodo = (name: string) => vitestTest.todo(name);

Object.assign(nodeTest, {
  skip: nodeTestSkip,
  only: nodeTestOnly,
  todo: nodeTestTodo,
});

export default nodeTest;
export { after, afterEach, before, beforeEach, describe };
export const it = nodeTest;
export const test = nodeTest;
