# Cloud VM Comparison for ABBAS_WEB

기준일: `2026-03-11`

이 문서는 `ABBAS_WEB + ESP32-MELAUHF` 운영을 전제로,

- `테스트 서버`에 적합한 Cloud VM 모델과 월 예상비용
- `1000대 이상` 운영에 적합한 Cloud VM 모델과 월 예상비용

을 `AWS / Azure / OCI / GCP`별로 비교한 문서입니다.

---

## 1. 전제 조건

### 테스트 서버 기준

- 기기 수: `1~20대`
- 사용자: 내부 개발자/운영자 소수
- 구성: `Nginx + FastAPI + MariaDB + Redis`를 한 VM에 동거
- 목적: 기능 검증, 펌웨어 연동, 내부 데모

### 1000대 이상 기준

- 기기 수: `1000~1500대`
- 관리자/CS 웹 사용 포함
- 전국 기기 연결
- 전제: `polling 최적화 후`
  - heartbeat `30~60초`
  - subscription sync `10~60분`
  - telemetry는 `event + summary` 위주

### 비용 계산 가정

- 월 `730시간` 기준 환산
- 세금 제외
- 백업/모니터링/대용량 외부 트래픽 제외
- `AWS Lightsail`은 공개 월정액 사용
- `Azure / GCP / OCI`는 시간당 가격을 월 환산
- Azure/GCP/OCI는 디스크가 별도 과금되는 경우가 있어 표에 반영 가능한 범위까지만 포함

### 중요한 주의

현재 ESP32 펌웨어의 polling 값을 그대로 유지하면 비용과 필요 사양이 훨씬 올라갑니다.

현재 기본값:

- register: `15초`
- telemetry: `1초`
- registered check: `3초`
- subscription sync: `5초`

이 상태로 1000대 이상을 붙이면, 아래 표의 `1000대 이상` 권장치보다 더 큰 서버 또는 `앱/DB 분리`가 필요합니다.

---

## 2. 한눈에 보는 추천

### 테스트 서버 추천

1. `OCI Always Free`
2. `AWS Lightsail 2GB` 또는 `4GB`
3. `GCP e2-medium`
4. `Azure B1ms / B2s`

### 1000대 이상 추천

1. `AWS Lightsail 16GB 또는 32GB`
2. `OCI Ampere A1 4 OCPU / 24GB` 또는 `8 OCPU / 48GB`
3. `GCP e2-standard-4`
4. `Azure D4as v5 / D8as v5`

### 가장 현실적인 결론

- `테스트`: `OCI Always Free` 또는 `AWS Lightsail 2GB`
- `1000대 이상 최소 시작`: `AWS Lightsail 16GB`
- `1000대 이상 안전 시작`: `AWS Lightsail 32GB`

---

## 3. 테스트 서버 비교

| Provider | 추천 모델 | 사양 | 월 예상비용 | 메모 |
|---|---|---|---:|---|
| OCI | Always Free Ampere A1 | free pool 내 사용 | `$0` | 가장 저렴. 다만 실운영 핵심 서버로는 비추천 |
| AWS | Lightsail 2GB | `2 vCPU / 2GB / 60GB SSD / 3TB transfer` | `$12` | 테스트/내부 검증에 가장 무난 |
| AWS | Lightsail 4GB | `2 vCPU / 4GB / 80GB SSD / 4TB transfer` | `$24` | 테스트 서버로는 여유가 있는 편 |
| Azure | B1ms + E6 Standard SSD | `1 vCPU / 2GB` + 기본 디스크 | 약 `$24.41` | Azure Korea Central 기준 |
| Azure | B2s + E6 Standard SSD | `2 vCPU / 4GB` + 기본 디스크 | 약 `$43.39` | 테스트+내부 데모까지 가능 |
| GCP | e2-medium + 30GiB standard PD | `2 vCPU(shared-core) / 4GB` + 기본 디스크 | 약 `$25.66` | 테스트용으론 괜찮지만 sustained load엔 불리 |

### 테스트 서버 해석

