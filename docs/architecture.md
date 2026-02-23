# AI-Powered Knowledge Hub

## Multi-Source RAG SaaS Platform — Architecture Specification

**Version 2.0 | February 2026**

---

## 1. Executive Summary

This document outlines the technical architecture for a B2B SaaS platform that enables organizations to connect diverse data sources (databases, documents, SaaS tools) and interact with them through an AI-powered chatbot interface.

### 1.1 Product Vision

- Accept any data source: SQL/NoSQL databases, PDFs, Excel, Notion, Slack, Jira, ERP systems
- AI Agent finds relevant resources, summarizes content, provides exact files
- Non-technical users can easily add resources via web interface
- Embeddable chatbot widget for customer websites

### 1.2 Key Design Principles

1. **Agentic by Default:** Intelligent orchestration of multiple RAG strategies
2. **Simplicity First:** No separate backend initially; leverage Vercel + Supabase
3. **Live Data Default:** Query live databases where possible, not just indexed snapshots
4. **Multi-tenant by Design:** Logical isolation with Row Level Security

---

## 2. High-Level Architecture

### 2.1 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         PRESENTATION                            │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │   Web Dashboard  │  │ Embeddable Widget│  │  Public API  │  │
│  │   (Next.js)      │  │ (Web Component)  │  │  (Phase 4+)  │  │
│  └────────┬─────────┘  └────────┬─────────┘  └──────┬───────┘  │
└───────────┼──────────────────────┼───────────────────┼──────────┘
            │                      │                   │
            └──────────────────────┼───────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                         NEXT.JS LAYER                           │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  Server Actions  │  │  Route Handlers  │  │  Middleware  │  │
│  │  (CRUD, Upload)  │  │  (Chat Stream)   │  │  (Auth)      │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                        AGENTIC RAG SYSTEM                       │
│                     (Our Core Architecture)                     │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                  ORCHESTRATION LAYER                       │ │
│  │                                                            │ │
│  │   ┌─────────────────────┐  ┌─────────────────────────┐    │ │
│  │   │   INGESTION AGENT   │  │    RETRIEVAL AGENT      │    │ │
│  │   │                     │  │                         │    │ │
│  │   │ • Content Analysis  │  │ • Query Decomposition   │    │ │
│  │   │ • Strategy Selection│  │ • Multi-Strategy Exec   │    │ │
│  │   │ • Multi-Index       │  │ • Self-Reflection       │    │ │
│  │   │                     │  │ • Result Synthesis      │    │ │
│  │   └──────────┬──────────┘  └────────────┬────────────┘    │ │
│  │              │                          │                  │ │
│  │              └────────────┬─────────────┘                  │ │
│  │                           │                                │ │
│  │                           ▼                                │ │
│  │   ┌────────────────────────────────────────────────────┐  │ │
│  │   │           RAG STRATEGIES (Equal Level)              │  │ │
│  │   │                                                     │  │ │
│  │   │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │
│  │   │  │Vector  │ │ Code   │ │ Graph  │ │Text2SQL│ │  KAG   │ │
│  │   │  │RAG     │ │ RAG    │ │ RAG    │ │        │ │        │ │
│  │   │  │        │ │        │ │        │ │        │ │        │ │
│  │   │  │General │ │Source  │ │Entity  │ │Database│ │Logical │ │
│  │   │  │Docs    │ │Code    │ │Relations│ │Query  │ │Reasoning│ │
│  │   │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ │
│  │   │                                                     │  │ │
│  │   └────────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│    SUPABASE      │  │   TRIGGER.DEV    │  │  EXTERNAL APIs   │
│                  │  │                  │  │                  │
│ • Auth           │  │ • Doc Processing │  │ • Claude API     │
│ • Database (PG)  │  │ • Embedding Gen  │  │ • Embedding API  │
│ • Storage        │  │ • Sync Jobs      │  │                  │
│ • Edge Functions │  │ • Scheduled Runs │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
        │                                           │
        ▼                                           ▼
┌──────────────────┐                      ┌──────────────────┐
│     QDRANT       │                      │   NEO4J AURADB   │
│                  │                      │                  │
│ • Vector Store   │                      │ • Entity Nodes   │
│ • Semantic Search│                      │ • Relations      │
│                  │                      │ • Graph Queries  │
└──────────────────┘                      └──────────────────┘
```

### 2.2 Agentic RAG: Core Concept

```
┌─────────────────────────────────────────────────────────────────┐
│                 AGENTIC RAG = 시스템 전체                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   ORCHESTRATION                          │   │
│  │            (Ingestion Agent + Retrieval Agent)           │   │
│  │                                                          │   │
│  │   "이 문서는 코드가 많으니 CodeRAG로 인덱싱하자"          │   │
│  │   "이 질문은 DB 조회 + 문서 검색이 둘 다 필요하네"        │   │
│  │   "검색 결과가 부족하니 다른 전략으로 다시 검색"          │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              RAG STRATEGIES (도구들)                      │   │
│  │                                                          │   │
│  │   Agent가 선택해서 사용하는 도구들 (모두 동등한 레벨)     │   │
│  │                                                          │   │
│  │   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│  │   │VectorRAG│ │ CodeRAG │ │GraphRAG │ │Text2SQL │ │   KAG   │
│  │   │         │ │         │ │         │ │         │ │         │
│  │   │일반문서  │ │소스코드  │ │엔티티    │  │DB 직접  │ │논리적   │
│  │   │검색     │ │검색      │ │관계검색  │  │쿼리     │ │추론     │
│  │   └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
│  │                                                          │   │
│  │   사용 시점 예시:                                         │   │
│  │   • VectorRAG: "휴가 정책이 뭐야?" → 일반 문서 검색      │   │
│  │   • CodeRAG: "로그인 함수 어디있어?" → 코드 검색         │   │
│  │   • GraphRAG: "김철수 팀 프로젝트 뭐야?" → 관계 탐색     │   │
│  │   • Text2SQL: "1월 매출 얼마야?" → DB 쿼리              │   │
│  │   • KAG: "예산 1억 이상 프로젝트 중 지연된 것" → 논리추론│   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Data Flow Overview

