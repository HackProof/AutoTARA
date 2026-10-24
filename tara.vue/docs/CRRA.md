# CRRA 구현 및 사용

CRRA 버튼에서 **AV 선택 → CM 평가·정렬 → Selection Strategy → Solution Effectiveness Table**을 진행합니다.
입력은 기존 `createSusceptibilityMatrix()`의 MITRE Technique 행입니다. 동일 Technique의 위험도는 기존과 같이
Shopping Cart별 평가 최댓값을 사용합니다. Shopping Cart는 현재 데이터 모델의 다이어그램 자산 인스턴스입니다.

참고: [TARA Training Workshop, pp. 73–96](https://www.mitre.org/sites/default/files/2021-11/pr-20-0272-tara-training-workshop.pdf),
[TARA Methodology Description, §2.1.2](https://www.mitre.org/sites/default/files/2021-10/pr-11-4982-tara-methodology-and-description.pdf).
요청된 P/R 개수 기반 Utility 공식은 2020 워크숍의 절차를 적용합니다. H/M/L 등의 효과 수준·확신도는 출처 표기를
유지하며 추가 배수로 사용하지 않습니다. 2011 방법론의 다른 효과 기호·예시 점수로 자동 변환하지 않습니다.

## 사용 흐름

1. CTSA 평가를 저장한 다이어그램에서 CRRA를 엽니다. AV를 개별 선택하거나 검색 후 보이는 AV를 선택합니다.
   Technique 미매핑 Attack Step은 CTSA의 별도 목록에서 확인합니다. 미평가 Step으로 AV나 점수를 만들지 않습니다.
2. 선택된 AV에 대해 카탈로그의 `mitre_technique_mitigation → mitre_mitigation` 관계로 CM을 조회합니다.
   CM을 펼치면 설명, MITRE 링크 및 AV별 Effect classification 선택 항목을 볼 수 있습니다.
3. P/R 가중치는 각각 1로 시작하며, DB effect profile의 효과 분류와 confidence가 있으면 자동으로 표시합니다.
   `2. Evaluate CMs` 표의 Cost에도 DB의 `cost`(1~5)를 기본값으로 표시합니다.
   저장된 비용 override가 있으면 DB 기본값보다 우선하며, DB 비용이 없으면 미입력 상태를 유지합니다.
   필요하면 가중치·효과를 수정하고 Cost에서 1~5를 선택합니다. P와 R을 함께 지정할 수 있습니다.
   비용·분류·가중치의 basis / source 입력란은 표시하지 않습니다.
   입력한 값은 해당 다이어그램의 평가 override입니다.
4. 위험 수준별 CM 최소 수를 입력하고 필요하면 P/R별 최소 수도 지정합니다.
   `Find minimum CM combination`으로 조합을 찾거나 2단계의 체크박스로 수동 선택합니다.
5. Solution Effectiveness Table에서 선택된 CM, 점수, AV별 효과·적용 수·필요 수·Gap을 확인합니다.
   `Save analysis`로 다이어그램에 저장합니다. 이후 다이어그램 파일 저장으로 휴대 가능한 사본을 남깁니다.

## 계산과 누락 처리

- `Utility = 고유 AV별 P 개수 × P 가중치 + 고유 AV별 R 개수 × R 가중치`
- `U/C Ratio = Utility / Cost × 100`
- 동일 AV–CM 관계/효과는 중복 계산하지 않습니다. 같은 CM의 P+R은 Utility에 각각 기여하지만
  해당 AV의 **전체 CM 수는 1**입니다. P 최소 수와 R 최소 수에는 각각 1로 반영합니다.
- Detect(D)는 보존해 표시하지만 요청된 P/R 공식과 대응책 수에는 포함하지 않습니다.
- P/R 가중치의 기본값은 각각 1이며 저장된 가중치(0 포함)가 있으면 이를 유지합니다.
  입력란이 비어 있으면 카탈로그 가중치, 기본값 1 순으로 사용합니다. 비용·효과는 다이어그램 override가 있으면
  이를 사용하고, 없으면 카탈로그 값을 사용합니다. 다른 자산의 TTP 가중치를 P/R 가중치로 전용하지 않습니다.
- DB 테이블 `mitre_mitigation_effect_profile`의 `effect_types`와 `confidence`를 조회하여 각 AV 매핑의
  효과 분류 선택 항목과 AV별 매핑 제목에 초기값으로 표시합니다. confidence는 H/M/L 원문을 유지합니다.
  이는 **CM 단위 초기 분류**이며 AV별 효과 검증 결과는 아닙니다.
  기존 다이어그램의 명시적 효과 override는 DB 초기값보다 우선합니다. API는 출처·적용 범위를 제공합니다.
- DB에 confidence가 없으면 매핑 제목에 confidence를 표시하지 않습니다.
  `mitre_mitigation_effect_profile.cost`가 유효한 1~5 정수이면 비용 선택 항목에 자동으로 표시하고,
  평가자는 이를 수정할 수 있습니다. 프로필이나 비용 컬럼이 없는 DB에서도 조회할 수 있습니다.
  API는 누락된 분류·confidence·비용을 `missingFields`로 알립니다.
  초기화되지 않은 DB도 조회할 수 있으며 이 경우 효과 분류가 미입력으로 표시됩니다.
- 미분류 효과/가중치가 있으면 Utility가 `-`, Cost가 없거나 0 이하이면 U/C가 `-`입니다.
  판정된 무효과는 빈 effects 배열이며 Utility 0과 구별됩니다. 입력이 없다는 이유로 0을 채우지 않습니다.
- 불완전 점수 또는 제외된 CM은 자동 선택에서 제외합니다. 불완전 CM을 수동 선택하면 누락 목록을 표시합니다.
  분류가 알려진 효과의 계획상 coverage와 점수 완전성은 별도로 표시합니다.
- Total Cost는 선택한 고유 CM의 비용 합계이며 하나라도 비용이 누락되면 `-`입니다. U/C 비율은 합산하지 않습니다.
- U/C·Utility 내림차순, Cost 오름차순 정렬을 지원하며 미계산 점수는 마지막에 배치합니다.
  CRRA 숫자는 최대 유효숫자 12자리로 표시하여 작은 가중치/비용을 TTP의 소수점 한 자리 형식으로 0 처리하지 않습니다.

## 전략과 탐색 범위

- 기존 Risk Score 구간을 재사용합니다: High ≥4, Moderate ≥2.5 및 <4, Low <2.5.
- 각 선택 AV의 위험 구간에 전체 CM 최소 수(0 이상 정수)가 필요합니다. P/R 최소 수는 선택사항이며
  비워 두면 해당 종류에 추가 제약을 두지 않습니다. 기본 정책 수치는 제공하지 않습니다.
- 먼저 고위험 AV부터 사용자가 선택한 정렬 순서로 CM을 배치하고 전체 AV에 효과를 공유합니다.
  이어서 뒤쪽 CM부터 제거해 중복을 줄이고, branch-and-bound로 더 적은 CM 조합이 있는지 검사합니다.
- 목적은 **CM 개수 최소화**입니다. 같은 개수의 조합 간 총비용 최소화는 별도 목표로 수행하지 않습니다.
  정렬 순서는 초기 해와 탐색 순서에 영향을 줍니다.
- Web Worker에서 최대 200,000 탐색 노드를 검사합니다. 완료한 경우만 준비된 후보 범위에서 최소 개수를
  검증했다고 표시합니다. 한도에 도달하면 현재 충족 조합과 함께 최소성 미확인을 표시합니다.
- 준비된 전체 후보로도 전략을 충족하지 못하면 도달 가능한 부분 조합과 AV별 전체/P/R 부족 수를 표시합니다.
  미매핑 AV도 결과 열에서 제거하지 않습니다. 입력 변경/닫기/취소 시 진행 중 Worker를 종료합니다.
- 이는 선택 전략에 따른 **계획상 효과**입니다. 실제 배포·검증 상태 또는 Risk Score 감소량을 계산하지 않습니다.
  적용 대상 Shopping Cart와 원본 Attack Step 근거를 결과에서 확인할 수 있습니다.

## 저장과 파일

다이어그램 루트의 `taraCrraAssessments` 속성에 스키마별 설정과 선택 ID를 저장합니다. 기존 draw.io 저장·세션 복원·
Undo/Redo 경로를 사용합니다. MAL YAML의 `metadata.crra`에도 보존합니다. 평가 입력을 저장할 때 DB 카탈로그나 CM 초기 분류를 변경하지 않습니다.
계산 점수와 최적성 판정은 저장하지 않고 현재 CTSA 결과와 카탈로그를 바탕으로 다시 계산합니다.
스키마 변경 시 이전 모달에서 저장하지 못하도록 검사하고 비동기 이전 조회 응답도 폐기합니다.

| 파일 | 역할 |
| --- | --- |
| `tara.server/src/modules/catalog/remediation.service.js` | 기존 MITRE 관계 조회, CM 통합, 출처·누락 데이터 반환 |
| `tara.server/src/modules/catalog/catalog.routes.js` | 스키마별 countermeasures POST API, Technique ID 검증 |
| `src/services/crra.js` | 평가 입력, Utility/U/C, 정렬, 전략 coverage, 최소 개수 탐색 |
| `src/services/crraCatalog.js`, `src/services/crra.worker.js` | 조회 클라이언트와 비동기 조합 탐색 |
| `src/components/CrraModal.vue` | 4단계 흐름, 입력·조회·취소·저장 |
| `src/components/CrraCandidateTable.vue` | 대응책 설명·MITRE 링크, 비용 선택·효과 분류 편집 |
| `src/components/CrraSolutionTable.vue` | Solution Effectiveness Table 및 선택 근거 |
| `src/components/Graph.vue` | CRRA 모달에 기존 편집기 연결 |
| `src/services/drawio/crraMetadata.js` | 스키마별 평가 메타데이터 읽기/쓰기 |
| `src/services/drawio/editor.js`, `modelSnapshot.js`, `import.js` | 편집·스냅샷·파일 가져오기 연결 |
| `src/services/malModel.js`, `malModelImport.js` | MAL YAML 왕복 보존 |
| `tests/crraRemediation.test.js`, `crra.test.js`, `drawioModel.test.js` | 계산·탐색·화면 상태·메타데이터 회귀 테스트 |
| `tara.server/src/tests/remediation.test.js` | DB 조회 계약 및 HTTP API 검증 |

## 검증 명령

```sh
# tara.vue/
node --test --test-isolation=none tests/crraRemediation.test.js tests/crra.test.js tests/susceptibilityMatrix.test.js tests/ttpScoring.test.js tests/threatCatalog.test.js
node --test --test-isolation=none --test-name-pattern='CRRA|schema|CTSA|MAL snapshot' tests/drawioModel.test.js
npm run build

# tara.server/
node --test --test-isolation=none src/tests/catalog.test.js src/tests/remediation.test.js
```

테스트는 공식 위험·비용값으로 주장되지 않는 명시적 fixture를 사용합니다. 최소 탐색은 작은 랜덤 사례 60개의 전수
조합과 비교합니다. 원래 `malModelImport.test.js`는 현 저장소에 없는 `sample/Tesla_Model_S_MAL_Model.yaml`을
읽어 실행이 중단됩니다. 새 CRRA YAML 왕복 테스트는 자체 모델로 별도 검증합니다.
