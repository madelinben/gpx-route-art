import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { DrawCanvas } from '#/components/DrawCanvas'
import type { Stroke } from '#/canvas/drawing'

export const Route = createFileRoute('/')({ component: Draw })

function Draw() {
  const [strokes, setStrokes] = useState<Stroke[]>([])
  return (
    <div className="screen">
      <header className="bar">
        <button disabled={!strokes.length} onClick={() => setStrokes(strokes.slice(0, -1))}>
          Undo
        </button>
        <button disabled={!strokes.length} onClick={() => setStrokes([])}>
          Clear
        </button>
      </header>
      <DrawCanvas strokes={strokes} onChange={setStrokes} />
      <footer className="bar">
        <Link to="/map">Next: pick location</Link>
      </footer>
    </div>
  )
}
