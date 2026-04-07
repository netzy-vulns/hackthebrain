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
    return crypto.randomUUID();
  }
}

let cachedIpHash: string | null = null;

async function getCachedIpHash(): Promise<string> {
  if (!cachedIpHash) {
    cachedIpHash = await getIpHash();
  }
  return cachedIpHash;
}

// ============================================
// sessionStorage 캐시
// ============================================
const CACHE_KEY = "post_stats_cache";

function saveToCache(slug: string, stats: { views: number; likes: number }) {
  try {
    const cache = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "{}");
    cache[slug] = stats;
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function saveManyToCache(
  statsMap: Map<string, { views: number; likes: number }>
) {
  try {
    const cache = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "{}");
    for (const [slug, stats] of statsMap) {
      cache[slug] = stats;
    }
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

export function getFromCache(
  slug: string
): { views: number; likes: number } | null {
  try {
    const cache = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "{}");
    return cache[slug] || null;
  } catch {
    return null;
  }
}

// ============================================
// API 함수
// ============================================

export type PostStats = {
  views: number;
  likes: number;
  liked: boolean;
};

// 리스트 페이지용: 여러 slug의 stats를 한 번에 조회 + 캐시 저장
export async function getMultipleStats(
  slugs: string[]
): Promise<Map<string, { views: number; likes: number }>> {
  const map = new Map<string, { views: number; likes: number }>();
  if (slugs.length === 0) return map;

  const { data, error } = await supabase
    .from("post_stats")
    .select("slug, views, likes")
    .in("slug", slugs);

  if (error || !data) return map;
  for (const row of data) {
    map.set(row.slug, { views: row.views, likes: row.likes });
  }

  // 캐시에 저장
  saveManyToCache(map);
  return map;
}

// IP 해시로 조회수 기록 + liked 여부 확인
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
  const stats = data as PostStats;
  // 캐시 업데이트
  saveToCache(slug, { views: stats.views, likes: stats.likes });
  return stats;
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
