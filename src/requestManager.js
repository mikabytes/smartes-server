import mime from "mime-types"
import zlib from "zlib"
import fs from "fs"

import DependencyGraph from "./dependencyGraph.js"
import Git from "./git.js"
import transform from "./transform.js"

let data

try {
  data = JSON.parse(fs.readFileSync(".smartes.cache"))
} catch (e) {
  data = {}
}

const cache = {
  get(rev) {
    return data[rev]
  },
  set(rev, val) {
    data[rev] = val
    fs.writeFileSync(".smartes.cache", JSON.stringify(data))
  },
}

export default function RequestManager(config) {
  return {
    async handle(treeish, path) {
      const git = Git(treeish)
      let revs
      try {
        revs = await git.getRevisions()
      } catch (e) {
        return [
          400,
          { "Content-Type": "text/text" },
          `Invalid branch/hash/tag "${treeish}"`,
        ]
      }

      let schema = {}
      let snapshot

      console.log(`Request for ${treeish}, which has ${revs.length} commits`)

      for (const rev of revs) {
        schema = cache.get(rev)
        if (!schema || rev === `39b6a67dc368f4a09a93a0eaa353bdc44a3c256a`) {
          const dp = DependencyGraph(config.entry, schema)

          const git = Git(rev)

          snapshot = await git.snapshot()

          cache.set(rev, (schema = await dp.add(snapshot)))
          console.log(schema)
          console.log(`======================`)
        }
      }

      let ret

      if (path === config.entry) {
        if (!schema[path]) {
          ret = [404, {}, "No such file."]
        } else {
          ret = await getFile(treeish, path, schema, snapshot)
        }
      } else if (pathNotInSchema(path, schema)) {
        ret = [404, {}, "No such file.\n\n" + JSON.stringify(schema, null, 4)]
      } else {
        const [realpath, version] = versionedPathToReal(path)
        ret = await getFile(treeish, realpath, schema, snapshot)
      }

      return ret
    },
  }
}

function pathNotInSchema(path, schema) {
  const [realpath, version] = versionedPathToReal(path)

  if (!realpath) {
    return true
  }

  const entry = schema[realpath]
  if (!entry || entry.version !== version) {
    return true
  }
}

const matcher = /^(.*)-(\d+)(\.[^.]+$|$)/
function versionedPathToReal(path) {
  const split = path.match(matcher)
  // paths are appended a dash and a number (version)
  if (!split) {
    return []
  }
  const realpath = split[1] + split[3]
  const version = parseInt(split[2])
  return [realpath, version]
}

async function getFile(treeish, path, schema, snapshot) {
  let contents = snapshot
    ? await snapshot[path].contents()
    : await Git(treeish).readFile(path)

  contents = transform(treeish, path, contents, schema)

  contents = await new Promise((res) => {
    zlib.gzip(contents, (_, result) => {
      res(result)
    })
  })

  return [
    200,
    { "Content-Type": mime.lookup(path), "Content-Encoding": "gzip" },
    contents,
  ]
}

function fileExists(path) {
  return new Promise((res) => {
    fs.access(path, fs.constants.R_OK, (err) => {
      res(!err)
    })
  })
}

function fileContents(path) {
  return new Promise((res, rej) => {
    fs.readFile(path, (err, data) => {
      if (err) {
        rej(err)
      } else {
        res(data)
      }
    })
  })
}
