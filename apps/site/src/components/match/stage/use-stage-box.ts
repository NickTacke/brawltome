import { type RefObject, useLayoutEffect, useState } from 'react'

type Size = { width: number; height: number }

// something that lies on the stage and the stage it lies on, as laid out
export type StageBox = { element: Size; stage: Size }

/** Measures an element on the stage and the stage itself, again whenever either changes size or the key does. */
export function useStageBox(elementRef: RefObject<HTMLElement | null>, key: string): StageBox | null {
  const [box, setBox] = useState<StageBox | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for content that changes the element's size
  useLayoutEffect(() => {
    const element = elementRef.current
    const stage = element?.offsetParent

    if (!element || !stage) return

    const measure = () =>
      setBox({
        element: { width: element.offsetWidth, height: element.offsetHeight },
        stage: { width: stage.clientWidth, height: stage.clientHeight },
      })

    const observer = new ResizeObserver(measure)

    measure()
    observer.observe(stage)
    observer.observe(element)

    return () => observer.disconnect()
  }, [elementRef, key])

  return box
}
