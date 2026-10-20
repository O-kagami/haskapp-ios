/** A stale screen/action must never mutate a newly selected account's cache or rows. */
export class AccountOwnerChangedError extends Error {
  constructor() {
    super("アカウントが変更されました。データを読み直してから操作してください。");
    this.name = "AccountOwnerChangedError";
  }
}

export function assertExpectedOwner(actualOwner: string | null, expectedOwner?: string): void {
  if (expectedOwner !== undefined && actualOwner !== expectedOwner) throw new AccountOwnerChangedError();
}
