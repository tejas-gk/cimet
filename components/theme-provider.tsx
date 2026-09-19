"use client"

import * as React from "react"

type Theme = "light" | "dark"

function ThemeProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [theme, setTheme] = React.useState<Theme>("dark")

  React.useEffect(() => {
    const stored = localStorage.getItem("theme")

    const initialTheme: Theme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"

    setTheme(initialTheme)

    document.documentElement.classList.toggle(
      "dark",
      initialTheme === "dark"
    )
  }, [])

  React.useEffect(() => {
    document.documentElement.classList.toggle(
      "dark",
      theme === "dark"
    )

    localStorage.setItem("theme", theme)
  }, [theme])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.key.toLowerCase() !== "d") {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      setTheme((current) =>
        current === "dark" ? "light" : "dark"
      )
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [])

  return <>{children}</>
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

export { ThemeProvider }