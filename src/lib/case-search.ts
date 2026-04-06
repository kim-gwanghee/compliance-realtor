/**
 * 국가법령정보센터 판례 검색
 * https://open.law.go.kr API 연동
 */

interface CaseResult {
  caseNo: string;      // 사건번호 (예: 2023다12345)
  caseName: string;    // 사건명
  courtName: string;   // 법원명
  judgeDate: string;   // 선고일
  summary: string;     // 판례요지
}

export async function searchCases(query: string, maxResults = 3): Promise<CaseResult[]> {
  const apiKey = process.env.LAW_API_KEY;
  if (!apiKey) return [];

  try {
    // OC(인증키)를 사용하여 판례 검색
    const params = new URLSearchParams({
      OC: apiKey,
      target: "prec",
      type: "JSON",
      query,
      display: String(maxResults),
      sort: "score",
    });

    const res = await fetch(
      `https://www.law.go.kr/DRF/lawSearch.do?${params.toString()}`,
      { next: { revalidate: 3600 } } // 1시간 캐시
    );

    if (!res.ok) return [];

    const data = await res.json();

    // API 응답 구조 파싱
    const items = data?.PrecSearch?.prec;
    if (!items) return [];

    const precList = Array.isArray(items) ? items : [items];

    // 각 판례의 상세 정보(요지) 가져오기
    const results: CaseResult[] = [];
    for (const item of precList.slice(0, maxResults)) {
      const detail = await fetchCaseDetail(apiKey, item.판례일련번호);
      results.push({
        caseNo: item.사건번호 || "",
        caseName: item.사건명 || "",
        courtName: item.법원명 || "",
        judgeDate: item.선고일자 || "",
        summary: detail || item.사건명 || "",
      });
    }

    return results;
  } catch {
    return [];
  }
}

async function fetchCaseDetail(apiKey: string, precId: string): Promise<string> {
  if (!precId) return "";

  try {
    const params = new URLSearchParams({
      OC: apiKey,
      target: "prec",
      type: "JSON",
      ID: precId,
    });

    const res = await fetch(
      `https://www.law.go.kr/DRF/lawService.do?${params.toString()}`,
      { next: { revalidate: 3600 } }
    );

    if (!res.ok) return "";

    const data = await res.json();
    const prec = data?.PrecService;
    if (!prec) return "";

    // 요지를 우선 사용, 없으면 판시사항
    const summary = prec.판례내용 || prec.판시사항 || "";

    // HTML 태그 제거 및 300자로 제한
    return summary
      .replace(/<[^>]*>/g, "")
      .replace(/\n{2,}/g, "\n")
      .trim()
      .slice(0, 300);
  } catch {
    return "";
  }
}

export function buildCaseContext(cases: CaseResult[]): string {
  if (cases.length === 0) return "";

  const lines = cases.map((c, i) => {
    const date = c.judgeDate
      ? `${c.judgeDate.slice(0, 4)}.${c.judgeDate.slice(4, 6)}.${c.judgeDate.slice(6, 8)}`
      : "";
    return `#### 판례 ${i + 1}: ${c.caseNo} (${c.courtName}, ${date})
**${c.caseName}**
${c.summary}`;
  });

  return `### 관련 판례\n\n${lines.join("\n\n")}`;
}
