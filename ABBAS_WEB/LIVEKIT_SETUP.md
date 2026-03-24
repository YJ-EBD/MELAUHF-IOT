# LiveKit Setup

`ABBAS_WEB` 메신저 그룹 통화는 무료 self-hosted `LiveKit(SFU)` 기준으로 연결되어 있습니다.

## Quick Start

```bash
cd /home/abbas/Desktop/ABBAS_WEB
./scripts/start_group_call_stack.sh
```

위 명령은 아래를 한 번에 처리합니다.

- `livekit-server`를 프로젝트 안 `bin/`에 설치하거나 재사용합니다.
- `abbas-livekit.service`를 통해 LiveKit을 실행합니다.
- `abbas-web.service`를 통해 `ABBAS_WEB`를 재시작합니다.

## 현재 self-hosted 설정

`/home/abbas/Desktop/ABBAS_WEB/settings.env`에 아래 항목이 추가되어 있어야 합니다.

```env
LIVEKIT_URL=ws://<LAN_IP>:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
LIVEKIT_ROOM_PREFIX=abbas-talk-room-
LIVEKIT_BIND_IP=0.0.0.0
LIVEKIT_NODE_IP=<LAN_IP>
```

## 운영 스크립트

```bash
cd /home/abbas/Desktop/ABBAS_WEB
./scripts/livekit_local.sh status
./scripts/livekit_local.sh logs
./scripts/abbas_web_service.sh status
./scripts/abbas_web_service.sh logs
```

## systemd 서비스

- `abbas-livekit.service`: self-hosted LiveKit
- `abbas-web.service`: ABBAS_WEB FastAPI
- `for_rnd_web.service`: 중복 서비스라 비활성화됨

## 주의 사항

- 이 설정은 `self-hosted local/LAN`에서 바로 테스트하기 위한 구성입니다.
- 공식 문서 기준 local dev 서버는 `devkey / secret`을 사용합니다.
- 같은 LAN이나 같은 장비에서는 바로 테스트 가능하지만, 인터넷 공개 운영용으로는 `TLS + TURN` 구성이 추가로 필요합니다.
- 현재 구성은 `192.168.0.12`를 LAN IP로 사용합니다. IP가 바뀌면 `settings.env`와 `deploy/systemd/abbas-livekit.service`를 같이 갱신한 뒤 서비스를 재시작해야 합니다.
- 카메라를 켠 참가자는 모두 타일로 렌더링되고, 화면 공유는 별도 타일로 표시됩니다.
- 참가자가 많아질수록 그리드는 더 촘촘한 레이아웃으로 바뀌어 한 화면에 더 많은 카메라 타일이 보이도록 조정됩니다.