시스템의 데이터 흐름은 크게 **Ingestion(문서 처리)** 과 **Retrieval(검색/응답)** 두 가지로 나뉩니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                    TWO MAIN DATA FLOWS                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ FLOW 1: INGESTION (문서 → 인덱스)                        │   │
│  │                                                          │   │
│  │ Document Upload → Ingestion Agent → Select Strategies    │   │
│  │                                            │              │   │
│  │                           ┌────────────────┼────────────┐ │   │
│  │                           ▼                ▼            ▼ │   │
│  │                       VectorRAG       CodeRAG      GraphRAG   │
│  │                           │                │            │ │   │
│  │                           └────────────────┴────────────┘ │   │
│  │                                       │                   │   │
│  │                               Multiple Indexes            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ FLOW 2: RETRIEVAL (질문 → 답변)                          │   │
│  │                                                          │   │
│  │ User Query → Retrieval Agent → Decompose Query           │   │
│  │                                      │                   │   │
│  │                    ┌─────────────────┼─────────────────┐ │   │
│  │                    ▼                 ▼                 ▼ │   │
│  │               Text2SQL          VectorRAG          GraphRAG  │
│  │                    │                 │                 │ │   │
│  │                    └─────────────────┼─────────────────┘ │   │
│  │                                      ▼                   │   │
│  │                              Evaluate Quality            │   │
│  │                           (Evaluation Agent)             │   │
│  │                                      │                   │   │
│  │                            ┌─────────┴─────────┐         │   │
│  │                            ▼                   ▼         │   │
│  │                      Sufficient?           Insufficient  │   │
│  │                            │                   │         │   │
│  │                            ▼                   ▼         │   │
│  │                       Synthesize         Retry with      │   │
│  │                       Response           Different       │   │
│  │                                          Strategy        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack

### 3.1 Core Stack

| Layer               | Technology            | Purpose                                  |
| ------------------- | --------------------- | ---------------------------------------- |
| **Frontend**        | Next.js (latest)      | Dashboard, server components, streaming  |
| **Hosting**         | Vercel                | Zero-config deployment, edge network     |
| **Auth**            | Supabase Auth         | Built-in auth with RLS integration       |
| **Database**        | Supabase (PostgreSQL) | App data, tenants, documents metadata    |
| **Vector DB**       | Qdrant                | Embeddings storage, semantic search      |
| **Graph DB**        | Neo4j AuraDB          | Entity relationships, GraphRAG, KAG      |
| **File Storage**    | Supabase Storage      | Document files, user uploads             |
| **Background Jobs** | Trigger.dev           | Long-running tasks, document processing  |
| **AI/LLM**          | Claude API            | Chat, reasoning, tool use, orchestration |
| **Embeddings**      | TBD (see 3.3)         | Document and query embedding             |
| **SaaS Connectors** | Nango                 | OAuth management, API unification        |
| **Doc Processing**  | Docling               | PDF, DOCX, PPTX parsing                  |
| **Code Parsing**    | Tree-sitter           | AST extraction for CodeRAG               |

### 3.2 Why This Stack?

#### No Separate Backend (Phase 1)

| Task              | Solution       | Notes                     |
| ----------------- | -------------- | ------------------------- |
| CRUD Operations   | Server Actions | Direct database calls     |
| Chat Streaming    | Route Handlers | Claude streaming response |
| Long Tasks (>60s) | Trigger.dev    | Document processing, sync |
| Webhooks          | Route Handlers | Notion, Slack callbacks   |
| Scheduled Jobs    | Trigger.dev    | Periodic sync tasks       |

#### Supabase as Unified Platform

- **Single platform:** Auth + Database + Storage + Realtime + Edge Functions
- **Row Level Security:** Multi-tenancy isolation at database level
- **Generous free tier:** $25/month Pro plan covers most MVP needs

#### Qdrant for Vector Search

- **Purpose-built:** Optimized for vector similarity search
- **Scalable:** Handles large-scale embeddings efficiently
- **Cloud option:** Qdrant Cloud for managed deployment

#### Trigger.dev for Background Jobs

- **No time limits:** Tasks can run for minutes (vs. Vercel 60s limit)
- **Automatic retries:** Built-in retry logic with exponential backoff
- **Step functions:** Break long tasks into resumable steps

### 3.3 Embedding Model (구현 시 선택)

| Model                | Platform   | Features                  | Pricing                     |
| -------------------- | ---------- | ------------------------- | --------------------------- |
| Cohere embed-v4      | Cohere API | Text only, multilingual   | Usage-based                 |
| gemini-embedding-001 | Gemini API | Text only, 100+ languages | Free tier + $0.15/1M tokens |

선택 기준: 멀티모달 필요 여부, 비용, 다국어 지원

---

## 4. Multi-Tenancy Design

### 4.1 Isolation Strategy

- **Row Level Security (RLS):** All tables filtered by `tenant_id`
- **Logical isolation:** Single database, policy-based separation
- **No cross-tenant access:** Enforced at database level

