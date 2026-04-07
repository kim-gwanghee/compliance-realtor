import Stripe from "stripe";
import { createSupabaseAdmin } from "@/lib/supabase-server";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

const PRICES: Record<string, number> = {
  monthly: 9900,
  yearly: 99000,
};

export async function POST(request: Request) {
  const { userId, billing = "monthly" } = (await request.json()) as {
    userId: string;
    billing?: "monthly" | "yearly";
  };

  if (!userId) {
    return Response.json({ error: "userId 필요" }, { status: 400 });
  }

  const origin = request.headers.get("origin") || "https://compliance-realtors.vercel.app";
  const amount = PRICES[billing] || 9900;
  const interval = billing === "yearly" ? "year" : "month";
  const itemName = billing === "yearly"
    ? "Compliance for Realtors 프로 연간 구독"
    : "Compliance for Realtors 프로 월간 구독";

  try {
    // Stripe Checkout Session 생성 (구독 모드)
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "krw",
            product_data: { name: itemName },
            unit_amount: amount,
            recurring: { interval },
          },
          quantity: 1,
        },
      ],
      metadata: { userId, billing },
      success_url: `${origin}/api/subscription/approve?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}?payment=cancel`,
    });

    // 세션 ID를 DB에 임시 저장
    const supabase = createSupabaseAdmin();
    await supabase.from("subscriptions").upsert(
      {
        user_id: userId,
        plan: "free",
        kakao_tid: session.id, // stripe session ID 저장 (기존 컬럼 재활용)
      },
      { onConflict: "user_id" }
    );

    return Response.json({ redirect_url: session.url });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Stripe 요청 실패" },
      { status: 500 }
    );
  }
}
