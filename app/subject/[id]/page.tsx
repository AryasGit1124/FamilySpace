import { SubjectView } from '@/components/subject-view'
import { mockSubjects } from '@/lib/mock-data'

export function generateStaticParams() {
  return mockSubjects.map((s) => ({ id: s.id }))
}

export default async function SubjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <SubjectView subjectId={id} />
}
