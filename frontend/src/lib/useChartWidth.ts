import { useLayoutEffect, useState } from 'react'

// The width a chart should draw at: the real pixel width of its container.
//
// The charts used to draw at a fixed 760 units and let the SVG scale down, which on a phone took
// an 11-unit axis label to about 5px. Drawing at the real width keeps text its true size at every
// screen width, and only the marks get narrower.
//
// The ref is a state setter rather than a ref object because a chart can first render its "no
// data" message, with no container to measure, and only mount the container once data arrives.
export function useChartWidth(initial = 760) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(initial)

  useLayoutEffect(() => {
    if (!element) return
    const measure = () => {
      const next = Math.round(element.getBoundingClientRect().width)
      if (next > 0) setWidth(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return [setElement, width] as const
}
