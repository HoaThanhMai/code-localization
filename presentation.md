# Code Locator
### Phân tích bug thông minh trong phần mềm phân tầng

---

## Slide 1 — Bài toán

### Tìm bug trong phần mềm phân tầng rất khó

- Source code chia thành **nhiều tầng**: phần cứng → driver → giao diện → dịch vụ → ứng dụng
- Một luồng xử lý có thể đi qua **5–7 module** khác nhau, mỗi module do một nhóm phát triển
- Bug thường **không nằm ở chỗ phát sinh triệu chứng** mà ở tầng thấp hơn hoặc cao hơn
- Review thủ công: mất hàng giờ để trace qua từng file, hiểu ngữ cảnh và quan hệ giữa các module

> **Ví dụ thực tế:** Ứng dụng gửi dữ liệu qua giao tiếp ngoại vi nhưng không bao giờ nhận được phản hồi.
> Nguyên nhân? Lỗi nằm sâu 3 tầng bên dưới — ở driver phần cứng — và bị che giấu bởi một giá trị trả về bị bỏ qua.

---

## Slide 2 — Thách thức cụ thể

| Thách thức | Mô tả |
|---|---|
| **Codebase lớn & phân tán** | Hàng trăm file `.c/.h`, nhiều module lồng nhau |
| **Quan hệ ngầm** | Module A gọi Module B qua callback, không có import trực tiếp |
| **Bug xuyên tầng** | Lỗi race condition giữa 2 task khác ưu tiên, lỗi state machine thiếu trạng thái |
| **Kiến thức chuyên ngành** | Cần hiểu spec của hệ thống, cơ chế timeout, critical section, trạng thái lỗi... |
| **Review mất thời gian** | Trace 1 luồng xử lý thủ công: 30–60 phút. Phân tích bug: nhiều giờ |

---

## Slide 3 — Giải pháp

### VS Code Extension + AI Agent

Kết hợp 3 thành phần:

```
┌─────────────────────────────────────────────┐
│  GitNexus Knowledge Graph                    │
│  "Hiểu cấu trúc & quan hệ giữa các module" │
│  → Ai gọi ai? Luồng xử lý đi đường nào?    │
└──────────────────┬──────────────────────────┘
                   │
         ┌─────────▼─────────┐
         │   AI Agent Loop    │
         │  powered by        │
         │  Copilot LM API    │
         └─────────┬─────────┘
                   │
      ┌────────────▼────────────┐
      │    Bug Report Output     │
      │  Suspect points, Impact, │
      │  Test checklist, Fix     │
      └─────────────────────────┘
```

- **Knowledge Graph** (GitNexus): Hiểu cấu trúc & quan hệ giữa các module — ai gọi ai, luồng xử lý đi đường nào
- **Copilot LM API** (`vscode.lm`): Cốt lõi của agent — cung cấp khả năng suy luận ngôn ngữ tự nhiên ngay trong VS Code, **không cần API key ngoài, không cần deploy model**
- **Agent Loop**: Kết dính hai thành phần trên — dùng LLM để lập kế hoạch, gọi knowledge graph để thu thập dữ liệu, rồi dùng LLM để phân tích

### Tại sao dùng Copilot LM API?

| | API bên ngoài (OpenAI, Claude...) | **Copilot LM API** |
|---|---|---|
| Cần API key | Có | **Không** — dùng license Copilot có sẵn |
| Chi phí riêng | Có (pay per token) | **Không** — đã bao gồm trong Copilot |
| Chạy offline/trong firewall | Khó | **Tích hợp sẵn** trong VS Code |
| Truy cập nhiều model | Tự quản lý | **vscode.lm** — chọn model qua dropdown |
| Tích hợp với extension | Tự build HTTP client | **Native API** — `sendRequest()` trả về stream |

> Extension tận dụng hoàn toàn hạ tầng AI có sẵn của VS Code — developer chỉ cần cài extension, không cần setup thêm gì.

> **Tại sao cần đồ thị tri thức thay vì chỉ tìm kiếm text?**
> Grep/search chỉ tìm chuỗi ký tự. Đồ thị tri thức hiểu được "A gọi B qua callback", "luồng xử lý đi qua 5 module" — thông tin mà tìm kiếm text không thể cung cấp.

---

## Slide 4 — Cách hoạt động

### Pipeline phân tích

```
Câu hỏi ──► Phase 1     ──► Phase 2                    ──► Narrative
của user     Tìm kiếm        Inline Multi-Turn               (song song)
             ban đầu         Conversation
                             (plan → tools → plan → ... → analysis)
```

**Phase 1 — Tìm kiếm ban đầu**
Truy vấn đồ thị tri thức để tìm các module, hàm, luồng xử lý liên quan đến câu hỏi.

**Phase 2 — Inline Agent Conversation (giống Pure Copilot)**
Thay vì mỗi vòng lặp là 1 LLM call riêng biệt (cold start), extension dùng **1 cuộc hội thoại đa lượt liên tục**:
- Turn 1: LLM nhận evidence → quyết định gọi tool nào → tools thực thi song song
- Turn 2: Kết quả tool được đưa vào conversation → LLM tiếp tục suy luận
- Turn cuối: LLM tự tổng hợp analysis trực tiếp trong response — không cần LLM call riêng

