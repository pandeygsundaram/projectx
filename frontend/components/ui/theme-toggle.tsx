"use client"

import { Moon, Sun } from "lucide-react"
import { motion } from "framer-motion"
import { useTheme } from "@/components/providers/theme-provider"
import { Button } from "@/components/ui/button"
import { useState } from "react"

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [rotation, setRotation] = useState(0)

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light")
    setRotation(rotation + 360)
  }

  return (
    <motion.div
      animate={{ rotate: rotation }}
      transition={{ duration: 0.8, ease: "easeInOut" }}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleTheme}
        className="relative"
      >
        <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 absolute" />
        <Moon className="h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 absolute" />
        <span className="sr-only">Toggle theme</span>
      </Button>
    </motion.div>
  )
}