### 4.2 Key Entities

| Entity            | Purpose                           |
| ----------------- | --------------------------------- |
| **Tenants**       | Organizations using the platform  |
| **Users**         | Members of tenants with roles     |
| **Documents**     | Uploaded files and synced content |
| **Connectors**    | External data source connections  |
| **Conversations** | Chat sessions                     |
| **Messages**      | Individual chat messages          |

### 4.3 Plan Structure (향후 추가 예정)

Phase 4+ 에서 다중 Plan 구조 도입 예정:

- Plan별 기능 차등 (예: Free/Pro/Enterprise)
- 사용 가능한 RAG 전략, 쿼리 수, 커넥터 수, 저장 용량 등 제한

---

## 5. RAG Strategies

### 5.1 Strategy Overview

Agentic RAG 시스템에서 사용할 수 있는 RAG 전략들입니다. 모든 전략은 **동등한 레벨**이며, Agent가 상황에 맞게 선택합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                RAG STRATEGIES (모두 동등한 레벨)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │  VectorRAG  │ │   CodeRAG   │ │  GraphRAG   │               │
│  │             │ │             │ │             │               │
│  │ • 일반 문서 │ │ • 소스코드  │ │ • 엔티티    │               │
│  │ • PDF, DOCX│ │ • AST 파싱  │ │ • 관계 탐색 │               │
│  │ • 시맨틱   │ │ • 함수/클래스│ │ • Neo4j    │               │
│  │   검색     │ │             │ │             │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐                               │
│  │  Text2SQL   │ │     KAG     │                               │
│  │             │ │             │                               │
│  │ • DB 커넥터│ │ • 논리 추론 │                               │
│  │ • 라이브   │ │ • 복잡 조건 │                               │
│  │   쿼리     │ │ • 지식 정렬 │                               │
│  └─────────────┘ └─────────────┘                               │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  STRATEGY SELECTION GUIDE:                                      │
│                                                                 │
│  질문 유형                    → 권장 전략                        │
│  ─────────────────────────────────────────────────────          │
│  "휴가 정책이 뭐야?"          → VectorRAG                        │
│  "로그인 함수 어디있어?"       → CodeRAG                         │
│  "김철수 팀 프로젝트는?"       → GraphRAG                        │
│  "1월 매출 합계는?"           → Text2SQL                        │
│  "예산 1억 이상이면서          → KAG                             │
│   담당자가 김철수인 프로젝트"                                    │
│                                                                 │
│  복잡한 질문                  → 여러 전략 조합                   │
│  "1월 매출 기반으로            → Text2SQL + VectorRAG            │
│   마케팅 문서 찾아줘"                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 VectorRAG

일반 문서에 대한 시맨틱 검색 전략입니다.

**적합한 경우:**

- PDF, DOCX, TXT 등 일반 문서
- 정책, 가이드라인, 보고서 검색
- "~에 대해 설명해줘" 유형의 질문

**처리 방식:**

- Indexing: Document → Parse → Chunk → Embed → Store (Qdrant)
- Retrieval: Query → Embed → Similarity Search → Top-K Results

### 5.3 CodeRAG

소스코드에 대한 AST 기반 검색 전략입니다.

**적합한 경우:**

- 소스코드 파일 (.py, .ts, .java 등)
- "함수 찾아줘", "클래스 어디있어?" 유형
- 코드 구조 이해 필요 시

**처리 방식:**

- Indexing: Source → Tree-sitter Parse → Extract Elements (function/class/method) → Embed → Store
- Retrieval: Query → Semantic Search → Enrich with Context (parent/siblings)

### 5.4 GraphRAG

엔티티 관계 기반 검색 전략입니다.

**적합한 경우:**

- Notion, Confluence 등 지식베이스
- "누가", "어떤 팀", "관련된 프로젝트" 유형
- 관계 탐색이 필요한 질문

**처리 방식:**

- Indexing: Document → LLM Entity Extraction → Entity Resolution → Store (Neo4j + Qdrant)
- Retrieval: Query → Entity Detection → Graph Traversal (N-hop) + Vector Search → Merge

### 5.5 Text2SQL

데이터베이스 커넥터에 대한 SQL 생성 및 실행 전략입니다.

**적합한 경우:**

- MySQL, PostgreSQL, MongoDB 등 DB 커넥터
- "매출 얼마야?", "몇 개야?" 유형
- 집계, 필터링, 정렬이 필요한 데이터 질의

**처리 방식:**

- Indexing: DB Connection → Extract Schema → Store Metadata (schema only, not data)
- Retrieval: Query → LLM SQL Generation → Validate → Execute → Format Results

**보안 정책:**

