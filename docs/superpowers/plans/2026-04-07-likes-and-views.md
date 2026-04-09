# 게시글 좋아요 & 조회수 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Astro 정적 블로그에 Supabase 기반 좋아요(토글) 및 조회수 기능 추가

**Architecture:** Supabase PostgreSQL에 `post_stats`와 `post_likes` 테이블을 생성하고, RPC 함수 2개(`view_post`, `toggle_like`)로 데이터를 처리한다. 프론트엔드는 Astro 클라이언트 스크립트(순수 JS)로 Supabase를 직접 호출하며, IP를 SHA-256 해시하여 중복 좋아요를 방지한다.

**Tech Stack:** Astro 5, Supabase (PostgreSQL + RPC + RLS), @supabase/supabase-js, Web Crypto API, ipify API

**Spec:** `docs/superpowers/specs/2026-04-07-likes-and-views-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/001_create_tables.sql` | DB 테이블 + RLS + RPC 함수 정의 |
| Create | `src/utils/supabase.ts` | Supabase 클라이언트 인스턴스 |
| Create | `src/utils/engagement.ts` | IP 해시 + view_post/toggle_like 호출 헬퍼 |
| Create | `src/components/LikeButton.astro` | 좋아요 토글 버튼 UI |
| Create | `src/components/ViewCount.astro` | 조회수 표시 UI |
| Modify | `src/layouts/PostDetails.astro` | ViewCount, LikeButton 삽입 |
| Modify | `astro.config.ts` | Supabase 환경변수 스키마 추가 |
| Modify | `package.json` | @supabase/supabase-js 의존성 추가 |

---

## Task 1: Supabase 프로젝트 설정 + 환경변수

**Files:**
- Modify: `astro.config.ts:51-58`
- Create: `.env` (gitignore 대상)

- [ ] **Step 1: Supabase 프로젝트 생성**

