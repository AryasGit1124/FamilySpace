import { BookOpen, Calculator, Dumbbell, Languages, Lightbulb, Sparkles, type LucideIcon } from 'lucide-react'
import type { SubjectId } from '@/lib/mock-data'

type SubjectMeta = { icon: LucideIcon; tint: string }

const subjectMeta: Record<string, SubjectMeta> = {
  chinese: { icon: BookOpen, tint: 'bg-rose-100 text-rose-700' },
  math: { icon: Calculator, tint: 'bg-sky-100 text-sky-700' },
  english: { icon: Languages, tint: 'bg-violet-100 text-violet-700' },
  thinking: { icon: Lightbulb, tint: 'bg-amber-100 text-amber-700' },
  pe: { icon: Dumbbell, tint: 'bg-emerald-100 text-emerald-700' },
}

const fallbackMeta: SubjectMeta = { icon: Sparkles, tint: 'bg-orange-100 text-orange-700' }

export function getSubjectMeta(subjectId: SubjectId): SubjectMeta {
  return subjectMeta[subjectId] ?? fallbackMeta
}
