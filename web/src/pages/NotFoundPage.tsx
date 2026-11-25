// NOT FOUND
// Purpose: the 404 page

import { Link } from "react-router"

export function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <h1 className="font-display text-5xl text-brown">Not found</h1>
      <p className="mt-2 text-stone-600">That machine or page doesn't exist.</p>
      <Link to="/" className="mt-4 inline-block rounded-lg bg-forest px-4 py-2 font-semibold text-cream">
        Back to the gym floor
      </Link>
    </div>
  )
}
