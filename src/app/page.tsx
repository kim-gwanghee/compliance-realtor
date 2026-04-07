"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { createSupabaseBrowser } from "@/lib/supabase";
import type { User, Session } from "@supabase/supabase-js";

const supabase = createSupabaseBrowser();

interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
}

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

const EXAMPLE_QUESTIONS = [
  "매물 광고에 방향 표기를 안 하면 과태료 대상인가요?",
  "중개보수 법정 상한요율이 어떻게 되나요?",
  "허위매물 광고하면 어떤 처벌을 받나요?",
  "임차인이 대항력을 갖추려면 어떤 조건이 필요한가요?",
  "상가 임대차에서 권리금 회수를 방해하면?",
  "부동산 거래신고는 몇 일 이내에 해야 하나요?",
];

// Map law names to law.go.kr search URLs
const LAW_SEARCH_MAP: Record<string, string> = {
  "공인중개사법 시행규칙": "https://www.law.go.kr/법령/공인중개사법시행규칙",
  "공인중개사법 시행령": "https://www.law.go.kr/법령/공인중개사법시행령",
  "공인중개사법": "https://www.law.go.kr/법령/공인중개사법",
  "주택임대차보호법 시행령": "https://www.law.go.kr/법령/주택임대차보호법시행령",
  "주택임대차보호법": "https://www.law.go.kr/법령/주택임대차보호법",
  "상가건물 임대차보호법 시행령": "https://www.law.go.kr/법령/상가건물임대차보호법시행령",
  "상가건물임대차보호법 시행령": "https://www.law.go.kr/법령/상가건물임대차보호법시행령",
  "상가건물 임대차보호법": "https://www.law.go.kr/법령/상가건물임대차보호법",
  "상가건물임대차보호법": "https://www.law.go.kr/법령/상가건물임대차보호법",
  "부동산 거래신고법 시행령": "https://www.law.go.kr/법령/부동산거래신고등에관한법률시행령",
  "부동산 거래신고법": "https://www.law.go.kr/법령/부동산거래신고등에관한법률",
  "부동산거래신고법": "https://www.law.go.kr/법령/부동산거래신고등에관한법률",
  "부동산등기 특별조치법": "https://www.law.go.kr/법령/부동산등기특별조치법",
  "표시·광고의 공정화에 관한 법률": "https://www.law.go.kr/법령/표시·광고의공정화에관한법률",
  "표시광고 공정화법": "https://www.law.go.kr/법령/표시·광고의공정화에관한법률",
  "표시광고법": "https://www.law.go.kr/법령/표시·광고의공정화에관한법률",
  "건축법": "https://www.law.go.kr/법령/건축법",
  "국토계획법": "https://www.law.go.kr/법령/국토의계획및이용에관한법률",
  "국토의 계획 및 이용에 관한 법률": "https://www.law.go.kr/법령/국토의계획및이용에관한법률",
  "개인정보보호법": "https://www.law.go.kr/법령/개인정보보호법",
  "개인정보 보호법": "https://www.law.go.kr/법령/개인정보보호법",
};

