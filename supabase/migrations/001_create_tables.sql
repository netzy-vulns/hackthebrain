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
