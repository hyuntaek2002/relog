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
