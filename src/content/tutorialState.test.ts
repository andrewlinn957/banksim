import { describe, expect, it } from 'vitest';
import {
  readTutorialCompletedFrom,
  TUTORIAL_COMPLETION_STORAGE_KEY,
  writeTutorialCompletedTo,
} from './tutorialState';

const createMemoryStorage = () => {
  const data = new Map<string, string>();
  return {
    storage: {
      getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    },
    data,
  };
};

describe('tutorialState storage', () => {
  it('reads completion flag when set', () => {
    const { storage } = createMemoryStorage();
    storage.setItem(TUTORIAL_COMPLETION_STORAGE_KEY, '1');
    expect(readTutorialCompletedFrom(storage)).toBe(true);
  });

  it('writes and clears completion flag', () => {
    const { storage, data } = createMemoryStorage();
    writeTutorialCompletedTo(storage, true);
    expect(data.get(TUTORIAL_COMPLETION_STORAGE_KEY)).toBe('1');

    writeTutorialCompletedTo(storage, false);
    expect(data.has(TUTORIAL_COMPLETION_STORAGE_KEY)).toBe(false);
  });

  it('fails safely when storage is unavailable', () => {
    expect(readTutorialCompletedFrom(null)).toBe(false);
    expect(() => writeTutorialCompletedTo(null, true)).not.toThrow();
  });
});