Agent có 2 nhóm công cụ:
- **Navigate** (đồ thị tri thức): tìm module liên quan, trace luồng xử lý, xem ai gọi ai
- **Analyze** (đọc source code): khi đã biết nghi vấn ở đâu, đọc code thật để thấy logic cụ thể

**Narrative answer** chạy song song với turn cuối — plain text riêng, dễ đọc hơn JSON.

---

## Slide 5 — Inline Multi-Turn: Chạy như Pure Copilot

### Bài toán: Agent loop truyền thống quá chậm

Cách cũ: mỗi vòng lặp = 1 LLM call riêng biệt (cold start), phải serialize lại toàn bộ evidence.
Pure Copilot: 1 cuộc hội thoại liên tục, LLM giữ nguyên context.

### Giải pháp: Multi-Turn Conversation

```
TRƯỚC (5 LLM calls riêng biệt):
Query → Plan₁ → Tools → Plan₂ → Tools → Plan₃ → Synthesis → Narrative
       ~~~~~~          ~~~~~~          ~~~~~~    ~~~~~~~~~~   ~~~~~~~~~
       cold start      cold start      cold start  separate     separate
                                               Total: ~20-30s

SAU (3 turns trong 1 conversation + narrative song song):
Query → Turn₁ (plan) → tools → Turn₂ (plan) → tools → Turn₃ (analysis!)
                                                        + Narrative ⫲
        ~~~~~~~~~~~~           ~~~~~~~~~~~~            ~~~~~~~~~~~~~~~
        LLM giữ context →→→→→→ tiếp tục suy luận →→→→ trả analysis trực tiếp
                                               Total: ~12-18s
```

**Lợi ích chính:**
1. **Context liên tục** — LLM thấy toàn bộ chain of thought, không cần đọc lại evidence
2. **Analysis inline** — Turn cuối trả analysis trực tiếp, bỏ 1 LLM call riêng
3. **Early exit** — Nếu turn 1 đã đủ evidence, LLM set `done=true` → chỉ 1 turn + narrative = **2 LLM calls**
4. **Auto-read** — Source files từ graph results được đọc tự động, không cần LLM quyết định

> Giữ nguyên agent loop (AI tự quyết định gọi tool nào) nhưng chạy **inline giống Pure Copilot**.

---

## Slide 6 — Output của Extension

### Báo cáo phân tích bug gồm:

```
┌─────────────────────────────────────────────┐
│  📋 Narrative Answer                         │
│  Giải thích bằng văn bản tự nhiên            │
├─────────────────────────────────────────────┤
│  🔍 Execution Trace                          │
│  Luồng xử lý liên quan (từ App → Hardware)  │
├─────────────────────────────────────────────┤
│  ⚠️ Suspect Points                           │
│  Danh sách điểm nghi ngờ + mức nghiêm trọng │
├─────────────────────────────────────────────┤
│  💥 Blast Radius                             │
│  Bao nhiêu module/hàm bị ảnh hưởng?         │
├─────────────────────────────────────────────┤
│  📝 Suggestions & Fix                        │
│  Gợi ý cách sửa + giải thích                │
├─────────────────────────────────────────────┤
│  ✅ Test Checklist                            │
│  Danh sách test case cần kiểm tra            │
└─────────────────────────────────────────────┘
```

---

## Slide 7 — So sánh

| | Review thủ công | Code Locator |
|---|---|---|
| **Trace luồng xử lý** | Mở từng file, tìm hàm gọi, đi theo callback | Tự động trace qua đồ thị |
| **Tìm bug xuyên tầng** | Phải hiểu cả stack, dễ bỏ sót | Agent tự khám phá đa tầng |
| **Đánh giá ảnh hưởng** | Grep + kinh nghiệm | Blast radius từ knowledge graph |
| **Thời gian** | 30 phút – vài giờ / bug | Vài chục giây |
| **Yêu cầu chuyên môn** | Cần expert hiểu toàn bộ hệ thống | Kiến thức chuyên ngành được nhúng trong prompt |

---

## Slide 8 — Kiến trúc kỹ thuật

```
┌──────────────────────────────────────────────────────┐
│                  VS Code Extension                    │
│                                                       │
│  ┌─────────────┐    ┌──────────────┐                 │
│  │  WebView UI  │◄──│  Panel.ts    │                 │
│  │  (HTML/CSS)  │    └──────┬───────┘                 │
│  └─────────────┘           │                          │
│                    ┌───────▼────────┐                 │
│                    │  QueryEngine   │                 │
│                    │  (Inline       │                 │
│                    │  Multi-Turn)   │                 │
│                    └─┬──────┬────┬──┘                 │
│                      │      │    │                    │
│         ┌────────────▼┐  ┌──▼────┴───────────┐       │
│         │  GitNexus    │  │  Copilot LM       │       │
│         │  Service     │  │  Service           │       │
│         │  (MCP SDK)   │  │  (vscode.lm API)  │       │
│         └──────┬───────┘  └──────────────────┘       │
│                │                                      │
│         ┌──────▼───────┐                              │
│         │  read_file   │ ← Đọc source code thật      │
│         │  (local I/O) │   từ workspace               │
│         └──────────────┘                              │
│                   │                                   │
└───────────────────┼───────────────────────────────────┘
                    │ stdio
          ┌─────────▼─────────┐
          │  GitNexus MCP     │
          │  Server           │
          │  (Knowledge Graph)│
          └───────────────────┘
```

