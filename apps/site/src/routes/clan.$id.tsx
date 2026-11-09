import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/clan/$id')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/guild/$id', params: { id: params.id }, statusCode: 301 })
  },
})
