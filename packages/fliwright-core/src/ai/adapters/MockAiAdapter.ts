import type { AiAdapter, AiAdapterResponse, AiInvocationContext, AiRequest } from '../types.js';

export type MockAiAdapterHandler = (
  request: AiRequest,
  context: AiInvocationContext,
) => AiAdapterResponse | Promise<AiAdapterResponse>;

export type MockAiAdapterItem = AiAdapterResponse | Error;

export class MockAiAdapter implements AiAdapter {
  readonly name = 'mock';
  private readonly queue: MockAiAdapterItem[] = [];
  private readonly handler?: MockAiAdapterHandler;

  constructor(itemsOrHandler: MockAiAdapterItem[] | MockAiAdapterHandler = []) {
    if (typeof itemsOrHandler === 'function') {
      this.handler = itemsOrHandler;
    } else {
      this.queue = [...itemsOrHandler];
    }
  }

  async invoke(request: AiRequest, context: AiInvocationContext): Promise<AiAdapterResponse> {
    if (this.handler) return this.handler(request, context);

    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    if (next) return next;

    if (request.responseFormat === 'json') {
      return { text: '{}', json: {} };
    }
    return { text: '' };
  }
}
