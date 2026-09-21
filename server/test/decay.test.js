import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decayCandidates } from '../decay.js'

const opts = { required: 20, buildingValue: 5, capitalHex: 'cap' }
const ids = (hexes, built = []) => decayCandidates(hexes, new Set(built), opts).map(h => h.h3_index)

test('a hex below the required garrison is a candidate', () => {
  assert.deepEqual(ids([{ h3_index: 'a', garrison: 5 }]), ['a'])
})

test('a hex at or above the requirement is safe', () => {
  assert.deepEqual(ids([{ h3_index: 'a', garrison: 20 }, { h3_index: 'b', garrison: 40 }]), [])
})

test('a finished building counts as 5 troops, not as full immunity', () => {
  // 15 + 5 = 20 -> safe; 14 + 5 = 19 -> still a candidate; 0 + 5 -> still a candidate
  assert.deepEqual(ids([{ h3_index: 'a', garrison: 15 }, { h3_index: 'b', garrison: 14 }, { h3_index: 'c', garrison: 0 }], ['a', 'b', 'c']), ['b', 'c'])
})

test('the capital is never a candidate', () => {
  assert.deepEqual(ids([{ h3_index: 'cap', garrison: 0 }]), [])
})
