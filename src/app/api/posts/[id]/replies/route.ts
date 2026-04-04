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

// POST /api/posts/[id]/replies
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createSupabaseServer(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { content } = await request.json();
  if (!content?.trim()) {
    return Response.json({ error: "내용을 입력해주세요." }, { status: 400 });
  }

  const nickname = user.email?.split("@")[0] || "익명";

  const { data, error } = await supabase
    .from("replies")
    .insert({ post_id: id, user_id: user.id, nickname, content: content.trim() })
    .select("id, user_id, nickname, content, created_at")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}
