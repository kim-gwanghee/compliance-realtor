import { createSupabaseAdmin } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const { userId } = (await request.json()) as { userId: string };
  if (!userId) {
    return Response.json({ error: "userId 필요" }, { status: 400 });
  }

  const supabase = createSupabaseAdmin();
  const today = new Date().toISOString().split("T")[0];

  const { data: existing } = await supabase
    .from("daily_usage")
    .select("count")
    .eq("user_id", userId)
    .eq("usage_date", today)
    .single();

  let newCount: number;

  if (existing) {
    newCount = existing.count + 1;
    await supabase
      .from("daily_usage")
      .update({ count: newCount })
      .eq("user_id", userId)
      .eq("usage_date", today);
  } else {
    newCount = 1;
    await supabase
      .from("daily_usage")
      .insert({ user_id: userId, usage_date: today, count: 1 });
  }

  return Response.json({ dailyCount: newCount });
}