```
┌─────────────────────────────────────────────────────────────────┐
│                    TEXT2SQL SECURITY                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User Query                                                     │
│      │                                                          │
│      ▼                                                          │
│  ┌─────────────┐                                                │
│  │ LLM         │  SQL문 생성만 담당                             │
│  │             │  실행 권한 없음                                 │
│  └──────┬──────┘                                                │
│         │ SQL string                                            │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ SYSTEM VALIDATION LAYER                                  │   │
│  │                                                          │   │
│  │ 1. Statement Type Check                                  │   │
│  │    • SELECT만 허용                                       │   │
│  │    • INSERT/UPDATE/DELETE/DROP/ALTER → 차단             │   │
│  │                                                          │   │
│  │ 2. Table/Column Allowlist                                │   │
│  │    • Tenant가 허용한 테이블만 접근 가능                  │   │
│  │    • 민감 컬럼 자동 마스킹 (옵션)                        │   │
│  │                                                          │   │
│  │ 3. Execution Limits                                      │   │
│  │    • 최대 반환 row 수                                    │   │
│  │    • 쿼리 실행 시간 제한                                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │ DB Server   │  시스템이 Read-only 연결로 실행               │
│  │             │  Tenant DB에 대한 권한 분리                    │
│  └─────────────┘                                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

| 항목        | 정책                                     |
| ----------- | ---------------------------------------- |
| 허용 SQL    | SELECT만 허용 (DML/DDL 차단)             |
| 테이블 접근 | Tenant가 명시적으로 허용한 테이블만      |
| 민감 컬럼   | Tenant 설정에 따라 마스킹 또는 차단 가능 |
| 결과 제한   | 최대 row 수 및 실행 시간 제한            |
| DB 연결     | Read-only 권한의 별도 credential 사용    |

### 5.6 KAG (Knowledge Augmented Generation)

논리적 추론 기반 검색 전략입니다.

**적합한 경우:**

- 복잡한 조건부 쿼리 ("A이면서 B인 것 중 C인 것")
- 지식 완성이 필요한 도메인 (법률, 의료, 금융)
- 환각 감소가 critical한 산업
- 다단계 논리적 추론이 필요한 경우

**GraphRAG와의 차이:**

| 구분      | GraphRAG                | KAG                                                 |
| --------- | ----------------------- | --------------------------------------------------- |
| 쿼리 유형 | "김철수 관련 프로젝트"  | "예산 1억 이상 AND 김철수 담당 AND 지연된 프로젝트" |
| 처리 방식 | 노드 → 연결된 노드 순회 | 조건별 검증 → 교집합 → 증거 첨부                    |
| 결과 형태 | 관련 엔티티 목록        | 엔티티 + 각 조건의 출처(citation)                   |

**Logical Form:**

쿼리와 지식을 구조화된 형식으로 표현:

- **Target**: 반환할 변수 (예: ?project)
- **Conditions**: AND/OR로 연결된 조건들
  - RELATION: 엔티티 간 관계
  - ATTRIBUTE: 속성 일치
  - COMPARISON: 비교 연산
  - NEGATION: 부정 조건

**Ingestion Flow:**

```
┌─────────────────────────────────────────────────────────────────┐
│                    KAG INGESTION FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Document                                                      │
│       │                                                         │
│       ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  STEP 1: Entity & Relation Extraction (LLM)             │  │
│   │                                                          │  │
│   │  문서에서 추출:                                          │  │
│   │  • Entities (타입 포함)                                  │  │
│   │  • Relations (엔티티 간 관계)                            │  │
│   │  • Attributes (엔티티의 속성값)                          │  │
│   └─────────────────────────────────────────────────────────┘  │
│       │                                                         │
│       ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  STEP 2: Convert to Logical Facts                        │  │
│   │                                                          │  │
│   │  추출 결과를 Logical Form으로 변환:                      │  │
│   │  • RELATION(subject, object)                             │  │
│   │  • ATTRIBUTE(entity, property, value)                    │  │
│   └─────────────────────────────────────────────────────────┘  │
│       │                                                         │
│       ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  STEP 3: Store in Neo4j with Provenance                  │  │
│   │                                                          │  │
│   │  각 Fact에 출처 정보 함께 저장:                          │  │
│   │  • source_document_id                                    │  │
│   │  • source_text (원문 발췌)                               │  │
│   │  • extraction_confidence                                 │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Retrieval Flow:**

