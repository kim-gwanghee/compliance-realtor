import { createSupabaseAdmin } from "@/lib/supabase-server";

const KAKAO_ADMIN_KEY = process.env.KAKAO_ADMIN_KEY!;
const KAKAO_CID = process.env.KAKAO_PAY_CID || "TCSUBSCRIP"; // 테스트용 정기결제 CID

export async function POST(request: Request) {
  const { userId, billing = "monthly" } = (await request.json()) as { userId: string; billing?: "monthly" | "yearly" };
  if (!userId) {
    return Response.json({ error: "userId 필요" }, { status: 400 });
  }

  const isYearly = billing === "yearly";
  const amount = isYearly ? 99000 : 9900;
  const itemName = isYearly
    ? "Compliance for Realtors 프로 연간 구독"
    : "Compliance for Realtors 프로 월간 구독";

  const origin = request.headers.get("origin") || "http://localhost:3000";

  const res = await fetch("https://open-api.kakaopay.com/online/v1/payment/subscription", {
    method: "POST",
    headers: {
      Authorization: `SECRET_KEY ${KAKAO_ADMIN_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      cid: KAKAO_CID,
      partner_order_id: `sub_${billing}_${userId}`,
      partner_user_id: userId,
      item_name: itemName,
      quantity: 1,
      total_amount: amount,
      tax_free_amount: 0,
      approval_url: `${origin}/api/subscription/approve?user_id=${userId}&billing=${billing}`,
      cancel_url: `${origin}?payment=cancel`,
      fail_url: `${origin}?payment=fail`,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    return Response.json({ error: data.msg || "카카오페이 요청 실패" }, { status: 500 });
  }

  // TID를 DB에 임시 저장
  const supabase = createSupabaseAdmin();
  await supabase.from("subscriptions").upsert({
    user_id: userId,
    plan: "free",
    kakao_tid: data.tid,
  }, { onConflict: "user_id" });

  return Response.json({
    tid: data.tid,
    redirect_url: data.next_redirect_pc_url,
    redirect_mobile_url: data.next_redirect_mobile_url,
  });
}
