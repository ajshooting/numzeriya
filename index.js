const DB_NAME = "numzeriya";
const DB_VERSION = 1;
const STORE_NAME = "records";
const STORAGE_KEY = "numzeriya.records.v1";
const STORAGE_BACKUP_KEY = "numzeriya.records.backup.v1";
const MAX_DIGITS = 4;

const display = document.querySelector("#numberDisplay");
const keys = document.querySelectorAll("[data-key]");
const deleteKey = document.querySelector("[data-delete]");
const registerKey = document.querySelector("[data-register]");
const resetKey = document.querySelector("[data-reset]");
const exportKey = document.querySelector("[data-export]");

let value = "";

function render() {
  display.textContent = value;
}

function formatLocalDateTime(date) {
  const pad = (number) => String(number).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + " " + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join(":");
}

function createRecordId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isValidRecord(record) {
  return (
    record &&
    typeof record.number === "string" &&
    /^\d{1,4}$/.test(record.number) &&
    typeof record.registeredAt === "string"
  );
}

function normalizeRecords(records) {
  return records
    .filter(isValidRecord)
    .map((record) => ({
      id: record.id || createRecordId(),
      number: record.number,
      registeredAt: record.registeredAt,
      registeredAtIso: record.registeredAtIso || "",
    }))
    .sort((a, b) => a.registeredAtIso.localeCompare(b.registeredAtIso));
}

function mergeRecords(...recordGroups) {
  const recordsById = new Map();

  normalizeRecords(recordGroups.flat()).forEach((record) => {
    recordsById.set(record.id, record);
  });

  return normalizeRecords([...recordsById.values()]);
}

function parseLocalRecords(rawValue) {
  const parsed = JSON.parse(rawValue || "[]");

  if (!Array.isArray(parsed)) {
    return [];
  }

  return normalizeRecords(parsed);
}

function loadLocalRecords() {
  try {
    const primaryRecords = localStorage.getItem(STORAGE_KEY);

    if (primaryRecords !== null) {
      return parseLocalRecords(primaryRecords);
    }

    return parseLocalRecords(localStorage.getItem(STORAGE_BACKUP_KEY));
  } catch {
    try {
      return parseLocalRecords(localStorage.getItem(STORAGE_BACKUP_KEY));
    } catch {
      return [];
    }
  }
}

function saveLocalRecords(records) {
  const payload = JSON.stringify(records);

  localStorage.setItem(STORAGE_BACKUP_KEY, payload);
  localStorage.setItem(STORAGE_KEY, payload);
}

function clearLocalRecords() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_BACKUP_KEY);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB is not available."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB is blocked."));
  });
}

async function loadDatabaseRecords() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(normalizeRecords(request.result));
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function saveDatabaseRecords(records) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    store.clear();
    records.forEach((record) => store.put(record));

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function clearDatabaseRecords() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    store.clear();

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function loadRecords() {
  const localRecords = loadLocalRecords();

  try {
    const databaseRecords = await loadDatabaseRecords();
    const records = mergeRecords(databaseRecords, localRecords);

    if (records.length > 0) {
      try {
        await saveDatabaseRecords(records);
      } catch {
        // IndexedDBに戻せない場合でもlocalStorage側のデータは使う。
      }

      try {
        saveLocalRecords(records);
      } catch {
        // localStorageに戻せない場合でもIndexedDB側のデータは使う。
      }
    }

    return records;
  } catch {
    return localRecords;
  }
}

async function saveRecords(records) {
  let saved = false;

  try {
    await saveDatabaseRecords(records);
    saved = true;
  } catch {
    saved = false;
  }

  try {
    saveLocalRecords(records);
    saved = true;
  } catch {
    if (!saved) {
      throw new Error("Failed to save records.");
    }
  }
}

async function clearRecords() {
  const results = await Promise.allSettled([
    clearDatabaseRecords(),
    Promise.resolve().then(clearLocalRecords),
  ]);
  const failed = results.some((result) => result.status === "rejected");

  if (failed) {
    throw new Error("Failed to clear records.");
  }
}

async function registerValue() {
  const number = value;

  if (!number) {
    return;
  }

  registerKey.disabled = true;

  try {
    const now = new Date();
    const records = await loadRecords();

    records.push({
      id: createRecordId(),
      number,
      registeredAt: formatLocalDateTime(now),
      registeredAtIso: now.toISOString(),
    });

    await saveRecords(records);
    value = "";
    render();
  } catch {
    alert("保存に失敗しました。ブラウザのストレージ設定を確認してください。");
  } finally {
    registerKey.disabled = false;
  }
}

function confirmReset() {
  if (!confirm("保存済みデータをすべて削除します。続けますか？")) {
    return false;
  }

  if (!confirm("この操作は元に戻せません。CSVを書き出していないデータも削除されます。本当に続けますか？")) {
    return false;
  }

  return prompt("最終確認です。削除するには「リセット」と入力してください。") === "リセット";
}

async function resetRecords() {
  if (!confirmReset()) {
    return;
  }

  resetKey.disabled = true;

  try {
    await clearRecords();
    value = "";
    render();
    alert("保存データを削除しました。");
  } catch {
    alert("削除に失敗しました。ページを再読み込みしてからもう一度試してください。");
  } finally {
    resetKey.disabled = false;
  }
}

function escapeCsvValue(valueToEscape) {
  return `"${String(valueToEscape).replaceAll('"', '""')}"`;
}

async function exportCsv() {
  exportKey.disabled = true;

  try {
    const records = await loadRecords();
    const rows = [
      ["registered_at", "number"],
      ...records.map((record) => [
        record.registeredAt,
        record.number,
      ]),
    ];
    const csv = rows
      .map((row) => row.map(escapeCsvValue).join(","))
      .join("\r\n");
    const blob = new Blob([`\uFEFF${csv}\r\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `numzeriya-${formatLocalDateTime(new Date()).replaceAll(":", "")}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch {
    alert("CSVの書き出しに失敗しました。");
  } finally {
    exportKey.disabled = false;
  }
}

async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) {
    return;
  }

  try {
    await navigator.storage.persist();
  } catch {
    // 保存できるブラウザでは自動で有効化される。失敗しても通常保存は続ける。
  }
}

keys.forEach((key) => {
  key.addEventListener("click", () => {
    if (value.length >= MAX_DIGITS) {
      return;
    }

    value += key.dataset.key;
    render();
  });
});

deleteKey.addEventListener("click", () => {
  value = value.slice(0, -1);
  render();
});

registerKey.addEventListener("click", registerValue);
resetKey.addEventListener("click", resetRecords);
exportKey.addEventListener("click", exportCsv);
requestPersistentStorage();
