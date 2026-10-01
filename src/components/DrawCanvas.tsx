import { useCallback, useEffect, useRef, useState } from 'react'
import { fmtDist, gridSpec } from '../canvas/grid'
import { toNorm, toPx, squareOf } from '../canvas/drawing'
import type { Stroke } from '../canvas/drawing'

const FONT = '800 15px Nunito, ui-rounded, system-ui, sans-serif'

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function DrawCanvas({
  strokes,
  onChange,
  mPerSquare,
}: {
  strokes: Stroke[]
  onChange: (s: Stroke[]) => void
  /** Real-world meters across the canvas square at the current target distance. */
  mPerSquare: number
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

    // "touch screen": soft panel inside a bezel, clipped so dots/strokes stay on it
    ctx.save()
    roundRect(ctx, ox + 2, oy + 2, side - 4, side - 4, 18)
    ctx.fillStyle = '#fbfdff'
    ctx.fill()
    ctx.clip()

    // distance dots: minor every 100 m-ish, rings every 10× (1 km)
    const g = gridSpec(mPerSquare, side)
    // centered on the square so a 1 km ring always sits in the middle of the screen
    const n = Math.ceil(side / 2 / g.minorPx)
    const cx = ox + side / 2
    const cy = oy + side / 2
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const major = i % 10 === 0 && j % 10 === 0
        ctx.beginPath()
        ctx.arc(cx + i * g.minorPx, cy + j * g.minorPx, major ? 5 : 1.8, 0, Math.PI * 2)
        if (major) {
          ctx.fillStyle = '#fff'
          ctx.fill()
          ctx.lineWidth = 2.5
          ctx.strokeStyle = '#2fa7e0'
          ctx.stroke()
        } else {
          ctx.fillStyle = '#b9cad8'
          ctx.fill()
        }
      }
    }

    ctx.strokeStyle = '#ff6b35'
    ctx.lineWidth = 5
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
    ctx.restore()

    // empty state + legend
    ctx.font = FONT
    ctx.textBaseline = 'middle'
    if (!all.length) {
      ctx.textAlign = 'center'
      ctx.fillStyle = '#7d93a6'
      ctx.font = '900 22px Nunito, ui-rounded, system-ui, sans-serif'
      ctx.fillText('✏️ Draw anything!', ox + side / 2, oy + side / 2 - 10)
      ctx.font = FONT
      ctx.fillText('or pick a stamp / write a word', ox + side / 2, oy + side / 2 + 16)
    }
    const label = `●  ${fmtDist(g.minorM)}    ◎  ${fmtDist(g.majorM)}`
    ctx.textAlign = 'left'
    const tw = ctx.measureText(label).width + 20
    roundRect(ctx, ox + 10, oy + 10, tw, 28, 14)
    ctx.fillStyle = 'rgba(255,255,255,.92)'
    ctx.fill()
    ctx.strokeStyle = '#d5dee6'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.fillStyle = '#2b3a46'
    ctx.fillText(label, ox + 20, oy + 24)
  }, [size, mPerSquare])

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
