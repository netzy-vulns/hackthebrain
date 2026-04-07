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