- 예산이 거의 없으면 `OCI Always Free`
- 가장 무난한 선택은 `AWS Lightsail 2GB` 또는 `4GB`
- Azure는 한국 리전 기준 가격이 상대적으로 높음
- GCP `e2-medium`은 shared-core라 테스트에는 적합하지만 장기 운영 중심 설계엔 약간 애매함

---

## 4. 1000대 이상 비교

아래는 `polling 최적화 후`, `단일 VM 중심`으로 시작할 때의 기준입니다.

| Provider | 추천 모델 | 사양 | 월 예상비용 | 메모 |
|---|---|---|---:|---|
| AWS | Lightsail 16GB | `4 vCPU / 16GB / 320GB SSD / 5TB transfer` | `$84` | 1000대 이상 `최소 시작선`으로 가장 현실적 |
| AWS | Lightsail 32GB | `8 vCPU / 32GB / 640GB SSD / 7TB transfer` | `$164` | 1000대 이상 `안전 시작선` |
| Azure | D4as v5 + E10 Standard SSD | `4 vCPU / 16GB` + 기본 디스크 | 약 `$165.59` | Korea Central 기준, sustained load에 B-series보다 적합 |
| Azure | D8as v5 + E10 Standard SSD | `8 vCPU / 32GB` + 기본 디스크 | 약 `$320.35` | Azure 쪽 안전 시작선 |
| OCI | Ampere A1 | `4 OCPU / 24GB` | 약 `$55.48` + 스토리지 | 가격은 매우 좋지만 운영 경험/용량 확보 이슈 고려 |
| OCI | Ampere A1 | `8 OCPU / 48GB` | 약 `$110.96` + 스토리지 | 1000대 이상에서도 가성비 우수 |
| GCP | e2-standard-4 + 100GiB standard PD | `4 vCPU / 16GB` + 기본 디스크 | 약 `$101.84` | GCP 쪽 최소 시작선 |

### 1000대 이상 해석

- `최소 비용으로 가려면`: `OCI 4 OCPU / 24GB` 또는 `AWS Lightsail 16GB`
- `운영 안정성까지 보면`: `AWS Lightsail 32GB`
- `Azure는 가능하지만 비용이 높음`
- `GCP e2-standard-4`는 무난하지만 AWS Lightsail 대비 월비용 메리트가 크지 않음

---

## 5. 현재 polling 그대로일 때의 현실적 비용

현재 펌웨어 값 그대로면 1000대에서 polling 요청량이 높습니다.

- telemetry `1초`
- registered check `3초`
- subscription sync `5초`

이 경우는 `단일 저가 VM` 기준으로 보면 안 됩니다.

대략 다음 정도로 봐야 합니다.

| 시나리오 | AWS | Azure | OCI |
|---|---:|---:|---:|
| 앱 8vCPU/32GB + DB 4vCPU/16GB | 약 `$248` | 약 `$464.28` + 디스크 | 약 `$166.44` + 스토리지 |
| 앱 8vCPU/32GB + DB 8vCPU/32GB | 약 `$328` | 약 `$619.04` + 디스크 | 약 `$221.92` + 스토리지 |
| 더 보수적으로 16vCPU급 | `$384+` | `$600+` | `$220+` + 스토리지 |

즉, `1000대 이상 + 현재 polling 유지`면 월비용 기준이 바로 한 단계 올라갑니다.

---

## 6. 추천안

### 6.1 비용 최소화

- 테스트: `OCI Always Free`
- 1000대 이상: `OCI 8 OCPU / 48GB` 또는 `AWS Lightsail 16GB`

### 6.2 운영 균형형

- 테스트: `AWS Lightsail 2GB`
- 1000대 이상: `AWS Lightsail 32GB`

### 6.3 한국 리전/엔터프라이즈 쪽 선호

- 테스트: `Azure B1ms` 또는 `B2s`
- 1000대 이상: `Azure D4as v5`

### 6.4 내 최종 추천

#### 지금 당장 테스트

- `AWS Lightsail 2GB ($12/mo)` 또는 `OCI Always Free`

#### 실제 1000대 이상 가정 시작

- `AWS Lightsail 32GB ($164/mo)`

이유:

- 월정액이라 계산이 단순함
- 디스크와 트래픽 포함이라 예측이 쉬움
- Azure보다 싸고, GCP보다 비교가 단순함
- 초기에 `ABBAS_WEB + Device API + DB + Redis`를 한 VM에서 시작하기 편함

