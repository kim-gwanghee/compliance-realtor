import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

function createSupabaseServer(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) { cookiesToSet.forEach(({ name, value, options }) => { cookieStore.set(name, value, options); }); },
      },
    }
  );
}

// GET /api/posts/[id]
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createSupabaseServer(cookieStore);

  const { data: post, error } = await supabase
    .from("posts")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !post) {
    return Response.json({ error: "게시글을 찾을 수 없습니다." }, { status: 404 });
  }

  // Increment views
  await supabase.from("posts").update({ views: (post.views || 0) + 1 }).eq("id", id);

  // Get replies
  const { data: replies } = await supabase
    .from("replies")
    .select("id, user_id, nickname, content, created_at")
    .eq("post_id", id)
    .order("created_at", { ascending: true });

  // Get like count and user's like status
  const { count: likeCount } = await supabase
    .from("post_likes")
    .select("id", { count: "exact" })
    .eq("post_id", id);

  const { data: { user } } = await supabase.auth.getUser();
  let userLiked = false;
  if (user) {
    const { data: like } = await supabase
      .from("post_likes")
      .select("id")
      .eq("post_id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    userLiked = !!like;
  }

  return Response.json({
    post,
    replies: replies || [],
    like_count: likeCount || 0,
    user_liked: userLiked,
    current_user_id: user?.id || null,
  });
}

// DELETE /api/posts/[id]
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createSupabaseServer(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { error } = await supabase.from("posts").delete().eq("id", id).eq("user_id", user.id);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
