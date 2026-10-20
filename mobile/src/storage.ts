import AsyncStorage from '@react-native-async-storage/async-storage';

// Web APIs need synchronous reads. Keep failed writes dirty so a later flush
// retries them instead of silently acknowledging data that only exists in RAM.
const values = new Map<string, string>();
// Compatibility keys are an active-account view, never an ownerless disk copy.
const volatileKeys = new Set(['haskapp_faculty_name', 'haskapp_major_name', 'haskapp_affiliation_id', 'haskapp_share_templates']);
type Write = { key: string; value: string | null };
const dirty = new Map<string, Write>();
const failures = new Map<string, unknown>();
let pending: Promise<void> = Promise.resolve();
let hydration: Promise<void> | undefined;

function enqueue(write: Write) {
  pending = pending.then(async () => {
    try {
      if (write.value === null) await AsyncStorage.removeItem(write.key);
      else await AsyncStorage.setItem(write.key, write.value);
      if (dirty.get(write.key) === write) {
        dirty.delete(write.key);
        failures.delete(write.key);
      }
    } catch (error) {
      if (dirty.get(write.key) === write) failures.set(write.key, error);
    }
  });
}

export function hydrateStorage(): Promise<void> {
  if (hydration) return hydration;
  hydration = (async () => {
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith('haskapp_') && !volatileKeys.has(key));
    const stored = await AsyncStorage.multiGet(keys);
    for (const [key, value] of stored) if (value !== null) values.set(key, value);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (key: string) => values.get(String(key)) ?? null,
      setItem: (key: string, value: string) => {
        key = String(key); value = String(value);
        values.set(key, value);
        if (volatileKeys.has(key)) return;
        const write = { key, value };
        dirty.set(key, write);
        failures.delete(key);
        enqueue(write);
      },
      removeItem: (key: string) => {
        key = String(key);
        values.delete(key);
        if (volatileKeys.has(key)) return;
        const write = { key, value: null };
        dirty.set(key, write);
        failures.delete(key);
        enqueue(write);
      },
    } });
  })().catch(error => { hydration = undefined; throw error; });
  return hydration;
}

export async function flushStorage(): Promise<void> {
  // Retry only writes that failed before this flush. New failures are reported
  // immediately, with their latest values retained for the next explicit retry.
  for (const key of failures.keys()) {
    const write = dirty.get(key);
    failures.delete(key);
    if (write) enqueue(write);
  }
  let observed: Promise<void>;
  do { observed = pending; await observed; } while (observed !== pending);
  if (failures.size) throw failures.values().next().value;
}
