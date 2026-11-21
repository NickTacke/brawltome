import type { MouseEvent } from 'react'

// pressing a result or button keeps the cursor in the field, so the arrow keys carry on working and the
// search stays open until the click lands. safari never focuses a tapped link, so without this the field's
// blur closes the panel and the link is gone before its click fires
export function keepFieldFocus(event: MouseEvent) {
  event.preventDefault()
}
