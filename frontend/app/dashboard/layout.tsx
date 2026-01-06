"use client"

import { ProtectedRoute } from "@/components/auth/ProtectedRoute"
import { useAuthStore } from "@/lib/stores/authStore"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { LogOut, Folder, Gamepad2 } from "lucide-react"
import { useRouter } from "next/navigation"
import Link from "next/link"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const { logout, user } = useAuthStore()

  const handleLogout = () => {
    logout()
    router.push("/login")
  }

  return (
    <ProtectedRoute>
      <div className="min-h-screen flex flex-col">
        {/* Top Navbar */}
        <header className="border-b bg-card/50 backdrop-blur-lg sticky top-0 z-40">
          <div className="container mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <Link href="/dashboard" className="flex items-center gap-2 group">
                <div className="bg-primary/10 p-2 rounded-lg border border-primary/20 group-hover:border-primary/50 group-hover:shadow-[0_0_15px_rgba(139,92,246,0.3)] transition-all duration-300">
                  <Gamepad2 className="h-5 w-5 text-primary" />
                </div>
                <span className="text-lg font-bold tracking-tight text-foreground">
                  HitBox
                </span>
              </Link>
              <Link href="/dashboard">
                <Button variant="ghost" size="sm" className="gap-2">
                  <Folder className="h-4 w-4" />
                  Projects
                </Button>
              </Link>
            </div>

            <div className="flex items-center gap-4">
              {user && (
                <span className="text-sm text-muted-foreground hidden md:inline">
                  {user.name || user.email}
                </span>
              )}
              <ThemeToggle />
              <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-2">
                <LogOut className="h-4 w-4" />
                <span className="hidden md:inline">Logout</span>
              </Button>
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1">
          {children}
        </main>
      </div>
    </ProtectedRoute>
  )
}
