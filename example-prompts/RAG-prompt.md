> This is an original example prompt from https://github.com/coleam00/adversarial-dev

Build a full-stack RAG (Retrieval-Augmented Generation) chat application that looks and feels like a premium AI chat platform (similar to ChatGPT or Claude.ai). The app should allow users to ask questions over ingested YouTube video content from a creator's channel, with full conversation management and history.

## Tech Stack

- Frontend: React + Vite + TypeScript + Tailwind CSS
- Backend: Python + FastAPI (handles API routes, RAG pipeline, Docling chunking, and LLM calls — all in one process)
- Database: SQLite via aiosqlite (design the database layer with a clean repository pattern so it can be swapped to Postgres later without changing business logic)
- Embeddings: Use OpenRouter's embeddings API (POST https://openrouter.ai/api/v1/embeddings) with model ID "openai/text-embedding-3-small". Use the same OPENROUTER_API_KEY for both chat completions and embeddings.
- LLM: OpenRouter API (base URL: https://openrouter.ai/api/v1) using model ID "anthropic/claude-sonnet-4.6" for chat completions. The API key is stored in the .env file at the ABSOLUTE path C:/Users/colem/open-source/adversarial-dev/.env with the variable name OPENROUTER_API_KEY. Read this file and use this key for all OpenRouter API calls. The OpenRouter API is OpenAI-compatible — use the standard chat completions format with the base URL and model ID above.
- Document Processing: Docling with HybridChunker — runs natively in the Python backend, no microservice needed.
- Frontend package manager: Use bun (not npm) for frontend installs and scripts
- Python package manager: Use pip with a virtual environment (python -m venv .venv)

## Visual Design — CRITICAL

This is NOT a generic bootstrap app. The design must be polished and distinctive:

- **Theme**: Dark mode ONLY. Background: near-black (#0a0a0f or similar very dark blue-black). No light mode toggle needed.
- **Accent color**: Electric blue (#3b82f6) and its variants. Use blue for primary buttons, active states, links, and highlights. Add subtle blue glows on focus states.
- **Surface colors**: Use layered dark surfaces — cards/panels slightly lighter than background (#111827, #1e293b). Use subtle borders (#1e293b or rgba white at 10%) to separate elements.
- **Typography**: Use Inter or system font stack. White (#f1f5f9) for primary text, muted gray (#94a3b8) for secondary text. Chat messages should be highly readable with generous line-height.
- **Chat bubbles**: User messages right-aligned with blue background. Assistant messages left-aligned with dark surface background. Do NOT use generic gray boxes.
- **Sidebar**: Conversation list on the left (250-300px wide). Each conversation shows a title (auto-generated from first message), timestamp, and preview. Active conversation highlighted with blue accent. "New Chat" button at the top. The sidebar should be collapsible on mobile.
- **Chat input**: Fixed to bottom of the chat area. A textarea (not input) that expands with content, with a blue send button. Include a subtle animated gradient border or glow when focused.
- **Message area**: Takes up most of the screen. Messages stream in with a typing indicator when the assistant is responding. Support markdown rendering in assistant messages (use react-markdown). Code blocks should have syntax highlighting with a dark theme.
- **Loading states**: Use skeleton loaders or subtle pulse animations, not spinners.
- **Scrolling**: Auto-scroll to bottom on new messages, but stop auto-scrolling if user has scrolled up to read history.
- **Overall feel**: Think "premium developer tool" — clean, spacious, minimal chrome, no clutter. Similar energy to Linear, Vercel dashboard, or Raycast.

## RAG Pipeline Architecture

### Docling Hybrid Chunking (in the Python backend)

Use Docling's HybridChunker directly in the FastAPI backend for intelligent document chunking:

**Install dependencies:**
```bash
pip install "docling-core[chunking]" fastapi uvicorn aiosqlite httpx python-dotenv openai
```

**How to use Docling HybridChunker for plain text/transcripts:**
```python
from docling_core.types.doc import DoclingDocument, DocumentOrigin
from docling_core.types.doc.labels import DocItemLabel
from docling.chunking import HybridChunker

# Build a DoclingDocument from plain text (no PDF needed)
doc = DoclingDocument(name="Video Title")
doc.add_text(label=DocItemLabel.TITLE, text="Video Title")

# If transcript has sections/chapters, add as SECTION_HEADER + PARAGRAPH pairs:
doc.add_text(label=DocItemLabel.SECTION_HEADER, text="Introduction")
doc.add_text(label=DocItemLabel.PARAGRAPH, text="The actual transcript text...")

# Or for unstructured transcript, just add as one paragraph:
doc.add_text(label=DocItemLabel.PARAGRAPH, text=full_transcript)

# Chunk with HybridChunker
chunker = HybridChunker(max_tokens=512, merge_peers=True)
chunks = list(chunker.chunk(dl_doc=doc))

# IMPORTANT: Use contextualize() for the text to embed — it prepends heading metadata
for chunk in chunks:
    enriched_text = chunker.contextualize(chunk)  # includes heading breadcrumbs
    # This enriched_text is what gets embedded and stored
```

**Key points about HybridChunker:**
- It's a 3-stage pipeline: structure-based split → token-aware split (via semchunk) → peer merge
- It respects document structure — never splits a heading from its content
- `contextualize(chunk)` prepends heading breadcrumbs for better embedding quality
- `merge_peers=True` prevents tiny fragments from becoming standalone chunks
- Set `max_tokens` to match your embedding model's sweet spot (512 is good for text-embedding-3-small)

### Content Ingestion
- Create a POST /api/ingest endpoint that accepts content and processes it into the RAG pipeline
- For the MVP, seed the database with mock YouTube video content on first startup (create a seed script). Generate 8-10 mock videos with realistic titles, descriptions, and transcript content about AI/coding topics (as if from a YouTube creator's channel). Each video should have 2-5 paragraphs of transcript content.
- When ingesting content, use Docling HybridChunker directly in the backend to chunk the text
- Generate embeddings for each chunk by calling OpenRouter's embeddings API: POST https://openrouter.ai/api/v1/embeddings with model "openai/text-embedding-3-small" and the same OPENROUTER_API_KEY. Use the openai Python SDK pointed at OpenRouter's base URL.
- Store chunks and their embedding vectors in SQLite (store embeddings as JSON arrays of floats)

### Retrieval
- When a user sends a message, embed their query using OpenRouter embeddings API (same model: openai/text-embedding-3-small)
- Compute cosine similarity against all stored chunk embeddings in SQLite
- Retrieve the top 5 most relevant chunks
- Include retrieved context in the system prompt sent to the LLM

### Generation
- Send the user's message plus retrieved context to OpenRouter chat completions (model: anthropic/claude-sonnet-4.6, base URL: https://openrouter.ai/api/v1)
- Stream the response back to the frontend using Server-Sent Events (SSE) via FastAPI's StreamingResponse
- The system prompt should instruct the model to answer based on the provided context and cite which video the information came from
- Use the openai Python SDK with base_url="https://openrouter.ai/api/v1" and api_key=OPENROUTER_API_KEY for both embeddings and chat completions

## Conversation Management

### Database Schema
- conversations table: id (UUID), title (auto-generated from first message), created_at, updated_at
- messages table: id (UUID), conversation_id (FK), role (user/assistant), content (text), created_at
- chunks table: id, video_id, content, embedding (JSON), chunk_index
- videos table: id, title, description, url, transcript, created_at

### API Endpoints
- GET /api/conversations — list all conversations (sorted by most recent)
- POST /api/conversations — create new conversation
- GET /api/conversations/{id} — get conversation with all messages
- DELETE /api/conversations/{id} — delete a conversation
- POST /api/conversations/{id}/messages — send a message and get streaming SSE response
- GET /api/videos — list ingested videos
- POST /api/ingest — ingest new content

### Frontend State
- Active conversation ID in URL (use React Router)
- Optimistic updates for sent messages
- Streaming response appended to the message list in real-time

## E2E Testing with Agent Browser CLI

The evaluator agent has access to `agent-browser` (already installed globally). To test the frontend:

1. Start the dev server: The app should be runnable with a single command from the app/ directory, serving the frontend on a known port (e.g., 5173 for Vite dev server) and the backend API on port 8000 (FastAPI default via uvicorn).
2. Use agent-browser to test:
   ```bash
   # Open the app
   agent-browser open http://localhost:5173

   # Wait for it to load
   agent-browser wait --load networkidle

   # Take a snapshot of interactive elements
   agent-browser snapshot -i

   # Click "New Chat" button
   agent-browser click @e<ref>

   # Type a message in the chat input
   agent-browser fill @e<ref> "What videos do you have about AI agents?"

   # Send the message
   agent-browser click @e<send-button-ref>

   # Wait for response to stream in
   agent-browser wait --text "Based on"
   agent-browser wait 3000

   # Take a screenshot to verify the UI
   agent-browser screenshot chat-test.png

   # Snapshot to verify message structure
   agent-browser snapshot -i
   ```
3. The evaluator should verify: dark theme is applied, blue accents are visible, sidebar shows conversations, messages render with proper styling, and the RAG pipeline returns relevant context from ingested videos.

## Project Structure

```
app/
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── ChatArea.tsx
│   │   │   ├── ChatInput.tsx
│   │   │   ├── Message.tsx
│   │   │   └── MarkdownRenderer.tsx
│   │   └── styles/
│   │       └── globals.css
│   └── tailwind.config.js
├── backend/
│   ├── requirements.txt
│   ├── main.py              (FastAPI app entry point)
│   ├── config.py             (env vars, settings)
│   ├── db/
│   │   ├── schema.py         (SQLite schema + migrations)
│   │   ├── repository.py     (data access layer — abstractable to Postgres)
│   │   └── seed.py           (mock YouTube video content)
│   ├── rag/
│   │   ├── chunker.py        (Docling HybridChunker integration)
│   │   ├── embeddings.py     (OpenRouter embeddings via openai SDK)
│   │   └── retriever.py      (cosine similarity search)
│   ├── llm/
│   │   └── openrouter.py     (OpenRouter chat completions with streaming)
│   └── routes/
│       ├── conversations.py
│       ├── messages.py
│       └── ingest.py
├── .env                      (copied from root .env)
└── start.sh                  (starts both frontend and backend)
```

## Important Notes

- The .env file with OPENROUTER_API_KEY is at the ABSOLUTE path: C:/Users/colem/open-source/adversarial-dev/.env — read it from there and either copy it into app/.env or reference it directly in config.py using python-dotenv.
- Use bun for the frontend (install, dev server, etc.)
- Use pip + venv for the Python backend
- The SQLite database file should be stored at app/backend/data/chat.db
- Run the seed script automatically on first startup if the database is empty
- Create a start.sh (and start.bat for Windows) script that: (1) sets up the Python venv and installs requirements if needed, (2) starts the FastAPI backend on port 8000 via uvicorn, (3) starts the Vite frontend dev server on port 5173. Use concurrently or just background processes.
- The Vite config should proxy /api requests to http://localhost:8000 so the frontend can call the backend without CORS issues
- Make sure all Python dependencies are in requirements.txt: docling-core[chunking], fastapi, uvicorn[standard], aiosqlite, httpx, python-dotenv, openai
- Make sure all frontend dependencies are in package.json and installed before running
