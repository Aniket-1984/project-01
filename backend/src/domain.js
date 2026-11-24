export function calculateLeaveDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  if (
    Number.isNaN(start.getTime())
    || Number.isNaN(end.getTime())
    || start.toISOString().slice(0, 10) !== startDate
    || end.toISOString().slice(0, 10) !== endDate
    || end < start
  ) {
    throw new Error('End date must be on or after the start date.')
  }
  return Math.floor((end - start) / 86_400_000) + 1
}

export function approvalStageFor(role, designation, status) {
  if (role === 'admin' && status === 'pending_admin') return true
  if (role !== 'faculty') return false
  return (status === 'pending_class_teacher' && designation === 'class_teacher')
    || (status === 'pending_hod' && designation === 'hod')
}