```
┌─────────────────────────────────────────────────────────────────┐
│                   KAG RETRIEVAL FLOW                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   User Query                                                    │
│       │                                                         │
│       ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  STEP 1: Parse to Logical Form (LLM)                     │  │
│   │                                                          │  │
│   │  자연어 쿼리를 구조화:                                    │  │
│   │  • Target 변수 식별                                      │  │
│   │  • 조건들 추출 (RELATION, ATTRIBUTE, COMPARISON, etc.)   │  │
│   │  • AND/OR 관계 파악                                      │  │
│   └─────────────────────────────────────────────────────────┘  │
│       │                                                         │
│       ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  STEP 2: Symbolic Matching (Neo4j Cypher)                │  │
│   │                                                          │  │
│   │  Logical Form → Cypher 쿼리 변환 → 실행                  │  │
│   │  • 조건에 맞는 엔티티 검색                               │  │
│   │  • 관계 및 속성 필터링                                   │  │
│   └─────────────────────────────────────────────────────────┘  │
│       │                                                         │
│       ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  STEP 3: Knowledge Alignment (Verification)              │  │
│   │                                                          │  │
│   │  각 결과에 대해 원본 문서와 대조:                        │  │
│   │  • 조건별 Evidence 수집                                  │  │
│   │  • 숫자/문자열/관계 검증                                 │  │
│   │  • 불일치 시: 문서 값 우선 또는 검토 플래그              │  │
│   └─────────────────────────────────────────────────────────┘  │
│       │                                                         │
│       ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  STEP 4: Response with Citations                         │  │
│   │                                                          │  │
│   │  결과 반환:                                              │  │
│   │  • 조건 충족 엔티티 목록                                 │  │
│   │  • 각 조건별 출처 (document_id, excerpt)                 │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Knowledge Alignment:**

검색 결과가 원본 문서와 일치하는지 검증:

| 검증 유형   | 방법                                 |
| ----------- | ------------------------------------ |
| 숫자 비교   | 원본에서 숫자 추출 후 조건 충족 확인 |
| 문자열 일치 | 동의어 포함 매칭                     |
| 관계 존재   | 원본에서 관계 표현 확인              |
| 불일치 발견 | 문서 값 우선 또는 검토 플래그        |

**Agent 선택 기준:**

Retrieval Agent가 KAG를 선택하는 신호:

- 복수 조건 결합 (AND/OR)
- 비교 연산자 ("이상", "미만", "초과")
- 부정 조건 ("제외", "아닌")
- 증거/출처 명시 요청

---

## 6. Agentic Orchestration

### 6.1 Overview

Agentic RAG의 핵심은 **Orchestration Layer**입니다. 세 개의 Agent가 각각 역할을 담당합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                   ORCHESTRATION LAYER                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │                   INGESTION AGENT                        │  │
│   │                                                          │  │
│   │   역할: 문서를 분석하고 적절한 RAG 전략으로 인덱싱       │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │                   RETRIEVAL AGENT                        │  │
│   │                                                          │  │
│   │   역할: 쿼리를 분석하고 최적의 RAG 전략으로 검색         │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │                  EVALUATION AGENT                        │  │
│   │                                                          │  │
│   │   역할: 검색 결과 품질 평가, 재검색 필요 여부 판단       │  │
│   │   모델: Admin 설정에서 변경 가능 (기본값: Haiku)         │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Ingestion Agent

문서를 분석하고 하나 이상의 RAG 전략으로 인덱싱합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                    INGESTION AGENT FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Document Upload                                               │
│       │                                                         │
│       ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  STEP 1: CONTENT ANALYSIS                                │  │
│   │                                                          │  │
│   │  LLM이 문서 내용을 분석:                                  │  │
│   │  • 텍스트 비율                                           │  │
│   │  • 코드 블록 여부                                        │  │
│   │  • 엔티티 언급                                           │  │
│   │  • 테이블/수치 데이터                                    │  │
│   │  • 복잡한 논리 관계                                      │  │
│   └─────────────────────────────────────────────────────────┘  │
│       │                                                         │
│       ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  STEP 2: STRATEGY SELECTION                              │  │
│   │                                                          │  │
│   │  분석 결과 기반으로 전략 결정:                            │  │
│   │  ✓ VectorRAG - 텍스트 청킹 (기본)                        │  │
│   │  ✓ CodeRAG - 코드 블록 파싱 (코드 있으면)                │  │
│   │  ✓ GraphRAG - 엔티티 추출 (엔티티 5개 이상)              │  │
│   │  ✓ KAG - 논리 형식 변환 (복잡한 논리 관계 있으면)        │  │
│   └─────────────────────────────────────────────────────────┘  │
│       │                                                         │
│       ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  STEP 3: PARALLEL INDEXING                               │  │
│   │                                                          │  │
│   │  선택된 전략들로 병렬 인덱싱 수행                         │  │
│   └─────────────────────────────────────────────────────────┘  │
│       │                                                         │
│       ▼                                                         │
│   Document metadata updated with applied strategies             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Retrieval Agent

쿼리를 분석하고, 분해하고, 여러 전략을 조합해서 검색합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                   RETRIEVAL AGENT FLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   User Query                                                    │
│       │                                                         │
│       ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  STEP 1: QUERY DECOMPOSITION                             │  │
│   │                                                          │  │
│   │  LLM: 복잡한 쿼리를 하위 쿼리로 분해                      │  │
│   │  각 하위 쿼리에 적합한 전략 매핑                          │  │
│   └─────────────────────────────────────────────────────────┘  │
│       │                                                         │
│       ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  STEP 2: EXECUTION                                       │  │
│   │                                                          │  │
│   │  선택된 RAG 전략들 실행                                   │  │
│   │  결과 수집                                                │  │
│   └─────────────────────────────────────────────────────────┘  │
│       │                                                         │
│       ▼                                                         │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  STEP 3: EVALUATION (Evaluation Agent)                   │  │
│   │                                                          │  │
│   │  별도 Agent가 검색 결과 평가:                            │  │
│   │  • 관련성 평가                                           │  │
│   │  • 충분성 평가                                           │  │
│   │  • 재검색 필요 여부 판단                                 │  │
│   │                                                          │  │
│   │  (모델: Admin 설정 가능)                                 │  │
│   └─────────────────────────────────────────────────────────┘  │
│       │                                                         │
│       ├─────────── 충분 ──────────┐                            │
│       │                          │                              │
│       ▼                          ▼                              │
│   부족 → Retry                Synthesize                        │
│   (다른 전략으로              Response                          │
│    재검색)                                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.4 Agent Safety Mechanisms (구현 시 결정)

다음 항목은 구현 단계에서 구체적 값 결정:

- 최대 재시도 횟수
- 전체 처리 timeout
- 모든 전략 실패 시 fallback 응답
- 무한 루프 감지 (동일 전략 반복 선택 방지)

### 6.5 Tool Use (Claude Native)

Claude의 네이티브 Tool Use로 Agent를 구현합니다. LangChain/LangGraph 없이 직접 구현.

**Available Tools:**

| Tool                 | Purpose                            | Strategy        |
| -------------------- | ---------------------------------- | --------------- |
| `intelligent_search` | Complex queries with decomposition | Retrieval Agent |
| `search_documents`   | General document search            | VectorRAG       |
| `search_code`        | Source code search                 | CodeRAG         |
| `search_entities`    | Entity relationship search         | GraphRAG        |
| `query_database`     | Database queries                   | Text2SQL        |
| `logical_search`     | Logical constraint queries         | KAG             |

---

## 7. Data Ingestion Pipeline

### 7.1 Processing Flow

```
                        INCOMING DATA
                             │
                             ▼
                    ┌─────────────────┐
                    │ INGESTION AGENT │
                    │                 │
                    │ • 콘텐츠 분석   │
                    │ • 전략 선택     │
                    │ • 병렬 인덱싱   │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┬──────────────────┐
         │                   │                   │                  │
         ▼                   ▼                   ▼                  ▼
  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐    ┌─────────────┐
  │  VectorRAG  │     │   CodeRAG   │     │  GraphRAG   │    │    KAG      │
  │             │     │             │     │             │    │             │
  │ 텍스트 청킹   │     │ AST 파싱    │     │ 엔티티 추출   │    │ 논리 형식   │
  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘    └──────┬──────┘
         │                   │                   │                  │
         ▼                   ▼                   ▼                  ▼
       Qdrant             Qdrant          Neo4j + Qdrant     Neo4j + index
