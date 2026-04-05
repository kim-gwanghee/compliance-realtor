import { createSupabaseAdmin } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("user_id");

  if (!userId) {
    return Response.json({ error: "user_id 필요" }, { status: 400 });
  }

  const supabase = createSupabaseAdmin();

  // 구독 상태 조회
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan, expires_at")
    .eq("user_id", userId)
    .single();

  const isPro = sub?.plan === "pro" && sub?.expires_at && new Date(sub.expires_at) > new Date();

  // 오늘 사용량 조회
  const today = new Date().toISOString().split("T")[0];
  const { data: usage } = await supabase
    .from("daily_usage")
    .select("count")
    .eq("user_id", userId)
    .eq("usage_date", today)
    .single();

  const dailyCount = usage?.count ?? 0;
  const dailyLimit = isPro ? null : 3; // 프로는 무제한
  const canChat = isPro || dailyCount < 3;

  return Response.json({
    plan: isPro ? "pro" : "free",
    dailyCount,
    dailyLimit,
    canChat,
    expiresAt: sub?.expires_at || null,
  });
}
