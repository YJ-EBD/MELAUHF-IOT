# for_rnd_web UI/UX 리디자인 적용 요약 (Modern SaaS Admin × Industrial Control)

## 1) 디자인 컨셉 요약
- **Modern SaaS Admin Dashboard**: 카드/테이블 중심, 깨끗한 여백과 타이포
- **Industrial Control Panel 포인트**: 제어·상태 영역은 다크톤, 상태를 LED/Badge로 명확화, 콘솔은 장비 제어 느낌 강화
- 애니메이션은 **절제(짧은 fade/slide, hover lift, 클릭 scale-down + ripple)**

---

## 2) 수정된 파일 목록
### Templates
- `templates/base.html`  
  - 좌측 **다크 사이드바** + 상단 **Topbar(상태/시간/테마 토글)** 레이아웃 반영
  - 페이지 진입 애니메이션 적용(`page-enter`)
  - 전역 로딩 오버레이 DOM 추가(기능에는 영향 없음)

- `templates/control_panel.html`  
  - 제어 영역을 **Industrial Control Surface**로 감싸는 wrapper 추가(`control-surface`)
  - 각 제어 블록에 `control-module` 클래스 부여(HTML 구조 최소 변경)

- `templates/device_status.html`  
  - Online/Offline/Error 상태 뱃지의 아이콘 중복 제거(LED dot은 CSS에서 표현)

### Static
- `static/css/admin.css`  
  - 테마 토큰(색상/라운드/섀도우) 추가
  - Sidebar/Topbar/Card/Table/Badge/Console/Control Surface 스타일 확장
  - 상태 LED(dot) + Error blink 애니메이션
  - (선택) 다크모드 토글 지원(`data-bs-theme="dark"`)

- `static/js/common.js`  
  - 다크모드 토글(로컬 저장)
  - 버튼 ripple
  - Topbar의 API 연결 상태 표시(`/api/devices/saved`로 가볍게 체크)
  - 시계 표시
  - 전역 로딩 오버레이 API(`window.AppUI.showLoading/hideLoading`)

- `static/js/control_panel.js`  
  - “찾기/저장” 동작 시 전역 로딩 오버레이 연동(기능 로직 유지)

---

## 3) 추가된 CSS/JS 핵심 컴포넌트
- **LED Dot**
  - `.led`, `.led--online`, `.led--offline`, `.led--error`, `.led--pending`
- **Topbar Status Pill**
  - `.status-pill` (API 상태, 시간 표기)
- **Industrial Control Surface**
  - `.control-surface` (다크톤 제어 패널 래핑)
  - `.control-module` (각 제어 블록)
- **Console Upgrade**
  - 기존 `.console-box/.console-pre` 유지 + grid 패턴/톤 강화
- **Micro animations**
  - 페이지 진입(`page-enter`)
  - 카드 hover lift(절제)
  - 버튼 클릭 scale-down + ripple

---

## 4) 실행 가이드
### (1) 의존성 설치
```bash
pip install -r requirements.txt
```

### (2) 실행 (uvicorn)
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### (3) 접속
- 브라우저에서 `http://localhost:8000/`

---

## 5) 페이지별 기능 정상 동작 체크리스트
- [ ] `/` Dashboard 로드 및 카드/차트 렌더링
- [ ] `/device-status`  
  - [ ] 4초 폴링으로 상태/카운트 갱신  
  - [ ] 수정 모달 열림/저장/삭제 동작
- [ ] `/control-panel`  
  - [ ] “찾기” 버튼 → `/api/devices/discovered` 호출 및 드롭다운 갱신  
  - [ ] “저장” 버튼 → `/api/devices/save` 호출 및 결과(token) 표시  
  - [ ] 콘솔 폴링(`/api/device/tail`) 동작 및 상태 배지 갱신
- [ ] `/logs`, `/data`, `/plan`, `/settings` 페이지 렌더링 정상
- [ ] 다크모드 토글 클릭 시 테마 전환/유지(localStorage) 확인

---

## 6) 구조 변경 여부
- ✅ 디렉토리 구조/파일명/라우팅(router)/템플릿 파일명 **변경 없음**
- ✅ 기존 기능(API 호출/폼/폴링/모달) **손상 없음**
- ✅ HTML 변경은 **최소 wrapper/div 클래스 추가** 수준으로 제한