```

### 7.2 File Processing Tools

| File Type  | Parser            | Default Strategy | Agent가 추가 가능한 전략   |
| ---------- | ----------------- | ---------------- | -------------------------- |
| PDF        | Docling           | VectorRAG        | +GraphRAG, +KAG            |
| DOCX       | Docling           | VectorRAG        | +GraphRAG, +CodeRAG, +KAG  |
| PPTX       | Docling           | VectorRAG        | +GraphRAG                  |
| Excel      | pandas + openpyxl | VectorRAG        | (future: StructuredRAG)    |
| .py        | Tree-sitter       | CodeRAG          | +VectorRAG                 |
| .ts/.js    | Tree-sitter       | CodeRAG          | +VectorRAG                 |
| Notion     | Nango + LLM       | GraphRAG         | +VectorRAG, +CodeRAG, +KAG |
| Confluence | Nango + LLM       | GraphRAG         | +VectorRAG, +CodeRAG, +KAG |
| MySQL/PG   | Schema extractor  | Text2SQL         | (schema only)              |

### 7.3 SaaS Connector Sync Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│              SAAS SYNC STRATEGY (Webhook + Incremental)         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  PRIMARY: Webhook (실시간)                               │  │
│   │                                                          │  │
│   │  SaaS ──webhook──▶ /api/webhooks/{provider}              │  │
│   │                          │                               │  │
│   │                          ▼                               │  │
│   │                    Process Change                        │  │
│   │                    (생성/수정/삭제)                       │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  FALLBACK: Incremental Sync (주기적)                     │  │
│   │                                                          │  │
│   │  Trigger.dev Scheduled Job                               │  │
│   │       │                                                  │  │
│   │       ▼                                                  │  │
│   │  last_synced_at 이후 변경분만 조회                       │  │
│   │       │                                                  │  │
│   │       ▼                                                  │  │
│   │  • Webhook 유실분 보완                                   │  │
│   │  • Webhook 미지원 SaaS 대응                              │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│   삭제 처리:                                                    │
│   • Webhook: 삭제 이벤트 수신 시 즉시 처리                     │
│   • Incremental: 원본에 없는 항목 soft delete                  │
│                                                                 │
│   동기화 주기: Tenant 설정 가능 (기본값: 구현 시 결정)         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.4 Background Job Processing

Long-running tasks (document parsing, embedding generation) are handled by Trigger.dev:

- **No time limits:** Can run for minutes
- **Automatic retries:** With exponential backoff
- **Step functions:** Resumable processing
- **Observability:** Built-in logging

---

## 8. Conversation Management

### 8.1 Context Management

```
┌─────────────────────────────────────────────────────────────────┐
│                CONVERSATION CONTEXT MANAGEMENT                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   기본 동작:                                                    │
│   • 전체 대화 히스토리를 LLM에 전송                             │
│   • 캐싱 없음                                                   │
│                                                                 │
│   컨텍스트 한계 도달 시:                                        │
│   • 자동 요약(compaction) 수행                                  │
│   • 오래된 메시지를 요약본으로 대체                             │
│   • 최근 메시지는 원본 유지                                     │
│                                                                 │
│   구현 세부사항 (구현 시 결정):                                 │
│   • Compaction 트리거 threshold                                │
│   • 요약 시 보존할 최근 메시지 수                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Citation Support

RAG 응답에서 출처(Citation) 표시 지원. 상세 구현은 구현 시 결정.

---

## 9. Embeddable Chat Widget

### 9.1 Widget Architecture

```
CUSTOMER'S WEBSITE                    YOUR INFRASTRUCTURE

┌─────────────────────────┐          ┌─────────────────────┐
│                         │          │                     │
│  <script src="widget.js"│────────▶│  Vercel CDN        │
│   data-key="wpk_xxx"/>  │          │  (widget bundle)    │
│                         │          │                     │
│  ┌───────────────────┐  │          └─────────────────────┘
│  │                   │  │                    │
│  │   Shadow DOM      │  │                    │
│  │   (Isolated)      │  │                    │
│  │                   │  │                    │
│  │  ┌─────────────┐  │  │          ┌─────────────────────┐
│  │  │ Chat UI     │  │──┼─────────▶│  /api/widget/chat   │
│  │  │ (Preact)    │  │  │  REST/   │                     │
│  │  └─────────────┘  │  │  Stream  │  • Verify tenant    │
│  │                   │  │          │  • Retrieval Agent  │
│  └───────────────────┘  │          │  • Stream response  │
│                         │          │                     │
└─────────────────────────┘          └─────────────────────┘
```

