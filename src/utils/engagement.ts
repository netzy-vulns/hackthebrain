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

// 1단계: IP 없이 즉시 조회수/좋아요 숫자만 가져오기 (빠름)
export async function getQuickStats(
  slug: string
): Promise<{ views: number; likes: number } | null> {
  const { data, error } = await supabase
    .from("post_stats")
    .select("views, likes")
    .eq("slug", slug)
    .single();
  if (error) return null;
  return data as { views: number; likes: number };
}

// 리스트 페이지용: 여러 slug의 stats를 한 번에 조회
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
  return map;
}

// 2단계: IP 해시로 조회수 기록 + liked 여부 확인 (백그라운드)
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
