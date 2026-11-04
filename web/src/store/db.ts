import type { LedgerEntry } from './ledger.ts'

// IndexedDB 래퍼. 보관 동의(로컬 보관 모드)일 때만 호출된다. 저장 내용은 대장 항목뿐(원문·임베딩 없음).
const DB = 'relog'
const STORE = 'ledger'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error) })

export async function putLedger(entries: LedgerEntry[]): Promise<void> {
  const db = await open()
  const tx = db.transaction(STORE, 'readwrite')
  const st = tx.objectStore(STORE)
  for (const e of entries) st.put(e)
  await done(tx)
  db.close()
}

export async function getLedger(): Promise<LedgerEntry[]> {
  const db = await open()
  const tx = db.transaction(STORE, 'readonly')
  const req = tx.objectStore(STORE).getAll()
  const rows = await new Promise<LedgerEntry[]>((resolve, reject) => { req.onsuccess = () => resolve(req.result as LedgerEntry[]); req.onerror = () => reject(req.error) })
  db.close()
  return rows
}

// 로컬 데이터 삭제: 대장 전체 + 설정·피드백·라벨(localStorage)
export async function clearAll(): Promise<void> {
  await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); r.onblocked = () => resolve() })
  for (const k of Object.keys(localStorage)) if (k.startsWith('relog-')) localStorage.removeItem(k)
}
