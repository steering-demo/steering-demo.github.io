import { describe, expect, it } from 'vitest';

import {
  describeAge,
  formatPercent,
  identityKey,
  isStale,
  resultOrigin,
  shortRevision,
  spokenPercent,
  type ResultIdentity,
} from '../../src/lib/result';

const base: ResultIdentity = {
  source: 'live',
  model: 'Qwen/Qwen2.5-0.5B-Instruct',
  scenarioId: 'movie-critic',
  prompt: 'A prompt.',
  prefix: 'A prefix',
  direction: 'movie-critic',
};

describe('how a displayed result describes itself', () => {
  it('separates the three things "live" can mean', () => {
    expect(resultOrigin({ ...base, source: 'recorded' })).toBe('recorded');
    expect(resultOrigin({ ...base, cached: false })).toBe('fresh');
    expect(resultOrigin({ ...base, cached: true })).toBe('cached');
    // A stored result served because the run failed is not a cache hit, and must not read as one.
    expect(resultOrigin({ ...base, cached: true, staleCache: true })).toBe('stale');
  });

  it('treats a stale fallback as stale even if the Space did not set cached', () => {
    expect(resultOrigin({ ...base, staleCache: true })).toBe('stale');
  });

  it('keys results by the configuration that produced them', () => {
    const other = { ...base, model: 'HuggingFaceTB/SmolLM2-135M-Instruct' };
    expect(identityKey(base)).not.toBe(identityKey(other));
    // Cache metadata is not part of the identity: the same run replayed is the same result.
    expect(identityKey({ ...base, cached: true, ageSeconds: 99 })).toBe(identityKey(base));
  });
});

describe('formatting a probability', () => {
  it('keeps exact zero and a very small positive value distinct', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(0.000173507)).toBe('<0.1%');
    expect(spokenPercent(0)).toBe('0 percent');
    expect(spokenPercent(0.000173507)).toBe('less than 0.1 percent');
  });

  it('shows ordinary values at one decimal', () => {
    expect(formatPercent(68.536)).toBe('68.5%');
    expect(formatPercent(0.1)).toBe('0.1%');
    expect(spokenPercent(68.536)).toBe('68.5 percent');
  });

  it('survives the round trip the content file puts a value through', () => {
    // 4e-7 as a percentage, written with six significant figures and read back by the parser.
    const stored = Number(Number(4e-7).toPrecision(6));
    expect(stored).toBeGreaterThan(0);
    expect(formatPercent(stored)).toBe('<0.1%');
  });
});

describe('deciding the editor has moved on', () => {
  it('flags an edited prompt', () => {
    expect(isStale(base, 'A different prompt.', base.prefix)).toBe(true);
    expect(isStale(base, base.prompt, 'Another prefix')).toBe(true);
  });

  it('does not flag whitespace the Space would have collapsed anyway', () => {
    expect(isStale(base, '  A   prompt.  ', ' A prefix ')).toBe(false);
  });
});

describe('small display helpers', () => {
  it('describes an age the way the badge and the explanation both need', () => {
    expect(describeAge(10)).toBe('moments ago');
    expect(describeAge(600)).toBe('10 min ago');
    expect(describeAge(3600)).toBe('an hour ago');
    expect(describeAge(7200)).toBe('2 hours ago');
  });

  it('shortens a pinned revision and leaves an unpinned one alone', () => {
    expect(shortRevision('7ae557604adf67be50417f59c2c2f167def9a775')).toBe('7ae557604a');
    expect(shortRevision('main')).toBe('main');
    expect(shortRevision(undefined)).toBeUndefined();
  });
});
