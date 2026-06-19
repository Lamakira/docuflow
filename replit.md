# DocuFlow - Internal Documentation Tool

## Overview

DocuFlow is a Notion-like documentation application designed for organizing tech projects with a rich block-based editor, nested page hierarchies, and collaborative features. The application enables teams to create, organize, and maintain structured documentation across multiple projects with an intuitive, content-first interface.

**Key Features:**
- Block-based TipTap editor with rich formatting, code blocks, task lists
- Nested page hierarchies with drag-and-drop reordering
- Image and video embeds (YouTube, Loom, Fathom) with automatic transcript extraction
- Automatic video transcript sync to AI knowledge base for Loom and Fathom videos
- Full-text search across projects and pages
- AI-powered chatbot assistant (GPT-4.1-nano) with pgvector-based semantic search for unlimited documentation access
- Company Documents page with folder organization, grid/list views, search, and file upload/text document creation
- Automatic text extraction and embedding generation for uploaded files (PDF, Word, text files)
- Dark mode support
- Page templates (Client Project, Technical Solution)

## User Preferences

Preferred communication style: Simple, everyday language.

## Test Credentials (Development / Staging)

Ces identifiants sont valides sur la branche `refactor/project_assignment` et l'environnement de développement Replit.

| Rôle | Email | Mot de passe |
|------|-------|--------------|
| **Admin principal** | `masdouk@techma.ca` | `DocuFlow2026!` |
| **Utilisateur standard** | `testuser123@example.com` | `TestUser123!` |

> ⚠️ Ces identifiants sont uniquement pour les tests (comptes de dév, non liés à la base de production). Ne pas utiliser en production.

## System Architecture

### Frontend Architecture

**Framework & Build System**
- **React 18** with TypeScript for type-safe component development
- **Vite** as the build tool and development server with hot module replacement
- **Wouter** for lightweight client-side routing
- **TanStack Query** (React Query) for server state management, caching, and data synchronization

**UI Component System**
- **shadcn/ui** component library built on Radix UI primitives
- **Tailwind CSS** for utility-first styling with custom design tokens
- Design system follows Notion-inspired principles: content-first, spatial clarity, and productive efficiency
- Three-column layout: Sidebar (240px) → Page Tree (280px resizable) → Editor Canvas (fluid, max 860px)

**Rich Text Editor**
- **TiptapJS** for block-based editing with extensions:
  - StarterKit for basic formatting (bold, italic, headings, lists)
  - CodeBlockLowlight with syntax highlighting via lowlight
  - TaskList/TaskItem for checklist support
  - Image, Highlight, Color, TextAlign, Underline extensions
  - Custom slash command system for block insertion
- Auto-save functionality with debounced updates

**State Management Strategy**
- Server state: TanStack Query with disabled refetching (staleTime: Infinity)
- Local UI state: React hooks (useState, useContext)
- Authentication state: Query-based with 401 handling
- Form state: React Hook Form with Zod validation

### Backend Architecture

**Server Framework**
- **Express.js** with TypeScript running on Node.js
- HTTP server created via Node's `http` module for WebSocket support readiness
- Middleware stack: JSON parsing, URL encoding, request logging with timestamps

**Authentication & Session Management**
- **Replit Auth** via OpenID Connect (OIDC) integration
- **Passport.js** with openid-client strategy for OAuth flows
- Session storage using **connect-pg-simple** with PostgreSQL backend
- JWT tokens managed through OIDC token endpoint
- Session TTL: 7 days with httpOnly, secure cookies

**API Design Pattern**
- RESTful API endpoints under `/api` prefix
- Authentication middleware (`isAuthenticated`) protecting all routes
- Error handling with appropriate HTTP status codes (401, 403, 404, 500)
- Request/response logging with duration tracking

**Database Layer**
- **Drizzle ORM** for type-safe database operations
- Schema-first design with automatic TypeScript type inference
- Relations defined between users, projects, and documents
- Zod schemas generated from Drizzle schemas for validation

### Data Storage Solutions

**Primary Database**
- **Neon Serverless PostgreSQL** via `@neondatabase/serverless` driver
- WebSocket-based connection pooling for serverless compatibility
- Connection string configured via `DATABASE_URL` environment variable

**Database Schema Structure**

**Users Table**
- Stores Replit Auth user profile data
- Fields: id (UUID), email, firstName, lastName, profileImageUrl, role, isMainAdmin, timestamps
- Automatic user upsert on login (onConflictDoUpdate)
- Main admin protection: isMainAdmin field (integer, 0/1) prevents non-main admins from modifying main admin's info (edit, delete, reset password, role change)

