/**
 * TF-IDF based Korean law search engine (Node.js port)
 * Character n-gram approach — works for Korean without a tokenizer.
 */

import ragData from "./rag-index-lean.json";

interface Chunk {
  id: number;
  law: string;
  chapter: string;
  article: string;
  text: string;
}

interface SearchResult {
  law: string;
  chapter: string;
  article: string;
  text: string;
  score: number;
}

// ── Synonym expansion ─────────────────────────────────
const SYNONYMS: Record<string, string[]> = {
  "과태료": ["벌금", "벌칙", "제재", "처벌"],
  "벌금": ["과태료", "벌칙"],
  "중개보수": ["중개수수료", "수수료", "보수", "요율"],
  "수수료": ["중개보수", "보수", "요율"],
  "허위매물": ["허위광고", "거짓매물", "거짓광고"],
  "대항력": ["대항요건", "점유", "전입신고", "확정일자"],
  "전세": ["임대차", "임차", "보증금"],
  "월세": ["임대차", "임차", "차임"],
  "보증금": ["전세금", "임대보증금"],
  "권리금": ["권리금회수", "권리금보호"],
  "거래신고": ["부동산거래신고", "실거래신고", "신고기한"],
  "광고": ["표시광고", "매물광고", "광고규정"],
  "계약서": ["계약", "특약", "중개대상물확인"],
  "확인설명서": ["중개대상물확인설명서", "확인설명"],
  "등기": ["부동산등기", "소유권이전등기"],
  "임차인": ["세입자", "임대인", "임차"],
  "임대인": ["집주인", "임대", "임대차"],
  "공인중개사": ["중개사", "중개업자", "개업공인중개사"],
  "상가": ["상가건물", "상가임대차"],
  "주택": ["주택임대차", "아파트", "빌라"],
};

function expandQuery(query: string): string {
  const words = query.split(/\s+/);
  const extra: string[] = [];
  for (const word of words) {
    for (const [key, synonyms] of Object.entries(SYNONYMS)) {
      if (word.includes(key)) {
        extra.push(...synonyms);
      }
    }
  }
  return extra.length > 0 ? `${query} ${extra.join(" ")}` : query;
}

// ── Character n-gram tokenizer ──────────────────────────

function charNgrams(text: string, minN = 2, maxN = 4): string[] {
  const tokens: string[] = [];
  const words = text
    .toLowerCase()
    .replace(/[^\uAC00-\uD7A3a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const word of words) {
    const padded = ` ${word} `;
    for (let n = minN; n <= maxN; n++) {
      for (let i = 0; i <= padded.length - n; i++) {
        tokens.push(padded.slice(i, i + n));
      }
    }
  }
  return tokens;
}

// ── TF-IDF index (built once, cached) ───────────────────

interface TfIdfIndex {
  chunks: Chunk[];
  tfidf: Float64Array[]; // per-document TF-IDF vectors
  vocab: Map<string, number>;
  idf: Float64Array;
}

let cachedIndex: TfIdfIndex | null = null;

function buildIndex(): TfIdfIndex {
  if (cachedIndex) return cachedIndex;

  const chunks = (ragData as { chunks: Chunk[] }).chunks;
  const N = chunks.length;

  // Build vocabulary & document frequency
  const dfMap = new Map<string, number>();
  const docTokens: string[][] = [];

  for (const chunk of chunks) {
    const tokens = charNgrams(chunk.text);
    docTokens.push(tokens);
    const unique = new Set(tokens);
    for (const t of unique) {
      dfMap.set(t, (dfMap.get(t) ?? 0) + 1);
    }
  }

  // Keep top 50000 terms by DF (same as Python version)
  const sortedTerms = [...dfMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50000);

  const vocab = new Map<string, number>();
  sortedTerms.forEach(([term], idx) => vocab.set(term, idx));

  const vocabSize = vocab.size;

  // IDF
  const idf = new Float64Array(vocabSize);
  for (const [term, idx] of vocab) {
    const df = dfMap.get(term)!;
    idf[idx] = Math.log((N + 1) / (df + 1)) + 1;
  }

  // TF-IDF vectors (L2-normalized)
  const tfidf: Float64Array[] = [];
  for (const tokens of docTokens) {
    const vec = new Float64Array(vocabSize);
    const tf = new Map<string, number>();
    for (const t of tokens) {
      if (vocab.has(t)) {
        tf.set(t, (tf.get(t) ?? 0) + 1);
      }
    }
    for (const [t, count] of tf) {
      const idx = vocab.get(t)!;
      vec[idx] = count * idf[idx];
    }
    // L2 normalize
    let norm = 0;
    for (let i = 0; i < vocabSize; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vocabSize; i++) vec[i] /= norm;
    }
    tfidf.push(vec);
  }

  cachedIndex = { chunks, tfidf, vocab, idf };
  return cachedIndex;
}

// ── Search ──────────────────────────────────────────────

export function searchLaws(query: string, topK = 20): SearchResult[] {
  const { chunks, tfidf, vocab, idf } = buildIndex();
  const vocabSize = vocab.size;

  // Query vector (with synonym expansion)
  const expanded = expandQuery(query);
  const tokens = charNgrams(expanded);
  const qVec = new Float64Array(vocabSize);
  const tf = new Map<string, number>();
  for (const t of tokens) {
    if (vocab.has(t)) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }
  }
  for (const [t, count] of tf) {
    const idx = vocab.get(t)!;
    qVec[idx] = count * idf[idx];
  }
  // L2 normalize
  let qNorm = 0;
  for (let i = 0; i < vocabSize; i++) qNorm += qVec[i] * qVec[i];
  qNorm = Math.sqrt(qNorm);
  if (qNorm > 0) {
    for (let i = 0; i < vocabSize; i++) qVec[i] /= qNorm;
  }

  // Cosine similarity (vectors are already L2-normalized, so dot product = cosine)
  const scores: { idx: number; score: number }[] = [];
  for (let d = 0; d < tfidf.length; d++) {
    let dot = 0;
    const dVec = tfidf[d];
    for (let i = 0; i < vocabSize; i++) dot += qVec[i] * dVec[i];
    if (dot > 0) scores.push({ idx: d, score: dot });
  }

  scores.sort((a, b) => b.score - a.score);

  return scores.slice(0, topK).map((s) => ({
    law: chunks[s.idx].law,
    chapter: chunks[s.idx].chapter,
    article: chunks[s.idx].article,
    text: chunks[s.idx].text,
    score: s.score,
  }));
}

export function buildRagContext(query: string): string {
  const results = searchLaws(query, 20);

  const byLaw = new Map<string, SearchResult[]>();
  for (const r of results) {
    if (!byLaw.has(r.law)) byLaw.set(r.law, []);
    byLaw.get(r.law)!.push(r);
  }

  const sections: string[] = [];
  for (const [law, chunks] of byLaw) {
    const texts = chunks.map((c) => c.text).join("\n\n");
    sections.push(`### ${law}\n${texts}`);
  }

  return sections.join("\n\n---\n\n");
}
