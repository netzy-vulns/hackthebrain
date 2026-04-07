-- ============================================
-- 1. 조회 기록 테이블 추가
-- ============================================

CREATE TABLE IF NOT EXISTS post_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  viewed_at DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE(slug, ip_hash, viewed_at)
);

CREATE INDEX idx_post_views_slug_ip_date ON post_views(slug, ip_hash, viewed_at);

-- RLS: 직접 접근 차단 (RPC 함수만 접근)
ALTER TABLE post_views ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 2. view_post 함수 수정: IP 기반 하루 1회
-- ============================================

CREATE OR REPLACE FUNCTION view_post(p_slug TEXT, p_ip_hash TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  is_new_view BOOLEAN;
BEGIN
  -- 오늘 이 IP가 이미 조회했는지 확인
  SELECT NOT EXISTS(
    SELECT 1 FROM post_views
    WHERE slug = p_slug AND ip_hash = p_ip_hash AND viewed_at = CURRENT_DATE
  ) INTO is_new_view;

  IF is_new_view THEN
    -- 조회 기록 추가
    INSERT INTO post_views (slug, ip_hash, viewed_at)
    VALUES (p_slug, p_ip_hash, CURRENT_DATE)
    ON CONFLICT (slug, ip_hash, viewed_at) DO NOTHING;

    -- post_stats 업데이트
    INSERT INTO post_stats (slug, views, likes)
    VALUES (p_slug, 1, 0)
    ON CONFLICT (slug)
    DO UPDATE SET views = post_stats.views + 1;
  ELSE
    -- post_stats가 없으면 생성만 (views 증가 안 함)
    INSERT INTO post_stats (slug, views, likes)
    VALUES (p_slug, 0, 0)
    ON CONFLICT (slug) DO NOTHING;
  END IF;

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
