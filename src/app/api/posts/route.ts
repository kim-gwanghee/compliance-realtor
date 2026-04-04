import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

function createSupabaseServer(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );
}

// GET /api/posts?category=중개실무&page=1
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const search = searchParams.get("q");
  const page = parseInt(searchParams.get("page") || "1");
  const limit = 20;
  const offset = (page - 1) * limit;

  const cookieStore = await cookies();
  const supabase = createSupabaseServer(cookieStore);

  let query = supabase
    .from("posts")
    .select("id, user_id, nickname, title, content, category, views, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (category && category !== "전체") {
    query = query.eq("category", category);
  }

  if (search?.trim()) {
    query = query.or(`title.ilike.%${search.trim()}%,content.ilike.%${search.trim()}%`);
  }

  const { data, count, error } = await query;

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Get reply counts for each post
  const postIds = (data || []).map((p) => p.id);
  const { data: replyCounts } = await supabase
    .from("replies")
    .select("post_id")
    .in("post_id", postIds);

  const replyCountMap: Record<string, number> = {};
  (replyCounts || []).forEach((r) => {
    replyCountMap[r.post_id] = (replyCountMap[r.post_id] || 0) + 1;
  });

  // Get like counts
  const { data: likeCounts } = await supabase
    .from("post_likes")
    .select("post_id")
    .in("post_id", postIds);

  const likeCountMap: Record<string, number> = {};
  (likeCounts || []).forEach((l) => {
    likeCountMap[l.post_id] = (likeCountMap[l.post_id] || 0) + 1;
  });

  const posts = (data || []).map((p) => ({
    ...p,
    reply_count: replyCountMap[p.id] || 0,
    like_count: likeCountMap[p.id] || 0,
  }));

  return Response.json({ posts, total: count || 0, page, limit });
}

// POST /api/posts
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createSupabaseServer(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { title, content, category } = await request.json();

  if (!title?.trim() || !content?.trim()) {
    return Response.json({ error: "제목과 내용을 입력해주세요." }, { status: 400 });
  }

  const nickname = user.email?.split("@")[0] || "익명";

  const { data, error } = await supabase
    .from("posts")
    .insert({ user_id: user.id, nickname, title: title.trim(), content: content.trim(), category: category || "기타" })
    .select("id")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ id: data.id });
}
