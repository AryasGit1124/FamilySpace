'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import {
  mockCourseOptions,
  mockSchedule,
  mockScheduleGrid,
  mockSubjects,
  mockTaskContents,
  mockTasks,
  mockWeeklyTemplate,
  type CheckInTask,
  type ScheduleEntry,
  type ScheduleGrid,
  type Subject,
  type SubjectContent,
  type SubjectId,
  type Weekday,
  type WeeklyTemplate,
} from '@/lib/mock-data'

type AppState = {
  subjects: Subject[]
  tasks: CheckInTask[]
  schedule: ScheduleEntry[]
  courseOptions: SubjectContent[]
  taskContents: SubjectContent[]
  scheduleGrid: ScheduleGrid
  weeklyTemplate: WeeklyTemplate
  toggleTask: (taskId: string) => void
  setSubjectInTab: (subjectId: SubjectId, show: boolean) => void
  addSubject: (name: string, showInTab: boolean) => void
  setScheduleCell: (subjectId: SubjectId, weekday: Weekday, courseId: string | null) => void
  addTemplateTasks: (weekday: Weekday, contentIds: string[]) => void
  removeTemplateTask: (weekday: Weekday, contentId: string) => void
}

const AppStateContext = createContext<AppState | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [subjects, setSubjects] = useState(mockSubjects)
  const [tasks, setTasks] = useState(mockTasks)
  const [scheduleGrid, setScheduleGrid] = useState(mockScheduleGrid)
  const [weeklyTemplate, setWeeklyTemplate] = useState(mockWeeklyTemplate)

  const toggleTask = (taskId: string) =>
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: t.status === 'done' ? 'todo' : 'done' } : t)),
    )

  const setSubjectInTab = (subjectId: SubjectId, show: boolean) =>
    setSubjects((prev) => prev.map((s) => (s.id === subjectId ? { ...s, showInTab: show } : s)))

  const addSubject = (name: string, showInTab: boolean) =>
    setSubjects((prev) => [
      ...prev,
      { id: `custom-${crypto.randomUUID().slice(0, 8)}`, name, description: '自定义学科', showInTab },
    ])

  const setScheduleCell = (subjectId: SubjectId, weekday: Weekday, courseId: string | null) =>
    setScheduleGrid((prev) => {
      const row = { ...prev[subjectId] }
      if (courseId) row[weekday] = courseId
      else delete row[weekday]
      return { ...prev, [subjectId]: row }
    })

  const addTemplateTasks = (weekday: Weekday, contentIds: string[]) =>
    setWeeklyTemplate((prev) => ({
      ...prev,
      [weekday]: [...prev[weekday], ...contentIds.filter((id) => !prev[weekday].includes(id))],
    }))

  const removeTemplateTask = (weekday: Weekday, contentId: string) =>
    setWeeklyTemplate((prev) => ({ ...prev, [weekday]: prev[weekday].filter((id) => id !== contentId) }))

  return (
    <AppStateContext.Provider
      value={{
        subjects,
        tasks,
        schedule: mockSchedule,
        courseOptions: mockCourseOptions,
        taskContents: mockTaskContents,
        scheduleGrid,
        weeklyTemplate,
        toggleTask,
        setSubjectInTab,
        addSubject,
        setScheduleCell,
        addTemplateTasks,
        removeTemplateTask,
      }}
    >
      {children}
    </AppStateContext.Provider>
  )
}

export function useAppState() {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider')
  return ctx
}