**Projects Table**
- Top-level organizational containers
- Fields: id (UUID), name, description, icon, ownerId (FK to users), timestamps
- Cascade deletion when owner is deleted
- Icon system with emoji representation

**Documents Table**
- Nested page hierarchy with self-referential parentId
- Fields: id (UUID), projectId (FK), parentId (nullable FK to self), title, content (JSONB), order (integer), timestamps
- Content stored as Tiptap JSON format in JSONB column
- Cascade deletion when project is deleted
- Order field for manual sorting within same parent

**Sessions Table**
- PostgreSQL session store for connect-pg-simple
- Fields: sid (primary key), sess (JSONB), expire (timestamp with index)
- Automatic session cleanup via TTL

**Document Embeddings Table**
- Stores vector embeddings for semantic search (pgvector extension)
- Fields: id (UUID), documentId (FK), projectId (FK), ownerId (FK), chunkIndex (int), chunkText (text), contentHash (varchar), embedding (vector(1536)), metadata (JSONB), timestamps
- Uses OpenAI text-embedding-3-small model for 1536-dimensional embeddings
- Chunks documents into ~800 token segments with 100 token overlap
- Hash-based change detection to avoid regenerating unchanged chunks
- Cascade deletion when document or project is deleted
- Cosine similarity indexing for fast semantic search

**Video Transcripts Table**
- Stores video transcript metadata for Loom and Fathom videos embedded in documents
- Fields: id (UUID), videoUrl, videoId, provider (loom/fathom), documentId (FK), projectId (FK), ownerId (FK), status (pending/processing/completed/error), transcript (text), errorMessage, timestamps
- Automatic sync: Videos added to documents trigger transcript extraction
- Automatic cleanup: Videos removed from documents delete transcript and embeddings
- Transcript embeddings stored in document_embeddings with metadata including transcriptId, videoProvider, projectName, breadcrumbs
- Extraction methods: Fathom API (requires FATHOM_API_KEY) and Loom web scraping
- Background processing for smooth UX with TranscriptStatusBanner showing real-time progress

**Company Document Embeddings Table**
- Stores vector embeddings for company documents (separate from project document embeddings)
- Fields: id (UUID), companyDocumentId (FK), folderId (FK), chunkIndex (int), chunkText (text), contentHash (varchar), embedding (vector(1536)), metadata (JSONB), timestamps
- Automatic embedding generation when company documents are created or updated
- Supports text extraction from uploaded files: PDF (pdf-parse), Word (mammoth), and text files
- Semantic search via cosine similarity for AI chatbot knowledge base

**CRM Modules Table**
- Customizable modules for CRM/project management system
- Fields: id (UUID), name, slug (unique), description, icon, sortOrder (int), isEnabled (int 0/1), isSystem (int 0/1), timestamps
- System modules cannot be deleted (isSystem flag)
- Modules can be enabled/disabled independently

**CRM Module Fields Table**
- Custom fields within each CRM module
- Fields: id (UUID), moduleId (FK), name, slug, fieldType (enum: text, number, date, datetime, select, multiselect, checkbox, textarea, email, phone, url, currency), description, placeholder, defaultValue, options (text array for select/multiselect), isRequired (int 0/1), isEnabled (int 0/1), isSystem (int 0/1), sortOrder (int), timestamps
- 12 supported field types with validation
- Options array for dropdown and multi-select fields
- Cascade deletion when parent module is deleted

**CRM Custom Field Values Table**
- Stores actual values for custom fields per CRM project
- Fields: id (UUID), crmProjectId (FK), fieldId (FK), value (text), timestamps
- Unique constraint on crmProjectId + fieldId combination
- Cascade deletion when project or field is deleted

**Object Storage**
- **Google Cloud Storage** integration via `@google-cloud/storage`
- Authentication using Replit Sidecar OAuth2 flow
- Access control system with ObjectAclPolicy interface
- Public/private visibility controls
- Support for user/group-based permissions (READ/WRITE)

### External Dependencies

**Third-Party Services**

**Replit Platform Services**
- Replit Auth (OIDC) for authentication
- Replit Sidecar for GCS credential provisioning
- Replit Vite plugins: runtime error overlay, cartographer, dev banner

**Google Cloud Platform**
- Google Cloud Storage for file/image storage
- External account credentials via token exchange

**Development Tools**
- TypeScript compiler with strict mode enabled
- ESBuild for server-side bundling in production
- Vite for client-side development and builds
- Drizzle Kit for database migrations

**Key NPM Packages**

**UI & Interaction**
- `@radix-ui/*` - 20+ accessible component primitives
- `@hello-pangea/dnd` - Drag and drop for page reordering
- `@tiptap/*` - Rich text editor extensions
- `lowlight` - Syntax highlighting with common language support
- `react-day-picker` - Calendar component
- `vaul` - Drawer component

