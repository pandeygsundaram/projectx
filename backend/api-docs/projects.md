# Projects API

All endpoints require `Authorization: Bearer TOKEN`

## Create Project (SSE Stream)
```bash
curl -N -X POST http://localhost:3000/api/projects/stream \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "My App", "prompt": "A todo app with dark mode"}'
```

**Event Stream:**
```
event: stage
data: {"stage": "creating_project", "message": "Creating project..."}

event: stage
data: {"stage": "deploying", "message": "Creating deployment..."}

event: stage
data: {"stage": "scheduling", "message": "Waiting for pod to be scheduled..."}

event: stage
data: {"stage": "pulling_image", "message": "Pulling container image..."}

event: stage
data: {"stage": "cloning_repo", "message": "Cloning repository..."}

event: stage
data: {"stage": "installing_deps", "message": "Installing dependencies..."}

event: stage
data: {"stage": "ready", "message": "Project is ready!", "previewUrl": "https://abc-123.projects.samosa.wtf", "projectId": "abc-123"}
```

**Stages:** `creating_project` → `deploying` → `scheduling` → `pulling_image` → `cloning_repo` → `installing_deps` → `ready`

---

## Open/Resume Existing Project (SSE Stream)
```bash
curl -N -X POST http://localhost:3000/api/projects/abc-123/open/stream \
  -H "Authorization: Bearer TOKEN"
```

**Event Stream:**
```
event: stage
data: {"stage": "deploying", "message": "Starting project..."}

event: stage
data: {"stage": "scheduling", "message": "Waiting for pod to be scheduled..."}

event: stage
data: {"stage": "pulling_image", "message": "Pulling container image..."}

event: stage
data: {"stage": "cloning_repo", "message": "Cloning repository..."}

event: stage
data: {"stage": "installing_deps", "message": "Installing dependencies..."}

event: stage
data: {"stage": "ready", "message": "Project is ready!", "previewUrl": "https://abc-123.projects.samosa.wtf", "projectId": "abc-123"}
```

**Stages:** `deploying` → `scheduling` → `pulling_image` → `cloning_repo` → `installing_deps` → `ready`

## Stop Project
```bash
curl -X POST http://localhost:3000/api/projects/abc-123/stop \
  -H "Authorization: Bearer TOKEN"
```

**Response (200)**
```json
{"message": "Project stopped successfully"}
```

## List Projects
```bash
curl http://localhost:3000/api/projects \
  -H "Authorization: Bearer TOKEN"
```

**Response (200)**
```json
[
  {
    "id": "abc-123",
    "name": "My App",
    "status": "ready",
    "template": "vite-react",
    "createdAt": "2025-11-21T08:00:00.000Z",
    "lastActivityAt": "2025-11-21T08:30:00.000Z",
    "previewUrl": "https://abc-123.projects.samosa.wtf"
  }
]
```

## Get Project
```bash
curl http://localhost:3000/api/projects/abc-123 \
  -H "Authorization: Bearer TOKEN"
```

## Delete Project
```bash
curl -X DELETE http://localhost:3000/api/projects/abc-123 \
  -H "Authorization: Bearer TOKEN"
```

**Response (200)**
```json
{"message": "Project deleted successfully"}
```

## Get Project Files
```bash
curl http://localhost:3000/api/projects/abc-123/files \
  -H "Authorization: Bearer TOKEN"
```

**Response (200)**
```json
{
  "type": "directory",
  "name": "project",
  "children": [
    {
      "type": "file",
      "name": "package.json"
    },
    {
      "type": "directory",
      "name": "src",
      "children": [...]
    }
  ]
}
```

## Get File Content
```bash
curl "http://localhost:3000/api/projects/abc-123/file?path=src/App.tsx" \
  -H "Authorization: Bearer TOKEN"
```

**Response (200)**
```json
{
  "path": "src/App.tsx",
  "content": "import React from 'react';\n..."
}
```

## Errors

**409 Conflict (Pod already running)**
```json
{
  "error": "You already have an active project running",
  "activeProject": {
    "id": "xyz-789",
    "name": "Other Project",
    "status": "ready",
    "previewUrl": "https://xyz-789.projects.samosa.wtf"
  }
}
```

**404 Not Found**
```json
{"error": "Project not found"}
```

## Notes
- One pod per user at a time
- Pods auto-destruct after 1 hour of inactivity