### 9.2 Widget Tech Stack

| Component     | Choice            | Reason                        |
| ------------- | ----------------- | ----------------------------- |
| Framework     | Preact            | 3KB gzipped, React-compatible |
| Styling       | CSS-in-JS         | No conflicts with host styles |
| Isolation     | Shadow DOM        | Complete isolation            |
| Communication | Fetch + Streaming | Native browser APIs           |
| Bundle Size   | < 15KB gzipped    | Fast load                     |

### 9.3 Widget Security

```
┌─────────────────────────────────────────────────────────────────┐
│                    WIDGET SECURITY                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SETUP (Dashboard):                                             │
│  • Tenant가 허용 도메인 등록 (allowed_origins)                  │
│  • Public Key 발급 (widget에 노출)                              │
│  • Secret Key 발급 (서버 보관, 토큰 생성용)                     │
│                                                                 │
│  RUNTIME:                                                       │
│  ┌───────────────────┐         ┌────────────────────────────┐  │
│  │ Customer Website  │         │ Your API                    │  │
│  │                   │         │                             │  │
│  │ Widget Load ──────┼────1───▶│ /api/widget/init            │  │
│  │                   │         │ • Verify Origin header      │  │
│  │                   │◀───2────│ • Verify public_key         │  │
│  │ (session_token)   │         │ • Issue session_token (1hr) │  │
│  │                   │         │                             │  │
│  │ Chat Request ─────┼────3───▶│ /api/widget/chat            │  │
│  │                   │         │ • Verify session_token      │  │
│  │                   │         │ • Verify Origin matches     │  │
│  │                   │◀───4────│ • Rate limit check          │  │
│  │ (stream response) │         │ • Stream response           │  │
│  └───────────────────┘         └────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**검증 항목:**

| 단계 | 검증 내용                                                  |
| ---- | ---------------------------------------------------------- |
| Init | Origin 헤더 존재 여부, Public key 유효성, 도메인 허용 여부 |
| Chat | Session token 유효성, Origin 일치 여부, Rate limit         |

**Rate Limiting:**

- 분당 요청 수 제한 (Tenant 설정 가능)
- 일일 요청 수 제한 (Tenant 설정 가능)
- Client IP 기반 추적

---

## 10. Data Management

### 10.1 Deletion Policy

**Soft Delete + 보존 기간:**

- 삭제 요청 시 즉시 삭제하지 않고 삭제 표시
- 보존 기간 동안 복구 가능
- 보존 기간 후 영구 삭제 (원본 파일, 청크, 임베딩, 그래프 노드)
- 기본 보존 기간: 구현 시 결정

### 10.2 Error Handling

**장애 시 Fallback 없이 에러 반환:**

| 구성요소   | 장애 시 동작                       |
| ---------- | ---------------------------------- |
| Claude API | 에러 반환, 사용자에게 알림         |
| Neo4j      | 에러 반환 (GraphRAG/KAG 사용 불가) |
| Qdrant     | 에러 반환 (VectorRAG 사용 불가)    |
| Tenant DB  | 에러 반환 (Text2SQL 사용 불가)     |

---

## 11. Monitoring (Phase 2)

```
┌─────────────────────────────────────────────────────────────────┐
│                    MONITORING ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  수집 대상                                               │  │
│   │                                                          │  │
│   │  • 에러 로깅 (Vercel/Trigger.dev 기본)                   │  │
│   │  • Agent 행동 추적                                       │  │
│   │    - 선택된 RAG 전략                                     │  │
│   │    - Evaluation 결과                                     │  │
│   │    - 재시도 횟수 및 사유                                 │  │
│   │  • LLM 호출 비용 추적                                    │  │
│   │    - 모델별 토큰 사용량                                  │  │
│   │    - 요청당 비용                                         │  │
│   │    - Tenant별 비용 집계                                  │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  도구 옵션 (구현 시 결정)                                │  │
│   │                                                          │  │
│   │  • Langfuse (오픈소스, self-host 가능)                   │  │
│   │  • Helicone (SaaS)                                       │  │
│   │  • 자체 구현 (Supabase 테이블 + Dashboard)              │  │
│   └─────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 12. Implementation Phases

### 12.1 Phase Overview

```
PHASE 1 (Month 1-2)         PHASE 2 (Month 3-4)         PHASE 3 (Month 5-6)
Foundation                  Multi-Strategy               Full Agentic

┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│                     │    │                     │    │                     │
│ • Auth + Multi-tenant│   │ • CodeRAG           │    │ • GraphRAG          │
│ • File Upload       │    │ • Text2SQL          │    │ • KAG (optional)    │
│ • VectorRAG         │    │ • SaaS Connectors   │    │ • Ingestion Agent   │
│ • Simple Router     │    │ • Basic Agent       │    │ • Retrieval Agent   │
│ • Basic Chat        │    │ • Monitoring        │    │ • Full Orchestration│
│ • Basic Widget      │    │                     │    │                     │
│                     │    │                     │    │                     │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
         │                          │                          │
         ▼                          ▼                          ▼
   VectorRAG Only             + Code + SQL               Full Agentic RAG
```

### 12.2 Phase 1: Foundation (Month 1-2)

**Goals:**

- Basic infrastructure (Auth, Database, Storage)
- VectorRAG implementation with Qdrant
- Simple chat interface
- Basic embeddable widget with security

**Deliverable:** Working prototype with document upload and vector search

### 12.3 Phase 2: Multi-Strategy (Month 3-4)

