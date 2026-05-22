import { describe, expect, test } from 'vitest'
import { Bookmark } from './Bookmark'
import type { CommitHash } from './Commit'
import { Sha256Hash } from './Sha256Hash'

describe('Bookmark', () => {
  const validCommitHash = Sha256Hash.fromHex('0'.repeat(64)) as CommitHash
  const createdOn = new Date()

  describe('create', () => {
    test('accepts valid bookmark names', () => {
      expect(Bookmark.create('main', validCommitHash, createdOn).ok).toBe(true)
      expect(
        Bookmark.create('feature-branch', validCommitHash, createdOn).ok,
      ).toBe(true)
      expect(Bookmark.create('a', validCommitHash, createdOn).ok).toBe(true)
      expect(
        Bookmark.create('x'.repeat(32), validCommitHash, createdOn).ok,
      ).toBe(true)
    })

    test('rejects bookmark names with invalid characters', () => {
      expect(Bookmark.create('branch~1', validCommitHash, createdOn).ok).toBe(
        false,
      )
      expect(
        Bookmark.create('branch:name', validCommitHash, createdOn).ok,
      ).toBe(false)
      expect(
        Bookmark.create('branch\rname', validCommitHash, createdOn).ok,
      ).toBe(false)
      expect(
        Bookmark.create('branch\nname', validCommitHash, createdOn).ok,
      ).toBe(false)
    })

    test('rejects empty bookmark names', () => {
      const result = Bookmark.create('', validCommitHash, createdOn)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.type).toBe('invalid-bookmark-name')
      }
    })

    test('rejects bookmark names longer than 32 characters', () => {
      const result = Bookmark.create('x'.repeat(33), validCommitHash, createdOn)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.type).toBe('invalid-bookmark-name')
      }
    })
  })
})
