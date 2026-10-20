import { describe, expect, test } from 'vitest';
import {
  applyParameterDraft,
  discardParameterDraft,
  readParameterDraft,
  writeParameterDraft,
  type ParameterDraftCache,
} from '../../src/workspaces/shared/parameter-drafts.ts';

describe('parameter drafts shared by the primitive and tensor inspectors', () => {
  test('selection changes preserve each object draft and its original baseline', () => {
    const cache: ParameterDraftCache = new Map();
    writeParameterDraft(cache, 'a', { channels: 16 }, { channels: 32 });
    writeParameterDraft(cache, 'b', { channels: 8 }, { channels: 24 });
    expect(readParameterDraft(cache, 'a', { channels: 16 })).toEqual({
      params: { channels: 32 },
      dirty: true,
      conflict: false,
    });
    expect(readParameterDraft(cache, 'b', { channels: 8 }).params).toEqual({ channels: 24 });
    writeParameterDraft(cache, 'a', { channels: 64 }, { channels: 48 });
    expect(readParameterDraft(cache, 'a', { channels: 64 })).toEqual({
      params: { channels: 48 },
      dirty: true,
      conflict: true,
    });
  });

  test('matching the latest official parameters removes a dirty or conflicting draft', () => {
    const cache: ParameterDraftCache = new Map();
    writeParameterDraft(cache, 'a', { channels: 16 }, { channels: 32 });
    writeParameterDraft(cache, 'a', { channels: 64 }, { channels: 64 });
    expect(cache.has('a')).toBe(false);
    expect(readParameterDraft(cache, 'a', { channels: 64 })).toEqual({
      params: { channels: 64 },
      dirty: false,
      conflict: false,
    });
  });

  test('discard reloads current parameters and clears only the selected object', () => {
    const cache: ParameterDraftCache = new Map();
    writeParameterDraft(cache, 'a', { channels: 16 }, { channels: 32 });
    writeParameterDraft(cache, 'b', { channels: 8 }, { channels: 24 });
    discardParameterDraft(cache, 'a');
    expect(readParameterDraft(cache, 'a', { channels: 64 })).toEqual({
      params: { channels: 64 },
      dirty: false,
      conflict: false,
    });
    expect(cache.has('b')).toBe(true);
  });

  test('failed application preserves the draft for retry', async () => {
    const cache: ParameterDraftCache = new Map();
    writeParameterDraft(cache, 'a', { channels: 16 }, { channels: 32 });
    const applied = await applyParameterDraft(
      cache,
      'a',
      { channels: 16 },
      { channels: 32 },
      {
        confirmOverwrite: () => true,
        commit: async () => false,
      },
    );
    expect(applied).toBe(false);
    expect(cache.get('a')?.params).toEqual({ channels: 32 });
  });

  test('declining a conflict does not invoke a transaction or discard the draft', async () => {
    const cache: ParameterDraftCache = new Map();
    writeParameterDraft(cache, 'a', { channels: 16 }, { channels: 32 });
    let commits = 0;
    expect(
      await applyParameterDraft(
        cache,
        'a',
        { channels: 64 },
        { channels: 32 },
        {
          confirmOverwrite: () => false,
          commit: async () => {
            commits++;
            return true;
          },
        },
      ),
    ).toBe(false);
    expect(commits).toBe(0);
    expect(cache.get('a')?.params).toEqual({ channels: 32 });
  });

  test('successful application clears the applied draft and retains other objects', async () => {
    const cache: ParameterDraftCache = new Map();
    writeParameterDraft(cache, 'a', { channels: 16 }, { channels: 32 });
    writeParameterDraft(cache, 'b', { channels: 8 }, { channels: 24 });
    let committed: unknown;
    expect(
      await applyParameterDraft(
        cache,
        'a',
        { channels: 64 },
        { channels: 32 },
        {
          confirmOverwrite: () => true,
          commit: async (params) => {
            committed = params;
            return true;
          },
        },
      ),
    ).toBe(true);
    expect(committed).toEqual({ channels: 32 });
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
  });

  test('edits made while an application is pending are not discarded on completion', async () => {
    const cache: ParameterDraftCache = new Map();
    writeParameterDraft(cache, 'a', { channels: 16 }, { channels: 32 });
    expect(
      await applyParameterDraft(
        cache,
        'a',
        { channels: 16 },
        { channels: 32 },
        {
          confirmOverwrite: () => true,
          commit: async () => {
            writeParameterDraft(cache, 'a', { channels: 16 }, { channels: 48 });
            return true;
          },
        },
      ),
    ).toBe(true);
    expect(cache.get('a')?.params).toEqual({ channels: 48 });
  });
});
