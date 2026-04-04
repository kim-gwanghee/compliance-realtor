"use client";

import { useState, useEffect, useCallback } from "react";
import { createSupabaseBrowser } from "@/lib/supabase";
import type { User, Session } from "@supabase/supabase-js";
import Link from "next/link";

const supabase = createSupabaseBrowser();

const CATEGORIES = ["전체", "중개실무", "계약서", "광고규정", "세금", "기타"] as const;

interface Post {
  id: string;
  nickname: string;
  title: string;
  content: string;
  category: string;
  views: number;
  created_at: string;
  reply_count: number;
  like_count: number;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return new Date(dateStr).toLocaleDateString("ko-KR");
}

function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    "중개실무": "bg-blue-100 text-blue-700",
    "계약서": "bg-green-100 text-green-700",
    "광고규정": "bg-orange-100 text-orange-700",
    "세금": "bg-purple-100 text-purple-700",
    "기타": "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[category] || colors["기타"]}`}>
      {category}
    </span>
  );
}

// ─── Write Modal ───
function WriteModal({ user, onClose, onSuccess }: { user: User; onClose: () => void; onSuccess: () => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("기타");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content, category }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "오류가 발생했습니다.");
      setLoading(false);
      return;
    }

    onSuccess();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg mx-4 rounded-2xl p-6 border shadow-xl"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border-color)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-4">질문 작성</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
          >
            {CATEGORIES.filter((c) => c !== "전체").map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="제목"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={100}
            className="w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
          />
          <textarea
            placeholder="질문 내용을 자세히 적어주세요..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            rows={6}
            className="w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
          />

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border text-sm transition-colors"
              style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
            >
              취소
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim() || !content.trim()}
              className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "작성 중..." : "등록"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Post Detail Modal ───
