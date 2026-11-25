// CARD
// Purpose: the white panel with an optional green title bar used all over the site

import type { ReactNode } from "react"

// white panel with an optional forest green title bar, like the slides
export function Card({
  title,
  action,
  children,
  className = "",
  bodyClassName = "p-4",
  headingID: headingID,
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  headingID?: string
}) {
  return (
    <section className={`overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5 ${className}`} aria-labelledby={headingID}>
      {title && (
        <div className="flex items-center justify-between gap-2 bg-forest px-4 py-2 text-cream">
          <h2 id={headingID} className="font-display text-xl tracking-wide sm:text-2xl">
            {title}
          </h2>
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}
