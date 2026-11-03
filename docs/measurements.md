# 실측 기록

## 2026-11-03 임베딩 속도 (합성 데이터, 사용자 발화 100개 순환)
조건: Windows 11, Claude 앱 내장 브라우저(Chromium), Vite dev 서버, 워커 안에서 실행, 모델 다운로드 시간 제외.
발화 길이가 짧은 합성 문장이라 실제 데이터로 다시 측정해야 함.

| 모델 | dtype | device | 로드(캐시 후) | 100개 임베딩 | 개당 |
|---|---|---|---|---|---|
| Xenova/multilingual-e5-small | q8 | wasm | 686ms | 1023ms | 10.2ms |
| Xenova/multilingual-e5-small | q8 | webgpu | 1462ms | 2286ms | 22.9ms |

- 첫 로드(다운로드 포함) 17.8s, 네트워크 의존.
- q8은 webgpu에서 오히려 느림. webgpu는 fp16/fp32로 다시 비교 필요.
- Cache Storage 실측: model_quantized.onnx 112.8MB, tokenizer.json 16.3MB, ort wasm 25.6MB → 합계 154.8MB.
- paraphrase-multilingual-MiniLM-L12-v2는 미측정(버튼만 있음).

## 2026-11-03 임베딩 속도 (실제 Claude 내보내기, 정규화 후 ok 발화 앞 100개)
조건: 위와 동일. 배치 16. 발화 평균 71자(최대 1000자, 앞부분 컷). 내장 브라우저 창이 숨겨진 상태에선 진행이 멈춘 것처럼 보였고(타이머 스로틀링 추정), 창을 띄운 뒤 측정.

| 모델 | dtype | device | 로드(캐시 후) | 100개 임베딩 | 개당 |
|---|---|---|---|---|---|
| Xenova/multilingual-e5-small | q8 | wasm | 1034ms | 18154ms | 181.5ms |
| Xenova/multilingual-e5-small | q8 | webgpu | 1333ms | 14563ms | 145.6ms |
| Xenova/paraphrase-multilingual-MiniLM-L12-v2 | q8 | wasm | 16642ms(첫 로드) | 19325ms | 193.3ms |
| Xenova/paraphrase-multilingual-MiniLM-L12-v2 | q8 | webgpu | 900ms | 14282ms | 142.8ms |

- 합성 짧은 문장(10ms/개) 대비 15~18배 느림. 길이가 지배적 → 길이순 정렬 배치가 다음 최적화.
- 1,000개 환산 약 2.5~3분(wasm). 기능상 허용 범위지만 진행률 표시 필수.
- 두 모델 모두 model_quantized.onnx 112.8MB + tokenizer.json 16.3MB. 두 모델 캐시 합계 283.9MB.
- 정적 임베딩(소형) 비교군은 미착수.
