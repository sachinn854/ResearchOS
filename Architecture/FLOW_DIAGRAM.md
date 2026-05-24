# ResearchOS — Flow Diagrams

---

## 1. Main System Flow

```mermaid
flowchart TD
    A([User Query]) --> B[Query Expansion]
    A --> C[HyDE Generation]
    A --> D[Sub-query Decomposition]

    B --> E[Dense Retrieval - Qdrant]
    C --> E
    D --> E
    B --> F[Sparse Retrieval - BM25]
    C --> F
    D --> F

    E --> G[RRF Fusion]
    F --> G
    G --> H[Cross-Encoder Reranking]
    H --> I{Confidence OK?}

    I -->|Yes| L[LangGraph Orchestrator]
    I -->|No| J[Web Search Agent]

    J --> K[Ingest into KB]
    K --> L

    L --> M[Planner Agent]
    M --> N[Citation Verifier]
    N --> O[Contradiction Detector]
    O --> P[Report Generator]

    P --> Q([Streaming Response])
```

---

## 2. Document Ingestion Pipeline

```mermaid
flowchart TD
    A([Document Upload]) --> B{File Type?}

    B -->|PDF| C[PyMuPDF]
    B -->|DOCX| D[python-docx]
    B -->|HTML| E[Trafilatura]
    B -->|Markdown| F[markdown-it]

    C --> G[Text Cleaning]
    D --> G
    E --> G
    F --> G

    G --> H{Chunking Strategy}

    H -->|Default| I[Parent-Child Chunking]
    H -->|Semantic| J[Semantic Chunking]
    H -->|Simple| K[Recursive Chunking]

    I --> L[Metadata Extraction]
    J --> L
    K --> L

    L --> M{Hash Exists?}
    M -->|Cache Hit| P[Skip]
    M -->|Cache Miss| N[Batch Embedding]

    N --> O[Store Hash in Redis]
    O --> Q[Store in Qdrant]
    L --> R[Store in PostgreSQL]
    A --> S[Store file in S3]
```

---

## 3. Retrieval Pipeline

```mermaid
flowchart TD
    A([Query]) --> B[Embed Query]
    A --> C[Tokenize Query]

    subgraph Stage1["Stage 1 — Candidate Fetch"]
        B --> D[Qdrant HNSW Search<br/>Top 20]
        C --> E[PostgreSQL BM25<br/>Top 20]
    end

    subgraph Stage2["Stage 2 — Fusion"]
        D --> F[RRF Merge]
        E --> F
        F --> G[Top 20 Unique]
    end

    subgraph Stage3["Stage 3 — Rerank"]
        G --> H[Cross-Encoder Score]
        H --> I[Top 5 Final]
    end

    I --> J[Confidence Score]
    J --> K{Score >= 0.65?}

    K -->|Yes| L([Send to Agents])
    K -->|No| M([Trigger Web Search])
```

---

## 4. Async Task Queue

```mermaid
flowchart LR
    A([API Request]) --> B[FastAPI Handler]
    B --> C([Immediate Response])
    B --> D[Push to Redis Queue]

    D --> E{Priority?}
    E -->|High| F[Query Queue]
    E -->|Normal| G[Ingestion Queue]
    E -->|Low| H[Refresh Queue]

    F --> I[Worker 1]
    G --> J[Worker 2]
    G --> K[Worker 3]
    H --> L[Worker 4]

    I --> M[(Qdrant / Postgres)]
    J --> M
    K --> M
    L --> M
```

---

## 5. Adaptive KB — Self-Improving RAG

> Web se jo raw content aaya wo seedha LLM ko milta hai current response ke liye.
> Ingestion background mein hota hai — current request block nahi hoti.

```mermaid
flowchart TD
    A([User Query]) --> B[Search Internal KB]

    subgraph Check["Confidence Evaluation"]
        B --> C[Similarity Score]
        B --> D[Chunk Count]
        B --> E[Freshness Check]
        B --> F[Source Authority]
        C & D & E & F --> G[Final Confidence Score]
    end

    G --> H{Score >= 0.65?}

    H -->|Strong Knowledge| I[Use KB Context]
    H -->|Weak / Missing| J[Web Search Agent]

    J --> K[Fetch Raw Documents]

    K -->|FAST PATH - current request| I
    K -->|FIRE AND FORGET - background| L

    subgraph BG["Background - Celery Worker"]
        L[Celery Task Queued] --> M[Clean Text]
        M --> N[Chunk]
        N --> O[Embed]
        O --> P[(Store in Qdrant KB)]
    end

    I --> Q[LLM Generation]
    Q --> R([Streaming Response])

    P -.->|Next time - direct KB hit| S([No Web Call Needed])
```

---

## 6. LangGraph Agent States

```mermaid
stateDiagram-v2
    [*] --> Planner

    Planner --> Retriever : sub-queries ready

    Retriever --> WebSearch : confidence low
    Retriever --> CitationVerifier : confidence ok

    WebSearch --> Retriever : KB updated

    CitationVerifier --> ContradictionDetector
    ContradictionDetector --> ReportGenerator

    ReportGenerator --> [*]
```
