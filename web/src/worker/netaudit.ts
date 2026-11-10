// 네트워크 감사: 이 실행 컨텍스트(페이지 또는 워커)의 fetch를 감싸 요청마다 URL·메서드·본문 크기와
// "원문 조각이 본문에 들어갔는지"를 기록한다. 원문 자체는 기록하지 않는다. 개인정보 원칙 7항 검증용.
export interface NetRecord {
  context: string
  url: string
  method: string
  bodyBytes: number
  containsText: boolean // 요청 본문에 감시 중인 발화 조각이 포함됨 → 원문 유출
  at: number
}

const records: NetRecord[] = []
let probes: string[] = [] // 발화 앞 24자 조각들(소문자). 본문에 이게 있으면 유출로 본다
let installed = false

export function setAuditProbes(texts: string[]) {
  probes = [...new Set(texts.map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 24).toLowerCase()).filter((p) => p.length >= 8))]
}

async function bodyToString(body: BodyInit | null | undefined): Promise<string> {
  if (body == null) return ''
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof Blob) return await body.text()
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body as Uint8Array)
  if (body instanceof FormData) return [...body.entries()].map(([k, v]) => `${k}=${typeof v === 'string' ? v : '[file]'}`).join('&')
  return '[stream]'
}

export function installFetchAudit(context: string) {
  if (installed) return
  installed = true
  const orig = globalThis.fetch.bind(globalThis)
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    let bodyBytes = 0, containsText = false
    try {
      const s = await bodyToString(init?.body ?? (input instanceof Request && input.body ? await input.clone().text() : null))
      bodyBytes = s.length
      const low = s.toLowerCase()
      containsText = probes.some((p) => low.includes(p))
    } catch { /* 본문을 못 읽으면 크기 0으로 기록 */ }
    records.push({ context, url, method, bodyBytes, containsText, at: Date.now() })
    return orig(input, init)
  }
}

// 워커용: 꺼내면서 비운다(메인으로 한 번 전달)
export function takeAuditRecords(): NetRecord[] {
  return records.splice(0)
}
// 페이지용: 비우지 않고 복사본만(렌더링 때마다 읽어도 안전)
export function peekAuditRecords(): NetRecord[] {
  return [...records]
}
