import { afterEach, describe, expect, it, vi } from 'vitest';

import { runLiveScenario } from '../../src/lib/live';

/** A minimal but well-formed response from the Space. */
function payload(overrides: Record<string, unknown> = {}) {
  const alphas = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2];
  return {
    id: 'movie-critic',
    title: 'Movie Critic',
    negative_label: 'Negative sentiment',
    positive_label: 'Positive sentiment',
    prompt: 'Give a one-sentence review.',
    prefix: 'The movie was absolutely',
    takeaway: 'Steering changes sentiment.',
    candidates: [' terrible', ' stunning', ' captivating'],
    layer: 7,
    scale: 1,
    model: 'Qwen/Qwen2.5-0.5B-Instruct',
    device: 'cuda:0',
    states: alphas.map((alpha) => ({
      alpha,
      percents: [60, 5, 5],
      other: 30,
      selected: ' terrible',
      continuation: 'terrible, and it never recovers.',
    })),
    ...overrides,
  };
}

function sseFor(body: unknown): string {
  return `event: complete\ndata: ${JSON.stringify([JSON.stringify(body)])}\n\n`;
}

/**
 * Stubs the two-step Gradio call. `missing` lists API prefixes that should 404, which is how a
 * Gradio 4 Space behaves when asked for the Gradio 5 path.
 */
function stubFetch(body: unknown, { missing = [] as string[] } = {}) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (missing.some((prefix) => url.includes(prefix))) {
      return new Response('nope', { status: 404 });
    }
    if (url.endsWith('/run_scenario')) {
      return new Response(JSON.stringify({ event_id: 'abc123' }), { status: 200 });
    }
    return new Response(sseFor(body), { status: 200 });
  });
  vi.stubGlobal('fetch', impl);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('the live Space client', () => {
  it('turns a Space response into a scenario the UI can render', async () => {
    stubFetch(payload());
    const result = await runLiveScenario('https://example.hf.space/', 'movie-critic');

    expect(result.model).toBe('Qwen/Qwen2.5-0.5B-Instruct');
    expect(result.scenario.candidates.map((c) => c.id)).toEqual([
      'terrible',
      'stunning',
      'captivating',
    ]);
    expect(result.scenario.candidates[0].token).toBe(' terrible');
    expect(result.scenario.candidates[0].label).toBe('terrible');
    expect(result.scenario.states).toHaveLength(9);
    expect(result.scenario.states[0].index).toBe(0);
    expect(result.scenario.states[8].alpha).toBe(2);
    expect(result.scenario.states[0].selectedIndex).toBe(0);
    expect(result.scenario.layer).toBe(7);
  });

  it('falls back to the Gradio 4 path when the Gradio 5 path is absent', async () => {
    const calls = stubFetch(payload(), { missing: ['/gradio_api/'] });
    const result = await runLiveScenario('https://example.hf.space', 'movie-critic');

    expect(result.scenario.id).toBe('movie-critic');
    expect(calls.some((url) => url.includes('/gradio_api/call/run_scenario'))).toBe(true);
    expect(calls.some((url) => url.includes('https://example.hf.space/call/run_scenario'))).toBe(
      true,
    );
  });

  it('reports an exhausted ZeroGPU quota in the words the Space used', async () => {
    // Gradio signals a failed run with a JSON object frame, not the usual array.
    const quota = {
      error:
        'You have exceeded your ZeroGPU runs limit. Authenticate with a Hugging Face token for more quota',
      duration: 10,
      visible: true,
      title: 'ZeroGPU quota exceeded',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/run_scenario')) {
          return new Response(JSON.stringify({ event_id: 'e' }), { status: 200 });
        }
        return new Response(`event: error\ndata: ${JSON.stringify(quota)}\n\n`, { status: 200 });
      }),
    );
    await expect(runLiveScenario('https://example.hf.space', 'movie-critic')).rejects.toThrow(
      /ZeroGPU quota exceeded/,
    );
  });

  it('stops probing API paths once one has answered', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('/run_scenario')) {
          return new Response(JSON.stringify({ event_id: 'e' }), { status: 200 });
        }
        return new Response('event: error\ndata: {"title":"boom"}\n\n', { status: 200 });
      }),
    );
    await expect(runLiveScenario('https://example.hf.space', 'movie-critic')).rejects.toThrow(/boom/);
    // One POST and one stream read - no pointless retry against the other prefix.
    expect(calls.filter((url) => url.includes('/call/run_scenario')).length).toBe(2);
  });

  it('rejects an error reported by the Space', async () => {
    stubFetch({ error: 'unknown scenario' });
    await expect(runLiveScenario('https://example.hf.space', 'nope')).rejects.toThrow(
      /unknown scenario/,
    );
  });

  it('rejects a response with the wrong number of steering states', async () => {
    stubFetch(payload({ states: payload().states.slice(0, 5) }));
    await expect(runLiveScenario('https://example.hf.space', 'movie-critic')).rejects.toThrow(
      /9 steering states/,
    );
  });

  it('rejects a response whose rows do not line up with the candidates', async () => {
    const broken = payload();
    broken.states[3].percents = [10, 10];
    stubFetch(broken);
    await expect(runLiveScenario('https://example.hf.space', 'movie-critic')).rejects.toThrow(
      /do not line up|does not line up/,
    );
  });

  it('gives up rather than hanging when the Space never answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
      ),
    );
    await expect(
      runLiveScenario('https://example.hf.space', 'movie-critic', { timeoutMs: 40 }),
    ).rejects.toThrow();
  });
});