Supabase 대시보드(https://supabase.com)에서:
1. New Project 생성
2. Project Settings → API에서 `Project URL`과 `anon public` key 복사

- [ ] **Step 2: .env 파일 생성**

프로젝트 루트에 `.env` 파일 생성:

```
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

- [ ] **Step 3: .gitignore에 .env 추가 확인**

`.gitignore`에 `.env`가 이미 있는지 확인. 없으면 추가:

```
.env
```

- [ ] **Step 4: astro.config.ts에 환경변수 스키마 추가**

`astro.config.ts`의 `env.schema` 섹션에 Supabase 환경변수를 추가한다:

```typescript
env: {
  schema: {
    PUBLIC_GOOGLE_SITE_VERIFICATION: envField.string({
      access: "public",
      context: "client",
      optional: true,
    }),
    PUBLIC_SUPABASE_URL: envField.string({
      access: "public",
      context: "client",
      optional: false,
    }),
    PUBLIC_SUPABASE_ANON_KEY: envField.string({
      access: "public",
      context: "client",
      optional: false,
    }),
  },
},
```

- [ ] **Step 5: @supabase/supabase-js 설치**

```bash
cd D:/git/hackthebrain
npm install @supabase/supabase-js
```

- [ ] **Step 6: 커밋**

```bash
git add astro.config.ts package.json package-lock.json .gitignore
git commit -m "chore: add supabase dependency and env schema"
```

---

## Task 2: Supabase DB 마이그레이션 (테이블 + RLS + RPC)

**Files:**
- Create: `supabase/migrations/001_create_tables.sql`

- [ ] **Step 1: 마이그레이션 SQL 작성**

`supabase/migrations/001_create_tables.sql` 파일을 생성한다:

```sql
-- ============================================
-- 1. 테이블 생성
-- ============================================

CREATE TABLE IF NOT EXISTS post_stats (
  slug TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS post_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(slug, ip_hash)
);

CREATE INDEX idx_post_likes_slug_ip ON post_likes(slug, ip_hash);

-- ============================================
-- 2. RLS 활성화 + 정책
-- ============================================

ALTER TABLE post_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes ENABLE ROW LEVEL SECURITY;

-- post_stats: 누구나 읽기 가능, 직접 쓰기 불가
CREATE POLICY "Allow public read on post_stats"
  ON post_stats FOR SELECT
  TO anon
  USING (true);

-- post_likes: 직접 접근 전부 차단 (RPC 함수만 접근)
-- (정책 없음 = 모든 직접 접근 차단)

-- ============================================
-- 3. RPC 함수: view_post
-- ============================================

CREATE OR REPLACE FUNCTION view_post(p_slug TEXT, p_ip_hash TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  -- post_stats에 slug이 없으면 생성, 있으면 views +1
  INSERT INTO post_stats (slug, views, likes)
  VALUES (p_slug, 1, 0)
  ON CONFLICT (slug)
  DO UPDATE SET views = post_stats.views + 1;

  -- 현재 stats + liked 여부 반환
  SELECT json_build_object(
    'views', ps.views,
    'likes', ps.likes,
    'liked', EXISTS(
      SELECT 1 FROM post_likes
      WHERE slug = p_slug AND ip_hash = p_ip_hash
    )
  ) INTO result
  FROM post_stats ps
  WHERE ps.slug = p_slug;

  RETURN result;
END;
$$;

-- ============================================
-- 4. RPC 함수: toggle_like
-- ============================================

CREATE OR REPLACE FUNCTION toggle_like(p_slug TEXT, p_ip_hash TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  already_liked BOOLEAN;
  new_likes INTEGER;
BEGIN
  -- 이미 좋아요 했는지 확인
  SELECT EXISTS(
    SELECT 1 FROM post_likes
    WHERE slug = p_slug AND ip_hash = p_ip_hash
  ) INTO already_liked;

  IF already_liked THEN
    -- 좋아요 취소
    DELETE FROM post_likes
    WHERE slug = p_slug AND ip_hash = p_ip_hash;

    UPDATE post_stats
    SET likes = GREATEST(likes - 1, 0)
    WHERE slug = p_slug;
  ELSE
    -- 좋아요 추가 (post_stats가 없으면 생성)
    INSERT INTO post_stats (slug, views, likes)
    VALUES (p_slug, 0, 1)
    ON CONFLICT (slug)
    DO UPDATE SET likes = post_stats.likes + 1;

    INSERT INTO post_likes (slug, ip_hash)
    VALUES (p_slug, p_ip_hash);
  END IF;

  -- 결과 반환
  SELECT ps.likes INTO new_likes
  FROM post_stats ps
  WHERE ps.slug = p_slug;

  RETURN json_build_object(
    'likes', COALESCE(new_likes, 0),
    'liked', NOT already_liked
  );
END;
$$;
```

- [ ] **Step 2: Supabase 대시보드에서 SQL 실행**

Supabase 대시보드 → SQL Editor에 위 SQL을 붙여넣고 실행한다.

- [ ] **Step 3: 테이블 생성 확인**

Supabase 대시보드 → Table Editor에서 `post_stats`와 `post_likes` 테이블이 보이는지 확인한다.

- [ ] **Step 4: RPC 함수 테스트**

Supabase 대시보드 → SQL Editor에서:

```sql
-- view_post 테스트
SELECT view_post('test-slug', 'test-hash-123');
-- 예상: {"views": 1, "likes": 0, "liked": false}

-- toggle_like 테스트 (좋아요)
SELECT toggle_like('test-slug', 'test-hash-123');
-- 예상: {"likes": 1, "liked": true}

-- toggle_like 테스트 (좋아요 취소)
SELECT toggle_like('test-slug', 'test-hash-123');
-- 예상: {"likes": 0, "liked": false}

-- 테스트 데이터 정리
DELETE FROM post_likes WHERE slug = 'test-slug';
DELETE FROM post_stats WHERE slug = 'test-slug';
```

- [ ] **Step 5: 커밋**

```bash
git add supabase/
git commit -m "feat: add supabase migration for post stats and likes"
```

---

## Task 3: Supabase 클라이언트 유틸리티

**Files:**
- Create: `src/utils/supabase.ts`

- [ ] **Step 1: Supabase 클라이언트 모듈 작성**

```typescript
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

- [ ] **Step 2: 커밋**

```bash
git add src/utils/supabase.ts
git commit -m "feat: add supabase client utility"
```

---

## Task 4: IP 해시 + Engagement 헬퍼

**Files:**
- Create: `src/utils/engagement.ts`

- [ ] **Step 1: engagement 유틸리티 작성**

```typescript
import { supabase } from "./supabase";

async function getIpHash(): Promise<string> {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const { ip } = await res.json();
    const encoder = new TextEncoder();
    const data = encoder.encode(ip);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // IP를 가져올 수 없으면 랜덤 해시 (좋아요 중복 방지 불가, 조회수는 정상 동작)
    return crypto.randomUUID();
  }
}

// IP 해시를 캐시하여 같은 페이지에서 재사용
let cachedIpHash: string | null = null;

async function getCachedIpHash(): Promise<string> {
  if (!cachedIpHash) {
    cachedIpHash = await getIpHash();
  }
  return cachedIpHash;
}

export type PostStats = {
  views: number;
  likes: number;
  liked: boolean;
};

export async function viewPost(slug: string): Promise<PostStats | null> {
  const ipHash = await getCachedIpHash();
  const { data, error } = await supabase.rpc("view_post", {
    p_slug: slug,
    p_ip_hash: ipHash,
  });
  if (error) {
    console.error("viewPost error:", error);
    return null;
  }
  return data as PostStats;
}

export async function toggleLike(
  slug: string
): Promise<{ likes: number; liked: boolean } | null> {
  const ipHash = await getCachedIpHash();
  const { data, error } = await supabase.rpc("toggle_like", {
    p_slug: slug,
    p_ip_hash: ipHash,
  });
  if (error) {
    console.error("toggleLike error:", error);
    return null;
  }
  return data as { likes: number; liked: boolean };
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/utils/engagement.ts
git commit -m "feat: add engagement helpers for view and like"
```

---

## Task 5: ViewCount 컴포넌트

**Files:**
- Create: `src/components/ViewCount.astro`

- [ ] **Step 1: ViewCount 컴포넌트 작성**

`Datetime.astro` 패턴을 따라 작성한다. 서버에서는 빈 placeholder를 렌더링하고, 클라이언트 JS에서 숫자를 채운다.

```astro
---
type Props = {
  slug: string;
};

const { slug } = Astro.props;
---

<span
  id="view-count"
  class="flex items-center gap-x-1 text-sm opacity-80"
  data-slug={slug}
>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="inline-block"
  >
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
  <span id="view-count-number">-</span>
</span>
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/ViewCount.astro
git commit -m "feat: add ViewCount component"
```

---

## Task 6: LikeButton 컴포넌트

**Files:**
- Create: `src/components/LikeButton.astro`

- [ ] **Step 1: LikeButton 컴포넌트 작성**

빈 하트/채워진 하트를 토글하는 버튼. 서버에서는 초기 상태를 렌더링하고, 클라이언트 JS에서 상태를 관리한다.

```astro
---
type Props = {
  slug: string;
};

const { slug } = Astro.props;
---

<div
  id="like-section"
  class="flex items-center gap-2"
  data-slug={slug}
>
  <button
    id="like-button"
    type="button"
    class="flex items-center gap-1.5 rounded-lg border border-muted px-3 py-1.5 text-sm transition-colors hover:bg-muted"
    aria-label="Like this post"
  >
    <!-- 빈 하트 (기본) -->
    <svg
      id="heart-empty"
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="inline-block"
    >
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path>
    </svg>
    <!-- 채워진 하트 (좋아요 상태) -->
    <svg
      id="heart-filled"
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="hidden text-red-500"
    >
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path>
    </svg>
    <span id="like-count">-</span>
  </button>
</div>
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/LikeButton.astro
git commit -m "feat: add LikeButton component"
```

---

## Task 7: PostDetails 레이아웃에 컴포넌트 통합 + 클라이언트 스크립트

**Files:**
- Modify: `src/layouts/PostDetails.astro:1-286`

- [ ] **Step 1: import 추가**

`PostDetails.astro` 상단(line 9, ShareLinks import 아래)에 추가:

```astro
import ViewCount from "@/components/ViewCount.astro";
import LikeButton from "@/components/LikeButton.astro";
```

- [ ] **Step 2: slug 변수 추출**

line 38 (`const { Content } = await render(post);`) 아래에 추가:

```astro
const slug = post.id;
```

- [ ] **Step 3: ViewCount를 제목 아래에 삽입**

line 99~109의 `<div class="my-2 flex items-center gap-2">` 블록을 수정한다. Datetime 뒤에 ViewCount를 추가:

```astro
<div class="my-2 flex items-center gap-2">
  <Datetime {pubDatetime} {modDatetime} {timezone} size="lg" />
  <span aria-hidden="true" class="opacity-80">|</span>
  <ViewCount {slug} />
  <span
    aria-hidden="true"
    class:list={[
      "max-sm:hidden",
      { hidden: !SITE.editPost.enabled || hideEditPost },
    ]}>|</span
  >
  <EditPost {hideEditPost} {post} class="max-sm:hidden" />
</div>
```

- [ ] **Step 4: LikeButton을 ShareLinks 위에 삽입**

line 127 (`<ShareLinks />`) 바로 위에 추가:

```astro
<LikeButton {slug} />

<ShareLinks />
```

- [ ] **Step 5: 클라이언트 스크립트 추가**

기존 `<script is:inline data-astro-rerun>` 태그(line 166) 바로 위에 새 스크립트를 추가한다. 이 스크립트는 번들링되는 모듈 스크립트이다:

```astro
<script>
  import { viewPost, toggleLike } from "@/utils/engagement";

  async function initEngagement() {
    const viewCountEl = document.getElementById("view-count");
    const slug = viewCountEl?.dataset.slug;
    if (!slug) return;

    // 조회수 증가 + 현재 상태 로드
    const stats = await viewPost(slug);
    if (stats) {
      const viewNumber = document.getElementById("view-count-number");
      if (viewNumber) viewNumber.textContent = String(stats.views);

      const likeCount = document.getElementById("like-count");
      if (likeCount) likeCount.textContent = String(stats.likes);

      // 이미 좋아요 했으면 채워진 하트 표시
      if (stats.liked) {
        document.getElementById("heart-empty")?.classList.add("hidden");
        document.getElementById("heart-filled")?.classList.remove("hidden");
      }
    }

    // 좋아요 버튼 클릭 핸들러
    const likeButton = document.getElementById("like-button");
    let isProcessing = false;

    likeButton?.addEventListener("click", async () => {
      if (isProcessing) return;
      isProcessing = true;

      const result = await toggleLike(slug);
      if (result) {
        const likeCount = document.getElementById("like-count");
        if (likeCount) likeCount.textContent = String(result.likes);

        const heartEmpty = document.getElementById("heart-empty");
        const heartFilled = document.getElementById("heart-filled");

        if (result.liked) {
          heartEmpty?.classList.add("hidden");
          heartFilled?.classList.remove("hidden");
        } else {
          heartEmpty?.classList.remove("hidden");
          heartFilled?.classList.add("hidden");
        }
      }

      isProcessing = false;
    });
  }

  // Astro view transitions 지원
  document.addEventListener("astro:page-load", initEngagement);
</script>
```

- [ ] **Step 6: 커밋**

```bash
git add src/layouts/PostDetails.astro
git commit -m "feat: integrate view count and like button into post detail"
```

---

## Task 8: 수동 테스트 + 배포

- [ ] **Step 1: 로컬 개발 서버 실행**

```bash
cd D:/git/hackthebrain
npm run dev
```

- [ ] **Step 2: 게시글 페이지 열기**

브라우저에서 아무 게시글 페이지를 열고 확인:
- 제목 아래에 눈 아이콘 + 조회수 숫자가 표시되는지
- 새로고침하면 조회수가 1 증가하는지
- 글 하단에 하트 버튼 + 숫자가 표시되는지

- [ ] **Step 3: 좋아요 토글 테스트**

- 하트 버튼 클릭 → 채워진 하트로 변경, 숫자 +1
- 다시 클릭 → 빈 하트로 변경, 숫자 -1

- [ ] **Step 4: 브라우저 콘솔 에러 확인**

개발자 도구(F12) → Console 탭에서 에러가 없는지 확인.

- [ ] **Step 5: 빌드 테스트**

```bash
npm run build
```

에러 없이 빌드되는지 확인.

- [ ] **Step 6: 최종 커밋 + 배포**

```bash
git add -A
git commit -m "feat: complete post likes and view count feature"
git push
```

Cloudflare Pages에서 환경변수 설정:
- Settings → Environment Variables에 `PUBLIC_SUPABASE_URL`과 `PUBLIC_SUPABASE_ANON_KEY` 추가

---

## 배포 후 TODO

- [ ] **Supabase Rate Limiting 설정**: Supabase 대시보드 → Project Settings → API에서 Rate Limiting 활성화
