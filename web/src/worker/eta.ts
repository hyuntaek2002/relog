// 임베딩 남은 시간 추정. 워커는 문장을 길이순으로 정렬해 EMBED_BATCH개씩 처리하고, 묶음은 가장 긴 문장 길이로 채워지므로
// 묶음 하나의 비용을 "묶음 크기 × (가장 긴 길이 + 고정분)"으로 본다. 처음 진행 보고 이후 걸린 시간을 그 비용 비율로 늘려 남은 시간을 낸다.
// ponytail: 길이에 비례한다고 본 단순 모형. 긴 글이 몰린 끝부분에서 조금 짧게 잡힐 수 있어 진행하면서 계속 고쳐 보인다.
export const EMBED_BATCH = 16
const FIXED = 20 // "query: " 접두어·특수 토큰 등 길이와 무관한 몫(글자 수 단위 근사)

// done개까지 처리했을 때 끝난 비용 비율(0~1). lengths는 원래 순서 그대로 줘도 된다.
export function doneFraction(lengths: number[], done: number, batch = EMBED_BATCH): number {
  const s = [...lengths].sort((a, b) => a - b)
  let total = 0, upto = 0
  for (let i = 0; i < s.length; i += batch) {
    const n = Math.min(batch, s.length - i)
    const w = n * (s[i + n - 1] + FIXED)
    total += w
    if (i + n <= done) upto += w
  }
  return total ? upto / total : 1
}

// start: 처음 진행 보고 때의 {f, t}. 지금 비율 f, 시각 t(ms). 아직 판단하기 이르면 null.
export function remainingMs(start: { f: number; t: number }, f: number, t: number): number | null {
  const df = f - start.f, dt = t - start.t
  if (df <= 0 || dt < 3000) return null
  return (dt * (1 - f)) / df
}

export function fmtRemaining(ms: number | null): string {
  if (ms == null) return '남은 시간을 계산하고 있습니다'
  const min = Math.round(ms / 60000)
  return min < 1 ? '1분 안에 끝납니다' : `약 ${min}분 남았습니다`
}
