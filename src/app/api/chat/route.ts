import Anthropic from "@anthropic-ai/sdk";
import { buildRagContext } from "@/lib/rag-search";

const SYSTEM_BASE = `당신은 공인중개사 업무에 특화된 법령 정보 안내 AI입니다.
법률 자문이 아닌 법령 정보를 안내합니다.

## 면책 고지
본 답변은 참고용이며 법적 효력을 갖지 않습니다.
정확한 법률 자문은 변호사 또는 법무사에게 문의하세요.

## 답변 규칙
1. 모든 답변에 관련 법령 조문 번호를 명시할 것
2. 해당 조문의 원문을 인용할 것
3. 실무적 해석을 1~3문장으로 덧붙일 것 (시나리오 기반)
4. 확실하지 않은 내용은 "확인이 필요합니다"로 표시할 것
5. 조문 번호를 인용할 때, 반드시 아래 법령 전문에서 해당 조문이 존재하는지 확인 후 인용할 것
6. 위반 시 과태료/벌칙이 있는 경우 해당 조항과 금액을 함께 안내할 것

## 답변 형식 (반드시 아래 4개 섹션을 모두 포함할 것)
### 1. 핵심 결론
- 질문에 대한 답을 먼저 명확하게 1~3문장으로 제시
### 2. 관련 법령 조문
- 해당 조문 번호와 원문을 인용
### 3. 실무적 해석
- 조문을 현장 실무 관점에서 풀어서 설명 (시나리오 예시 포함)
### 4. 위반 시 제재
- 과태료, 벌칙, 행정처분 등을 조항과 금액 포함하여 안내

## 스코프 제한
아래 제공된 법령 조문에 포함되지 않는 질문에는 "현재 제공하는 법령 범위를 벗어나는 질문입니다. 국가법령정보센터(law.go.kr)에서 확인하시기 바랍니다."라고 안내하세요.

## 법령 기준일
본 답변은 2026년 3월 기준 법령을 바탕으로 합니다.
최신 개정 여부는 국가법령정보센터(law.go.kr)에서 확인하시기 바랍니다.`;

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  const { messages } = (await request.json()) as {
    messages: { role: "user" | "assistant"; content: string }[];
  };

  // Find the latest user message for RAG context
  let query = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      query = messages[i].content;
      break;
    }
  }

  const ragContext = buildRagContext(query);
  const systemPrompt = `${SYSTEM_BASE}\n\n---\n\n## 관련 법령 조문\n\n${ragContext}`;

  const client = new Anthropic({ apiKey });

  const stream = await client.messages.stream({
    model: "claude-sonnet-4-20250514",
    system: systemPrompt,
    messages,
    max_tokens: 8192,
  });

  // Return a streaming response
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
            );
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: String(err) })}\n\n`
          )
        );
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
