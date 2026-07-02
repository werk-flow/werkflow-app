'use client'

export function startCalendarDragState() {
  document.body.classList.add('is-dragging')
  document.body.style.cursor = 'grabbing'
  document.body.style.userSelect = 'none'
}

export function clearCalendarDragState() {
  document.body.classList.remove('is-dragging')
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}
