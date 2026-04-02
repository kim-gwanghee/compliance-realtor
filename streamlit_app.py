"""
부동산 법령 AI 어드바이저 — Streamlit Chat UI
TF-IDF 검색 + Anthropic Claude
"""

import json
import os
import time

import streamlit as st
import anthropic
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# ── Config ─────────────────────────────────────────────────

try:
    API_KEY = st.secrets["ANTHROPIC_API_KEY"]
except (KeyError, FileNotFoundError):
    API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

CHAT_MODEL = "claude-sonnet-4-20250514"
INDEX_PATH = os.path.join(os.path.dirname(__file__), "src", "lib", "rag-index-lean.json")

if not API_KEY:
    st.error("⚠️ ANTHROPIC_API_KEY가 설정되지 않았습니다. Streamlit Cloud > Settings > Secrets에서 설정해주세요.")
    st.stop()

client = anthropic.Anthropic(api_key=API_KEY)

SYSTEM_BASE = """당신은 공인중개사 업무에 특화된 법령 정보 안내 AI입니다.
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
최신 개정 여부는 국가법령정보센터(law.go.kr)에서 확인하시기 바랍니다."""


# ── Load RAG index + TF-IDF (cached) ──────────────────────

@st.cache_resource(show_spinner="법령 인덱스 로딩 중...")
def load_index():
    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    chunks = data["chunks"]
    texts = [c["text"] for c in chunks]
    # Character n-gram TF-IDF — works for Korean without tokenizer
    vectorizer = TfidfVectorizer(
        analyzer="char_wb",
        ngram_range=(2, 4),
        max_features=50000,
    )
    tfidf_matrix = vectorizer.fit_transform(texts)
    return chunks, vectorizer, tfidf_matrix


# ── RAG search (TF-IDF) ───────────────────────────────────

def search_laws(query: str, top_k: int = 20):
    chunks, vectorizer, tfidf_matrix = load_index()
    q_vec = vectorizer.transform([query])
    scores = cosine_similarity(q_vec, tfidf_matrix).flatten()
    top_indices = scores.argsort()[::-1][:top_k]

    results = []
    for idx in top_indices:
        if scores[idx] > 0:
            c = chunks[idx]
            results.append({
                "law": c["law"],
                "chapter": c["chapter"],
                "article": c["article"],
                "text": c["text"],
                "score": float(scores[idx]),
            })
    return results


def build_rag_context(query: str) -> str:
    results = search_laws(query, 20)

    by_law: dict[str, list] = {}
    for r in results:
        by_law.setdefault(r["law"], []).append(r)

    sections = []
    for law, chunks in by_law.items():
        chunk_texts = "\n\n".join(c["text"] for c in chunks)
        sections.append(f"### {law}\n{chunk_texts}")

    return "\n\n---\n\n".join(sections)


# ── Chat ───────────────────────────────────────────────────

def _build_system_prompt(query: str) -> str:
    rag_context = build_rag_context(query)
    return f"""{SYSTEM_BASE}

---

## 관련 법령 조문

{rag_context}"""


def stream_response(messages: list[dict]):
    """Generator that yields tokens for st.write_stream."""
    query = ""
    for m in reversed(messages):
        if m["role"] == "user":
            query = m["content"]
            break

    system_prompt = _build_system_prompt(query)

    # Filter to only user/assistant messages for Claude
    chat_messages = [
        {"role": m["role"], "content": m["content"]}
        for m in messages
        if m["role"] in ("user", "assistant")
    ]

    with client.messages.stream(
        model=CHAT_MODEL,
        system=system_prompt,
        messages=chat_messages,
        max_tokens=8192,
    ) as stream:
        for text in stream.text_stream:
            yield text


# ── Streamlit UI ───────────────────────────────────────────

st.set_page_config(
    page_title="부동산 법령 AI 어드바이저",
    page_icon="🏠",
    layout="centered",
)

st.title("🏠 부동산 법령 AI 어드바이저")
st.caption("본 서비스는 법률 자문이 아닌 법령 정보 안내 서비스입니다. 2026년 3월 기준.")

# Example questions in sidebar
with st.sidebar:
    st.header("💡 예시 질문")
    examples = [
        "매물 광고에 방향 표기를 안 하면 과태료 대상인가요?",
        "중개보수 법정 상한요율이 어떻게 되나요?",
        "허위매물 광고하면 어떤 처벌을 받나요?",
        "임차인이 대항력을 갖추려면 어떤 조건이 필요한가요?",
        "상가 임대차에서 권리금 회수를 방해하면?",
        "부동산 거래신고는 몇 일 이내에 해야 하나요?",
    ]
    for ex in examples:
        if st.button(ex, use_container_width=True):
            st.session_state["pending_question"] = ex

# Chat history
if "messages" not in st.session_state:
    st.session_state.messages = []

# Display chat history (past messages only)
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

# Handle pending question from sidebar
pending = st.session_state.pop("pending_question", None)
prompt = st.chat_input("법령에 대해 질문해주세요...")

if pending and not prompt:
    prompt = pending

if prompt:
    # Show user message immediately
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    # Stream assistant response (tokens appear one by one, no page reload)
    with st.chat_message("assistant"):
        t0 = time.time()
        api_messages = [{"role": m["role"], "content": m["content"]} for m in st.session_state.messages]
        try:
            response = st.write_stream(stream_response(api_messages))
            elapsed = time.time() - t0
            st.caption(f"⏱️ {elapsed:.1f}초")
        except Exception as e:
            response = f"⚠️ 오류가 발생했습니다: {e}"
            st.error(response)

    st.session_state.messages.append({"role": "assistant", "content": response})
