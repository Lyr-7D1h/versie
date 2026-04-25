import { Bookmark } from './Bookmark'
import { BookmarkNotFoundError } from './VersieError'
import { CommitHash } from './Commit'
import { VersieStorageError } from './VersieStorage'
import { Result } from 'typescript-result'
import { Sha256Hash } from './Sha256Hash'

/** Simple data structure for modifying and looking up vcs bookmarks in memory */
export class Bookmarks {
  private readonly bookmarks: Map<string, Bookmark>
  // Maps base64 encoded commit hash to bookmarks
  private readonly lookup: Map<string, Bookmark[]>

  constructor() {
    this.bookmarks = new Map()
    this.lookup = new Map()
  }

  setCommit(
    bookmarkName: string,
    commit: CommitHash,
  ): Result<Bookmark, BookmarkNotFoundError | VersieStorageError> {
    const bookmark = this.getBookmark(bookmarkName)
    if (bookmark === null) {
      return Result.error(new BookmarkNotFoundError(bookmarkName))
    }

    // update lookup - remove from old commit
    this.lookupDelete(bookmark.name, bookmark.commit.toHex())

    const newBookmark = new Bookmark(bookmark.name, commit, bookmark.createdOn)
    this.bookmarks.set(bookmarkName, newBookmark)
    this.lookupAdd(newBookmark)

    return Result.ok(newBookmark)
  }

  getAllBookmarks(): Bookmark[] {
    return [...this.bookmarks.values()]
  }

  getBookmark(name: string): Bookmark | null {
    return this.bookmarks.get(name) ?? null
  }

  bookmarkLookup(commit: CommitHash): Bookmark[] | null {
    const v = this.lookup.get(commit.toBase64(true))
    if (typeof v === 'undefined') return null
    return v
  }

  private lookupDelete(name: string, commitHex: string) {
    const key = Sha256Hash.fromHex(commitHex).toBase64(true)
    const b = this.lookup.get(key)
    if (typeof b === 'undefined') return
    const bms = b.filter((x) => x.name !== name)
    if (bms.length === 0) {
      this.lookup.delete(key)
      return
    }
    this.lookup.set(key, bms)
  }

  private lookupAdd(bookmark: Bookmark) {
    const key = bookmark.commit.toBase64(true)
    const bms = this.lookup.get(key)
    this.lookup.set(key, bms ? [...bms, bookmark] : [bookmark])
  }

  add(bookmark: Bookmark | Bookmark[]) {
    if (!Array.isArray(bookmark)) bookmark = [bookmark]
    for (const bm of bookmark) {
      this.bookmarks.set(bm.name, bm)
      this.lookupAdd(bm)
    }
  }

  remove(
    name: string,
  ): Result<Bookmark, BookmarkNotFoundError | VersieStorageError> {
    const bm = this.getBookmark(name)
    if (!bm) return Result.error(new BookmarkNotFoundError(name))
    this.bookmarks.delete(name)
    this.lookupDelete(bm.name, bm.commit.toHex())
    return Result.ok(bm)
  }
}
