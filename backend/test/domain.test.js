import test from 'node:test'
import assert from 'node:assert/strict'
import { approvalStageFor, calculateLeaveDays } from '../src/domain.js'

test('calculates leave duration inclusively across month boundaries', () => {
  assert.equal(calculateLeaveDays('2026-01-30', '2026-02-02'), 4)
})

test('counts a single day as one and rejects reversed dates', () => {
  assert.equal(calculateLeaveDays('2026-05-10', '2026-05-10'), 1)
  assert.throws(() => calculateLeaveDays('2026-05-11', '2026-05-10'), /End date/)
  assert.throws(() => calculateLeaveDays('2026-02-30', '2026-03-01'), /End date/)
})

test('restricts decisions to the correct approval role and stage', () => {
  assert.equal(approvalStageFor('faculty', 'class_teacher', 'pending_class_teacher'), true)
  assert.equal(approvalStageFor('faculty', 'hod', 'pending_hod'), true)
  assert.equal(approvalStageFor('faculty', 'hod', 'pending_class_teacher'), false)
  assert.equal(approvalStageFor('admin', null, 'pending_admin'), true)
  assert.equal(approvalStageFor('student', null, 'pending_admin'), false)
})
