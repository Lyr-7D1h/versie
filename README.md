# versie

A lightweight version control library for the browser.

Versie ("version" in Dutch) provides git-like version control — commits, blobs, and bookmarks — designed to run entirely in the browser backed by IndexedDB.

## Features

- **Commits & history** — create commits with arbitrary metadata, traverse history, and check out any point in time
- **Bookmarks** — named pointers to commits (analogous to git branches/tags)
- **Delta compression** — blobs are stored as compressed deltas using `fast-diff` and the native `CompressionStream`/`DecompressionStream` APIs, with a Bloom filter to speed up delta lookups and an LRU cache to reduce redundant decompression
- **Pluggable storage** — implement the `Storage<M>` interface to use any backend; `IndexDBStorage` is provided out of the box
- **Import / export** — serialize and restore the full repository state

## Installation

```sh
npm install versie
```

## Usage

```ts
import { Versie, IndexDBStorage } from "versie";

type Meta = { author: string };

const storage = await IndexDBStorage.create<Meta>("my-repo");
if (!storage.ok) throw storage.error;

const vcs = await Versie.create(storage.value, (raw) => raw as Meta);
if (!vcs.ok) throw vcs.error;

const repo = vcs.value;

// Commit some content
const commit = await repo.commit("Hello, world!", { author: "Alice" });

// Check out the latest commit
const checkout = await repo.checkout(commit.value.hash);
console.log(checkout.value.data); // "Hello, world!"
```

## Storage interface

Custom backends can be provided by implementing `Storage<M>`:

```ts
import { Storage } from "versie";

class MyStorage<M> implements Storage<M> {
  // implement getCommit, setCommit, getBlob, setBlob, getDelta, setDelta,
  // getBookmark, setBookmark, removeBookmark, getAllCommits, …, import, export
}
```

## Building

```sh
npm run build       # build to dist/
npm run test        # run tests
npm run lint        # lint
```

## Roadmap

- Easy diffing between two commits 
- Efficient minified in-memory tree of all commits

## License

Apache-2.0