**Data & Validation**
- `zod` - Runtime type validation
- `drizzle-zod` - Zod schema generation from Drizzle
- `date-fns` - Date formatting utilities

**Styling**
- `tailwindcss` with custom configuration
- `class-variance-authority` (cva) - Variant management
- `tailwind-merge` - Class name merging
- Google Fonts: Inter (UI), JetBrains Mono (code)

**Build & Development**
- `tsx` - TypeScript execution for Node.js
- `vite` with React plugin
- `esbuild` - Production server bundling
- `ws` - WebSocket support for Neon

**Design System Tokens**
- CSS variables for theme colors (light/dark mode support)
- Neutral-based palette inspired by Notion/Linear
- Consistent spacing scale: 2, 3, 4, 6, 8, 12, 16 (Tailwind units)
- Typography hierarchy with Inter for UI and system fonts for content
- Shadow system: 2xs, xs, sm, md, lg, xl, 2xl

### MCP Server (Claude Integration)

**Location**: `mcp-server/`

The MCP (Model Context Protocol) server enables Claude Desktop to interact with DocuFlow directly. It communicates via STDIO transport and calls the DocuFlow REST API using API key authentication.

**Authentication**: Uses `X-API-Key` header with the `MCP_API_KEY` environment variable. The API key authenticates as the main admin user.

**Build**: `npx tsc --project mcp-server/tsconfig.json` outputs to `mcp-server/build/index.js`

**Available Tools** (22 total):
- Projects: list_projects, get_project
- Documents: list_documents, get_document, create_document, update_document, delete_document, list_recent_documents
- Search: search (full-text across all projects)
- CRM Clients: list_clients, get_client, create_client
- CRM Projects: list_crm_projects, get_crm_project
- Time Tracking: list_time_entries, get_time_tracking_stats, start_time_tracking, stop_time_tracking, get_active_time_entry
- AI: ask_ai (semantic search + GPT response)
- Users: list_users
- Notifications: get_notifications

