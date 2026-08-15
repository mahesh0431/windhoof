import type { SaveAdapter } from "./saveAdapter";
import type { GameSaveV1 } from "./saveSchema";

const DATABASE_NAME = "longride";
const DATABASE_VERSION = 1;
const STORE_NAME = "game-saves";
const SAVE_KEY = "primary-v1";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
}

export class IndexedDbSaveAdapter implements SaveAdapter {
  private databasePromise: Promise<IDBDatabase> | null = null;
  private databaseInstance: IDBDatabase | null = null;
  private closed = false;

  public constructor(
    private readonly indexedDb: IDBFactory | undefined = globalThis.indexedDB,
  ) {}

  public async read(): Promise<unknown | null> {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const value = await requestResult(transaction.objectStore(STORE_NAME).get(SAVE_KEY));
    await transactionDone(transaction);
    return value ?? null;
  }

  public async write(save: GameSaveV1): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(save, SAVE_KEY);
    await transactionDone(transaction);
  }

  public async remove(): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(SAVE_KEY);
    await transactionDone(transaction);
  }

  public close(): void {
    this.closed = true;
    this.databaseInstance?.close();
    this.databaseInstance = null;
    this.databasePromise = null;
  }

  private database(): Promise<IDBDatabase> {
    if (this.closed) return Promise.reject(new Error("IndexedDB adapter is closed"));
    if (this.databasePromise) return this.databasePromise;
    const indexedDb = this.indexedDb;
    // Captured locally: the narrowing above does not survive into the executor,
    // because the property is mutable and the closure runs later.
    if (!indexedDb) return Promise.reject(new Error("IndexedDB is unavailable"));
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
      let settled = false;
      const fail = (error: Error | DOMException | null): void => {
        if (settled) return;
        settled = true;
        reject(error ?? new Error("IndexedDB open failed"));
      };
      request.addEventListener("upgradeneeded", () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      });
      request.addEventListener("success", () => {
        const database = request.result;
        if (settled || this.closed) {
          database.close();
          if (!settled) fail(new Error("IndexedDB adapter closed during open"));
          return;
        }
        settled = true;
        this.databaseInstance = database;
        database.addEventListener("versionchange", () => {
          database.close();
          if (this.databaseInstance === database) this.databaseInstance = null;
          if (this.databasePromise === opening) this.databasePromise = null;
        });
        resolve(database);
      }, { once: true });
      request.addEventListener("error", () => fail(request.error), { once: true });
      request.addEventListener("blocked", () => fail(new Error("IndexedDB upgrade blocked")), {
        once: true,
      });
    });
    this.databasePromise = opening;
    void opening.catch(() => {
      if (this.databasePromise === opening) this.databasePromise = null;
    });
    return opening;
  }
}