---

## Slide 9 — Độ tin cậy

### "Làm sao biết kết quả AI trả về là đúng?"

**1. Dữ liệu đầu vào là sự thật, không phải suy đoán**
Đồ thị tri thức được xây từ phân tích tĩnh source code thực. "Module A gọi Module B" là fact — không phải AI tự bịa ra.

**2. Mọi bước suy luận đều ghi lại và truy ngược được**
Toàn bộ quá trình agent được lưu trong **Agent Trace**: mỗi vòng lặp đã hỏi gì, nhận được gì, kết luận gì. Người dùng đọc trace như đọc "bài giải" — không chỉ thấy đáp án mà thấy cả cách làm.

**3. Kết quả chỉ đến vị trí cụ thể trong code**
Mỗi suspect point trỏ đến **file + dòng cụ thể**. Developer mở lên là xác nhận được ngay trong 10 giây. AI không nói chung chung "có bug ở đâu đó" — nó khoanh vùng chính xác.

**4. Công cụ hỗ trợ, không thay thế**
Mục đích: **thu hẹp phạm vi tìm kiếm** từ 17 file xuống 2-3 điểm đáng nghi. Quyết định cuối cùng vẫn là con người. Thay vì đọc toàn bộ codebase, developer chỉ cần review những chỗ AI đã đánh dấu.

```
Không dùng tool:    📁📁📁📁📁📁📁📁📁📁📁📁📁📁📁📁📁  (17 file)
                    "Bug ở đâu? Tôi không biết bắt đầu từ đâu"

Dùng tool:          📁📁 ⚠️⚠️ 📁📁📁📁📁📁📁📁📁📁📁📁📁
                    "Xem 2 chỗ này — AI nghĩ vấn đề nằm ở đây"
```

---

## Slide 10 — Hạn chế & Hướng phát triển

### Tại sao không dùng Clangd?

**Clangd** (Language Server cho C/C++) rất mạnh ở mức **từng symbol**: nhảy đến định nghĩa, tìm reference, phân tích AST. Tuy nhiên:

| Khả năng | Clangd | Knowledge Graph (GitNexus) |
|---|---|---|
| Tìm định nghĩa / reference | Rất mạnh | Có |
| Trace luồng xử lý xuyên nhiều module | Không | **Có** — execution flows |
| Đánh giá phạm vi ảnh hưởng (blast radius) | Không | **Có** — tính transitive |
| Phân nhóm module theo chức năng | Không | **Có** — cluster analysis |
| Tích hợp với LLM agent qua MCP | Không | **Có** — tool calls |

> Clangd trả lời "hàm A được gọi ở đâu?" rất tốt.
> Nhưng không trả lời được "nếu hàm A bị lỗi, những luồng xử lý nào bị ảnh hưởng?"

### Nhược điểm của GitNexus

- **Index bị cũ** khi code thay đổi — cần chạy lại phân tích (mất vài giây đến vài phút)
- **Chỉ phân tích tĩnh** — không hiểu hành vi runtime (giá trị biến, điều kiện if/else thực tế)
- **Có thể bỏ sót quan hệ** qua function pointer hoặc macro phức tạp
- **Phụ thuộc công cụ bên thứ ba** — không kiểm soát được chất lượng đồ thị

### Hướng phát triển

- Kết hợp **Clangd + Knowledge Graph**: dùng Clangd cho phân tích AST chính xác, dùng graph cho execution flow
- Thêm **tự động re-index** khi file thay đổi (file watcher)
- Hỗ trợ nhiều ngôn ngữ hơn (hiện tại tập trung vào C/C++)

---

## Slide 11 — Tổng kết

### Đóng góp chính

1. **Agent-based bug analysis** — AI tự lập kế hoạch khám phá codebase thay vì dựa vào luật cứng
2. **Knowledge graph + LLM** — Kết hợp hiểu biết cấu trúc (graph) với khả năng suy luận (LLM)
3. **Dynamic iteration budget** — Tự điều chỉnh mức độ khám phá theo độ phức tạp
4. **Domain-specific prompts** — Nhúng kiến thức chuyên ngành vào prompt để phân tích chính xác

### Kết quả

- Phát hiện chính xác các lỗi xuyên tầng trong codebase phân tầng
- Phân loại đúng mức nghiêm trọng
- Đề xuất cách sửa phù hợp với kiến trúc hệ thống
- Thời gian phân tích: **< 30 giây / bug**

---

## Q&A
