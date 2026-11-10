import { createFileRoute } from '@tanstack/react-router'
import { servePatchImage } from '../server/patch-image-proxy'

// patch art is fetched here instead of in the visitor's browser, so visiting home never contacts blue mammoth's cms
export const Route = createFileRoute('/patch-images/$name')({
  server: { handlers: { GET: ({ params }) => servePatchImage(params.name) } },
})
