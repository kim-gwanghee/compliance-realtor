import { createSupabaseAdmin } from "@/lib/supabase-server";
import { NextRequest } from "next/server";

const KAKAO_ADMIN_KEY = process.env.KAKAO_ADMIN_KEY!;
const KAKAO_CID = process.env.KAKAO_PAY_CID || "TCSUBSCRIP";

export async function GET(request: NextRequest) {
  const pgToken = request.nextUrl.searchParams.get("pg_token");
  const userId = request.nextUrl.searchParams.get("user_id");
  const billing = request.nextUrl.searchParams.get("billing") || "monthly";

  if (!pgToken || !userId) {
    return Response.redirect(new URL("/?payment=fail", request.url));
  }

  const supabase = createSupabaseAdmin();

  // DB에서 TID 조회
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("kakao_tid")
    .eq("user_id", userId)
    .single();

  if (!sub?.kakao_tid) {
    return Response.redirect(new URL("/?payment=fail", request.url));
  }

  // 카카오페이 결제 승인
  const res = await fetch("https://open-api.kakaopay.com/online/v1/payment/approve", {
    method: "POST",
    headers: {
      Authorization: `SECRET_KEY ${KAKAO_ADMIN_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      cid: KAKAO_CID,
      tid: sub.kakao_tid,
      partner_order_id: `sub_${billing}_${userId}`,
      partner_user_id: userId,
      pg_token: pgToken,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    return Response.redirect(new URL("/?payment=fail", request.url));
  }

  // 구독 정보 업데이트
  const now = new Date();
  const days = billing === "yearly" ? 365 : 30;
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  await supabase.from("subscriptions").update({
    plan: "pro",
    kakao_sid: data.sid,
    kakao_tid: data.tid,
    started_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  }).eq("user_id", userId);

  return Response.redirect(new URL("/?payment=success", request.url));
}
