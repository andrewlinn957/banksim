export const TUTORIAL_COMPLETION_STORAGE_KEY = 'banksim.tutorial.v1.completed';

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export const readTutorialCompletedFrom = (storage: StorageLike | null | undefined): boolean => {
  if (!storage) return false;
  try {
    return storage.getItem(TUTORIAL_COMPLETION_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

export const writeTutorialCompletedTo = (
  storage: StorageLike | null | undefined,
  completed: boolean
): void => {
  if (!storage) return;
  try {
    if (completed) {
      storage.setItem(TUTORIAL_COMPLETION_STORAGE_KEY, '1');
      return;
    }
    storage.removeItem(TUTORIAL_COMPLETION_STORAGE_KEY);
  } catch {
    // Ignore storage write failures (private mode/quota/sandbox).
  }
};

const getBrowserStorage = (): StorageLike | null => {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
};

export const readTutorialCompleted = (): boolean => readTutorialCompletedFrom(getBrowserStorage());

export const writeTutorialCompleted = (completed: boolean): void =>
  writeTutorialCompletedTo(getBrowserStorage(), completed);
