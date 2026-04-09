# 게시글 좋아요 & 조회수 기능 설계

## 개요

Astro 정적 블로그에 Supabase를 활용한 좋아요(토글) 및 조회수 기능 추가.
IP 해시 기반으로 중복 좋아요를 방지하고, 페이지 로드마다 조회수를 증가시킨다.

## 기술 스택

- **백엔드**: Supabase (PostgreSQL + RPC 함수 + RLS)
- **프론트엔드**: Astro 클라이언트 스크립트 (순수 JS)
- **패키지 추가**: `@supabase/supabase-js`
- **IP 조회**: `https://api.ipify.org`
- **해시**: Web Crypto API (SHA-256)

## 데이터베이스 설계

### 테이블: `post_stats`

게시글별 조회수/좋아요 집계 테이블.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `slug` | TEXT (PK) | 게시글 식별자 (Astro slug과 동일) |
| `views` | INTEGER DEFAULT 0 | 조회수 |
| `likes` | INTEGER DEFAULT 0 | 좋아요 수 |

### 테이블: `post_likes`

IP 기반 좋아요 중복 방지 테이블.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | UUID (PK, gen_random_uuid()) | 자동 생성 |
| `slug` | TEXT NOT NULL | 게시글 slug |
| `ip_hash` | TEXT NOT NULL | IP SHA-256 해시 (원본 IP 저장 안 함) |
| `created_at` | TIMESTAMPTZ DEFAULT now() | 좋아요 시각 |
| — | UNIQUE(slug, ip_hash) | 같은 IP가 같은 글에 중복 좋아요 방지 |

### RLS 정책

- `post_stats`: SELECT 허용, INSERT/UPDATE/DELETE 차단 (RPC 함수만 가능)
- `post_likes`: 모든 직접 접근 차단 (RPC 함수만 가능)

## API 설계 (Supabase RPC 함수)

### 1. `view_post(p_slug TEXT, p_ip_hash TEXT)`

페이지 로드 시 호출. 조회수 증가 + 현재 상태 반환.

**동작:**
1. `post_stats`에 해당 slug이 없으면 새 행 생성 (views=1, likes=0)
2. 있으면 `views = views + 1`
3. `post_likes`에서 해당 (slug, ip_hash) 존재 여부 확인

**반환:** `{ views: INTEGER, likes: INTEGER, liked: BOOLEAN }`

### 2. `toggle_like(p_slug TEXT, p_ip_hash TEXT)`

좋아요 버튼 클릭 시 호출. 토글 처리.

**동작:**
1. `post_likes`에 (slug, ip_hash)가 존재하면:
   - 해당 행 삭제
   - `post_stats.likes = likes - 1`
   - `liked = false` 반환
2. 존재하지 않으면:
   - 새 행 삽입
   - `post_stats.likes = likes + 1`
   - `liked = true` 반환

**반환:** `{ likes: INTEGER, liked: BOOLEAN }`

## 프론트엔드 설계

### IP 해시 획득 흐름

1. `fetch('https://api.ipify.org?format=json')` → IP 문자열 획득
2. Web Crypto API `crypto.subtle.digest('SHA-256', ...)` → 해시 생성
3. 해시값을 RPC 호출 시 `p_ip_hash` 파라미터로 전달

### Supabase 클라이언트 설정

- `@supabase/supabase-js` npm 패키지 설치
- Supabase URL과 anon key를 환경변수로 관리
- 클라이언트 인스턴스를 유틸리티 모듈로 분리

### UI 배치

**조회수 (제목 아래, 날짜 영역 근처):**
- 눈 아이콘 + 숫자 표시 (예: 👁 123)
- 페이지 로드 시 `view_post` 응답으로 렌더링

**좋아요 버튼 (글 하단, ShareLinks 위):**
- 하트 아이콘 + 숫자 표시 (예: ♥ 45)
- `liked=true`이면 채워진 하트, `false`이면 빈 하트
- 클릭 시 `toggle_like` 호출 → 즉시 UI 업데이트 (optimistic update)

### 구현 방식

- Astro `<script>` 태그 내 순수 JavaScript
- 별도 프레임워크(React/Vue) 추가 없음
- DOM 직접 조작으로 숫자 및 아이콘 상태 업데이트

## 보안

### 대응 완료
- **SQL Injection**: Supabase RPC 파라미터화된 쿼리 사용
- **개인정보 보호**: IP를 SHA-256 해시로만 저장, 원본 복원 불가
- **데이터 조작 방지**: RLS + RPC로 직접 테이블 접근 차단
- **XSS**: 숫자만 표시, 사용자 입력 HTML 없음

### 허용된 리스크
- **IP 위조**: 클라이언트에서 IP를 가져오므로 기술적으로 위조 가능. 블로그 규모에서 악용 동기 낮아 감수.
- **조회수 스팸**: 새로고침으로 조회수 증가 가능. Rate Limiting으로 완화.

### TODO: Rate Limiting
- Supabase 대시보드에서 API Rate Limiting 설정 필요
- 배포 후 반드시 설정할 것