---

## 7. 공급자별 상세 메모

### AWS

장점:

- Lightsail이 단순함
- 월정액이라 운영 예측이 쉬움
- SSD/트래픽 포함

단점:

- 더 커지면 EC2/RDS 등으로 결국 넘어갈 수 있음

### Azure

장점:

- 한국 리전 선택이 자연스러움
- 엔터프라이즈 운영 친화적

단점:

- 비용이 상대적으로 높음
- burstable 계열은 steady load에 덜 적합

### OCI

장점:

- Always Free가 매우 강력함
- Ampere A1 가성비가 좋음

단점:

- 용량 확보/운영 경험에서 호불호 있음
- 실운영 핵심 인프라로는 팀 선호가 갈릴 수 있음

### GCP

장점:

- 구조가 깔끔하고 확장성도 좋음
- e2-standard 계열은 이해하기 쉬움

단점:

- Lightsail처럼 단순 월정액이 아니라 계산이 조금 번거로움
- shared-core 테스트 인스턴스는 sustained load에 불리

---

## 8. 참고 소스

공식 가격/사양 소스:

- AWS Lightsail pricing  
  https://aws.amazon.com/lightsail/pricing/

- Azure Retail Prices API
  - B1ms  
    https://prices.azure.com/api/retail/prices?$filter=serviceName%20eq%20%27Virtual%20Machines%27%20and%20armSkuName%20eq%20%27Standard_B1ms%27%20and%20armRegionName%20eq%20%27koreacentral%27%20and%20priceType%20eq%20%27Consumption%27
  - B2s  
    https://prices.azure.com/api/retail/prices?$filter=serviceName%20eq%20%27Virtual%20Machines%27%20and%20armSkuName%20eq%20%27Standard_B2s%27%20and%20armRegionName%20eq%20%27koreacentral%27%20and%20priceType%20eq%20%27Consumption%27
  - B4ms  
    https://prices.azure.com/api/retail/prices?$filter=serviceName%20eq%20%27Virtual%20Machines%27%20and%20armSkuName%20eq%20%27Standard_B4ms%27%20and%20armRegionName%20eq%20%27koreacentral%27%20and%20priceType%20eq%20%27Consumption%27
  - B8ms  
    https://prices.azure.com/api/retail/prices?$filter=serviceName%20eq%20%27Virtual%20Machines%27%20and%20armSkuName%20eq%20%27Standard_B8ms%27%20and%20armRegionName%20eq%20%27koreacentral%27%20and%20priceType%20eq%20%27Consumption%27
  - D4as v5  
    https://prices.azure.com/api/retail/prices?$filter=serviceName%20eq%20%27Virtual%20Machines%27%20and%20armSkuName%20eq%20%27Standard_D4as_v5%27%20and%20armRegionName%20eq%20%27koreacentral%27%20and%20priceType%20eq%20%27Consumption%27
  - D8as v5  
    https://prices.azure.com/api/retail/prices?$filter=serviceName%20eq%20%27Virtual%20Machines%27%20and%20armSkuName%20eq%20%27Standard_D8as_v5%27%20and%20armRegionName%20eq%20%27koreacentral%27%20and%20priceType%20eq%20%27Consumption%27

- Google Cloud VM pricing  
  https://cloud.google.com/compute/vm-instance-pricing

- Google Cloud machine types  
  https://cloud.google.com/compute/docs/general-purpose-machines

- Google Cloud disk pricing  
  https://cloud.google.com/compute/disks-image-pricing

- Oracle Compute pricing  
  https://www.oracle.com/cloud/compute/pricing/

- Oracle Always Free resources  
  https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm

---

## 9. 결론

가장 간단하게 정리하면 다음과 같습니다.

- 테스트 서버: `OCI Always Free` 또는 `AWS Lightsail 2GB`
- 1000대 이상: `AWS Lightsail 16GB`가 최소 시작선
- 1000대 이상 안전 시작: `AWS Lightsail 32GB`
- 현재 polling 그대로 운영할 계획이면, 이보다 더 큰 예산을 잡아야 함