**Environment Variables** (set in Claude Desktop config):
- `DOCUFLOW_API_URL`: The published app URL (e.g. https://your-app.replit.app)
- `DOCUFLOW_API_KEY`: The MCP_API_KEY value from the app's environment

### Time Tracking Architecture

**TimeTrackerContext** (`client/src/contexts/TimeTrackerContext.tsx`):
- Single global source of truth for all timer state (active entry, duration, idle detection, screen capture)
- Uses ref pattern (`stopScreenCaptureRef`) to avoid TDZ issues with circular callback dependencies
- Idle detection: 3-minute inactivity threshold, auto-STOP after 30-second countdown dialog
- Screenshot capture: Random 180-300s intervals, retry logic with max 5 consecutive failures, video readyState validation
- Backend auto-stops previous active entry when starting a new one

### Desktop Agent Installers

**Emplacement des installeurs** : stockés dans Google Cloud Storage (GCS), bucket `replit-objstore-64708bc7-367f-45c8-9004-db72f81cbeba`, dossier `public/installers/`.

> ⚠️ **Important** : ce bucket est géré par Replit via un OAuth sidecar interne. Il n'est **pas** accessible depuis GitHub Actions avec un service account Google standard. Pour la pipeline CI/CD, utiliser un **bucket GCS externe** (créé dans votre propre projet GCP).

**Versions publiées via Replit** (v0.1.7 — dernière version enregistrée en DB) :
| Plateforme | Fichier | Taille |
|------------|---------|--------|
| Windows | `DocuFlow-Agent-0.1.7-windows-setup.exe` | ~65 MB |
| macOS | `DocuFlow-Agent-0.1.7-macos.dmg` | ~94 MB |
| Linux | `DocuFlow-Agent-0.1.7-linux-amd64.deb` | ~74 MB |

**v0.1.8 — État** : compilée avec succès (GitHub Actions artifacts, rétention 7 jours), mais **non uploadée sur GCS et non enregistrée en DB** — les endpoints de téléchargement retournent encore v0.1.7. Voir "Workflow de release CI/CD" ci-dessous pour finaliser.

**Architecture de distribution** :
- Les installeurs sont trop volumineux (~65-94 MB) pour le proxy inverse de Replit (~50 MB max)
- Solution : `server/downloadRoutes.ts` génère des **URL signées GCS** (valides 15 min) via une redirection 302
- Endpoint de disponibilité : `GET /api/downloads/desktop/availability` → `{ windows: bool, macos: bool, linux: bool }`
- Endpoint de téléchargement : `GET /downloads/:platform` → 302 vers URL signée GCS
- La DB (`desktop_releases`) stocke le `storageUrl` GCS, `sha256`, `fileSize` et `isLatest` par plateforme

**Scripts de build** (`desktop-agent/scripts/`) :
- `dist-win.js` — build Windows NSIS installer via electron-forge + electron-builder
- `dist-mac.js` — build macOS DMG (requiert macOS + certificats Apple)
- `dist-linux.js` — build Linux .deb ; inclut deux correctifs critiques :
  1. **Fix permissions Step 1.5** : `chmod 755` sur le dossier `out/` après `electron-forge package` (electron-forge crée parfois le dossier en `700`, bloquant l'accès aux utilisateurs normaux)
  2. **Patch postinst Step 3** : extrait le `.deb`, injecte `chmod 755 '/opt/DocuFlow Desktop Agent'` dans le script `postinst`, et repackage le `.deb` — permet que les permissions soient corrigées même lors d'une **mise à jour** (dpkg ne remet pas à jour les permissions d'un dossier existant)
- `upload-to-gcs.mjs` — upload un installeur vers GCS via l'API sidecar Replit (bucket Replit uniquement)
- `fix-permissions.js` — correctif de permissions (utilisé lors du build, non invoqué directement)

**Script d'enregistrement en DB** :
```bash
curl -X POST https://docs.appvibed.com/api/internal/desktop-releases \
  -H "Authorization: Bearer $DESKTOP_RELEASE_CI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "linux",
    "version": "0.1.8",
    "filename": "DocuFlow-Agent-0.1.8-linux-amd64.deb",
    "storageUrl": "https://storage.googleapis.com/<BUCKET>/installers/v0.1.8/DocuFlow-Agent-0.1.8-linux-amd64.deb",
    "sha256": "...",
    "fileSize": 0
  }'
```

**Workflow de mise à jour manuel (via Replit — bucket Replit)** :
1. Rebuilder : `cd desktop-agent && npm run dist:linux` (ou `dist:win` / `dist:mac`)
2. Uploader : `node scripts/upload-to-gcs.mjs linux desktop-agent/release/<fichier>.deb`
3. Enregistrer en DB via l'endpoint ci-dessus (dev ET prod partagent la même DB Neon)
4. Déployer si des modifications de code serveur sont incluses

---

### Workflow de release CI/CD (GitHub Actions)

**Repo** : `billos-e/TECHMA-DOCUMENTATION-PLATFORM`
**Fichier** : `.github/workflows/desktop-release.yml`

**Comportement selon le déclencheur** :

| Déclencheur | Build | Upload GCS | Enregistrement DB |
|-------------|-------|------------|-------------------|
| `git push` sur un tag `desktop-agent-v*` | ✅ | ✅ | ✅ |
| Déclenchement manuel (Actions → Run workflow) | ✅ | ❌ skippé | ❌ skippé |

> Le paramètre `dry_run` visible dans l'UI de déclenchement manuel est **non fonctionnel** — il est défini dans le YAML mais jamais lu dans les conditions. Le seul vrai interrupteur est le type d'événement (`push` sur tag vs `workflow_dispatch`). Un déclenchement manuel produit toujours un build-only.

**Secrets GitHub requis** (Settings → Secrets and variables → Actions) :

| Secret | Description |
|--------|-------------|
| `GCS_RELEASE_SA_KEY` | JSON brut d'une clé de service account GCP avec rôle `Storage Object Admin` sur le bucket |
| `INSTALLER_GCS_BUCKET` | Nom du bucket GCS externe (ex: `techma-desktop-releases`) — **pas** le bucket Replit |
| `DOCUFLOW_API_URL` | `https://docs.appvibed.com` |
| `DESKTOP_RELEASE_CI_TOKEN` | Valeur de l'env var Replit (récupérable via `echo $DESKTOP_RELEASE_CI_TOKEN` dans le shell) |

**Pour publier une nouvelle version** :
```bash
# 1. Bumper la version dans desktop-agent/package.json
# 2. Committer et pousser sur main
# 3. Créer et pousser le tag
git tag desktop-agent-v0.1.X
git push origin desktop-agent-v0.1.X
# → GitHub Actions compile + uploade sur GCS + enregistre en DB automatiquement
```

**Notes Linux spécifiques** :
- Sur **Wayland** : l'app demande une autorisation de partage d'écran à chaque session (comportement normal du portail XDG/PipeWire, imposé par Wayland pour la sécurité). Pour éviter ce dialogue, utiliser une session **X11/Xorg** à la connexion.
- Sur **X11** : aucun dialogue de permission pour les captures d'écran.
- Installation propre recommandée lors d'une mise à jour : `sudo dpkg --purge docuflow-agent && sudo dpkg -i <nouveau.deb>` (évite les problèmes de permissions résiduelles si l'ancienne version avait le bug `700`).