function PostDetail({ postId, onClose, user }: { postId: string; onClose: () => void; user: User | null }) {
  const [post, setPost] = useState<Post | null>(null);
  const [replies, setReplies] = useState<{ id: string; user_id: string; nickname: string; content: string; created_at: string }[]>([]);
  const [likeCount, setLikeCount] = useState(0);
  const [userLiked, setUserLiked] = useState(false);
  const [, setCurrentUserId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const loadPost = useCallback(async () => {
    const res = await fetch(`/api/posts/${postId}`);
    if (!res.ok) return;
    const data = await res.json();
    setPost(data.post);
    setReplies(data.replies);
    setLikeCount(data.like_count);
    setUserLiked(data.user_liked);
    setCurrentUserId(data.current_user_id);
    setLoading(false);
  }, [postId]);

  useEffect(() => {
    loadPost();
  }, [loadPost]);

  async function handleLike() {
    if (!user) return;
    const res = await fetch(`/api/posts/${postId}/like`, { method: "POST" });
    if (!res.ok) return;
    const data = await res.json();
    setUserLiked(data.liked);
    setLikeCount((prev) => prev + (data.liked ? 1 : -1));
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim() || submitting) return;
    setSubmitting(true);
    const res = await fetch(`/api/posts/${postId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: replyText }),
    });
    if (res.ok) {
      const data = await res.json();
      setReplies((prev) => [...prev, data]);
      setReplyText("");
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="p-8 rounded-2xl" style={{ background: "var(--bg-surface)" }}>
          <p style={{ color: "var(--text-secondary)" }}>로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!post) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] rounded-2xl border shadow-xl flex flex-col"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border-color)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b" style={{ borderColor: "var(--border-color)" }}>
          <div className="flex items-center gap-2 mb-2">
            <CategoryBadge category={post.category} />
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {post.nickname} · {timeAgo(post.created_at)} · 조회 {post.views}
            </span>
          </div>
          <h2 className="text-lg font-bold">{post.title}</h2>
        </div>

        {/* Content + Replies (scrollable) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{post.content}</p>

          {/* Like button */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleLike}
              disabled={!user}
              className={`flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                userLiked ? "border-blue-500 text-blue-600" : ""
              }`}
              style={!userLiked ? { borderColor: "var(--border-color)", color: "var(--text-secondary)" } : undefined}
              title={!user ? "로그인 후 이용 가능" : ""}
            >
              <span>{userLiked ? "👍" : "👍🏻"}</span>
              <span>도움됨 {likeCount > 0 ? likeCount : ""}</span>
            </button>
          </div>

          {/* Replies */}
          <div className="border-t pt-4" style={{ borderColor: "var(--border-color)" }}>
            <h3 className="text-sm font-bold mb-3">댓글 {replies.length > 0 ? replies.length : ""}</h3>
            <div className="space-y-3">
              {replies.map((r) => (
                <div key={r.id} className="text-sm p-3 rounded-xl" style={{ background: "var(--bg-main)" }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-xs">{r.nickname}</span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>{timeAgo(r.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{r.content}</p>
                </div>
              ))}
              {replies.length === 0 && (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>아직 댓글이 없습니다.</p>
              )}
            </div>
          </div>
        </div>

        {/* Reply input */}
        <div className="p-4 border-t" style={{ borderColor: "var(--border-color)" }}>
          {user ? (
            <form onSubmit={handleReply} className="flex gap-2">
              <input
                type="text"
                placeholder="댓글을 입력하세요..."
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                className="flex-1 rounded-xl border px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
              />
              <button
                type="submit"
                disabled={submitting || !replyText.trim()}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                등록
              </button>
            </form>
          ) : (
            <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
              댓글을 작성하려면 로그인이 필요합니다.
            </p>
          )}

          <button
            onClick={onClose}
            className="w-full mt-2 py-2 text-sm rounded-xl border transition-colors"
            style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Community Page ───
export default function CommunityPage() {
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [category, setCategory] = useState("전체");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showWrite, setShowWrite] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, session: Session | null) => {
      setUser(session?.user ?? null);
    });

    const stored = localStorage.getItem("theme");
    if (stored === "dark" || (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.classList.add("dark");
    }

    return () => subscription.unsubscribe();
  }, []);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ category, page: String(page) });
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    const res = await fetch(`/api/posts?${params}`);
    if (res.ok) {
      const data = await res.json();
      setPosts(data.posts);
      setTotal(data.total);
    }
    setLoading(false);
  }, [category, page, searchQuery]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-main)", color: "var(--text-primary)" }}>
      {/* Header */}
      <header className="px-4 py-3 flex items-center justify-between border-b" style={{ background: "var(--bg-surface)", borderColor: "var(--border-color)" }}>
        <div className="flex items-center gap-3">
          <Link href="/" className="text-lg font-bold flex items-center gap-2">
            <span className="text-xl">🏠</span>
            부동산 중개 법령 가이드
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="text-sm px-3 py-1.5 rounded-lg transition-colors"
            style={{ color: "var(--text-secondary)" }}
          >
            AI 상담
          </Link>
          <span className="text-sm px-3 py-1.5 rounded-lg font-medium" style={{ color: "var(--color-primary)" }}>
            커뮤니티
          </span>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Search bar */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="질문 검색..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            className="w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
          />
        </div>

        {/* Title + Write button */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">커뮤니티 Q&A</h1>
          <button
            onClick={() => user ? setShowWrite(true) : alert("로그인 후 이용 가능합니다.")}
            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            질문하기
          </button>
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => { setCategory(c); setPage(1); }}
              className={`text-sm px-3 py-1.5 rounded-full transition-colors whitespace-nowrap ${
                category === c ? "bg-blue-600 text-white" : "border"
              }`}
              style={category !== c ? { borderColor: "var(--border-color)", color: "var(--text-secondary)" } : undefined}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Post list */}
        {loading ? (
          <div className="text-center py-12" style={{ color: "var(--text-muted)" }}>로딩 중...</div>
        ) : posts.length === 0 ? (
          <div className="text-center py-12" style={{ color: "var(--text-muted)" }}>
            <p className="text-lg mb-2">아직 게시글이 없습니다</p>
            <p className="text-sm">첫 번째 질문을 작성해보세요!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {posts.map((post) => (
              <button
                key={post.id}
                onClick={() => setSelectedPostId(post.id)}
                className="w-full text-left p-4 rounded-xl border transition-colors hover:shadow-sm"
                style={{ background: "var(--bg-surface)", borderColor: "var(--border-color)" }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <CategoryBadge category={post.category} />
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {post.nickname} · {timeAgo(post.created_at)}
                  </span>
                </div>
                <h3 className="font-medium text-sm mb-1">{post.title}</h3>
                <p className="text-xs line-clamp-2" style={{ color: "var(--text-secondary)" }}>
                  {post.content}
                </p>
                <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  <span>💬 {post.reply_count}</span>
                  <span>👍 {post.like_count}</span>
                  <span>👀 {post.views}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-6">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`w-8 h-8 rounded-lg text-sm transition-colors ${
                  page === p ? "bg-blue-600 text-white" : ""
                }`}
                style={page !== p ? { color: "var(--text-secondary)" } : undefined}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showWrite && user && (
        <WriteModal user={user} onClose={() => setShowWrite(false)} onSuccess={loadPosts} />
      )}
      {selectedPostId && (
        <PostDetail postId={selectedPostId} onClose={() => setSelectedPostId(null)} user={user} />
      )}
    </div>
  );
}
