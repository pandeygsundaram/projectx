# HitBox - Frontend

A modern Next.js 15 frontend for building AI-powered web applications with live preview.

## Features

- **Landing Page**: Beautiful dark/light mode toggle with glassmorphism effects
- **Authentication**: Email/password login and signup with JWT
- **Projects Dashboard**: Manage all your AI-generated projects
- **Live Preview**: Real-time preview of your running applications
- **Conversation UI**: Chat-based interface for creating and modifying projects
- **SSE Integration**: Real-time updates during project creation

## Tech Stack

- **Framework**: Next.js 15 (App Router) with TypeScript
- **Styling**: Tailwind CSS v4 with OKLCH color space
- **State Management**: Zustand with localStorage persistence
- **HTTP Client**: Axios with JWT interceptors
- **Animations**: Framer Motion
- **Forms**: React Hook Form + Zod validation
- **UI Components**: Custom components with Radix UI primitives
- **Icons**: Lucide React
- **Notifications**: Sonner (toast notifications)

## Getting Started

### Prerequisites

- Node.js 18+ installed
- Backend API running on `http://localhost:3000`

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create `.env.local` file (already created):
```env
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_PREVIEW_DOMAIN=projects.samosa.wtf
```

3. Run the development server:
```bash
npm run dev
```

The app will be available at **http://localhost:3001**

## Project Structure

```
frontend/
├── app/                          # Next.js App Router
│   ├── dashboard/               # Protected dashboard pages
│   │   ├── page.tsx            # Projects list
│   │   ├── project/[id]/       # Project conversation + preview
│   │   └── layout.tsx          # Dashboard layout with auth guard
│   ├── login/page.tsx          # Login page
│   ├── signup/page.tsx         # Signup page
│   ├── layout.tsx              # Root layout with theme provider
│   ├── page.tsx                # Landing page
│   └── globals.css             # Global styles + theme variables
├── components/
│   ├── auth/
│   │   └── ProtectedRoute.tsx  # Auth guard component
│   ├── landing/                # Landing page components
│   │   ├── navbar.tsx
│   │   └── hero.tsx
│   ├── providers/
│   │   └── theme-provider.tsx  # Dark/light theme context
│   └── ui/                     # Reusable UI components
│       ├── button.tsx
│       ├── card.tsx
│       ├── input.tsx
│       └── theme-toggle.tsx
├── lib/
│   ├── api/
│   │   └── client.ts           # Axios instance with interceptors
│   ├── stores/
│   │   ├── authStore.ts        # Authentication state (Zustand)
│   │   └── projectStore.ts     # Projects state (Zustand)
│   └── utils.ts                # Utility functions
└── types/
    └── index.ts                # TypeScript type definitions
```

## API Integration

### Endpoints Used

- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User signup
- `GET /api/auth/profile` - Get user profile
- `POST /api/projects/stream` - Create project with SSE
- `GET /api/projects` - List all projects
- `GET /api/projects/:id` - Get single project
- `POST /api/projects/:id/open` - Resume hibernated project
- `POST /api/projects/:id/stop` - Stop running project
- `DELETE /api/projects/:id` - Delete project

## User Flow

1. **Landing Page** (http://localhost:3001) → See hero section with dark/light toggle
2. **Sign Up** → Create account with name, email, password
3. **Login** → Sign in with credentials
4. **Dashboard** → View all projects, create new project
5. **Create Project** → Enter description, watch real-time build progress via SSE
6. **Live Preview** → View running application in iframe
7. **Manage Projects** → Stop, resume, or delete projects

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Backend API URL | `http://localhost:3000` |
| `NEXT_PUBLIC_PREVIEW_DOMAIN` | Preview domain for projects | `projects.samosa.wtf` |

## Development

### Build for Production

```bash
npm run build
npm start
```

The production server will run on **http://localhost:3001**

### Linting

```bash
npm run lint
```

## Features Implemented

### ✅ Completed
- Landing page with dark/light theme toggle
- Email/password authentication (login/signup)
- JWT token management with Zustand + localStorage
- Protected routes with authentication guard
- Projects list page with CRUD operations
- Project creation with SSE real-time updates
- Live preview iframe integration
- Conversation UI for project interaction
- Responsive design (mobile-friendly)
- Toast notifications for user feedback
- Error handling with Axios interceptors
- Glassmorphism UI effects
- Framer Motion animations

### 🚧 Pending (Backend Support Needed)
- Google OAuth integration
- Code viewer with Monaco Editor
- File structure viewer from backend
- Conversation history API (GET /api/conversations)

## Known Issues

- Backend doesn't provide file structure yet (code viewer is placeholder)
- Conversation endpoint not implemented (GET /api/conversations)
- Google OAuth not implemented in backend

## License

MIT