**Goals:**

- CodeRAG with Tree-sitter
- Text2SQL with DB connectors (security policies applied)
- SaaS connectors (Notion, Slack) with webhook + incremental sync
- Basic Ingestion/Retrieval Agent
- Monitoring infrastructure

**Deliverable:** Multiple RAG strategies, basic orchestration, monitoring

### 12.4 Phase 3: Full Agentic (Month 5-6)

**Goals:**

- GraphRAG with Neo4j
- KAG (optional, based on customer needs)
- Full Ingestion Agent (content analysis, multi-strategy)
- Full Retrieval Agent (decomposition, evaluation, retry)
- Evaluation Agent with configurable model

**Deliverable:** Production-ready Agentic RAG system

### 12.5 Phase 4+: Enterprise (Month 7+)

**Potential additions:**

- Public API (Enterprise Plan only)
- Multi-tier Plan structure
- On-premise deployment (Docker)
- Custom connector SDK
- White-label support
- Local LLM option (Ollama)
- SOC2 compliance

---

## 13. Cost Estimation

### 13.1 Monthly Infrastructure

| Service       | Phase 1      | Phase 2       | Phase 3+      |
| ------------- | ------------ | ------------- | ------------- |
| Vercel Pro    | $20          | $20           | $20-50        |
| Supabase Pro  | $25          | $25           | $75-200       |
| Qdrant Cloud  | $25-50       | $50-100       | $100-300      |
| Neo4j AuraDB  | -            | -             | $65+          |
| Trigger.dev   | $0-30        | $30-50        | $50-100       |
| Claude API    | ~$100-300    | $300-800      | $500-2000     |
| Embedding API | ~$10-50      | $50-150       | $100-400      |
| **TOTAL**     | **$180-475** | **$475-1145** | **$910-3050** |

### 13.2 LLM Model Strategy

| Use Case            | Model         | Cost          | Reason                             |
| ------------------- | ------------- | ------------- | ---------------------------------- |
| Primary Chat        | Claude Sonnet | $3/$15 per 1M | Quality/cost balance               |
| Query Decomposition | Claude Sonnet | $3/$15 per 1M | Complex reasoning                  |
| Classification      | Claude Haiku  | $0.25/$1.25   | Fast, cheap                        |
| Quality Evaluation  | Claude Haiku  | $0.25/$1.25   | Quick scoring (Admin configurable) |
| Entity Extraction   | Claude Sonnet | $3/$15 per 1M | Accuracy critical                  |

### 13.3 Cost Optimization

1. **Model tiering:** Haiku for classification/evaluation, Sonnet for generation
2. **Batch processing:** Group embedding requests
3. **Agent short-circuit:** Simple queries → direct strategy (skip decomposition)
4. **Selective strategies:** KAG only when explicitly needed

---

## 14. Decision Summary

| Decision           | Choice                      | Rationale                               |
| ------------------ | --------------------------- | --------------------------------------- |
| **Architecture**   | **Agentic RAG**             | Intelligent orchestration of strategies |
| Frontend           | Next.js                     | Best DX, serverless                     |
| Hosting            | Vercel                      | Zero-config                             |
| Database           | Supabase                    | Unified platform                        |
| **Vector DB**      | **Qdrant**                  | Purpose-built, scalable                 |
| Graph DB           | Neo4j AuraDB                | Industry standard                       |
| LLM                | Claude API                  | Native tool use                         |
| **Orchestration**  | **3 Agents**                | Ingestion, Retrieval, Evaluation        |
| **RAG Strategies** | **5 Equal Options**         | Vector, Code, Graph, SQL, KAG           |
| Embeddings         | TBD (3 options)             | 구현 시 선택                            |
| No LangChain       | Claude Native               | Simpler, less abstraction               |
| **Caching**        | **None**                    | Simplicity                              |
| **Error Handling** | **No Fallback**             | 에러 반환                               |
| Widget Security    | Origin + Token + Rate Limit | Multi-layer protection                  |
| Sync Strategy      | Webhook + Incremental       | Real-time + Fallback                    |
| Deletion           | Soft Delete + Retention     | 복구 가능                               |
| Public API         | Phase 4+ Enterprise only    | 향후 추가                               |

---

## Appendix: Agentic vs Non-Agentic RAG

```
┌─────────────────────────────────────────────────────────────────┐
│                NON-AGENTIC RAG                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Query → Router → Single Strategy → Results → LLM → Response   │
│                                                                 │
│   한계:                                                          │
│   • 복잡한 쿼리 처리 불가                                        │
│   • 결과 품질 보장 없음                                          │
│   • 단일 전략만 사용                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 AGENTIC RAG (Our System)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   INGESTION:                                                    │
│   Document → Agent → Analyze → Select Strategies → Multi-Index  │
│                                                                 │
│   RETRIEVAL:                                                    │
│   Query → Agent → Decompose → Execute → Evaluate → Synthesize   │
│                                  │          │                   │
│                                  ▼          │                   │
│                          Multi-Strategy     │                   │
│                                  │          │                   │
│                                  ▼          │                   │
│                        Evaluation Agent ────┘                   │
│                           (Insufficient? → Retry)               │
│                                  │                              │
│                                  ▼                              │
│                              Response                           │
│                                                                 │
│   장점:                                                          │
│   • 문서 특성에 맞는 인덱싱                                      │
│   • 쿼리 복잡도에 맞는 검색                                      │
│   • 자동 품질 평가 및 재시도                                     │
│   • 여러 전략 조합 가능                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

_— End of Document —_
