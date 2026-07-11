import { Component } from 'react'
import { Button } from './ui/Button'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-4 text-center px-8">
          <div className="text-red-500 text-4xl">⚠</div>
          <h2 className="text-lg font-semibold text-gray-800">Something went wrong</h2>
          <p className="text-sm text-gray-500">{this.state.error?.message || 'An unexpected error occurred'}</p>
          <Button type="button" onClick={() => window.location.reload()}>
            Reload Page
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
