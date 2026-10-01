import { useCallback, useEffect, useRef, useState } from 'react'
import { toNorm, toPx, squareOf } from '#/canvas/drawing'
import type { Stroke } from '#/canvas/drawing'

export function DrawCanvas({
  strokes,
  onChange,
}: {
  strokes: Stroke[]
  onChange: (s: Stroke[]) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const active = useRef<number | null>(null) // one pointer per stroke: palm/2nd finger rejection
  const live = useRef<Stroke | null>(null)
  const strokesRef = useRef(strokes)
  strokesRef.current = strokes
  const [size, setSize] = useState({ w: 0, h: 0, dpr: 1 })

  const redraw = useCallback(() => {
    const c = canvasRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const { w, h, dpr } = size
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const { side, ox, oy } = squareOf(w, h)
    ctx.strokeStyle = '#d0d5dd'
    ctx.strokeRect(ox + 0.5, oy + 0.5, side - 1, side - 1)
    ctx.strokeStyle = '#111'
    ctx.lineWidth = 3
    ctx.lineCap = ctx.lineJoin = 'round'
    const all = live.current ? [...strokesRef.current, live.current] : strokesRef.current
    for (const s of all) {
      ctx.beginPath()
      s.forEach((p, i) => {
        const q = toPx(p, w, h)
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)
      })
      if (s.length === 1) ctx.lineTo(toPx(s[0], w, h).x + 0.01, toPx(s[0], w, h).y)
      ctx.stroke()
    }
  }, [size])

  // Backing store sized from container; strokes are normalized so resize never distorts.
  useEffect(() => {
    const wrap = wrapRef.current!
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      const dpr = window.devicePixelRatio || 1
      const c = canvasRef.current!
      c.width = Math.round(width * dpr)
      c.height = Math.round(height * dpr)
      setSize({ w: width, h: height, dpr })
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  useEffect(redraw, [redraw, strokes])

  // Older iOS Safari: passive listeners can't block scroll.
  useEffect(() => {
    const c = canvasRef.current!
    const stop = (e: Event) => e.preventDefault()
    c.addEventListener('touchstart', stop, { passive: false })
    c.addEventListener('touchmove', stop, { passive: false })
    return () => {
      c.removeEventListener('touchstart', stop)
      c.removeEventListener('touchmove', stop)
    }
  }, [])

  const pt = (e: React.PointerEvent | PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return toNorm(e.clientX - r.left, e.clientY - r.top, r.width, r.height)
  }

  const end = (e: React.PointerEvent) => {
    if (e.pointerId !== active.current) return
    active.current = null
    const s = live.current
    live.current = null
    if (s) onChange([...strokesRef.current, s])
  }

  return (
    <div ref={wrapRef} className="canvas-wrap">
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          if (active.current !== null) return
          active.current = e.pointerId
          e.currentTarget.setPointerCapture(e.pointerId)
          e.preventDefault()
          live.current = [pt(e)]
          redraw()
        }}
        onPointerMove={(e) => {
          if (e.pointerId !== active.current || !live.current) return
          e.preventDefault()
          // cast: lib.dom types it as always present; older Safari lacks it
          const ne = e.nativeEvent as { getCoalescedEvents?: () => PointerEvent[] }
          const evs = ne.getCoalescedEvents?.() ?? []
          for (const ev of evs.length ? evs : [e.nativeEvent]) live.current.push(pt(ev))
          redraw()
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
}
