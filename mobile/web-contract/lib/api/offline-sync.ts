import { getSupabaseStatus, setSupabaseOffline } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/error-utils";

/**
 * LocalStorage の読み書きヘルパー
 */
export function getLocal<T>(key: string): T | null {
  if (typeof window === "undefined") return null;

  try {
    const saved = localStorage.getItem(key);
    if (!saved) return null;
    try {
      return JSON.parse(saved) as T;
    } catch {
      // 壊れたキャッシュは、次回の正常な取得時に再作成する。
      localStorage.removeItem(key);
      return null;
    }
  } catch {
    // ブラウザーの設定でストレージが使用できなくても、オンラインの取得は続ける。
    return null;
  }
}

export function setLocal<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(data));
}

/** DB で成功した操作は、任意のキャッシュ書き込み失敗で失敗扱いにしない。 */
export function cacheOnlineResult<T>(key: string, data: T): void {
  try {
    setLocal(key, data);
  } catch (err) {
    console.warn(`[offline-sync] Could not cache confirmed server data for key "${key}":`, getErrorMessage(err));
  }
}

/**
 * 指定時間（ミリ秒）でタイムアウトするヘルパー
 */
async function withTimeout<T>(promise: Promise<T>, ms: number = 3000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Supabase request timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ネットワーク接続エラーかどうか判定し、該当する場合はオフラインモードに移行する。
 */
export function isNetworkError(err: unknown): boolean {
  const message = getErrorMessage(err, "");
  return (
    message.includes("fetch") ||
    message.includes("Failed to fetch") ||
    message.includes("timed out") ||
    message.includes("ENOTFOUND")
  );
}

export function handleNetworkError(err: unknown): void {
  if (isNetworkError(err)) setSupabaseOffline();
}

/**
 * Supabase からデータを取得し、LocalStorage にキャッシュするオフラインファースト・フェッチャー。
 *
 * - オフライン (サーキットブレーカー作動中) の場合は LocalStorage から直接読み込む。
 * - Supabase がエラーを返した場合やタイムアウト（3秒）した場合も LocalStorage にフォールバックする。
 * - 取得成功時は LocalStorage にデータを保存する。
 *
 * @param key       LocalStorage のキー
 * @param fetcher   Supabase クエリを実行する非同期関数
 * @param fallback  LocalStorage にもデータが無い場合のデフォルト値
 */
export async function fetchWithFallback<T>(
  key: string,
  fetcher: () => Promise<T>,
  fallback: T,
): Promise<T> {
  if (typeof window === "undefined") return fallback;

  if (!getSupabaseStatus()) {
    return getLocal<T>(key) ?? fallback;
  }

  try {
    const data = await withTimeout(fetcher(), 3000);
    cacheOnlineResult(key, data);
    return data;
  } catch (err) {
    console.warn(`[offline-sync] fetchWithFallback failed for key "${key}", falling back to local:`, err);
    setSupabaseOffline();
    return getLocal<T>(key) ?? fallback;
  }
}

/**
 * Supabase に書き込みを行い、成功時には LocalStorage を同期するオフラインファースト・ライター。
 *
 * - オフラインの場合は `offlineFallback` を実行して LocalStorage に書き込む。
 * - 接続障害時は `offlineFallback` でリカバリする。
 * - 権限・検証エラーなど接続障害以外は呼び出し元へ返す。
 *
 * @param key              LocalStorage のキー
 * @param onlineAction     Supabase への書き込みを行う非同期関数。成功時の新しいリストを返す。
 * @param offlineFallback  オフライン時にローカルのみで処理する関数。新しいリストを返す。
 */
export async function writeWithFallback<TResult, TStored = TResult>(
  key: string,
  onlineAction: () => Promise<TResult>,
  offlineFallback: () => TResult,
  getStoredValue: (result: TResult) => TStored = (result) => result as unknown as TStored,
): Promise<TResult> {
  if (typeof window === "undefined") return offlineFallback();

  if (!getSupabaseStatus()) {
    const result = offlineFallback();
    setLocal(key, getStoredValue(result));
    return result;
  }

  try {
    const result = await onlineAction();
    cacheOnlineResult(key, getStoredValue(result));
    return result;
  } catch (err) {
    console.warn(`[offline-sync] writeWithFallback failed for key "${key}":`, getErrorMessage(err));
    if (!isNetworkError(err)) throw err;
    handleNetworkError(err);
    const result = offlineFallback();
    setLocal(key, getStoredValue(result));
    return result;
  }
}

/**
 * Supabase に副作用のみの書き込み（delete、status update 等）を行い、
 * 完了後に LocalStorage を同期するオフラインファースト・ミューテーター。
 *
 * @param key              LocalStorage のキー
 * @param onlineAction     Supabase への副作用を行う非同期関数。完了後 newList を返す。
 * @param offlineFallback  オフライン時にローカルのみで処理する関数。新しいリストを返す。
 */
export async function mutateWithFallback<TList>(
  key: string,
  onlineAction: () => Promise<TList>,
  offlineFallback: () => TList,
): Promise<void> {
  if (typeof window === "undefined") return;

  if (!getSupabaseStatus()) {
    setLocal(key, offlineFallback());
    return;
  }

  try {
    const result = await onlineAction();
    cacheOnlineResult(key, result);
  } catch (err) {
    console.warn(`[offline-sync] mutateWithFallback failed for key "${key}":`, getErrorMessage(err));
    if (!isNetworkError(err)) throw err;
    handleNetworkError(err);
    setLocal(key, offlineFallback());
  }
}
