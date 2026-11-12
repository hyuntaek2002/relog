# WildChat-1M 원본 parquet 파일들에서 한국어·비유해 대화를 뽑아 ChatGPT 내보내기 형식 zip으로 만든다(탐지 보류 표본용).
# datasets-server가 느리거나 실패할 때 쓴다. 대화의 모든 턴을 넣는다(반복 지시는 대화 뒤쪽에 많다).
# 사용: python -I eval/detect/wildchat_parquet.py <출력 zip> <parquet ...> [--exclude=a.ids.json,b.ids.json]
# 출력은 타인의 실제 대화이므로 exports/ 아래(저장소 제외)에만 둔다. 출처: Allen Institute for AI, WildChat-1M(ODC-BY).
import json
import sys
import zipfile

import pyarrow.parquet as pq

args = [a for a in sys.argv[1:] if not a.startswith('--exclude=')]
out, srcs = args[0], args[1:]
seen = set()
for a in sys.argv[1:]:
    if a.startswith('--exclude='):
        for f in a.split('=', 1)[1].split(','):
            seen.update(json.load(open(f, encoding='utf-8'))['conversations'])

convs = []
for src in srcs:
    t = pq.read_table(src, columns=['conversation_hash', 'timestamp', 'conversation', 'language', 'toxic'], filters=[('language', '=', 'Korean'), ('toxic', '=', False)])
    for row in t.to_pylist():
        cid = row['conversation_hash']
        if cid in seen:
            continue
        seen.add(cid)
        t0 = int(row['timestamp'].timestamp())
        root = f'{cid}:root'
        mapping = {root: {'id': root, 'message': None, 'parent': None, 'children': []}}
        parent, at = root, t0
        for i, m in enumerate(row['conversation']):
            mid = f'{cid}:{i}'
            text = str(m['content'] or '')
            if m['role'] != 'user':
                text = text[:600]  # 답변은 문맥 판단용이라 앞부분만
            at = int(m['timestamp'].timestamp()) if m.get('timestamp') else t0 + 60 * i
            mapping[mid] = {'id': mid, 'message': {'id': mid, 'author': {'role': 'user' if m['role'] == 'user' else 'assistant'}, 'create_time': at, 'content': {'content_type': 'text', 'parts': [text]}, 'metadata': {}, 'recipient': 'all'}, 'parent': parent, 'children': []}
            mapping[parent]['children'].append(mid)
            parent = mid
        convs.append({'title': '', 'create_time': t0, 'update_time': at, 'mapping': mapping, 'current_node': parent, 'conversation_id': cid, 'id': cid})
    print(src.split('/')[-1], 'korean so far', len(convs), flush=True)

with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('conversations.json', json.dumps(convs, ensure_ascii=False))
with open(out.replace('.zip', '.ids.json'), 'w', encoding='utf-8') as f:
    json.dump({'dataset': 'allenai/WildChat-1M', 'license': 'ODC-BY', 'sources': [s.split('/')[-1] for s in srcs], 'conversations': [c['id'] for c in convs]}, f, indent=1)
users = sum(1 for c in convs for n in c['mapping'].values() if n['message'] and n['message']['author']['role'] == 'user')
print(f'korean conversations={len(convs)} user turns={users}')
