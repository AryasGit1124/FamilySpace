import type { Metadata } from 'next'
import { WeekScheduleView } from '@/components/week-schedule-view'

export const metadata: Metadata = { title: '周课表' }

export default function SchedulePage() {
  return <WeekScheduleView />
}
