import { Component } from 'react'
import type { ReactNode } from 'react'

/** Catches a failed lazy chunk (flaky network, or a deploy that replaced old hashed files). */
export class LoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="center">
        <div className="card">
          <p>😵 Couldn&apos;t load the map.</p>
          <button className="btn blue" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}