function linkifyLawReferences(html: string): string {
  const sorted = Object.entries(LAW_SEARCH_MAP).sort((a, b) => b[0].length - a[0].length);

  for (const [lawName, url] of sorted) {
    const escaped = lawName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const withArticle = new RegExp(
      `(?<![↗a-z])(${escaped})\\s*(제\\d+조(?:의\\d+)?(?:\\s*제\\d+항)?(?:\\s*제\\d+호)?)(?![^<]*<\\/a>)`,
      "g"
    );
    html = html.replace(
      withArticle,
      `<a href="${url}" target="_blank" rel="noopener noreferrer" title="법령정보센터에서 보기">$1 $2 ↗</a>`
    );

    const nameOnly = new RegExp(
      `(?<![↗a-z])(${escaped})(?!\\s*제\\d)(?![^<]*<\\/a>)`,
      "g"
    );
    html = html.replace(
      nameOnly,
      `<a href="${url}" target="_blank" rel="noopener noreferrer" title="법령정보센터에서 보기">$1 ↗</a>`
    );
  }

  html = html.replace(
    /(?<![↗"a-z])(제\d+조(?:의\d+)?(?:\s*제\d+항)?(?:\s*제\d+호)?)(?![^<]*<\/a>)/g,
    `<a href="https://www.law.go.kr/법령검색/$1" target="_blank" rel="noopener noreferrer" title="법령정보센터에서 검색">$1 ↗</a>`
  );

  return html;
}

const SECTION_DEFS = [
  { pattern: /1[.\s]*핵심\s*결론/i, label: "1. 핵심 결론" },
  { pattern: /2[.\s]*관련\s*법령/i, label: "2. 관련 법령" },
  { pattern: /3[.\s]*실무적?\s*해석/i, label: "3. 실무 해석" },
  { pattern: /4[.\s]*위반\s*시\s*제재/i, label: "4. 위반 시 제재" },
  { pattern: /5[.\s]*관련\s*판례/i, label: "5. 관련 판례" },
];

function splitMarkdownSections(md: string): { before: string; sections: { label: string; body: string }[] } {
  const lines = md.split("\n");
  const sectionStarts: { lineIdx: number; defIdx: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].replace(/[#*_`]/g, "").trim();
    for (let d = 0; d < SECTION_DEFS.length; d++) {
      if (SECTION_DEFS[d].pattern.test(stripped)) {
        sectionStarts.push({ lineIdx: i, defIdx: d });
        break;
      }
    }
  }

  if (sectionStarts.length < 2) {
    return { before: md, sections: [] };
  }

  const before = lines.slice(0, sectionStarts[0].lineIdx).join("\n");
  const sections: { label: string; body: string }[] = [];

  for (let s = 0; s < sectionStarts.length; s++) {
    const start = sectionStarts[s].lineIdx + 1;
    const end = s + 1 < sectionStarts.length ? sectionStarts[s + 1].lineIdx : lines.length;
    const def = SECTION_DEFS[sectionStarts[s].defIdx];
    sections.push({
      label: def.label,
      body: lines.slice(start, end).join("\n").trim(),
    });
  }

  return { before, sections };
}

function mdToHtml(md: string): string {
  return md
    .replace(/^#### (.+)$/gm, '<h4 class="text-sm font-semibold mt-3 mb-1">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-bold mt-4 mb-2">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal">$2</li>')
    .replace(
      /^> (.+)$/gm,
      '<blockquote class="border-l-3 border-blue-500 pl-3 my-2 italic" style="color:var(--text-secondary)">$1</blockquote>'
    )
    .replace(/\n\n/g, '<div class="h-2"></div>')
    .replace(/\n/g, "<br />");
}

function MarkdownContent({ content }: { content: string }) {
  const { before, sections } = splitMarkdownSections(content);

  if (sections.length === 0) {
    const html = linkifyLawReferences(mdToHtml(content));
    return (
      <div
        className="prose text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <div className="prose text-sm leading-relaxed">
      {before.trim() && (
        <div dangerouslySetInnerHTML={{ __html: linkifyLawReferences(mdToHtml(before)) }} />
      )}
      {sections.map((sec, i) => (
        <div key={i} className="section-card">
          <div className="section-label">{sec.label}</div>
          <div dangerouslySetInnerHTML={{ __html: linkifyLawReferences(mdToHtml(sec.body)) }} />
        </div>
      ))}
    </div>
  );
}

// Icons
function SunIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return filled ? (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M5 2h14a1 1 0 011 1v19.143a.5.5 0 01-.766.424L12 18.03l-7.234 4.536A.5.5 0 014 22.143V3a1 1 0 011-1z" />
    </svg>
  ) : (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

// ─── Auth Modal ───
function AuthModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
      } else {
        onClose();
      }
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        setError(error.message);
      } else {
        setSuccess("가입 확인 이메일을 발송했습니다. 이메일을 확인해주세요.");
      }
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-sm mx-4 rounded-2xl p-6 border shadow-xl"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border-color)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-4">
          {mode === "login" ? "로그인" : "회원가입"}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
          />
          <input
            type="password"
            placeholder="비밀번호 (6자 이상)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
          />

          {error && <p className="text-xs text-red-500">{error}</p>}
          {success && <p className="text-xs text-green-600">{success}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "처리 중..." : mode === "login" ? "로그인" : "회원가입"}
          </button>
        </form>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t" style={{ borderColor: "var(--border-color)" }} />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="px-2" style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}>또는</span>
          </div>
        </div>

        <button
          onClick={async () => {
            await supabase.auth.signInWithOAuth({
              provider: "kakao",
              options: { redirectTo: `${window.location.origin}/auth/callback` },
            });
          }}
          className="w-full py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
          style={{ background: "#FEE500", color: "#191919" }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#191919" d="M9 1C4.58 1 1 3.79 1 7.21c0 2.17 1.45 4.08 3.64 5.18l-.93 3.44c-.08.28.24.5.48.34l4.11-2.72c.23.02.46.03.7.03 4.42 0 8-2.79 8-6.27C17 3.79 13.42 1 9 1z"/></svg>
          카카오 로그인
        </button>

        <p className="text-xs text-center mt-4" style={{ color: "var(--text-secondary)" }}>
          {mode === "login" ? (
            <>
              계정이 없으신가요?{" "}
              <button onClick={() => { setMode("signup"); setError(""); setSuccess(""); }} className="text-blue-600 font-medium">
                회원가입
              </button>
            </>
          ) : (
            <>
              이미 계정이 있으신가요?{" "}
              <button onClick={() => { setMode("login"); setError(""); setSuccess(""); }} className="text-blue-600 font-medium">
                로그인
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

// ─── Pricing Modal ───
function PricingModal({ onClose, onSubscribe, loading }: { onClose: () => void; onSubscribe: (billing: "monthly" | "yearly") => void; loading: boolean }) {
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md mx-4 rounded-2xl p-6 border shadow-xl"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border-color)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-1">오늘의 무료 질문을 모두 사용했습니다</h2>
        <p className="text-sm mb-5" style={{ color: "var(--text-secondary)" }}>
          프로 플랜으로 업그레이드하면 무제한으로 질문할 수 있습니다.
        </p>

        {/* Billing toggle */}
        <div className="flex items-center justify-center gap-1 mb-4 p-1 rounded-xl" style={{ background: "var(--bg-surface-hover)" }}>
          <button
            onClick={() => setBilling("monthly")}
            className={`flex-1 text-xs py-2 rounded-lg font-medium transition-colors ${billing === "monthly" ? "bg-white shadow-sm" : ""}`}
            style={billing === "monthly" ? { color: "var(--text-primary)" } : { color: "var(--text-muted)" }}
          >
            월간
          </button>
          <button
            onClick={() => setBilling("yearly")}
            className={`flex-1 text-xs py-2 rounded-lg font-medium transition-colors ${billing === "yearly" ? "bg-white shadow-sm" : ""}`}
            style={billing === "yearly" ? { color: "var(--text-primary)" } : { color: "var(--text-muted)" }}
          >
            연간 <span className="text-blue-600 font-bold">17% 할인</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          {/* Free */}
          <div className="rounded-xl border p-4" style={{ borderColor: "var(--border-color)" }}>
            <div className="text-sm font-semibold mb-1">무료</div>
            <div className="text-2xl font-bold mb-3">0<span className="text-sm font-normal">원/월</span></div>
            <ul className="text-xs space-y-1.5" style={{ color: "var(--text-secondary)" }}>
              <li>- 하루 3회 질문</li>
              <li>- 대화 저장 불가</li>
            </ul>
          </div>
          {/* Pro */}
          <div className="rounded-xl border-2 border-blue-500 p-4 relative">
            <div className="absolute -top-2.5 left-3 bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">추천</div>
            <div className="text-sm font-semibold mb-1">프로</div>
            {billing === "monthly" ? (
              <div className="text-2xl font-bold mb-3">9,900<span className="text-sm font-normal">원/월</span></div>
            ) : (
              <div className="mb-3">
                <div className="text-2xl font-bold">99,000<span className="text-sm font-normal">원/년</span></div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>월 8,250원 · 연 19,800원 절약</div>
              </div>
            )}
            <ul className="text-xs space-y-1.5" style={{ color: "var(--text-secondary)" }}>
              <li>- 무제한 질문</li>
              <li>- 관련 판례 검색</li>
              <li>- 대화 기록 저장</li>
              <li>- 북마크 기능</li>
            </ul>
          </div>
        </div>

        <button
          onClick={() => onSubscribe(billing)}
          disabled={loading}
          className="w-full py-3 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: "#FEE500", color: "#191919" }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#191919" d="M9 1C4.58 1 1 3.79 1 7.21c0 2.17 1.45 4.08 3.64 5.18l-.93 3.44c-.08.28.24.5.48.34l4.11-2.72c.23.02.46.03.7.03 4.42 0 8-2.79 8-6.27C17 3.79 13.42 1 9 1z"/></svg>
          {loading ? "처리 중..." : billing === "monthly" ? "월 9,900원 구독하기" : "연 99,000원 구독하기"}
        </button>

        <button
          onClick={onClose}
          className="w-full mt-2 py-2 text-xs transition-colors"
          style={{ color: "var(--text-muted)" }}
        >
          내일 다시 무료로 사용하기
        </button>
      </div>
    </div>
  );
}

// ─── Main Chat Page ───
export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [elapsedTime, setElapsedTime] = useState<number | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);

  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);

  // Conversation state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);

  // Bookmark state
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());

  // Subscription state
  const [plan, setPlan] = useState<"free" | "pro">("free");
  const [dailyCount, setDailyCount] = useState(0);
  const [showPricing, setShowPricing] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);

  // Initialize auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, session: Session | null) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load conversations & subscription when user logs in
  useEffect(() => {
    if (!user) {
      setConversations([]);
      setCurrentConvId(null);
      setPlan("free");
      setDailyCount(0);
      return;
    }
    loadConversations();
    loadSubscriptionStatus();
  }, [user]);

  async function loadSubscriptionStatus() {
    if (!user) return;
    try {
      const res = await fetch(`/api/subscription/status?user_id=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setPlan(data.plan);
        setDailyCount(data.dailyCount);
      }
    } catch { /* ignore */ }
  }

  async function incrementDailyUsage() {
    if (!user) return;
    try {
      const res = await fetch("/api/subscription/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if (res.ok && typeof data.dailyCount === "number") {
        setDailyCount(data.dailyCount);
      }
    } catch (err) {
      console.error("incrementDailyUsage error:", err);
      // 서버 실패 시 로컬에서라도 카운트 증가
      setDailyCount((prev) => prev + 1);
    }
  }

  async function handleSubscribe(billing: "monthly" | "yearly" = "monthly") {
    if (!user) return;
    setPaymentLoading(true);
    try {
      const res = await fetch("/api/subscription/ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, billing }),
      });
      const data = await res.json();
      if (data.redirect_url) {
        // 모바일이면 모바일 URL 사용
        const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
        window.location.href = isMobile && data.redirect_mobile_url
          ? data.redirect_mobile_url
          : data.redirect_url;
      }
    } catch {
      alert("결제 요청에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setPaymentLoading(false);
    }
  }

  async function loadConversations() {
    const { data } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (data) setConversations(data);
  }

  // Load bookmarks for current conversation
  useEffect(() => {
    if (!user || !currentConvId) {
      setBookmarkedIds(new Set());
      return;
    }
    supabase
      .from("bookmarks")
      .select("message_id")
      .eq("conversation_id", currentConvId)
      .then(({ data }) => {
        if (data) setBookmarkedIds(new Set(data.map((b) => b.message_id)));
      });
  }, [user, currentConvId]);

  // Handle payment return
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    if (payment === "success") {
      loadSubscriptionStatus();
      window.history.replaceState({}, "", "/");
    } else if (payment === "cancel" || payment === "fail") {
      window.history.replaceState({}, "", "/");
    }
  }, []);

  // Initialize dark mode — default is light, only apply dark if explicitly saved
  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "dark") {
      setDarkMode(true);
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent]);

  // 모바일에서 키보드 자동 올라오는 것 방지 — 자동 포커스 제거

  // ─── DB helpers ───
  async function ensureConversation(firstMsg: string): Promise<string | null> {
    if (!user) return null;
    if (currentConvId) return currentConvId;

    const title = firstMsg.slice(0, 40) + (firstMsg.length > 40 ? "..." : "");
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title })
      .select("id")
      .single();

    if (error || !data) return null;
    setCurrentConvId(data.id);
    loadConversations();
    return data.id;
  }

  async function saveMessage(convId: string, role: "user" | "assistant", content: string): Promise<string | null> {
    const { data } = await supabase
      .from("messages")
      .insert({ conversation_id: convId, role, content })
      .select("id")
      .single();
    return data?.id ?? null;
  }

  async function loadConversation(convId: string) {
    setCurrentConvId(convId);
    setMessages([]);
    setStreamingContent("");
    setElapsedTime(null);
    setError(null);
    setSidebarOpen(false);

    const { data } = await supabase
      .from("messages")
      .select("id, role, content")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });

    if (data) {
      setMessages(data.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content })));
    }
  }

  async function toggleBookmark(messageId: string) {
    if (!user || !currentConvId || !messageId) return;

    if (bookmarkedIds.has(messageId)) {
      await supabase.from("bookmarks").delete().eq("user_id", user.id).eq("message_id", messageId);
      setBookmarkedIds((prev) => { const next = new Set(prev); next.delete(messageId); return next; });
    } else {
      await supabase.from("bookmarks").insert({
        user_id: user.id,
        message_id: messageId,
        conversation_id: currentConvId,
      });
      setBookmarkedIds((prev) => new Set(prev).add(messageId));
    }
  }

  function startNewConversation() {
    setMessages([]);
    setStreamingContent("");
    setCurrentConvId(null);
    setElapsedTime(null);
    setError(null);
  }

  // ─── Send message ───
  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return;

    if (!user) {
      setShowAuth(true);
      return;
    }

    // 무료 플랜 일일 3회 제한
    if (plan !== "pro" && dailyCount >= 3) {
      setShowPricing(true);
      return;
    }

    const userMessage: Message = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setStreamingContent("");
    setElapsedTime(null);
    setError(null);
    setSidebarOpen(false);

    // Save user message to DB (프로 플랜만)
    let convId = currentConvId;
    if (user && plan === "pro") {
      convId = await ensureConversation(text.trim());
      if (convId) {
        const msgId = await saveMessage(convId, "user", text.trim());
        if (msgId) {
          newMessages[newMessages.length - 1].id = msgId;
          setMessages([...newMessages]);
        }
      }
    }

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedTime((Date.now() - startTime) / 1000);
    }, 100);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          isPro: plan === "pro",
        }),
      });

      if (!response.ok) {
        const errorText = response.status === 500 ? "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요." : `API 오류 (${response.status})`;
        throw new Error(errorText);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;
              try {
                const parsed = JSON.parse(data);
                if (parsed.text) {
                  fullContent += parsed.text;
                  setStreamingContent(fullContent);
                }
                if (parsed.error) {
                  throw new Error(parsed.error);
                }
              } catch {
                // skip parse errors for incomplete chunks
              }
            }
          }
        }
      }

      if (timerRef.current) clearInterval(timerRef.current);
      setElapsedTime((Date.now() - startTime) / 1000);

      const assistantMsg: Message = { role: "assistant", content: fullContent };

      // Save assistant message to DB (프로 플랜만)
      if (user && plan === "pro" && convId) {
        const msgId = await saveMessage(convId, "assistant", fullContent);
        if (msgId) assistantMsg.id = msgId;
      }

      setMessages([...newMessages, assistantMsg]);
      setStreamingContent("");

      // 사용량 증가
      await incrementDailyUsage();
    } catch (err) {
      if (timerRef.current) clearInterval(timerRef.current);
      const errMsg = err instanceof Error ? err.message : String(err);
      setError(errMsg);
      setMessages([
        ...newMessages,
        { role: "assistant", content: `오류가 발생했습니다: ${errMsg}` },
      ]);
      setStreamingContent("");
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    startNewConversation();
  }

  return (
    <div className="h-full flex flex-col" style={{ background: "var(--bg-main)", color: "var(--text-primary)" }}>
      {/* Auth Modal */}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      {showPricing && (
        <PricingModal
          onClose={() => setShowPricing(false)}
          onSubscribe={(billing) => handleSubscribe(billing)}
          loading={paymentLoading}
        />
      )}

      {/* Header */}
      <header className="px-4 py-3 flex items-center justify-between shrink-0 border-b" style={{ background: "var(--bg-surface)", borderColor: "var(--border-color)" }}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden p-2 rounded-lg transition-colors"
            style={{ color: "var(--text-secondary)" }}
            aria-label="메뉴"
          >
            <MenuIcon />
          </button>
          <div className="min-w-0">
            <h1 className="text-sm sm:text-lg font-bold flex items-center gap-1.5 sm:gap-2 whitespace-nowrap">
              <span className="text-base sm:text-xl">🏠</span>
              <span className="truncate">법령 가이드</span>
              <span className="hidden sm:inline truncate">— 부동산 중개</span>
            </h1>
            <p className="text-xs hidden sm:block" style={{ color: "var(--text-secondary)" }}>
              법률 자문이 아닌 법령 정보 안내 서비스 · 2026년 3월 기준
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 whitespace-nowrap">
          <button
            onClick={toggleDarkMode}
            className="p-2 rounded-lg transition-colors"
            style={{ color: "var(--text-secondary)" }}
            aria-label={darkMode ? "라이트 모드" : "다크 모드"}
            title={darkMode ? "라이트 모드로 전환" : "다크 모드로 전환"}
          >
            {darkMode ? <SunIcon /> : <MoonIcon />}
          </button>
          <Link
            href="/community"
            className="hidden sm:inline-block text-sm px-3 py-1.5 rounded-lg transition-colors"
            style={{ color: "var(--text-secondary)" }}
          >
            커뮤니티
          </Link>
          <button
            onClick={startNewConversation}
            className="text-xs sm:text-sm px-2 sm:px-3 py-1.5 rounded-lg transition-colors"
            style={{ color: "var(--text-secondary)" }}
          >
            새 대화
          </button>

          {/* Auth buttons */}
          {authLoading ? (
            <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border" style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}>
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              로그인 중...
            </div>
          ) : user ? (
            <div className="flex items-center gap-1 sm:gap-2">
              {plan === "pro" ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-600 text-white font-medium">PRO</span>
              ) : (
                <button
                  onClick={() => setShowPricing(true)}
                  className="text-xs px-2 py-0.5 rounded-full border transition-colors"
                  style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}
                  title="프로 플랜 업그레이드"
                >
                  {dailyCount}/3
                </button>
              )}
              <span className="text-xs hidden sm:inline" style={{ color: "var(--text-secondary)" }}>
                {user.email?.split("@")[0]}
              </span>
              <button
                onClick={handleLogout}
                className="text-xs px-2 sm:px-2.5 py-1.5 rounded-lg border transition-colors"
                style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
              >
                로그아웃
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAuth(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <UserIcon />
              로그인
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          } md:translate-x-0 fixed md:static inset-y-0 left-0 z-30 w-72 border-r p-4 transition-transform duration-200 overflow-y-auto`}
          style={{ background: "var(--bg-sidebar)", borderColor: "var(--border-color)" }}
        >
          {/* Conversation history (logged in) */}
          {user && plan === "pro" && conversations.length > 0 && (
            <>
              <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                <span>💬</span> 대화 기록
              </h2>
              <div className="space-y-1 mb-4">
                {conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => loadConversation(conv.id)}
                    className={`w-full text-left text-sm p-2.5 rounded-xl transition-colors truncate ${
                      currentConvId === conv.id ? "font-medium" : ""
                    }`}
                    style={{
                      background: currentConvId === conv.id ? "var(--bg-surface-hover)" : "transparent",
                      color: "var(--text-primary)",
                    }}
                  >
                    {conv.title}
                  </button>
                ))}
              </div>
              <hr className="mb-4" style={{ borderColor: "var(--border-color)" }} />
            </>
          )}

          <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
            <span>💡</span> 예시 질문
          </h2>
          <div className="space-y-2">
            {EXAMPLE_QUESTIONS.map((q, i) => (
              <button
                key={i}
                onClick={() => sendMessage(q)}
                disabled={isLoading}
                className="w-full text-left text-sm p-3 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-transparent"
                style={{ background: "var(--bg-surface-hover)", color: "var(--text-primary)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--color-primary)";
                  e.currentTarget.style.color = "var(--color-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "transparent";
                  e.currentTarget.style.color = "var(--text-primary)";
                }}
              >
                {q}
              </button>
            ))}
          </div>
          <div className="mt-6 p-3 rounded-xl border" style={{ background: darkMode ? "#422006" : "#fffbeb", borderColor: darkMode ? "#92400e" : "#fde68a" }}>
            <p className="text-xs" style={{ color: darkMode ? "#fbbf24" : "#92400e" }}>
              <strong>면책 고지:</strong> 본 서비스는 참고용 법령 정보 안내이며, 법적 효력을 갖지 않습니다.
              정확한 법률 자문은 변호사 또는 법무사에게 문의하세요.
            </p>
          </div>
        </aside>

        {/* Sidebar overlay on mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/30 z-20 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main chat area */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto chat-scroll px-4 py-6">
            {messages.length === 0 && !streamingContent && (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="text-5xl mb-4">🏠</div>
                <h2 className="text-xl font-bold mb-2">
                  부동산 중개 법령 가이드
                </h2>
                <p className="mb-4 max-w-md" style={{ color: "var(--text-secondary)" }}>
                  공인중개사 업무에 필요한 법령 정보를<br />
                  AI가 관련 조문과 함께 안내해 드립니다.
                </p>
                {!user && (
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    <button onClick={() => setShowAuth(true)} className="text-blue-600 font-medium">로그인</button>하면
                    하루 3회 무료로 질문할 수 있습니다.
                  </p>
                )}
                {user && plan !== "pro" && (
                  <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                    오늘 남은 질문: <strong>{3 - dailyCount}회</strong> ·{" "}
                    <button onClick={() => setShowPricing(true)} className="text-blue-600 font-medium">프로 구독</button>으로 무제한 이용
                  </p>
                )}
              </div>
            )}

            <div className="max-w-3xl mx-auto space-y-4">
              {messages.map((msg, i) => (
                <div
                  key={msg.id || i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center mr-2 mt-1 text-sm" style={{ background: "var(--bg-surface-hover)" }}>
                      🏠
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                      msg.role === "user"
                        ? "bg-blue-600 text-white rounded-br-md"
                        : "rounded-bl-md shadow-sm border"
                    }`}
                    style={msg.role === "assistant" ? { background: "var(--bg-surface)", borderColor: "var(--border-color)" } : undefined}
                  >
                    {msg.role === "user" ? (
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <>
                        <MarkdownContent content={msg.content} />
                        {/* 무료 사용자 판례 안내 배너 */}
                        {user && plan !== "pro" && msg.id && !msg.content.startsWith("오류가 발생했습니다") && (
                          <button
                            onClick={() => setShowPricing(true)}
                            className="w-full mt-2 pt-2 border-t flex items-center gap-2 text-xs transition-colors"
                            style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}
                          >
                            <span>⚖️</span>
                            <span>프로 플랜에서는 <strong className="text-blue-600">관련 판례</strong>도 함께 제공됩니다</span>
                          </button>
                        )}
                        {/* Bookmark button for logged-in users */}
                        {user && msg.id && !msg.content.startsWith("오류가 발생했습니다") && (
                          <div className="flex justify-end mt-1 pt-1 border-t" style={{ borderColor: "var(--border-color)" }}>
                            <button
                              onClick={() => toggleBookmark(msg.id!)}
                              className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors"
                              style={{ color: bookmarkedIds.has(msg.id) ? "#2962ff" : "var(--text-muted)" }}
                              title={bookmarkedIds.has(msg.id) ? "북마크 해제" : "북마크 저장"}
                            >
                              <BookmarkIcon filled={bookmarkedIds.has(msg.id)} />
                              {bookmarkedIds.has(msg.id) ? "저장됨" : "북마크"}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}

              {/* Streaming message */}
              {streamingContent && (
                <div className="flex justify-start">
                  <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center mr-2 mt-1 text-sm" style={{ background: "var(--bg-surface-hover)" }}>
                    🏠
                  </div>
                  <div className="max-w-[85%] rounded-2xl rounded-bl-md px-4 py-3 shadow-sm border" style={{ background: "var(--bg-surface)", borderColor: "var(--border-color)" }}>
                    <MarkdownContent content={streamingContent} />
                    <span className="inline-block w-0.5 h-4 bg-blue-600 animate-pulse ml-0.5" />
                  </div>
                </div>
              )}

              {/* Loading indicator */}
              {isLoading && !streamingContent && (
                <div className="flex justify-start">
                  <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center mr-2 mt-1 text-sm" style={{ background: "var(--bg-surface-hover)" }}>
                    🏠
                  </div>
                  <div className="rounded-2xl rounded-bl-md px-4 py-3 shadow-sm border" style={{ background: "var(--bg-surface)", borderColor: "var(--border-color)" }}>
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1.5">
                        <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                        <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                        <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" />
                      </div>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        법령을 검색하고 있습니다...
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Error banner */}
              {error && !isLoading && (
                <div className="flex justify-center">
                  <div className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm border" style={{ background: darkMode ? "#450a0a" : "#fef2f2", borderColor: darkMode ? "#dc2626" : "#fecaca", color: darkMode ? "#fca5a5" : "#dc2626" }}>
                    <span>⚠️</span>
                    <span>{error}</span>
                    <button
                      onClick={() => {
                        setError(null);
                        if (messages.length >= 2) {
                          const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
                          if (lastUserMsg) {
                            setMessages(messages.slice(0, -1));
                            sendMessage(lastUserMsg.content);
                          }
                        }
                      }}
                      className="ml-2 underline font-medium"
                    >
                      다시 시도
                    </button>
                  </div>
                </div>
              )}

              {/* Elapsed time */}
              {elapsedTime !== null && !isLoading && messages.length > 0 && !error && (
                <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
                  ⏱️ {elapsedTime.toFixed(1)}초
                </p>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Example questions - horizontal scroll */}
          {messages.length === 0 && !streamingContent && (
            <div className="shrink-0 px-4 pt-2 pb-1" style={{ background: "var(--bg-surface)" }}>
              <div className="max-w-3xl mx-auto overflow-x-auto scrollbar-hide">
                <div className="flex gap-2 pb-1" style={{ minWidth: "max-content" }}>
                  {EXAMPLE_QUESTIONS.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(q)}
                      disabled={isLoading}
                      className="shrink-0 text-xs px-3 py-2 rounded-full border transition-colors disabled:opacity-50"
                      style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Input area */}
          <div className="border-t px-4 py-3 shrink-0" style={{ background: "var(--bg-surface)", borderColor: "var(--border-color)" }}>
            <form
              onSubmit={handleSubmit}
              className="max-w-3xl mx-auto flex items-end gap-2"
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="법령에 대해 질문해주세요..."
                rows={1}
                disabled={isLoading}
                className="flex-1 resize-none rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 max-h-32"
                style={{ minHeight: "42px", background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height = Math.min(target.scrollHeight, 128) + "px";
                }}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="shrink-0 w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <SendIcon />
              </button>
            </form>
            <p className="text-center text-xs mt-2 max-w-3xl mx-auto" style={{ color: "var(--text-muted)" }}>
              본 서비스는 참고용 법령 정보 안내이며, 법적 효력을 갖지 않습니다. 2026년 3월 기준.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
