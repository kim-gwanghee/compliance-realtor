import Stripe from "stripe";
import { createSupabaseAdmin } from "@/lib/supabase-server";
import { NextRequest } from "next/server";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id");

  if (!sessionId) {
    return Response.redirect(new URL("/?payment=fail", request.url));
  }

  try {
    // Stripe 세션 조회
    const session = await getStripe().checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid" || !session.metadata?.userId) {
      return Response.redirect(new URL("/?payment=fail", request.url));
    }

    const userId = session.metadata.userId;
    const billing = session.metadata.billing || "monthly";

    // 구독 정보 업데이트
    const now = new Date();
    const days = billing === "yearly" ? 365 : 30;
    const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const supabase = createSupabaseAdmin();
    await supabase.from("subscriptions").upsert(
      {
        user_id: userId,
        plan: "pro",
        kakao_sid: session.subscription as string, // Stripe subscription ID
        kakao_tid: sessionId,
        started_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: "user_id" }
    );

    return Response.redirect(new URL("/?payment=success", request.url));
  } catch {
    return Response.redirect(new URL("/?payment=fail", request.url));
  }
}
