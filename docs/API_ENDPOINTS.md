# API Endpoints

## Authentication

### POST `/auth/signup`
```json
Request:
{
  "email": "user@example.com",
  "password": "securepass123"
}

Response:
{
  "userId": "user-abc123",
  "token": "jwt-token-here"
}
```

### POST `/auth/login`
```json
Request:
{
  "email": "user@example.com",
  "password": "securepass123"
}

Response:
{
  "userId": "user-abc123",
  "token": "jwt-token-here"
}
```

---

## Projects

### POST `/projects/create`

**Returns:** Server-Sent Events (SSE) stream

**Headers:** `Authorization: Bearer <token>`

```json
Request:
{
  "prompt": "Create a todo app with dark mode"
}

SSE Response Stream:
event: status
data: {"message": "Creating project...", "status": "initializing"}

event: status
data: {"message": "Starting pod...", "status": "pod_starting"}

event: status
data: {"message": "Installing dependencies...", "status": "installing"}

event: tool_call
data: {"tool": "write_file", "file": "src/App.tsx"}

event: tool_call
data: {"tool": "write_file", "file": "src/components/TodoList.tsx"}

event: tool_call
data: {"tool": "check_logs"}

event: status
data: {"message": "Build successful!", "status": "ready"}

event: complete
data: {
  "projectId": "proj-abc123",
  "previewUrl": "https://proj-abc123.project.apnaloveable.com",
  "status": "ready"
}
```

---

### POST `/projects/:projectId/chat`

**Returns:** Server-Sent Events (SSE) stream

**Headers:** `Authorization: Bearer <token>`

```json
Request:
{
  "message": "Add a dark mode toggle"
}

SSE Response Stream:
event: status
data: {"message": "Processing request...", "status": "thinking"}

event: tool_call
data: {"tool": "read_file", "file": "src/App.tsx"}

event: tool_call
data: {"tool": "write_file", "file": "src/contexts/ThemeContext.tsx"}

event: tool_call
data: {"tool": "check_logs"}

event: error
data: {"message": "TypeScript error found, fixing...", "attempt": 1}

event: tool_call
data: {"tool": "write_file", "file": "src/contexts/ThemeContext.tsx"}

event: tool_call
data: {"tool": "check_logs"}

event: complete
data: {
  "status": "success",
  "message": "Dark mode toggle added successfully",
  "changedFiles": ["src/contexts/ThemeContext.tsx", "src/App.tsx"]
}
```

---

### GET `/projects`

**Headers:** `Authorization: Bearer <token>`

```json
Response:
{
  "projects": [
    {
      "id": "proj-abc123",
      "name": "Todo App",
      "status": "ready",
      "previewUrl": "https://proj-abc123.project.apnaloveable.com",
      "lastActivityAt": "2025-01-15T11:45:00Z",
      "createdAt": "2025-01-15T10:30:00Z"
    },
    {
      "id": "proj-xyz789",
      "name": "Portfolio Site",
      "status": "hibernated",
      "previewUrl": "https://proj-xyz789.project.apnaloveable.com",
      "lastActivityAt": "2025-01-14T08:20:00Z",
      "createdAt": "2025-01-13T15:10:00Z"
    }
  ]
}
```

---

### GET `/projects/:projectId`

**Headers:** `Authorization: Bearer <token>`

```json
Response:
{
  "id": "proj-abc123",
  "name": "Todo App",
  "status": "ready",
  "previewUrl": "https://proj-abc123.project.apnaloveable.com",
  "podStatus": "running",
  "createdAt": "2025-01-15T10:30:00Z",
  "lastActivityAt": "2025-01-15T11:45:00Z"
}

If project is hibernated:
{
  "id": "proj-xyz789",
  "status": "hibernated",
  "previewUrl": "https://proj-xyz789.project.apnaloveable.com",
  "podStatus": "terminated",
  "message": "Project will be restored on next interaction",
  "createdAt": "2025-01-13T15:10:00Z",
  "lastActivityAt": "2025-01-14T08:20:00Z"
}
```

---

## Frontend Flow

### 1. User Opens Platform (Not Logged In)
```
User types prompt → Check auth → Redirect to /login
```

### 2. After Login/Signup
```
User types prompt → POST /projects/create → Open SSE stream

Frontend displays:
├─ "Creating project..." (event: status)
├─ "Writing files..." (event: tool_call)
├─ "Checking for errors..." (event: tool_call)
└─ Show preview URL (event: complete)
```

### 3. User Opens Old Project
```
GET /projects/:id → Returns preview URL immediately

If status: "hibernated"
  → Show "Restoring project..." message
  → Backend restores from S3 automatically on next /chat request

If status: "ready"
  → Show preview URL directly
```

### 4. User Edits Existing Project
```
User types edit request → POST /projects/:id/chat → Open SSE stream

Frontend displays:
├─ "Processing..." (event: status)
├─ "Updating files..." (event: tool_call)
├─ "Fixing errors..." (event: error, if any)
└─ "Done!" (event: complete)
```

---

## Event Types

| Event | Description | Data |
|-------|-------------|------|
| `status` | General status updates | `{ message, status }` |
| `tool_call` | Claude is using a tool | `{ tool, file, ... }` |
| `error` | Error occurred, retrying | `{ message, attempt }` |
| `complete` | Operation finished | `{ projectId, previewUrl, status }` |
| `stream_end` | SSE stream closing | `null` |
